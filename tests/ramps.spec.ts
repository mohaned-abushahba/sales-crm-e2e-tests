import { test, expect } from '@playwright/test';
import { snInsert, snDelete } from '../utils/servicenow-api';

const ACCOUNT_FIXTURE = {
  name: 'QA Automation Test Co',
  industry: 'technology_services',
};

const OPPORTUNITY_FIXTURE = {
  short_description: 'QA Test Opportunity for Ramps',
  sales_cycle_type: 'new_business',
  stage: '100_qualification',
};

// Same recurring/subscription product confirmed live to expose the Ramps button (Scene 2.2's own
// fixture product) — a 36-month term on the line item is what the Ramps dialog reads Start/End
// date and Term from directly (confirmed live: no separate "is this line recurring" flag exists
// on sn_quote_mgmt_core_quote_line_item; it's driven by the product offering itself).
const SOLANA_PRODUCT_OFFERING_SYS_ID = '6f7e75df3b324710d5260fa693e45a9a';
const STANDARD_PRICE_LIST_SYS_ID = '94ed8a972bb243104deaf02ac891bf4f';
const TERM_MONTHS = 36;

test.describe('Ramps', () => {
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
      short_description: 'QA Test Quote for Ramps',
    });
    lineItemSysId = await snInsert('sn_quote_mgmt_core_quote_line_item', {
      quote: quoteSysId,
      product_offering: SOLANA_PRODUCT_OFFERING_SYS_ID,
      price_list: STANDARD_PRICE_LIST_SYS_ID,
      short_description: 'Solana Revenue Enablement Platform',
      line_type: 'New',
      action: 'Add',
      term_month: String(TERM_MONTHS),
    });
  });

  test.afterEach(async () => {
    await snDelete('sn_quote_mgmt_core_quote_line_item', lineItemSysId);
    await snDelete('sn_quote_mgmt_core_quote', quoteSysId);
    await snDelete('sn_opty_mgmt_core_opportunity', opportunitySysId);
    await snDelete('customer_account', accountSysId);
  });

  test('selecting a recurring line enables Ramps, and a 36-month term auto-derives 3 yearly segments', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    await page.goto(`/now/cwf/agent/record/sn_quote_mgmt_core_quote/${quoteSysId}/params/list_id/undefined`);

    const lineItemsTab = page.getByRole('tab', { name: 'Line items', exact: false });
    await lineItemsTab.waitFor();
    await lineItemsTab.click();

    const ramposButton = page.getByRole('button', { name: 'Ramps', exact: true });
    await ramposButton.waitFor();
    await expect(ramposButton).toBeDisabled();

    const selectRowCheckbox = page.getByRole('checkbox', { name: 'Select row 1' });
    await selectRowCheckbox.waitFor();
    await selectRowCheckbox.click();

    await expect(ramposButton).toBeEnabled();
    await ramposButton.click();

    const ramTypeField = page.getByRole('textbox', { name: 'Ramp type', exact: true });
    await ramTypeField.waitFor({ timeout: 15_000 });
    await expect(ramTypeField).toHaveValue('Yearly');

    const termField = page.getByRole('spinbutton', { name: 'Term (months)', exact: true });
    await expect(termField).toHaveValue(String(TERM_MONTHS));

    // The real assertion this scene is built around: Ramp type "Yearly" auto-derives the segment
    // count from the term (36 months / 12-month years = 3 segments) — confirmed live.
    const segmentsField = page.getByRole('spinbutton', { name: 'Segments', exact: true });
    await expect(segmentsField).toHaveValue('3');
  });
});
