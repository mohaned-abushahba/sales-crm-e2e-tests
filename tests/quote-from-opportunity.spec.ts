import { test, expect } from '@playwright/test';
import { snInsert, snGet, snQuery, snUpdate, snDelete } from '../utils/servicenow-api';

const ACCOUNT_FIXTURE = {
  name: 'QA Automation Test Co',
  industry: 'technology_services',
  street: '123 QA Test Street',
  city: 'Testville',
  state: 'CA',
  zip: '90001',
  country: 'USA',
};

const CONTACT_FIXTURE = {
  first_name: 'Pat',
  last_name: 'QA Test Contact',
  email: 'pat.qa.test@example.com',
};

const OPPORTUNITY_FIXTURE = {
  short_description: 'QA Test Opportunity for Quote',
  sales_cycle_type: 'new_business',
  stage: '100_qualification',
};

test.describe('Quote creation from Opportunity', () => {
  let accountSysId: string;
  let contactSysId: string;
  let opportunitySysId: string;
  let quoteSysId: string | undefined;

  test.beforeEach(async () => {
    accountSysId = await snInsert('customer_account', ACCOUNT_FIXTURE);
    contactSysId = await snInsert('customer_contact', {
      ...CONTACT_FIXTURE,
      account: accountSysId,
    });
    // Primary contact + a full address on the account, so the "External Signer auto-populates"
    // and "Billing/Shipping resolve from account address" claims are both actually testable
    // (something is available to carry over either way).
    await snUpdate('customer_account', accountSysId, { primary_contact: contactSysId });
    opportunitySysId = await snInsert('sn_opty_mgmt_core_opportunity', {
      ...OPPORTUNITY_FIXTURE,
      account: accountSysId,
    });
    quoteSysId = undefined;
  });

  test.afterEach(async () => {
    if (quoteSysId) await snDelete('sn_quote_mgmt_core_quote', quoteSysId);
    await snDelete('sn_opty_mgmt_core_opportunity', opportunitySysId);
    await snDelete('customer_contact', contactSysId);
    await snDelete('customer_account', accountSysId);
  });

  test('creating a Quote from an Opportunity auto-populates header fields, computes Contract End Date from Term, and persists Auto-renew', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    await page.goto(`/now/cwf/agent/record/sn_opty_mgmt_core_opportunity/${opportunitySysId}/params/list_id/undefined`);

    const createQuoteButton = page.getByRole('button', { name: 'Create Quote' });
    await createQuoteButton.waitFor();
    await createQuoteButton.click();

    // Unlike the Account's "Create Opportunity" button, "Create Quote" does NOT navigate away —
    // it creates the Quote server-side and shows a toast ("Quote Created. View <number>") but
    // stays on the Opportunity page. Look the new record up by its back-reference instead of
    // relying on the toast or a URL change.
    await expect(page.getByText(/Quote Created/)).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(
        async () => {
          const rows = await snQuery('sn_quote_mgmt_core_quote', `source_opportunity=${opportunitySysId}`, 'sys_id');
          quoteSysId = rows[0]?.sys_id;
          return quoteSysId;
        },
        { timeout: 15_000 }
      )
      .toBeTruthy();

    // Re-read from the backend rather than trusting what rendered.
    const quote = await snGet(
      'sn_quote_mgmt_core_quote',
      quoteSysId!,
      'account,contact,source_opportunity,assigned_to,price_list,cost_book,state,version,total_amount,external_signer,internal_signer,billing_street,shipping_street,same_as_shipping_address'
    );
    expect(quote.account).toBe(ACCOUNT_FIXTURE.name);
    expect(quote.contact).toBe('Pat QA Test Contact');
    expect(quote.source_opportunity).toContain('OPTY');
    expect(quote.price_list).toBe('Standard Price List');
    expect(quote.cost_book).toBe('Standard Cost Book');
    expect(quote.state).toBe('Draft');
    expect(quote.version).toBe('1');
    expect(quote.total_amount).toBe('$0.00');

    // External Signer auto-populates from the account's primary contact — matches FLOWS.md.
    expect(quote.external_signer).toBe('Pat QA Test Contact');

    // "Assigned To" and "Internal Signer" default to the account's own territory-based Sales
    // Owner (inherited via the Opportunity), NOT the current session user — a divergence from
    // FLOWS.md's "defaults to the current user" claim. Assert the actual mechanism, and assert
    // it's explicitly not the logged-in admin, so this doesn't silently pass for the wrong reason.
    const account = await snGet('customer_account', accountSysId, 'sales_owner');
    const currentAdmin = await snQuery('sys_user', 'user_name=admin', 'sys_id');
    expect(quote.assigned_to).toBe(account.sales_owner);
    expect(quote.internal_signer).toBe(account.sales_owner);
    expect(quote.assigned_to).not.toBe(currentAdmin[0]?.sys_id);

    // Billing/Shipping do NOT auto-resolve from the account's address here, even though the
    // account has a full address (street/city/state/zip/country) and "same as shipping" is left
    // unchecked — another divergence from FLOWS.md. Assert the negative explicitly.
    expect(quote.billing_street).toBe('');
    expect(quote.shipping_street).toBe('');
    expect(quote.same_as_shipping_address).toBe('false');

    // Contract Start/Term/End relationship: change Term and confirm End Date recalculates
    // (Start + Term − 1 day), then confirm Auto-renew persists after Save.
    await page.goto(`/now/cwf/agent/record/sn_quote_mgmt_core_quote/${quoteSysId}/params/list_id/undefined`);

    const termField = page.getByRole('textbox', { name: 'Term (months)' });
    await termField.waitFor();
    await termField.fill('24');
    await termField.press('Tab');

    // Use .click() rather than .check(): this custom checkbox's visual/checked state updates
    // correctly (confirmed via screenshot), but Playwright's own post-click actionability
    // re-check reads it as unchanged and throws — the backend re-fetch below is what actually
    // confirms the outcome, so a plain click plus that later poll is the reliable path.
    const autoRenewCheckbox = page.getByRole('checkbox', { name: 'Auto-renew contract' });
    await autoRenewCheckbox.waitFor();
    await autoRenewCheckbox.click();

    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expect
      .poll(
        async () => {
          const saved = await snGet('sn_quote_mgmt_core_quote', quoteSysId!, 'term_month,auto_renew');
          return saved.term_month === '24' && saved.auto_renew === 'true';
        },
        { timeout: 15_000 }
      )
      .toBe(true);

    const contractDates = await snGet(
      'sn_quote_mgmt_core_quote',
      quoteSysId!,
      'contract_start_date,contract_end_date,term_month'
    );
    const start = new Date(contractDates.contract_start_date);
    const end = new Date(contractDates.contract_end_date);
    const expectedEnd = new Date(start);
    expectedEnd.setMonth(expectedEnd.getMonth() + Number(contractDates.term_month));
    expectedEnd.setDate(expectedEnd.getDate() - 1);
    expect(end.toISOString().slice(0, 10)).toBe(expectedEnd.toISOString().slice(0, 10));
  });
});
