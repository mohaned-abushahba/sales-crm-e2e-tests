import { test, expect } from '@playwright/test';
import { snInsert, snGet, snDelete } from '../utils/servicenow-api';

const ACCOUNT_FIXTURE = {
  name: 'QA Automation Test Co',
  industry: 'technology_services',
};

const OPPORTUNITY_FIXTURE = {
  short_description: 'QA Test Opportunity for Approvals',
  sales_cycle_type: 'new_business',
  stage: '100_qualification',
};

// Same disposable, non-configurable product used by pricing-adjustments.spec.ts — avoids the
// guided configurator, which is currently broken on opmsalescrm1 (CPQ-Logik.io tenant
// misconfiguration; see TESTING-STRATEGY.md §3).
const PRODUCT_OFFERING_SYS_ID = '05908ad73b724710d5260fa693e45a6f';
const STANDARD_PRICE_LIST_SYS_ID = '94ed8a972bb243104deaf02ac891bf4f';

test.describe('Quote Approvals', () => {
  let accountSysId: string;
  let opportunitySysId: string;
  let quoteSysId: string;
  let lineItemSysId: string;

  test.beforeEach(async () => {
    accountSysId = await snInsert('customer_account', ACCOUNT_FIXTURE);
    opportunitySysId = await snInsert('sn_opty_mgmt_core_opportunity', {
      ...OPPORTUNITY_FIXTURE,
      account: accountSysId,
    });
    quoteSysId = await snInsert('sn_quote_mgmt_core_quote', {
      account: accountSysId,
      source_opportunity: opportunitySysId,
      short_description: 'QA Test Quote for Approvals',
    });
    lineItemSysId = await snInsert('sn_quote_mgmt_core_quote_line_item', {
      quote: quoteSysId,
      product_offering: PRODUCT_OFFERING_SYS_ID,
      price_list: STANDARD_PRICE_LIST_SYS_ID,
      short_description: 'Micro Apps',
      line_type: 'New',
      action: 'Add',
    });
  });

  test.afterEach(async () => {
    await snDelete('sn_quote_mgmt_core_quote_line_item', lineItemSysId);
    await snDelete('sn_quote_mgmt_core_quote', quoteSysId);
    await snDelete('sn_opty_mgmt_core_opportunity', opportunitySysId);
    await snDelete('customer_account', accountSysId);
  });

  test('submitting an undiscounted quote auto-approves it — no approval conditions are satisfied', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    await page.goto(`/now/cwf/agent/record/sn_quote_mgmt_core_quote/${quoteSysId}/params/list_id/undefined`);

    const submitButton = page.getByRole('button', { name: 'Preview & Submit for Approval', exact: true });
    await submitButton.waitFor();
    await submitButton.click();

    // With no discount applied, there's nothing for any approval chain's conditions to match,
    // so the platform skips straight to Approved instead of opening the preview/request dialog.
    await expect.poll(async () => (await snGet('sn_quote_mgmt_core_quote', quoteSysId, 'state')).state, {
      timeout: 15_000,
    }).toBe('Approved');
  });

  test('a 20% header discount requires a two-tier Sales Discount Management approval chain, gated in order', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    await page.goto(`/now/cwf/agent/record/sn_quote_mgmt_core_quote/${quoteSysId}/params/list_id/undefined`);

    // Apply a 20% header discount — same mechanism as pricing-adjustments.spec.ts. 20% crosses
    // BOTH tiers of this instance's real threshold (Tier 1 at 10%+, Tier 2 at 20%+ — FLOWS.md's
    // guess of "20%" turns out to be the Tier 2 boundary, not the point approval first kicks in).
    const moreActionsButton = page.getByRole('button', { name: 'More Actions' });
    await moreActionsButton.waitFor();
    await moreActionsButton.click();

    const applyDiscountOption = page.getByRole('menuitem', { name: 'Apply header discount' }).last();
    await applyDiscountOption.waitFor();
    await page.waitForTimeout(400);
    const discountBox = await applyDiscountOption.boundingBox();
    if (!discountBox) throw new Error('"Apply header discount" menu item has no bounding box');
    await page.mouse.click(discountBox.x + discountBox.width / 2, discountBox.y + discountBox.height / 2);

    const discountField = page.getByRole('spinbutton', { name: 'Quote header discount %' });
    await discountField.waitFor();
    await discountField.fill('20');
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Apply', exact: true }).click();

    await expect
      .poll(
        async () => {
          const line = await snGet('sn_quote_mgmt_core_quote_line_item', lineItemSysId, 'unit_adjustment');
          return line.unit_adjustment;
        },
        { timeout: 15_000 }
      )
      .not.toBe('$0.00');

    // Submit for approval — this time the discount conditions ARE satisfied, so the preview
    // dialog opens instead of auto-approving.
    const submitButton = page.getByRole('button', { name: 'Preview & Submit for Approval', exact: true });
    await submitButton.click();

    const previewDialogHeading = page.getByRole('heading', { name: 'Preview and request approval' });
    await expect(previewDialogHeading).toBeVisible({ timeout: 15_000 });

    // Both tiers of the "Sales Discount Management" chain are shown up front in the preview,
    // with their trigger conditions — this is the real threshold discovery, worth asserting on
    // directly rather than just trusting the chain exists.
    await expect(page.getByText('Discount Tier 1 (10%+)')).toBeVisible();
    await expect(page.getByText('Discount Tier 2 (20%+)')).toBeVisible();

    await page.getByRole('button', { name: 'Request Approval', exact: true }).click();

    // Re-verify from the backend rather than trusting rendered text.
    await expect.poll(async () => (await snGet('sn_quote_mgmt_core_quote', quoteSysId, 'state')).state, {
      timeout: 15_000,
    }).toBe('Requested for review');

    // The header action button swaps from "Preview & Submit for Approval" to "Recall approval
    // request" once a request is in flight.
    await expect(page.getByRole('button', { name: 'Recall approval request' })).toBeVisible({
      timeout: 15_000,
    });

    // Chain gating: the Approvals tab shows Tier 1 already "Requested" (it's first in order),
    // while Tier 2 explicitly reads "Not yet requested" — it only activates once Tier 1 clears.
    // This is the actual, directly-observable mechanism behind FLOWS.md's claim that later
    // chains "aren't actionable/visible until the first chain fully clears". Both tiers can
    // transiently show "Not yet requested" right after submission before Tier 1's own request
    // finishes processing — poll for the count to settle at exactly 1 rather than a one-shot check.
    await page.getByRole('tab', { name: 'Approvals' }).click();
    await expect
      .poll(async () => page.getByText('Not yet requested', { exact: true }).count(), { timeout: 15_000 })
      .toBe(1);
  });
});
