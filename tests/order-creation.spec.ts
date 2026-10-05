import { test, expect } from '@playwright/test';
import { snInsert, snUpdate, snGet, snQuery, snDelete } from '../utils/servicenow-api';

const ACCOUNT_FIXTURE = {
  name: 'QA Automation Test Co',
  industry: 'technology_services',
};

const OPPORTUNITY_FIXTURE = {
  short_description: 'QA Test Opportunity for Order Creation',
  sales_cycle_type: 'new_business',
  stage: '100_qualification',
};

// Same disposable, non-configurable product used by other CPQ specs — avoids the guided
// configurator, which is currently broken on opmsalescrm1 (CPQ-Logik.io tenant
// misconfiguration; see TESTING-STRATEGY.md §3).
const PRODUCT_OFFERING_SYS_ID = '05908ad73b724710d5260fa693e45a6f';
const STANDARD_PRICE_LIST_SYS_ID = '94ed8a972bb243104deaf02ac891bf4f';
const DOCUMENT_TEMPLATE_SYS_ID = '7e06a6d03bcb4310d5260fa693e45a05';

test.describe('Order Creation from a Completed Quote', () => {
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
      short_description: 'QA Test Quote for Order Creation',
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
    // This spec is about the Quote → Order handoff itself, not the approval chain (Scene 2.5)
    // or document generation (Scene 2.6) — jump straight to Completed, per FLOWS.md's own
    // "admin can set State directly" shortcut. Confirmed via direct exploration that the
    // Table API accepts this state jump without needing to walk through Approved first.
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

  test('clicking Create order on a Completed quote creates a Draft order linked back to the quote, carrying over its line items', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    await page.goto(`/now/cwf/agent/record/sn_quote_mgmt_core_quote/${quoteSysId}/params/list_id/undefined`);

    const createOrderButton = page.getByRole('button', { name: 'Create order', exact: true });
    await createOrderButton.waitFor();
    await createOrderButton.click();

    // "Create order" creates and saves the Order server-side immediately (same "no intermediate
    // form" pattern as an Account's "Create Opportunity" button) and shows a toast with a link
    // rather than navigating away — look the new record up via its back-reference to the quote
    // rather than scraping the toast or waiting on a URL change.
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

    expect(order!.state).toBe('Draft');

    const orderLineItems = await snQuery(
      'sn_ind_tmt_orm_order_line_item',
      `order=${orderSysId}`,
      'product_offering,short_description'
    );
    expect(orderLineItems).toHaveLength(1);
    expect(orderLineItems[0].product_offering).toBe('Micro Apps');
    expect(orderLineItems[0].short_description).toBe('Micro Apps');
  });
});
