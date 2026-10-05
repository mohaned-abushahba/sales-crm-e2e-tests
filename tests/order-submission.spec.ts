import { test, expect } from '@playwright/test';
import { snInsert, snUpdate, snGet, snQuery, snDelete } from '../utils/servicenow-api';

const ACCOUNT_FIXTURE = {
  name: 'QA Automation Test Co',
  industry: 'technology_services',
};

const OPPORTUNITY_FIXTURE = {
  short_description: 'QA Test Opportunity for Order Submission',
  sales_cycle_type: 'new_business',
  stage: '100_qualification',
};

// Same disposable, non-configurable product used by other CPQ/OM specs — avoids the guided
// configurator, which is currently broken on opmsalescrm1 (CPQ-Logik.io tenant
// misconfiguration; see TESTING-STRATEGY.md §3).
const PRODUCT_OFFERING_SYS_ID = '05908ad73b724710d5260fa693e45a6f';
const STANDARD_PRICE_LIST_SYS_ID = '94ed8a972bb243104deaf02ac891bf4f';
const DOCUMENT_TEMPLATE_SYS_ID = '7e06a6d03bcb4310d5260fa693e45a05';

test.describe('Order Submission', () => {
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
      short_description: 'QA Test Quote for Order Submission',
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
    // This spec is about order submission itself, not the quote-to-order handoff (Scene 3.1) or
    // approval/doc-gen (2.5/2.6) — jump straight to Completed, same shortcut order-creation.spec.ts
    // and order-review.spec.ts already established.
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

  test('submitting a Draft order moves it to Submitted and auto-generates Order Tasks', async ({ page }) => {
    test.setTimeout(60_000);

    // Produce the Draft order fixture through the UI action (Table API insert is rejected by a
    // business rule requiring account/buyer_organization to be pre-resolved — see
    // order-review.spec.ts's note), then navigate to the order's own record.
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

    // The review screen itemizes quantity, unit price, and cumulative pricing per line — a
    // sanity check that we actually landed on the right screen before submitting.
    await expect(page.getByRole('heading', { name: 'Review order' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Micro Apps', { exact: true })).toBeVisible();

    const submitButton = page.getByRole('button', { name: 'Submit', exact: true });
    await submitButton.waitFor();
    await submitButton.click();

    // Unlike the "Convert lead" dialog (TESTING-STRATEGY.md §3), this confirmation dialog DOES
    // expose a proper role="dialog" container and renders instantly — no retry loop needed.
    const confirmDialog = page.getByRole('dialog');
    await expect(confirmDialog.getByRole('heading', { name: 'Confirmation' })).toBeVisible({ timeout: 15_000 });
    // Scoping this exact-text check to the dialog locator inexplicably finds nothing even
    // though the heading above (same visual dialog) matches fine — same class of scoping
    // oddity as the "Convert lead" dialog elsewhere. Assert unscoped; the string is unique.
    await expect(page.getByText('Are you sure you want to submit the order?')).toBeVisible();
    await confirmDialog.getByRole('button', { name: 'Submit', exact: true }).click();

    // Re-verify from the backend rather than trusting rendered text.
    await expect
      .poll(async () => (await snGet('sn_ind_tmt_orm_order', orderSysId!, 'state')).state, { timeout: 15_000 })
      .toBe('Submitted');

    // Order Tasks are auto-generated on submit — assert count > 0 and real tasks exist, not a
    // hardcoded count (FLOWS.md is explicit that this may vary by order composition). The Order
    // Task table is sn_ind_tmt_orm_order_task, linked back via its own customer_order field (NOT
    // "order" — that field exists on the table but is unrelated/always blank in practice).
    // Task generation runs asynchronously after the state flips to Submitted, so poll for it
    // rather than checking once immediately.
    let tasks: Record<string, any>[] = [];
    await expect
      .poll(
        async () => {
          tasks = await snQuery(
            'sn_ind_tmt_orm_order_task',
            `customer_order=${orderSysId}`,
            'sys_id,short_description,state'
          );
          return tasks.length;
        },
        { timeout: 20_000 }
      )
      .toBeGreaterThan(0);
    expect(tasks.every((t) => t.state === 'In progress')).toBe(true);
  });
});
