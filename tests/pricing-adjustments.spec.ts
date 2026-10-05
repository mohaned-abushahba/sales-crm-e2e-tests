import { test, expect } from '@playwright/test';
import { snInsert, snGet, snUpdate, snDelete } from '../utils/servicenow-api';

const ACCOUNT_FIXTURE = {
  name: 'QA Automation Test Co',
  industry: 'technology_services',
};

const OPPORTUNITY_FIXTURE = {
  short_description: 'QA Test Opportunity for Discount',
  sales_cycle_type: 'new_business',
  stage: '100_qualification',
};

// A simple, non-configurable product offering — avoids needing the guided configurator
// (currently broken on opmsalescrm1 due to a CPQ-Logik.io tenant misconfiguration; see
// TESTING-STRATEGY.md §3). "Micro Apps" has a real, non-zero Standard Price List entry.
const PRODUCT_OFFERING_SYS_ID = '05908ad73b724710d5260fa693e45a6f';
const STANDARD_PRICE_LIST_SYS_ID = '94ed8a972bb243104deaf02ac891bf4f';

const DISCOUNT_PERCENT = 30;

test.describe('Pricing & Adjustments (header discount)', () => {
  let accountSysId: string;
  let opportunitySysId: string;
  let quoteSysId: string;
  let lineItemSysIds: string[];

  test.beforeEach(async () => {
    accountSysId = await snInsert('customer_account', ACCOUNT_FIXTURE);
    opportunitySysId = await snInsert('sn_opty_mgmt_core_opportunity', {
      ...OPPORTUNITY_FIXTURE,
      account: accountSysId,
    });
    quoteSysId = await snInsert('sn_quote_mgmt_core_quote', {
      account: accountSysId,
      source_opportunity: opportunitySysId,
      short_description: 'QA Test Quote for Discount',
    });

    // Seed Quote Line Items directly via the Table API — bypasses the broken guided
    // configurator entirely. list_price is a computed field driven by the product offering's
    // own price book entry (confirmed: passing an arbitrary value here is silently overwritten
    // by the pricing engine), so its exact value isn't asserted on here, only that it's non-zero.
    const line1 = await snInsert('sn_quote_mgmt_core_quote_line_item', {
      quote: quoteSysId,
      product_offering: PRODUCT_OFFERING_SYS_ID,
      price_list: STANDARD_PRICE_LIST_SYS_ID,
      short_description: 'Micro Apps',
      line_type: 'New',
      action: 'Add',
    });
    const line2 = await snInsert('sn_quote_mgmt_core_quote_line_item', {
      quote: quoteSysId,
      product_offering: PRODUCT_OFFERING_SYS_ID,
      price_list: STANDARD_PRICE_LIST_SYS_ID,
      short_description: 'Micro Apps (2)',
      line_type: 'New',
      action: 'Add',
    });
    lineItemSysIds = [line1, line2];
  });

  test.afterEach(async () => {
    for (const id of lineItemSysIds) await snDelete('sn_quote_mgmt_core_quote_line_item', id);
    await snDelete('sn_quote_mgmt_core_quote', quoteSysId);
    await snDelete('sn_opty_mgmt_core_opportunity', opportunitySysId);
    await snDelete('customer_account', accountSysId);
  });

  test('applying a header discount populates Unit Adjustment on every line without a separate Save', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const totalsBefore = await snGet('sn_quote_mgmt_core_quote', quoteSysId, 'total_amount');
    const totalBefore = Number(totalsBefore.total_amount.replace(/[^0-9.]/g, ''));
    expect(totalBefore).toBeGreaterThan(0);

    await page.goto(`/now/cwf/agent/record/sn_quote_mgmt_core_quote/${quoteSysId}/params/list_id/undefined`);

    const moreActionsButton = page.getByRole('button', { name: 'More Actions' });
    await moreActionsButton.waitFor();
    await moreActionsButton.click();

    // Same popover-duplication quirk as the Stage/Convert-Lead listboxes (TESTING-STRATEGY.md
    // §3): the menu item renders twice; use a real mouse click on the second (live) copy rather
    // than a locator-driven .click(), which flakes with "resolved to 2 elements".
    const applyDiscountOption = page.getByRole('menuitem', { name: 'Apply header discount' }).last();
    await applyDiscountOption.waitFor();
    await page.waitForTimeout(400);
    const box = await applyDiscountOption.boundingBox();
    if (!box) throw new Error('"Apply header discount" menu item has no bounding box');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    // "Apply discount to all quote lines" is already selected by default — the dialog renders
    // fully immediately here (unlike the Convert Lead dialog, no retry loop needed).
    const discountField = page.getByRole('spinbutton', { name: 'Quote header discount %' });
    await discountField.waitFor();
    await discountField.fill(String(DISCOUNT_PERCENT));
    // A brief settle delay before Apply — clicking immediately after fill() sometimes no-ops
    // silently (dialog stays open, no error) on this custom component.
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Apply', exact: true }).click();

    // Re-verify from the backend rather than trusting rendered text.
    await expect
      .poll(
        async () => {
          const line = await snGet('sn_quote_mgmt_core_quote_line_item', lineItemSysIds[0], 'unit_adjustment');
          return line.unit_adjustment;
        },
        { timeout: 15_000 }
      )
      .not.toBe('$0.00');

    // Per FLOWS.md's own caveat, per-line adjustment allocation is not guaranteed to be a flat
    // percentage of each line's own list price — assert only that a non-zero adjustment landed
    // on every line, and that the quote's total dropped accordingly. No separate Save/click was
    // performed above, confirming the "no separate Save needed" claim.
    for (const id of lineItemSysIds) {
      const line = await snGet('sn_quote_mgmt_core_quote_line_item', id, 'unit_adjustment,total_adjustment');
      expect(line.unit_adjustment).not.toBe('$0.00');
      expect(line.total_adjustment).not.toBe('$0.00');
    }

    const totalsAfter = await snGet('sn_quote_mgmt_core_quote', quoteSysId, 'total_amount,state');
    const totalAfter = Number(totalsAfter.total_amount.replace(/[^0-9.]/g, ''));
    expect(totalAfter).toBeLessThan(totalBefore);
    // Applying the discount alone does not submit the quote for approval — that's the separate
    // "Preview & Submit for Approval" action (Scene 2.5's scope, not this one's).
    expect(totalsAfter.state).toBe('Draft');
  });
});
