import { test, expect } from '@playwright/test';
import { snInsert, snUpdate, snGet, snQuery, snDelete } from '../utils/servicenow-api';

const ACCOUNT_FIXTURE = {
  name: 'QA Automation Test Co',
  industry: 'technology_services',
};

const OPPORTUNITY_FIXTURE = {
  short_description: 'QA Test Opportunity for Order Completion',
  sales_cycle_type: 'new_business',
  stage: '100_qualification',
};

// Same disposable, non-configurable product used by other CPQ/OM specs — avoids the guided
// configurator, which is currently broken on opmsalescrm1 (CPQ-Logik.io tenant
// misconfiguration; see TESTING-STRATEGY.md §3).
const PRODUCT_OFFERING_SYS_ID = '05908ad73b724710d5260fa693e45a6f';
const STANDARD_PRICE_LIST_SYS_ID = '94ed8a972bb243104deaf02ac891bf4f';
const DOCUMENT_TEMPLATE_SYS_ID = '7e06a6d03bcb4310d5260fa693e45a05';

test.describe('Order Completion & Fulfillment', () => {
  let accountSysId: string;
  let opportunitySysId: string;
  let quoteSysId: string;
  let lineItemSysId: string;
  let orderSysId: string | undefined;
  let orderLineItemSysId: string | undefined;
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
      short_description: 'QA Test Quote for Order Completion',
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
    orderLineItemSysId = undefined;
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
    if (orderSysId) {
      const tasks = await snQuery('sn_ind_tmt_orm_order_task', `customer_order=${orderSysId}`, 'sys_id');
      for (const t of tasks) await snDelete('sn_ind_tmt_orm_order_task', t.sys_id);
      if (orderLineItemSysId) await snDelete('sn_ind_tmt_orm_order_line_item', orderLineItemSysId);
      await snDelete('sn_ind_tmt_orm_order', orderSysId);
    }
    await snDelete('sn_quote_mgmt_core_quote_line_item', lineItemSysId);
    await snDelete('sn_quote_mgmt_core_quote', quoteSysId);
    await snDelete('sn_opty_mgmt_core_opportunity', opportunitySysId);
    await snDelete('customer_account', accountSysId);
  });

  test('completing every order line moves Order State to Completed and auto-creates Contract, Contract Line, and Sold Product', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    // Build an Acknowledged order (Scenes 3.1/3.3/3.4's own mechanisms) as this scene's
    // starting point.
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

    // Order Tasks are generated one at a time after submission, and new ones can keep
    // appearing even after an earlier batch looks "settled" — closing a batch, then finding
    // more were created while we were closing it. Loop until a fresh query turns up nothing
    // left open, instead of trusting one settle window. Closing only a partial set leaves the
    // rest open, and the line's Completed save then can't roll the order up ("The order can't
    // be completed because one or more order header or top line item tasks are still open").
    // Query by the raw choice value (5 = Closed complete) — sysparm_query's "!=" does not
    // resolve choice labels the way "=" does, so a label-based filter here silently matches
    // nothing even when open tasks exist.
    const CLOSED_COMPLETE = '5';
    const closedTaskIds = new Set<string>();
    await expect
      .poll(
        async () => {
          const tasks = await snQuery(
            'sn_ind_tmt_orm_order_task',
            `customer_order=${orderSysId}^state!=${CLOSED_COMPLETE}`,
            'sys_id'
          );
          for (const t of tasks) {
            if (closedTaskIds.has(t.sys_id)) continue;
            await page.goto(`/now/cwf/agent/record/sn_ind_tmt_orm_order_task/${t.sys_id}/params/list_id/undefined`);
            const closeButton = page.getByRole('button', { name: 'Close', exact: true });
            await closeButton.waitFor();
            await closeButton.click();
            await expect
              .poll(async () => (await snGet('sn_ind_tmt_orm_order_task', t.sys_id, 'state')).state, {
                timeout: 15_000,
              })
              .toBe('Closed complete');
            closedTaskIds.add(t.sys_id);
          }
          const remaining = await snQuery(
            'sn_ind_tmt_orm_order_task',
            `customer_order=${orderSysId}^state!=${CLOSED_COMPLETE}`,
            'sys_id'
          );
          return closedTaskIds.size > 0 && remaining.length === 0;
        },
        { timeout: 60_000, intervals: [5_000] }
      )
      .toBe(true);

    await page.goto(`/now/cwf/agent/record/sn_ind_tmt_orm_order/${orderSysId}/params/list_id/undefined`);
    const approveButton = page.getByRole('button', { name: 'Approve', exact: true });
    await expect(approveButton).toBeVisible({ timeout: 15_000 });
    await approveButton.click();
    await expect
      .poll(async () => (await snGet('sn_ind_tmt_orm_order', orderSysId!, 'state')).state, { timeout: 15_000 })
      .toBe('Acknowledged');

    const orderLines = await snQuery('sn_ind_tmt_orm_order_line_item', `order=${orderSysId}`, 'sys_id');
    expect(orderLines.length).toBeGreaterThan(0);
    orderLineItemSysId = orderLines[0].sys_id;

    // This scene's own mechanic: on the order line item's own record, there's no dedicated
    // "Complete" action button (unlike Order Tasks' "Close") — set the plain State dropdown to
    // "Completed" and Save. Same popover-duplication quirk as every other custom dropdown in
    // this app (TESTING-STRATEGY.md §3): locate the option, wait for the popover to settle, and
    // click the LAST duplicate.
    await page.goto(
      `/now/cwf/agent/record/sn_ind_tmt_orm_order_line_item/${orderLineItemSysId}/params/list_id/undefined`
    );
    const stateField = page.getByRole('combobox', { name: 'State', exact: true });
    await stateField.waitFor();
    await stateField.click();
    const completedOption = page.getByRole('option', { name: 'Completed', exact: true }).last();
    await completedOption.waitFor();
    await page.waitForTimeout(400);
    await completedOption.click();
    const saveButton = page.getByRole('button', { name: 'Save', exact: true });
    await saveButton.click();

    await expect
      .poll(async () => (await snGet('sn_ind_tmt_orm_order_line_item', orderLineItemSysId!, 'state')).state, {
        timeout: 15_000,
      })
      .toBe('Completed');

    // Completing the only line completes the order itself, with no separate action needed —
    // this rollup is asynchronous and its timing is genuinely unpredictable: observed needing
    // >15s solo, and still exceeding a 40s poll once under full-suite load (more concurrent
    // flow-engine activity on the shared instance). Give it very generous headroom.
    await expect
      .poll(async () => (await snGet('sn_ind_tmt_orm_order', orderSysId!, 'state')).state, { timeout: 90_000 })
      .toBe('Completed');

    // The real assertion: completing the order automatically creates the Contract, Contract
    // Line, and Sold Product for the account — no separate manual step. Table names confirmed
    // live via sys_db_object (not guessable): sn_pss_core_service_contract ("Customer
    // Contract"), sn_pss_core_service_contract_line ("Customer Contract Line"),
    // sn_install_base_sold_product ("Sold Product").
    let contracts: Record<string, any>[] = [];
    await expect
      .poll(
        async () => {
          contracts = await snQuery('sn_pss_core_service_contract', `account=${accountSysId}`, 'sys_id,number,state');
          return contracts.length;
        },
        { timeout: 20_000 }
      )
      .toBeGreaterThan(0);
    contractSysId = contracts[0].sys_id;

    // Contract Lines are written after the Contract header, so poll rather than read once.
    let contractLines: Record<string, any>[] = [];
    await expect
      .poll(
        async () => {
          contractLines = await snQuery(
            'sn_pss_core_service_contract_line',
            `contract=${contractSysId}`,
            'sys_id,product_offering,state'
          );
          return contractLines.length;
        },
        { timeout: 20_000 }
      )
      .toBeGreaterThan(0);
    contractLineSysId = contractLines[0].sys_id;
    expect(contractLines[0].product_offering).toBe('Micro Apps');

    const soldProducts = await snQuery('sn_install_base_sold_product', `account=${accountSysId}`, 'sys_id,state');
    expect(soldProducts.length).toBeGreaterThan(0);
    soldProductSysId = soldProducts[0].sys_id;
  });
});
