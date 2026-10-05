import { test, expect } from '@playwright/test';
import { snInsert, snUpdate, snGet, snQuery, snDelete } from '../utils/servicenow-api';

const ACCOUNT_FIXTURE = {
  name: 'QA Automation Test Co',
  industry: 'technology_services',
};

const OPPORTUNITY_FIXTURE = {
  short_description: 'QA Test Opportunity for Order Task Fulfillment',
  sales_cycle_type: 'new_business',
  stage: '100_qualification',
};

// Same disposable, non-configurable product used by other CPQ/OM specs — avoids the guided
// configurator, which is currently broken on opmsalescrm1 (CPQ-Logik.io tenant
// misconfiguration; see TESTING-STRATEGY.md §3).
const PRODUCT_OFFERING_SYS_ID = '05908ad73b724710d5260fa693e45a6f';
const STANDARD_PRICE_LIST_SYS_ID = '94ed8a972bb243104deaf02ac891bf4f';
const DOCUMENT_TEMPLATE_SYS_ID = '7e06a6d03bcb4310d5260fa693e45a05';

test.describe('Order Task Fulfillment', () => {
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
      short_description: 'QA Test Quote for Order Task Fulfillment',
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
      const tasks = await snQuery('sn_ind_tmt_orm_order_task', `customer_order=${orderSysId}`, 'sys_id');
      for (const t of tasks) await snDelete('sn_ind_tmt_orm_order_task', t.sys_id);
      const orderLines = await snQuery('sn_ind_tmt_orm_order_line_item', `order=${orderSysId}`, 'sys_id');
      for (const line of orderLines) await snDelete('sn_ind_tmt_orm_order_line_item', line.sys_id);
      await snDelete('sn_ind_tmt_orm_order', orderSysId);
    }
    await snDelete('sn_quote_mgmt_core_quote_line_item', lineItemSysId);
    await snDelete('sn_quote_mgmt_core_quote', quoteSysId);
    await snDelete('sn_opty_mgmt_core_opportunity', opportunitySysId);
    await snDelete('customer_account', accountSysId);
  });

  test('closing every Order Task unlocks Approve, and approving moves the order to Acknowledged', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    // Build a Submitted order (Scene 3.3's own mechanism) as this scene's starting point.
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

    await page.goto(`/now/cwf/agent/record/sn_ind_tmt_orm_order/${orderSysId}/params/list_id/undefined`);
    const reviewAndSubmitButton = page.getByRole('button', { name: 'Review & Submit', exact: true });
    await reviewAndSubmitButton.waitFor();
    await reviewAndSubmitButton.click();
    const submitButton = page.getByRole('button', { name: 'Submit', exact: true });
    await submitButton.waitFor();
    await submitButton.click();
    const confirmDialog = page.getByRole('dialog');
    await expect(confirmDialog.getByRole('heading', { name: 'Confirmation' })).toBeVisible({ timeout: 15_000 });
    await confirmDialog.getByRole('button', { name: 'Submit', exact: true }).click();
    await expect
      .poll(async () => (await snGet('sn_ind_tmt_orm_order', orderSysId!, 'state')).state, { timeout: 15_000 })
      .toBe('Submitted');

    // Order Tasks generate asynchronously — poll for them (same pattern as order-submission.spec.ts).
    let tasks: Record<string, any>[] = [];
    await expect
      .poll(
        async () => {
          tasks = await snQuery('sn_ind_tmt_orm_order_task', `customer_order=${orderSysId}`, 'sys_id,number');
          return tasks.length;
        },
        { timeout: 20_000 }
      )
      .toBeGreaterThan(0);

    // Close every task via its own record's header "Close" action — this single button sets
    // State straight to "Closed complete" with no intermediate dialog (unlike the grid, which
    // exposes no bulk-select checkboxes for this related list on this instance).
    for (const t of tasks) {
      await page.goto(`/now/cwf/agent/record/sn_ind_tmt_orm_order_task/${t.sys_id}/params/list_id/undefined`);
      const closeButton = page.getByRole('button', { name: 'Close', exact: true });
      await closeButton.waitFor();
      await closeButton.click();
      await expect
        .poll(async () => (await snGet('sn_ind_tmt_orm_order_task', t.sys_id, 'state')).state, { timeout: 15_000 })
        .toBe('Closed complete');
    }

    // Once every task is closed, Order State flips (observed → "New" on this instance, matching
    // FLOWS.md) and an Approve/Reject pair replaces the prior action buttons.
    await page.goto(`/now/cwf/agent/record/sn_ind_tmt_orm_order/${orderSysId}/params/list_id/undefined`);
    await expect
      .poll(async () => (await snGet('sn_ind_tmt_orm_order', orderSysId!, 'state')).state, { timeout: 15_000 })
      .toBe('New');

    const approveButton = page.getByRole('button', { name: 'Approve', exact: true });
    await expect(approveButton).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Reject', exact: true })).toBeVisible();
    await approveButton.click();

    // Approve transitions immediately — no confirmation dialog on this instance.
    await expect
      .poll(async () => (await snGet('sn_ind_tmt_orm_order', orderSysId!, 'state')).state, { timeout: 15_000 })
      .toBe('Acknowledged');
  });
});
