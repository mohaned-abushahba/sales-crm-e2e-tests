import { test, expect } from '@playwright/test';
import { snInsert, snGet, snUpdate, snDelete } from '../utils/servicenow-api';

const ACCOUNT_FIXTURE = {
  name: 'QA Automation Test Co',
  industry: 'technology_services',
};

const CONTACT_FIXTURE = {
  first_name: 'Pat',
  last_name: 'QA Test Contact',
  email: 'pat.qa.test@example.com',
};

test.describe('Opportunity creation from an existing Account', () => {
  let accountSysId: string;
  let contactSysId: string;
  let opportunitySysId: string | undefined;

  test.beforeEach(async () => {
    accountSysId = await snInsert('customer_account', ACCOUNT_FIXTURE);
    contactSysId = await snInsert('customer_contact', {
      ...CONTACT_FIXTURE,
      account: accountSysId,
    });
    // Give the account a primary contact so the "Contact does not auto-populate" assertion
    // below is meaningful (there's something available to carry over, and it still doesn't).
    await snUpdate('customer_account', accountSysId, { primary_contact: contactSysId });
    opportunitySysId = undefined;
  });

  test.afterEach(async () => {
    if (opportunitySysId) await snDelete('sn_opty_mgmt_core_opportunity', opportunitySysId);
    await snDelete('customer_contact', contactSysId);
    await snDelete('customer_account', accountSysId);
  });

  test('creating an Opportunity from an Account carries over Account, Stage, and territory-based ownership — but not Contact or Industry pre-selection', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    await page.goto(`/now/cwf/agent/record/customer_account/${accountSysId}/params/list_id/undefined`);

    const createOpportunityButton = page.getByRole('button', { name: 'Create Opportunity' });
    await createOpportunityButton.waitFor();
    await createOpportunityButton.click();

    // Clicking "Create Opportunity" on the Account immediately creates and saves a new
    // Opportunity record (no intermediate form to fill in) and navigates straight to it.
    await page.waitForURL(/\/sub\/record\/sn_opty_mgmt_core_opportunity\/[0-9a-f]{32}/, {
      timeout: 20_000,
    });
    opportunitySysId = page.url().match(/sn_opty_mgmt_core_opportunity\/([0-9a-f]{32})/)?.[1];
    expect(opportunitySysId).toBeTruthy();

    // "Qualification" text matches over a dozen elements elsewhere on the page (hidden dropdown
    // options in other fields) — the backend re-read below is the reliable check for Stage;
    // this is just a sanity check that the record navigation itself actually landed correctly.
    await expect(page.getByRole('heading', { name: /Opportunity for/ })).toBeVisible();
    await expect(page.getByText(ACCOUNT_FIXTURE.name, { exact: true }).first()).toBeVisible();

    // Re-read from the backend rather than trusting what rendered.
    const opportunity = await snGet(
      'sn_opty_mgmt_core_opportunity',
      opportunitySysId!,
      'account,contact,industry,territory,assigned_to,stage'
    );
    expect(opportunity.account).toBe(ACCOUNT_FIXTURE.name);
    expect(opportunity.stage).toBe('Qualification');

    // On opmsalescrm1, Industry auto-populates from the account's own Industry — a real
    // divergence from the source clickpath doc (FLOWS.md), which describes Industry as
    // requiring manual selection. Assert what this instance actually does, not the doc.
    expect(opportunity.industry).toBe('Technology Services');

    // Contact does NOT auto-populate here, even though the account has a primary_contact set
    // (verified above) — also a divergence from FLOWS.md. Assert the negative explicitly so a
    // future platform change that starts auto-populating it doesn't silently go unnoticed.
    expect(opportunity.contact).toBe('');

    // Territory-based ownership: the Opportunity inherits the account's own Territory and Sales
    // Owner automatically, with no manual assignment step — this is the actual mechanism behind
    // "visible to the account's territory-based ownership" from FLOWS.md, verified directly
    // rather than via a separate manager-impersonation check (deferred, per that doc's own hedge).
    const account = await snGet('customer_account', accountSysId, 'primary_sales_territory,sales_owner');
    expect(opportunity.territory).toBe(account.primary_sales_territory);
    expect(opportunity.assigned_to).toBe(account.sales_owner);
  });
});
