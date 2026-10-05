import { test, expect, Page } from '@playwright/test';
import { snInsert, snUpdate, snGet, snQuery, snDelete } from '../utils/servicenow-api';

// Scenes 5.2–5.7 run as one serial chain: each scene's starting state is the previous scene's
// end state (amendment order → review → submit → tasks → completion → contract), so splitting
// them into independent files would mean rebuilding the whole chain per scene. A failure in any
// scene skips the rest.

const ACCOUNT_FIXTURE = {
  name: 'QA Automation Test Co',
  industry: 'technology_services',
};

const OPPORTUNITY_FIXTURE = {
  short_description: 'QA Test Opportunity for Contract Amendment',
  sales_cycle_type: 'new_business',
  stage: '100_qualification',
};

const DOCUMENT_TEMPLATE_SYS_ID = '7e06a6d03bcb4310d5260fa693e45a05';

const STANDARD_LICENSE = 'Standard User License – Advanced';
const VIEWER_LICENSE = 'Viewer License – Advanced';
const ORIGINAL_STANDARD_QTY = '1250';
const AMENDED_STANDARD_QTY = '1500';

const recordUrl = (table: string, sysId: string) => `/now/cwf/agent/record/${table}/${sysId}/params/list_id/undefined`;

async function waitForOrderState(orderSysId: string, state: string, timeout = 15_000) {
  await expect
    .poll(async () => (await snGet('sn_ind_tmt_orm_order', orderSysId, 'state')).state, { timeout })
    .toBe(state);
}

// Order Tasks are generated one at a time after submission, so "> 0" isn't the final set —
// wait until the count holds steady across consecutive reads before comparing counts.
async function settledOrderTasks(orderSysId: string): Promise<Record<string, any>[]> {
  let tasks: Record<string, any>[] = [];
  let previousCount = -1;
  await expect
    .poll(
      async () => {
        tasks = await snQuery('sn_ind_tmt_orm_order_task', `customer_order=${orderSysId}`, 'sys_id');
        const settled = tasks.length > 0 && tasks.length === previousCount;
        previousCount = tasks.length;
        return settled;
      },
      { timeout: 60_000, intervals: [5_000] }
    )
    .toBe(true);
  return tasks;
}

async function openContractLinesTab(page: Page, contractSysId: string) {
  await page.goto(recordUrl('sn_pss_core_service_contract', contractSysId));
  const contractLinesTab = page.getByRole('tab', { name: /^Customer Contract Lines/ });
  await contractLinesTab.waitFor({ timeout: 30_000 });
  await contractLinesTab.click();
  await page.getByRole('checkbox', { name: /^Select row/ }).first().waitFor({ timeout: 15_000 });
}

test.describe.serial('Contract Amendment (Scenes 5.2–5.7)', () => {
  let accountSysId: string;
  let opportunitySysId: string;
  let quoteSysId: string;
  let originalOrderSysId: string;
  let originalTaskCount: number;
  let contractSysId: string;
  let amendmentOrderSysId: string;

  test.beforeAll(async () => {
    accountSysId = await snInsert('customer_account', ACCOUNT_FIXTURE);
    opportunitySysId = await snInsert('sn_opty_mgmt_core_opportunity', {
      ...OPPORTUNITY_FIXTURE,
      account: accountSysId,
    });
    quoteSysId = await snInsert('sn_quote_mgmt_core_quote', {
      account: accountSysId,
      source_opportunity: opportunitySysId,
      short_description: 'QA Test Quote for Contract Amendment',
      document_template: DOCUMENT_TEMPLATE_SYS_ID,
      term_month: '12',
    });
  });

  test.afterAll(async () => {
    // Everything this chain creates hangs off the fixture account (two orders, two sets of
    // tasks, a contract whose line set grows during the amendment) — sweep by account rather
    // than tracking individual sys_ids.
    const contracts = await snQuery('sn_pss_core_service_contract', `account=${accountSysId}`, 'sys_id');
    for (const c of contracts) {
      const lines = await snQuery('sn_pss_core_service_contract_line', `contract=${c.sys_id}`, 'sys_id');
      for (const l of lines) await snDelete('sn_pss_core_service_contract_line', l.sys_id);
      await snDelete('sn_pss_core_service_contract', c.sys_id);
    }
    const soldProducts = await snQuery('sn_install_base_sold_product', `account=${accountSysId}`, 'sys_id');
    for (const sp of soldProducts) await snDelete('sn_install_base_sold_product', sp.sys_id);
    const orders = await snQuery('sn_ind_tmt_orm_order', `account=${accountSysId}`, 'sys_id');
    for (const o of orders) {
      const tasks = await snQuery('sn_ind_tmt_orm_order_task', `customer_order=${o.sys_id}`, 'sys_id');
      for (const t of tasks) await snDelete('sn_ind_tmt_orm_order_task', t.sys_id);
      const lines = await snQuery('sn_ind_tmt_orm_order_line_item', `order=${o.sys_id}`, 'sys_id');
      for (const l of lines) await snDelete('sn_ind_tmt_orm_order_line_item', l.sys_id);
      await snDelete('sn_ind_tmt_orm_order', o.sys_id);
    }
    const quotes = await snQuery('sn_quote_mgmt_core_quote', `account=${accountSysId}`, 'sys_id');
    for (const q of quotes) {
      const lines = await snQuery('sn_quote_mgmt_core_quote_line_item', `quote=${q.sys_id}`, 'sys_id');
      for (const l of lines) await snDelete('sn_quote_mgmt_core_quote_line_item', l.sys_id);
      await snDelete('sn_quote_mgmt_core_quote', q.sys_id);
    }
    await snDelete('sn_opty_mgmt_core_opportunity', opportunitySysId);
    await snDelete('customer_account', accountSysId);
  });

  test('setup: a configured Solana bundle fulfilled into an Active contract', async ({ page }) => {
    test.setTimeout(240_000);

    // The license quantities only become their own priced lines (and so something an amendment
    // can diff) once Enterprise Tier is set — with it blank, Standard/Partner/Viewer counts are
    // just attributes of the $0 root line and a later quantity change amends nothing (confirmed
    // live: both resulting Change-order lines came back contract_line_type "No change").
    await page.goto(recordUrl('sn_quote_mgmt_core_quote', quoteSysId));
    const catalogTab = page.getByRole('tab', { name: 'Catalog', exact: true });
    await catalogTab.waitFor();
    await catalogTab.click();
    await page.getByRole('button', { name: 'CustomizeSolana Revenue Enablement Platform' }).click({ timeout: 20_000 });
    await page.getByRole('combobox', { name: 'Industry', exact: true }).waitFor({ timeout: 20_000 });

    // Enterprise Tier sits below the fold of the configurator's own scroll container; opening it
    // without scrolling first intermittently renders its popover outside the viewport.
    const enterpriseTierField = page.getByRole('combobox', { name: 'Enterprise Tier', exact: true });
    await enterpriseTierField.scrollIntoViewIfNeeded();
    await enterpriseTierField.click();
    // Same popover-duplication quirk as other custom dropdowns (TESTING-STRATEGY.md §3): the
    // first match can be an off-viewport stale copy, so let it settle and click the last one.
    const advancedOption = page.getByRole('option', { name: 'Advanced', exact: true }).last();
    await advancedOption.waitFor();
    await page.waitForTimeout(400);
    await advancedOption.click();
    await expect(page.getByRole('row', { name: new RegExp(`^${STANDARD_LICENSE}`) })).toBeVisible({ timeout: 20_000 });

    await page.getByRole('spinbutton', { name: 'Standard User Licenses' }).fill(ORIGINAL_STANDARD_QTY);
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('row', { name: new RegExp(`^${STANDARD_LICENSE} ${ORIGINAL_STANDARD_QTY} `) })
    ).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Save and Close', exact: true }).click();

    await expect
      .poll(
        async () =>
          (await snQuery('sn_quote_mgmt_core_quote_line_item', `quote=${quoteSysId}`, 'product_offering')).some(
            (li) => li.product_offering === STANDARD_LICENSE
          ),
        { timeout: 30_000 }
      )
      .toBe(true);

    // Quote approval/doc-gen (Scenes 2.5/2.6) and order fulfillment (Scenes 3.x) each have their
    // own spec — drive them via the backend here, except "Create order", whose Table API insert
    // is rejected by a business rule (see order-review.spec.ts).
    await snUpdate('sn_quote_mgmt_core_quote', quoteSysId, { state: 'completed' });
    await page.goto(recordUrl('sn_quote_mgmt_core_quote', quoteSysId));
    await page.getByRole('button', { name: 'Create order', exact: true }).click({ timeout: 30_000 });

    let orders: Record<string, any>[] = [];
    await expect
      .poll(
        async () => {
          orders = await snQuery('sn_ind_tmt_orm_order', `quote=${quoteSysId}`, 'sys_id');
          return orders.length;
        },
        { timeout: 20_000 }
      )
      .toBeGreaterThan(0);
    originalOrderSysId = orders[0].sys_id;
    let orderLines: Record<string, any>[] = [];
    await expect
      .poll(
        async () => {
          orderLines = await snQuery('sn_ind_tmt_orm_order_line_item', `order=${originalOrderSysId}`, 'sys_id');
          return orderLines.length;
        },
        { timeout: 20_000 }
      )
      .toBeGreaterThan(1);

    await snUpdate('sn_ind_tmt_orm_order', originalOrderSysId, { state: 'submitted' });
    const tasks = await settledOrderTasks(originalOrderSysId);
    originalTaskCount = tasks.length;
    for (const t of tasks) await snUpdate('sn_ind_tmt_orm_order_task', t.sys_id, { state: '5' });
    await snUpdate('sn_ind_tmt_orm_order', originalOrderSysId, { state: 'acknowledged' });
    for (const l of orderLines) await snUpdate('sn_ind_tmt_orm_order_line_item', l.sys_id, { state: 'completed' });

    let contracts: Record<string, any>[] = [];
    await expect
      .poll(
        async () => {
          contracts = await snQuery('sn_pss_core_service_contract', `account=${accountSysId}`, 'sys_id');
          return contracts.length;
        },
        { timeout: 60_000 }
      )
      .toBe(1);
    contractSysId = contracts[0].sys_id;

    await expect
      .poll(
        async () =>
          (
            await snQuery(
              'sn_pss_core_service_contract_line',
              `contract=${contractSysId}^product_offering.name=${STANDARD_LICENSE}`,
              'quantity',
              'false'
            )
          ).map((l) => l.quantity),
        { timeout: 30_000 }
      )
      .toEqual([ORIGINAL_STANDARD_QTY]);
  });

  test('5.2 Modify entire line reopens the configurator pre-populated, shows old vs. new, and Save and Close creates a Change order', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await openContractLinesTab(page, contractSysId);
    // The grid lists root lines only, so the bundle root is the row to amend.
    const rootRow = page.getByRole('row').filter({ hasText: 'Solana Revenue Enablement Platform' }).first();
    await rootRow.getByRole('checkbox').click();
    const modifyEntireLineButton = page.getByRole('button', { name: 'Modify entire line', exact: true });
    await expect(modifyEntireLineButton).toBeEnabled({ timeout: 15_000 });
    await modifyEntireLineButton.click();

    // Pre-populated from the live contract, not reset to the configurator's defaults.
    const standardLicensesField = page.getByRole('spinbutton', { name: 'Standard User Licenses' });
    await expect(standardLicensesField).toHaveValue(ORIGINAL_STANDARD_QTY, { timeout: 30_000 });
    await expect(page.getByRole('row', { name: new RegExp(`^${VIEWER_LICENSE} `) })).toBeVisible();

    // Effective Date defaults to a date (left as-is — the calendar picker is out of scope here,
    // see FLOWS.md Scene 5.2).
    await expect(page.getByRole('textbox', { name: 'Effective Date (System)' })).toHaveValue(/\d{2}\/\d{2}\/\d{4}/);

    await standardLicensesField.fill(AMENDED_STANDARD_QTY);
    await page.keyboard.press('Tab');
    // The cart shows the old value struck through next to the new one; the accessible name
    // exposes both.
    await expect(
      page.getByRole('gridcell', {
        name: new RegExp(`previous Qty 1,?250 current Qty 1,?500`),
      })
    ).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Save and Close', exact: true }).click();

    // A new amendment order, rather than an in-place contract edit.
    let changeOrders: Record<string, any>[] = [];
    await expect
      .poll(
        async () => {
          changeOrders = await snQuery(
            'sn_ind_tmt_orm_order',
            `account=${accountSysId}^order_type=Change`,
            'sys_id,state',
            'false'
          );
          return changeOrders.length;
        },
        { timeout: 30_000 }
      )
      .toBe(1);
    amendmentOrderSysId = changeOrders[0].sys_id;
    expect(changeOrders[0].state).toBe('draft');

    const standardLine = await snQuery(
      'sn_pss_core_service_contract_line',
      `contract=${contractSysId}^product_offering.name=${STANDARD_LICENSE}`,
      'quantity',
      'false'
    );
    expect(standardLine.map((l) => l.quantity)).toEqual([ORIGINAL_STANDARD_QTY]);
  });

  test('5.3 the amendment order marks touched lines "Amend" and untouched lines "No change"', async ({ page }) => {
    test.setTimeout(60_000);

    let lines: Record<string, any>[] = [];
    await expect
      .poll(
        async () => {
          lines = await snQuery(
            'sn_ind_tmt_orm_order_line_item',
            `order=${amendmentOrderSysId}`,
            'product_offering,quantity,contract_line_type'
          );
          return lines.some((l) => l.product_offering === STANDARD_LICENSE);
        },
        { timeout: 20_000 }
      )
      .toBe(true);

    // contract_line_type carries the change marker; the separate `action` field reads "Change"
    // on every pre-existing line regardless (see FLOWS.md Scene 5.3).
    const standardLine = lines.find((l) => l.product_offering === STANDARD_LICENSE)!;
    expect(standardLine.contract_line_type).toBe('Amend');
    expect(standardLine.quantity.replace(/,/g, '')).toBe(AMENDED_STANDARD_QTY);
    const viewerLine = lines.find((l) => l.product_offering === VIEWER_LICENSE)!;
    expect(viewerLine.contract_line_type).toBe('No change');
    const rootLine = lines.find((l) => l.product_offering === 'Solana Revenue Enablement Platform')!;
    expect(rootLine.contract_line_type).toBe('Amend');

    await page.goto(recordUrl('sn_ind_tmt_orm_order', amendmentOrderSysId));
    const lineItemsTab = page.getByRole('tab', { name: 'Line items,' });
    await lineItemsTab.waitFor({ timeout: 30_000 });
    await lineItemsTab.click();
    // The grid is a tree with child lines collapsed under the bundle root; the root row itself
    // carries the marker, since one of its children changed.
    const rootRow = page.getByRole('row').filter({ hasText: 'Solana Revenue Enablement Platform' }).first();
    await expect(rootRow.getByRole('gridcell', { name: /^Amend / })).toBeVisible({ timeout: 15_000 });
  });

  test('5.4 submitting the amendment order moves it to Submitted', async ({ page }) => {
    test.setTimeout(60_000);

    await page.goto(recordUrl('sn_ind_tmt_orm_order', amendmentOrderSysId));
    const reviewAndSubmitButton = page.getByRole('button', { name: 'Review & Submit', exact: true });
    await reviewAndSubmitButton.waitFor({ timeout: 30_000 });
    await reviewAndSubmitButton.click();

    // Diverges from FLOWS.md: the review screen itemizes the whole order, unchanged lines
    // included, not just what the amendment touched.
    await expect(page.getByRole('heading', { name: 'Review order' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(VIEWER_LICENSE, { exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    const confirmDialog = page.getByRole('dialog');
    await expect(confirmDialog.getByRole('heading', { name: 'Confirmation' })).toBeVisible({ timeout: 15_000 });
    await confirmDialog.getByRole('button', { name: 'Submit', exact: true }).click();

    await waitForOrderState(amendmentOrderSysId, 'Submitted');
  });

  test('5.5 the amendment generates fewer tasks than the original order; closing them and approving acknowledges it', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const tasks = await settledOrderTasks(amendmentOrderSysId);
    expect(tasks.length).toBeLessThan(originalTaskCount);

    for (const t of tasks) {
      await page.goto(recordUrl('sn_ind_tmt_orm_order_task', t.sys_id));
      const closeButton = page.getByRole('button', { name: 'Close', exact: true });
      await closeButton.waitFor({ timeout: 30_000 });
      await closeButton.click();
      await expect
        .poll(async () => (await snGet('sn_ind_tmt_orm_order_task', t.sys_id, 'state')).state, { timeout: 15_000 })
        .toBe('Closed complete');
    }

    await waitForOrderState(amendmentOrderSysId, 'New');
    await page.goto(recordUrl('sn_ind_tmt_orm_order', amendmentOrderSysId));
    const approveButton = page.getByRole('button', { name: 'Approve', exact: true });
    await expect(approveButton).toBeVisible({ timeout: 15_000 });
    await approveButton.click();
    await waitForOrderState(amendmentOrderSysId, 'Acknowledged');
  });

  test('5.6 completing every amendment line rolls the order up to Completed', async ({ page }) => {
    test.setTimeout(180_000);

    const lines = await snQuery(
      'sn_ind_tmt_orm_order_line_item',
      `order=${amendmentOrderSysId}`,
      'sys_id,product_offering'
    );
    const standardLine = lines.find((l) => l.product_offering === STANDARD_LICENSE)!;

    // Complete the amended line through the UI (Scene 3.5's State dropdown + Save mechanic,
    // including the click-the-last-duplicate-option popover quirk); the rest via the backend to
    // keep runtime reasonable on an order with many lines.
    for (const l of lines) {
      if (l.sys_id !== standardLine.sys_id) {
        await snUpdate('sn_ind_tmt_orm_order_line_item', l.sys_id, { state: 'completed' });
      }
    }
    await page.goto(recordUrl('sn_ind_tmt_orm_order_line_item', standardLine.sys_id));
    const stateField = page.getByRole('combobox', { name: 'State', exact: true });
    await stateField.waitFor({ timeout: 30_000 });
    await stateField.click();
    const completedOption = page.getByRole('option', { name: 'Completed', exact: true }).last();
    await completedOption.waitFor();
    await page.waitForTimeout(400);
    await completedOption.click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect
      .poll(async () => (await snGet('sn_ind_tmt_orm_order_line_item', standardLine.sys_id, 'state')).state, {
        timeout: 15_000,
      })
      .toBe('Completed');

    // Same slow, variable rollup as Scene 3.5.
    await waitForOrderState(amendmentOrderSysId, 'Completed', 90_000);
  });

  test('5.7 the contract itself reflects the amended quantity with no manual edit', async ({ page }) => {
    test.setTimeout(90_000);

    await expect
      .poll(
        async () =>
          (
            await snQuery(
              'sn_pss_core_service_contract_line',
              `contract=${contractSysId}^product_offering.name=${STANDARD_LICENSE}^state=active`,
              'quantity',
              'false'
            )
          ).map((l) => l.quantity),
        { timeout: 60_000 }
      )
      .toEqual([AMENDED_STANDARD_QTY]);

    // Still one contract — the amendment updates it rather than spawning a new one.
    const contracts = await snQuery('sn_pss_core_service_contract', `account=${accountSysId}`, 'sys_id');
    expect(contracts.length).toBe(1);

    // And it's what the contract line's own record shows.
    const standardLineRecord = (
      await snQuery(
        'sn_pss_core_service_contract_line',
        `contract=${contractSysId}^product_offering.name=${STANDARD_LICENSE}^state=active`,
        'sys_id'
      )
    )[0];
    await page.goto(recordUrl('sn_pss_core_service_contract_line', standardLineRecord.sys_id));
    await expect(page.getByRole('textbox', { name: 'Quantity', exact: true })).toHaveValue(/1,?500/, { timeout: 30_000 });
  });
});
