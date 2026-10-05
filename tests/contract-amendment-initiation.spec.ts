import { test, expect } from '@playwright/test';
import { snInsert, snUpdate, snQuery, snDelete } from '../utils/servicenow-api';

const ACCOUNT_FIXTURE = {
  name: 'QA Automation Test Co',
  industry: 'technology_services',
};

const OPPORTUNITY_FIXTURE = {
  short_description: 'QA Test Opportunity for Contract Amendment Initiation',
  sales_cycle_type: 'new_business',
  stage: '100_qualification',
};

const PRODUCT_OFFERING_SYS_ID = '05908ad73b724710d5260fa693e45a6f';
const STANDARD_PRICE_LIST_SYS_ID = '94ed8a972bb243104deaf02ac891bf4f';
const DOCUMENT_TEMPLATE_SYS_ID = '7e06a6d03bcb4310d5260fa693e45a05';

test.describe('Contract Amendment Initiation', () => {
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
      short_description: 'QA Test Quote for Contract Amendment Initiation',
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

  test('"Modify entire line" is disabled with no contract line selected, and enables once its checkbox is checked', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // Build a Completed order down to its Contract/Contract Line (Scenes 3.x/4.x's own
    // mechanisms) as this scene's starting point. Precondition-building only — drive via the
    // backend directly rather than re-testing Order Management's own UI mechanics again.
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

    // The real assertion: open the Contract's own Customer Contract Lines tab. With nothing
    // selected, "Modify entire line" (and Renew/Suspend/Cancel) are disabled — only "Ramps"
    // being disabled is expected regardless, since this line isn't ramp-eligible (matches the
    // existing TESTING-STRATEGY.md §3 Ramps-button note). Selecting the line's own checkbox
    // enables it.
    await page.goto(`/now/cwf/agent/record/sn_pss_core_service_contract/${contractSysId}/params/list_id/undefined`);
    const contractLinesTab = page.getByRole('tab', { name: /^Customer Contract Lines/ });
    await contractLinesTab.waitFor();
    await contractLinesTab.click();

    const modifyEntireLineButton = page.getByRole('button', { name: 'Modify entire line', exact: true });
    await expect(modifyEntireLineButton).toBeVisible({ timeout: 15_000 });
    await expect(modifyEntireLineButton).toBeDisabled();

    const rowCheckbox = page.getByRole('checkbox', { name: /^Select row/ }).first();
    await rowCheckbox.waitFor();
    await rowCheckbox.click();

    await expect(modifyEntireLineButton).toBeEnabled({ timeout: 15_000 });

    // Negative check, other direction: unchecking it disables the action again.
    await rowCheckbox.click();
    await expect(modifyEntireLineButton).toBeDisabled();

    // The "root/bundle line vs. non-root child line" half of FLOWS.md's negative check needs a
    // multi-line bundle structure, which on this instance only comes from the guided
    // configurator (Scenes 2.2/2.3), currently blocked by the CPQ-Logik.io tenant
    // misconfiguration — out of scope until that's fixed. This fixture's single, non-bundle
    // line already exercises the "checkbox selected vs. not" half directly.
  });
});
