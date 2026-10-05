import { test, expect } from '@playwright/test';
import { snInsert, snUpdate, snGet, snQuery, snDelete } from '../utils/servicenow-api';

const ACCOUNT_FIXTURE = {
  name: 'QA Automation Test Co',
  industry: 'technology_services',
};

const OPPORTUNITY_FIXTURE = {
  short_description: 'QA Test Opportunity for Order Review',
  sales_cycle_type: 'new_business',
  stage: '100_qualification',
};

// Same disposable, non-configurable product used by other CPQ/OM specs — avoids the guided
// configurator, which is currently broken on opmsalescrm1 (CPQ-Logik.io tenant
// misconfiguration; see TESTING-STRATEGY.md §3).
const PRODUCT_OFFERING_SYS_ID = '05908ad73b724710d5260fa693e45a6f';
const STANDARD_PRICE_LIST_SYS_ID = '94ed8a972bb243104deaf02ac891bf4f';
const DOCUMENT_TEMPLATE_SYS_ID = '7e06a6d03bcb4310d5260fa693e45a05';

test.describe('Order Assignment & Review', () => {
  let accountSysId: string;
  let opportunitySysId: string;
  let quoteSysId: string;
  let lineItemSysId: string;
  let orderSysId: string | undefined;

  test.beforeEach(async () => {
    accountSysId = await snInsert('customer_account', ACCOUNT_FIXTURE);
    opportunitySysId = await snInsert('sn_opty_mgmt_core_opportunity', {
      ...OPPORTUNITY_FIXTURE,
      account: accountSysId,
    });
    quoteSysId = await snInsert('sn_quote_mgmt_core_quote', {
      account: accountSysId,
      source_opportunity: opportunitySysId,
      short_description: 'QA Test Quote for Order Review',
      document_template: DOCUMENT_TEMPLATE_SYS_ID,
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
  });

  test.afterEach(async () => {
    if (orderSysId) {
      const orderLines = await snQuery('sn_ind_tmt_orm_order_line_item', `order=${orderSysId}`, 'sys_id');
      for (const line of orderLines) await snDelete('sn_ind_tmt_orm_order_line_item', line.sys_id);
      await snDelete('sn_ind_tmt_orm_order', orderSysId);
    }
    await snDelete('sn_quote_mgmt_core_quote_line_item', lineItemSysId);
    await snDelete('sn_quote_mgmt_core_quote', quoteSysId);
    await snDelete('sn_opty_mgmt_core_opportunity', opportunitySysId);
    await snDelete('customer_account', accountSysId);
  });

  test("opening the new order's own record shows the carried-over line item intact and pre-submission", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    // "Create order" (Table API insert directly into sn_ind_tmt_orm_order fails a business
    // rule requiring account/buyer_organization to already be resolved — the UI action handles
    // that server-side) — go through the same Quote → Create order flow as order-creation.spec.ts.
    await page.goto(`/now/cwf/agent/record/sn_quote_mgmt_core_quote/${quoteSysId}/params/list_id/undefined`);
    const createOrderButton = page.getByRole('button', { name: 'Create order', exact: true });
    await createOrderButton.waitFor();
    await createOrderButton.click();

    let order: Record<string, any> | undefined;
    await expect
      .poll(
        async () => {
          const orders = await snQuery('sn_ind_tmt_orm_order', `quote=${quoteSysId}`, 'sys_id,number,state');
          order = orders[0];
          return orders.length;
        },
        { timeout: 15_000 }
      )
      .toBeGreaterThan(0);
    orderSysId = order!.sys_id;

    // Open the order's OWN record (not via the quote's sub-tab) — this is the view an Order
    // Operations persona would land on from a cross-account "Customer Orders" queue, per
    // FLOWS.md. Full cross-persona ACL/visibility verification is deferred (would need a real
    // non-admin Order Ops session — same scoping decision already made for Scene 1.2/2.5).
    await page.goto(`/now/cwf/agent/record/sn_ind_tmt_orm_order/${orderSysId}/params/list_id/undefined`);

    const lineItemsTab = page.getByRole('tab', { name: 'Line items,' });
    await lineItemsTab.waitFor();
    await lineItemsTab.click();

    await expect(page.getByRole('link', { name: /^ORDL\d+$/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: 'Micro Apps' })).toBeVisible();

    // Re-verify from the backend rather than trusting rendered text: same product, still in a
    // pre-submission state, structurally intact (exactly one line, matching the source quote).
    const orderLineItems = await snQuery(
      'sn_ind_tmt_orm_order_line_item',
      `order=${orderSysId}`,
      'product_offering,state,order_line_action'
    );
    expect(orderLineItems).toHaveLength(1);
    expect(orderLineItems[0].product_offering).toBe('Micro Apps');
    expect(orderLineItems[0].state).toBe('Draft');
  });
});
