import { test, expect } from '@playwright/test';
import { snInsert, snUpdate, snQuery, snDelete } from '../utils/servicenow-api';

const ACCOUNT_FIXTURE = {
  name: 'QA Automation Test Co',
  industry: 'technology_services',
};

const OPPORTUNITY_FIXTURE = {
  short_description: 'QA Test Opportunity for Sold Products Review',
  sales_cycle_type: 'new_business',
  stage: '100_qualification',
};

const PRODUCT_OFFERING_SYS_ID = '05908ad73b724710d5260fa693e45a6f';
const STANDARD_PRICE_LIST_SYS_ID = '94ed8a972bb243104deaf02ac891bf4f';
const DOCUMENT_TEMPLATE_SYS_ID = '7e06a6d03bcb4310d5260fa693e45a05';

test.describe('Sold Products Review', () => {
  let accountSysId: string;
  let opportunitySysId: string;
  let quoteSysId: string;
  let lineItemSysId: string;
  let orderSysId: string | undefined;
  let orderLineItemSysId: string | undefined;
  let orderTaskSysIds: string[] = [];
  let contractSysId: string | undefined;
  let contractLineSysId: string | undefined;
  let soldProductSysId: string | undefined;

  test.beforeEach(async () => {
    accountSysId = await snInsert('customer_account', ACCOUNT_FIXTURE);
    opportunitySysId = await snInsert('sn_opty_mgmt_core_opportunity', {
      ...OPPORTUNITY_FIXTURE,
      account: accountSysId,
    });
    quoteSysId = await snInsert('sn_quote_mgmt_core_quote', {
      account: accountSysId,
      source_opportunity: opportunitySysId,
      short_description: 'QA Test Quote for Sold Products Review',
      document_template: DOCUMENT_TEMPLATE_SYS_ID,
      term_month: '12',
    });
    lineItemSysId = await snInsert('sn_quote_mgmt_core_quote_line_item', {
      quote: quoteSysId,
      product_offering: PRODUCT_OFFERING_SYS_ID,
      price_list: STANDARD_PRICE_LIST_SYS_ID,
      short_description: 'Micro Apps',
      line_type: 'New',
      action: 'Add',
    });
    await snUpdate('sn_quote_mgmt_core_quote', quoteSysId, { state: 'completed' });
    orderSysId = undefined;
    orderLineItemSysId = undefined;
    orderTaskSysIds = [];
    contractSysId = undefined;
    contractLineSysId = undefined;
    soldProductSysId = undefined;
  });

  test.afterEach(async () => {
    // Query for ALL contracts/sold products on the account rather than relying only on the
    // single sys_id the test body happened to pick — an environment can produce more than the
    // expected one per completion event (observed on opmsalescrmgd: two Contract records with
    // different auto_renew values for one order, likely from a live CPQ-Logik integration path
    // opmsalescrm1's broken one never triggers; see TESTING-STRATEGY.md §3). Leaving the extras
    // untracked would orphan them once accountSysId is deleted below.
    const contracts = await snQuery('sn_pss_core_service_contract', `account=${accountSysId}`, 'sys_id');
    for (const c of contracts) {
      const lines = await snQuery('sn_pss_core_service_contract_line', `contract=${c.sys_id}`, 'sys_id');
      for (const l of lines) await snDelete('sn_pss_core_service_contract_line', l.sys_id);
      await snDelete('sn_pss_core_service_contract', c.sys_id);
    }
    const soldProducts = await snQuery('sn_install_base_sold_product', `account=${accountSysId}`, 'sys_id');
    for (const sp of soldProducts) await snDelete('sn_install_base_sold_product', sp.sys_id);
    for (const t of orderTaskSysIds) await snDelete('sn_ind_tmt_orm_order_task', t);
    if (orderLineItemSysId) await snDelete('sn_ind_tmt_orm_order_line_item', orderLineItemSysId);
    if (orderSysId) await snDelete('sn_ind_tmt_orm_order', orderSysId);
    await snDelete('sn_quote_mgmt_core_quote_line_item', lineItemSysId);
    await snDelete('sn_quote_mgmt_core_quote', quoteSysId);
    await snDelete('sn_opty_mgmt_core_opportunity', opportunitySysId);
    await snDelete('customer_account', accountSysId);
  });

  test('every order line appears as its own Sold Product with a lifecycle State, visible on the account\'s Sold Products tab', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await page.goto(`/now/cwf/agent/record/sn_quote_mgmt_core_quote/${quoteSysId}/params/list_id/undefined`);
    const createOrderButton = page.getByRole('button', { name: 'Create order', exact: true });
    await createOrderButton.waitFor();
    await createOrderButton.click();

    let order: Record<string, any> | undefined;
    await expect
      .poll(
        async () => {
          const orders = await snQuery('sn_ind_tmt_orm_order', `quote=${quoteSysId}`, 'sys_id');
          order = orders[0];
          return orders.length;
        },
        { timeout: 15_000 }
      )
      .toBeGreaterThan(0);
    orderSysId = order!.sys_id;

    // Precondition-building only (already covered live by Scenes 3.3/3.4/3.5).
    await snUpdate('sn_ind_tmt_orm_order', orderSysId, { state: 'submitted' });
    let tasks: Record<string, any>[] = [];
    await expect
      .poll(
        async () => {
          tasks = await snQuery('sn_ind_tmt_orm_order_task', `customer_order=${orderSysId}`, 'sys_id');
          return tasks.length;
        },
        { timeout: 20_000 }
      )
      .toBeGreaterThan(0);
    orderTaskSysIds = tasks.map((t) => t.sys_id);
    for (const t of orderTaskSysIds) await snUpdate('sn_ind_tmt_orm_order_task', t, { state: '5' });
    await snUpdate('sn_ind_tmt_orm_order', orderSysId, { state: 'acknowledged' });

    const orderLines = await snQuery('sn_ind_tmt_orm_order_line_item', `order=${orderSysId}`, 'sys_id');
    orderLineItemSysId = orderLines[0].sys_id;
    await snUpdate('sn_ind_tmt_orm_order_line_item', orderLineItemSysId, { state: 'completed' });

    let contracts: Record<string, any>[] = [];
    await expect
      .poll(
        async () => {
          contracts = await snQuery('sn_pss_core_service_contract', `account=${accountSysId}`, 'sys_id');
          return contracts.length;
        },
        { timeout: 30_000 }
      )
      .toBe(1);
    contractSysId = contracts[0].sys_id;

    // Contract Line creation lags the Contract itself by a beat — poll for it too rather than
    // assuming it exists the instant the Contract does (same for Sold Product below).
    let contractLines: Record<string, any>[] = [];
    await expect
      .poll(
        async () => {
          contractLines = await snQuery('sn_pss_core_service_contract_line', `contract=${contractSysId}`, 'sys_id');
          return contractLines.length;
        },
        { timeout: 15_000 }
      )
      .toBeGreaterThan(0);
    contractLineSysId = contractLines[0].sys_id;

    // The real assertion: every order line's product appears as its own Sold Product for the
    // account with a lifecycle State (not tied to a ramp segment here — Scenes 2.2/2.3's guided
    // configurator/ramps are blocked on this instance, so this fixture is a single simple line,
    // not a ramped one; the ramp-segment-lifecycle half of FLOWS.md's Scene 4.3 is out of scope
    // until that's unblocked). Table confirmed live: sn_install_base_sold_product.
    let soldProducts: Record<string, any>[] = [];
    await expect
      .poll(
        async () => {
          soldProducts = await snQuery('sn_install_base_sold_product', `account=${accountSysId}`, 'sys_id,name,state');
          return soldProducts.length;
        },
        { timeout: 15_000 }
      )
      .toBe(orderLines.length);
    soldProductSysId = soldProducts[0].sys_id;
    expect(soldProducts[0].name).toBe('Micro Apps');
    expect(soldProducts[0].state).toBe('Active');

    // UI-level check: the account's "Sold Products" tab. This one is directly visible in the
    // main tab bar in every run observed so far (unlike "Contracts", whose overflow bucket
    // varies — see contract-review.spec.ts), but check for it defensively the same way in case
    // that changes too.
    await page.goto(`/now/cwf/agent/record/customer_account/${accountSysId}/params/list_id/undefined`);
    const directSoldProductsTab = page.getByRole('tab', { name: /^Sold Products/ });
    const isDirectlyVisible = await directSoldProductsTab
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (isDirectlyVisible) {
      await directSoldProductsTab.click();
    } else {
      const moreTabsButton = page.getByRole('button', { name: 'More tabs', exact: true });
      await moreTabsButton.waitFor();
      await moreTabsButton.click();
      const soldProductsMenuItem = page.getByRole('menuitem', { name: /^Sold Products/ }).last();
      await soldProductsMenuItem.waitFor();
      await page.waitForTimeout(400);
      await soldProductsMenuItem.click();
    }

    await expect(page.getByRole('link', { name: 'Micro Apps', exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
