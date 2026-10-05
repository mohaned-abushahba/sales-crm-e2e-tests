import { test, expect } from '@playwright/test';
import { snInsert, snUpdate, snQuery, snDelete } from '../utils/servicenow-api';

// Runs on both opmsalescrm1 (default .env) and opmsalescrmgd
// (`E2E_ENV_FILE=.env.opmsalescrmgd npx playwright test tests/contract-renewal.spec.ts`).
// History: on opmsalescrm1, clicking Renew threw a Critical "Unable to create an order/quote/
// opportunity" error on 2026-09-22 and again on 2026-09-30 (after the CPQ-Logik.io tenant fix,
// so a separate cause). It passed 3/3 there on 2026-10-01 with no suite change — the
// instance-side cause was never identified. If that error returns, see TESTING-STRATEGY.md §3.

const ACCOUNT_FIXTURE = {
  name: 'QA Automation Test Co',
  industry: 'technology_services',
};

const OPPORTUNITY_FIXTURE = {
  short_description: 'QA Test Opportunity for Contract Renewal',
  sales_cycle_type: 'new_business',
  stage: '100_qualification',
};

// Renew's "not sellable" guard blocks Micro Apps (sellable=false) used by most other CPQ/OM
// specs — use "Generators Monthly" instead: sellable=true AND has a real recurring price-list
// line (some other sellable=true products, e.g. "Cloud Solution", have no price-list entry at
// all and never trigger downstream Contract creation either — see TESTING-STRATEGY.md §3).
const PRODUCT_OFFERING_SYS_ID = '0ff43ddc3b0f0310d5260fa693e45a73'; // Generators Monthly
const STANDARD_PRICE_LIST_SYS_ID = '94ed8a972bb243104deaf02ac891bf4f';
const DOCUMENT_TEMPLATE_SYS_ID = '7e06a6d03bcb4310d5260fa693e45a05';

test.describe('Contract Line Renewal', () => {
  let accountSysId: string;
  let opportunitySysId: string;
  let quoteSysId: string;
  let lineItemSysId: string;
  let orderSysId: string | undefined;
  let orderLineItemSysId: string | undefined;
  let orderTaskSysIds: string[] = [];

  test.beforeEach(async () => {
    accountSysId = await snInsert('customer_account', ACCOUNT_FIXTURE);
    opportunitySysId = await snInsert('sn_opty_mgmt_core_opportunity', {
      ...OPPORTUNITY_FIXTURE,
      account: accountSysId,
    });
    quoteSysId = await snInsert('sn_quote_mgmt_core_quote', {
      account: accountSysId,
      source_opportunity: opportunitySysId,
      short_description: 'QA Test Quote for Contract Renewal',
      document_template: DOCUMENT_TEMPLATE_SYS_ID,
      term_month: '12',
      auto_renew: 'true',
    });
    lineItemSysId = await snInsert('sn_quote_mgmt_core_quote_line_item', {
      quote: quoteSysId,
      product_offering: PRODUCT_OFFERING_SYS_ID,
      price_list: STANDARD_PRICE_LIST_SYS_ID,
      short_description: 'Generators Monthly',
      line_type: 'New',
      action: 'Add',
    });
    await snUpdate('sn_quote_mgmt_core_quote', quoteSysId, { state: 'completed' });
    orderSysId = undefined;
    orderLineItemSysId = undefined;
    orderTaskSysIds = [];
  });

  test.afterEach(async () => {
    // Renewal creates a brand-new Opportunity + Quote on the same account — query for ALL of
    // them (not just the ones this run's own variables point at) rather than assuming exactly
    // one extra pair, same defensive pattern used elsewhere for contracts (TESTING-STRATEGY.md
    // §3's "opmsalescrmgd can produce more records than expected" note).
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

    const quotes = await snQuery('sn_quote_mgmt_core_quote', `account=${accountSysId}`, 'sys_id');
    for (const q of quotes) {
      const qLines = await snQuery('sn_quote_mgmt_core_quote_line_item', `quote=${q.sys_id}`, 'sys_id');
      for (const l of qLines) await snDelete('sn_quote_mgmt_core_quote_line_item', l.sys_id);
      await snDelete('sn_quote_mgmt_core_quote', q.sys_id);
    }
    const opportunities = await snQuery('sn_opty_mgmt_core_opportunity', `account=${accountSysId}`, 'sys_id');
    for (const o of opportunities) await snDelete('sn_opty_mgmt_core_opportunity', o.sys_id);

    await snDelete('customer_account', accountSysId);
  });

  test('renewing a contract line creates a new Opportunity and Quote, per Scene 5.8', async ({ page }) => {
    test.setTimeout(180_000);

    // Build a Completed order down to its Contract/Contract Line (Scenes 3.x/4.x's own
    // mechanisms) as this scene's starting point.
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
    const contractSysId = contracts[0].sys_id;

    await expect
      .poll(
        async () => {
          const contractLines = await snQuery(
            'sn_pss_core_service_contract_line',
            `contract=${contractSysId}`,
            'sys_id'
          );
          return contractLines.length;
        },
        { timeout: 15_000 }
      )
      .toBeGreaterThan(0);

    // The real assertion: select the root line's checkbox on the Contract's Customer Contract
    // Lines tab, click Renew, submit the dialog with its auto-populated defaults, and verify a
    // new Opportunity + Quote get created — the actual Scene 5.8 mechanism.
    await page.goto(`/now/cwf/agent/record/sn_pss_core_service_contract/${contractSysId}/params/list_id/undefined`);
    const contractLinesTab = page.getByRole('tab', { name: /^Customer Contract Lines/ });
    await contractLinesTab.waitFor();
    await contractLinesTab.click();

    const rowCheckbox = page.getByRole('checkbox', { name: /^Select row/ }).first();
    await rowCheckbox.waitFor();
    await rowCheckbox.click();

    const renewButton = page.getByRole('button', { name: 'Renew', exact: true });
    await expect(renewButton).toBeEnabled({ timeout: 15_000 });
    await renewButton.click();

    // This modal doesn't expose a matching role="dialog" container (same quirk as "Convert
    // lead" — see TESTING-STRATEGY.md §3), so scoping through getByRole('dialog') silently
    // matches nothing and hangs for the full timeout. Assert on the heading directly instead.
    await expect(page.getByRole('heading', { name: 'Renew customer contract line?' })).toBeVisible({
      timeout: 15_000,
    });
    // Two "Renew"-named buttons now exist (the toolbar trigger + the dialog's own submit
    // button). The dialog's copy is .first() in DOM order (apparently portaled earlier than
    // the toolbar) — same pattern as "Convert Lead"'s header vs. dialog button.
    await page.getByRole('button', { name: 'Renew', exact: true }).first().click();

    // Re-verify from the backend rather than trusting the UI: a new Opportunity and a new Quote
    // (source_opportunity pointing at it) should now exist on the account, in addition to the
    // originals — no Critical error, unlike opmsalescrm1.
    await expect
      .poll(
        async () => {
          const opportunities = await snQuery('sn_opty_mgmt_core_opportunity', `account=${accountSysId}`, 'sys_id');
          return opportunities.length;
        },
        { timeout: 30_000 }
      )
      .toBe(2);

    // Quote creation lags slightly behind the Opportunity's, and the new Quote's own
    // source_opportunity link lags a moment further behind that (observed briefly empty right
    // after the row itself appears) — poll on the fully-linked state, not just record count.
    let renewalQuote: Record<string, any> | undefined;
    await expect
      .poll(
        async () => {
          const quotes = await snQuery(
            'sn_quote_mgmt_core_quote',
            `account=${accountSysId}`,
            'sys_id,source_opportunity'
          );
          renewalQuote = quotes.find((q) => q.sys_id !== quoteSysId);
          return renewalQuote?.source_opportunity ?? '';
        },
        { timeout: 20_000 }
      )
      .not.toBe('');

    const renewalLineItems = await snQuery(
      'sn_quote_mgmt_core_quote_line_item',
      `quote=${renewalQuote!.sys_id}`,
      'product_offering'
    );
    expect(renewalLineItems.length).toBeGreaterThan(0);
    expect(renewalLineItems[0].product_offering).toBe('Generators Monthly Trade Journal');

    // Not asserted here: FLOWS.md claims the original line's own state/end date changes to
    // reflect early termination. On opmsalescrmgd it stayed "Active" with no visible end_date
    // change within the observed window — see TESTING-STRATEGY.md §3. Left as a known open item
    // rather than asserted, to avoid a flaky/inaccurate check.
  });
});
