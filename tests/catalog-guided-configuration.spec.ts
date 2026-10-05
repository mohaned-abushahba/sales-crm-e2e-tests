import { test, expect } from '@playwright/test';
import { snInsert, snGet, snQuery, snDelete } from '../utils/servicenow-api';

const ACCOUNT_FIXTURE = {
  name: 'QA Automation Test Co',
  industry: 'technology_services',
};

const OPPORTUNITY_FIXTURE = {
  short_description: 'QA Test Opportunity for Guided Configuration',
  sales_cycle_type: 'new_business',
  stage: '100_qualification',
};

// The bundle product whose guided configurator we drive end-to-end. Requires the
// CPQ-Logik.io tenant to be correctly connected for this instance (fixed on opmsalescrm1 as of
// 2026-09-30 — was previously pointed at empksingampalli's tenant; see FLOWS.md Scene 2.2).
const SOLANA_PRODUCT_OFFERING_SYS_ID = '6f7e75df3b324710d5260fa693e45a9a';

test.describe('Catalog & Guided Product Configuration', () => {
  let accountSysId: string;
  let opportunitySysId: string;
  let quoteSysId: string;

  test.beforeEach(async () => {
    accountSysId = await snInsert('customer_account', ACCOUNT_FIXTURE);
    opportunitySysId = await snInsert('sn_opty_mgmt_core_opportunity', {
      ...OPPORTUNITY_FIXTURE,
      account: accountSysId,
    });
    // account must be set directly on the quote — the guided configurator's commit step aborts
    // with "Quote line item(s) could not be created" if both account and consumer are empty (a
    // pre-existing mandatory-field Business Rule, unrelated to the CPQ-Logik.io fix; confirmed by
    // reproducing the failure against a quote fixture that omitted this field).
    quoteSysId = await snInsert('sn_quote_mgmt_core_quote', {
      account: accountSysId,
      source_opportunity: opportunitySysId,
      short_description: 'QA Test Quote for Guided Configuration',
    });
  });

  test.afterEach(async () => {
    const lineItems = await snQuery('sn_quote_mgmt_core_quote_line_item', `quote=${quoteSysId}`, 'sys_id');
    for (const li of lineItems) await snDelete('sn_quote_mgmt_core_quote_line_item', li.sys_id);
    await snDelete('sn_quote_mgmt_core_quote', quoteSysId);
    await snDelete('sn_opty_mgmt_core_opportunity', opportunitySysId);
    await snDelete('customer_account', accountSysId);
  });

  test('configuring a bundle product and committing syncs line items back to the Quote', async ({ page }) => {
    test.setTimeout(90_000);

    await page.goto(`/now/cwf/agent/record/sn_quote_mgmt_core_quote/${quoteSysId}/params/list_id/undefined`);

    const catalogTab = page.getByRole('tab', { name: 'Catalog', exact: true });
    await catalogTab.waitFor();
    await catalogTab.click();

    const customizeButton = page.getByRole('button', { name: 'CustomizeSolana Revenue Enablement Platform' });
    await customizeButton.waitFor({ timeout: 20_000 });
    await customizeButton.click();

    // The configurator iframe loads the bundle's Industry field pre-populated from the account's
    // own Industry (confirmed live) — a real signal the CPQ-Logik.io session established
    // correctly, distinct from the account-agnostic fields below.
    const industryField = page.getByRole('combobox', { name: 'Industry', exact: true });
    await industryField.waitFor({ timeout: 20_000 });

    // Increase Standard User Licenses off its seeded default — this is the field whose quantity
    // later shows up as its own line item's quantity after commit.
    const standardLicensesField = page.getByRole('spinbutton', { name: 'Standard User Licenses' });
    await standardLicensesField.waitFor();
    await standardLicensesField.fill('250');
    await page.keyboard.press('Tab');

    const commitButton = page.getByRole('button', { name: 'Save and Close', exact: true });
    await commitButton.waitFor();
    await commitButton.click();

    // Re-verify from the backend that real Quote Line Items were created (not just a UI toast) —
    // the actual failure mode when this was blocked was a silent zero-line-item result.
    let lineItems: Record<string, any>[] = [];
    await expect
      .poll(
        async () => {
          lineItems = await snQuery(
            'sn_quote_mgmt_core_quote_line_item',
            `quote=${quoteSysId}`,
            'sys_id,short_description,quantity'
          );
          return lineItems.length;
        },
        { timeout: 20_000 }
      )
      .toBeGreaterThan(0);

    // The root bundle line syncs back as its own Quote Line Item — the license-quantity fields
    // set inside the configurator (Standard/Partner/Viewer Users) price into this single root
    // line rather than creating their own separate line items (confirmed live: only 1 line item
    // resulted from this fixture, not one per configurator field).
    const rootLine = lineItems.find((li) => li.short_description?.trim() === "Solana's Root Product Offering");
    expect(rootLine).toBeTruthy();
    expect(rootLine!.quantity).toBe('1');

    // Both the line item's own price fields and the quote header total stay genuinely $0.00 for
    // this fixture (confirmed live, not a timing/async issue — polled 20s with no change): a
    // bundle configured only via its own Bundle Selection fields (Industry/Use Case/license
    // quantities), with no additional catalog item separately "Added", prices at $0 both at the
    // line and header level. Pricing a configured bundle above $0 needs either an item actually
    // Added from the catalog grid or a manual Reprice — out of scope for this scene, whose own
    // assertion is the line-item sync-back itself, not the resulting price.
    const quoteAfter = await snGet('sn_quote_mgmt_core_quote', quoteSysId, 'total_amount,synced');
    expect(quoteAfter.total_amount).toBe('$0.00');
  });
});
