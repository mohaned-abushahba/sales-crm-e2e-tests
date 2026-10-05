import { test, expect } from '@playwright/test';
import { snInsert, snUpdate, snGet, snQuery, snDelete } from '../utils/servicenow-api';

const ACCOUNT_FIXTURE = {
  name: 'QA Automation Test Co',
  industry: 'technology_services',
};

const OPPORTUNITY_FIXTURE = {
  short_description: 'QA Test Opportunity for Contract Lines Review',
  sales_cycle_type: 'new_business',
  stage: '100_qualification',
};

const PRODUCT_OFFERING_SYS_ID = '05908ad73b724710d5260fa693e45a6f';
const STANDARD_PRICE_LIST_SYS_ID = '94ed8a972bb243104deaf02ac891bf4f';
const DOCUMENT_TEMPLATE_SYS_ID = '7e06a6d03bcb4310d5260fa693e45a05';

test.describe('Contract Lines Review', () => {
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
    // auto_renew must be set true on the QUOTE before completion — Scene 4.2's core assertion is
    // that this propagates all the way down to the CONTRACT LINE level, not just the header.
    // Confirmed live: leaving this unset produces auto_renew=false on the resulting contract
    // line (verified once with it unset, once with it set — the difference is exactly this
    // field, nothing else).
    quoteSysId = await snInsert('sn_quote_mgmt_core_quote', {
      account: accountSysId,
      source_opportunity: opportunitySysId,
      short_description: 'QA Test Quote for Contract Lines Review',
      document_template: DOCUMENT_TEMPLATE_SYS_ID,
      term_month: '12',
      auto_renew: 'true',
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

  test('the Contract\'s Customer Contract Lines tab shows one line per order line, carrying Term/dates and Auto-renew = true at the line level', async ({
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

    // Precondition-building only (already covered live by Scenes 3.3/3.4/3.5) — drive via the
    // backend directly.
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
          contracts = await snQuery('sn_pss_core_service_contract', `account=${accountSysId}`, 'sys_id,number');
          return contracts.length;
        },
        { timeout: 30_000 }
      )
      .toBe(1);
    contractSysId = contracts[0].sys_id;

    // The real assertion: every order line is present as its own contract line, carrying Term/
    // dates, and — critically — auto_renew = true at the CONTRACT-LINE level (not just inherited
    // display from the quote header). Table confirmed live: sn_pss_core_service_contract_line.
    // Contract Line creation lags the Contract itself by a beat — poll for it rather than
    // assuming it exists the instant the Contract does (a sibling spec hit exactly this race).
    let contractLines: Record<string, any>[] = [];
    await expect
      .poll(
        async () => {
          contractLines = await snQuery(
            'sn_pss_core_service_contract_line',
            `contract=${contractSysId}`,
            'sys_id,product_offering,term_month,starts,ends,auto_renew,sold_product'
          );
          return contractLines.length;
        },
        { timeout: 15_000 }
      )
      .toBe(orderLines.length);
    contractLineSysId = contractLines[0].sys_id;
    expect(contractLines[0].product_offering).toBe('Micro Apps');
    expect(contractLines[0].term_month).toBe('12');
    expect(contractLines[0].auto_renew).toBe('true');
    soldProductSysId = contractLines[0].sold_product
      ? (await snGet('sn_pss_core_service_contract_line', contractLineSysId, 'sold_product', 'false')).sold_product
      : undefined;

    // UI-level check: open the Contract record and its own "Customer Contract Lines" tab.
    await page.goto(`/now/cwf/agent/record/sn_pss_core_service_contract/${contractSysId}/params/list_id/undefined`);
    const contractLinesTab = page.getByRole('tab', { name: /^Customer Contract Lines/ });
    await contractLinesTab.waitFor();
    await contractLinesTab.click();

    // Same accessible-name-vs-visible-text mismatch as contract-review.spec.ts's "Contracts"
    // tab — assert on the actual line-item link in the grid, not the tab's count-label format.
    await expect(page.getByRole('link', { name: 'Micro Apps', exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
