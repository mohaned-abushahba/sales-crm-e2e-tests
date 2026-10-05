import { test, expect } from '@playwright/test';
import { snInsert, snUpdate, snGet, snQuery, snDelete } from '../utils/servicenow-api';

const ACCOUNT_FIXTURE = {
  name: 'QA Automation Test Co',
  industry: 'technology_services',
};

const OPPORTUNITY_FIXTURE = {
  short_description: 'QA Test Opportunity for Contract Review',
  sales_cycle_type: 'new_business',
  stage: '100_qualification',
};

// Same disposable, non-configurable product used by other CPQ/OM specs — avoids the guided
// configurator, which is currently broken on opmsalescrm1 (CPQ-Logik.io tenant
// misconfiguration; see TESTING-STRATEGY.md §3).
const PRODUCT_OFFERING_SYS_ID = '05908ad73b724710d5260fa693e45a6f';
const STANDARD_PRICE_LIST_SYS_ID = '94ed8a972bb243104deaf02ac891bf4f';
const DOCUMENT_TEMPLATE_SYS_ID = '7e06a6d03bcb4310d5260fa693e45a05';

test.describe('Contract Review', () => {
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
    // term_month + contract_start_date must be set BEFORE completion so Scene 4.1's End = Start
    // + Term relationship is actually meaningful to assert (left unset, Term stays blank).
    quoteSysId = await snInsert('sn_quote_mgmt_core_quote', {
      account: accountSysId,
      source_opportunity: opportunitySysId,
      short_description: 'QA Test Quote for Contract Review',
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

  test('completing an order auto-generates exactly one Contract with End = Start + Term, visible on the account\'s Contracts tab', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // Build a Completed order (Scenes 3.1/3.3/3.4/3.5's own UI/API mechanisms) as this scene's
    // starting point. "Create order" must go through the UI — the order can't be inserted
    // directly via the Table API (TESTING-STRATEGY.md §3).
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

    // The remaining Order Management steps (submit, close tasks, approve, complete the line)
    // are precondition-building, not this scene's own assertions — Scenes 3.3/3.4/3.5 already
    // test each of those mechanisms in the UI, so drive them directly via the backend here.
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

    // The real assertion: completing the order's line(s) automatically creates the Contract for
    // the account — no separate manual step. Table name confirmed live via sys_db_object:
    // sn_pss_core_service_contract ("Customer Contract").
    let contracts: Record<string, any>[] = [];
    await expect
      .poll(
        async () => {
          contracts = await snQuery(
            'sn_pss_core_service_contract',
            `account=${accountSysId}`,
            'sys_id,number,starts,ends'
          );
          return contracts.length;
        },
        { timeout: 30_000 }
      )
      .toBe(1);
    contractSysId = contracts[0].sys_id;

    // End = Start + Term (12 months) − 1 day — the relationship FLOWS.md describes, not a
    // literal date (TESTING-STRATEGY.md §3's "Contract End Date" note applies to contract
    // records too, not just the quote header).
    const start = new Date(contracts[0].starts);
    const end = new Date(contracts[0].ends);
    const expectedEnd = new Date(start);
    expectedEnd.setMonth(expectedEnd.getMonth() + 12);
    expectedEnd.setDate(expectedEnd.getDate() - 1);
    expect(end.toISOString().slice(0, 10)).toBe(expectedEnd.toISOString().slice(0, 10));

    // UI-level check: the account's "Contracts" tab shows exactly one row with the real dates.
    // Which bucket it lands in is variable — the tab bar's overflow point shifts with the total
    // label width of whichever related lists currently have data, so "Contracts" sometimes sits
    // directly in the visible tab bar and sometimes behind "More tabs" (confirmed both ways
    // across runs of this same spec). Try the direct tab first; only open the overflow menu if
    // it isn't there.
    await page.goto(`/now/cwf/agent/record/customer_account/${accountSysId}/params/list_id/undefined`);
    const directContractsTab = page.getByRole('tab', { name: /^Contracts/ });
    const isDirectlyVisible = await directContractsTab
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (isDirectlyVisible) {
      await directContractsTab.click();
    } else {
      // Same popover-duplication quirk as every other overflow menu in this app
      // (TESTING-STRATEGY.md §3) — use the last duplicate.
      const moreTabsButton = page.getByRole('button', { name: 'More tabs', exact: true });
      await moreTabsButton.waitFor();
      await moreTabsButton.click();
      const contractsMenuItem = page.getByRole('menuitem', { name: /^Contracts/ }).last();
      await contractsMenuItem.waitFor();
      await page.waitForTimeout(400);
      await contractsMenuItem.click();
    }

    // The tab's visible text shows "Contracts (1)" but its accessible name uses a comma
    // instead ("Contracts, 1") — assert on the actual contract number link landing in the grid
    // instead of the count-label formatting, which is what actually proves the navigation and
    // the data are both correct.
    await expect(page.getByRole('link', { name: contracts[0].number, exact: true })).toBeVisible({
      timeout: 15_000,
    });
  });
});
