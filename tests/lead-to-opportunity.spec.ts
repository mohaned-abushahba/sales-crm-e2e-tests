import { test, expect } from '@playwright/test';
import { snInsert, snGet, snDelete } from '../utils/servicenow-api';

const LEAD_FIXTURE = {
  first_name: 'Playwright',
  last_name: 'QA Test Lead',
  company: 'QA Automation Test Co',
  industry: 'Technology Services',
  email: 'playwright.qa.test@example.com',
  short_description: 'Disposable lead created by the e2e suite.',
};

test.describe('Lead to Opportunity conversion', () => {
  let leadSysId: string;
  let accountSysId: string | undefined;
  let contactSysId: string | undefined;
  let opportunitySysId: string | undefined;

  test.beforeEach(async () => {
    leadSysId = await snInsert('sn_lead_mgmt_core_lead', LEAD_FIXTURE);
    accountSysId = undefined;
    contactSysId = undefined;
    opportunitySysId = undefined;
  });

  test.afterEach(async () => {
    if (opportunitySysId) await snDelete('sn_opty_mgmt_core_opportunity', opportunitySysId);
    if (contactSysId) await snDelete('customer_contact', contactSysId);
    if (accountSysId) await snDelete('customer_account', accountSysId);
    await snDelete('sn_lead_mgmt_core_lead', leadSysId);
  });

  test('qualifying a lead converts it into an account, contact, and opportunity', async ({ page }) => {
    test.setTimeout(90_000);

    await page.goto(`/now/cwf/agent/record/sn_lead_mgmt_core_lead/${leadSysId}/params/list_id/undefined`);

    // On opmsalescrm1, the header's "Convert Lead" split-button (not a Stage-field change) is
    // the trigger — setting Stage to "Qualified" directly does open *a* dialog, but that dialog
    // never renders any content (reproduced repeatedly, 45s+), so it's a dead end on this
    // instance. Requires viewport width >=~1280px (see playwright.config.ts) or this button
    // collapses into the "..." More Actions overflow menu instead.
    //
    // The dialog's content (Account/Contact/Opportunity sections) also has a genuine, unpredictable
    // app-level render bug: it usually populates in ~3s, but reproducibly sometimes stays blank
    // forever (confirmed by screenshot, not just a short timeout) — closing and retrying the whole
    // trigger sequence reliably recovers. Retry up to 3 times before giving up for real.
    const convertLeadMenuButton = page.getByRole('button', { name: 'Convert Lead', exact: true });
    const convertLeadHeading = page.getByRole('heading', { name: 'Convert lead' });
    let dialogRendered = false;
    for (let attempt = 1; attempt <= 3 && !dialogRendered; attempt++) {
      await convertLeadMenuButton.waitFor();
      await convertLeadMenuButton.click();

      // Same popover-duplication quirk as the Stage listbox (TESTING-STRATEGY.md §3): a
      // locator-driven click on the menuitem flakes with "element intercepts pointer events"
      // because an overlapping popover copy sits on top. Dispatch a real mouse click instead.
      const toAnAccountOption = page.getByRole('menuitem', { name: 'to an account' }).last();
      await toAnAccountOption.waitFor();
      await page.waitForTimeout(400);
      const menuItemBox = await toAnAccountOption.boundingBox();
      if (!menuItemBox) throw new Error('"to an account" menu item has no bounding box');
      await page.mouse.click(menuItemBox.x + menuItemBox.width / 2, menuItemBox.y + menuItemBox.height / 2);

      // This modal doesn't expose a matching `role="dialog"` container, so scoping through
      // getByRole('dialog') silently matches nothing and hangs for the full timeout regardless
      // of how long you give it — wait for the heading directly instead.
      dialogRendered = await convertLeadHeading
        .waitFor({ state: 'visible', timeout: 12_000 })
        .then(() => true)
        .catch(() => false);

      if (!dialogRendered) {
        await page.getByRole('button', { name: 'Close dialog' }).first().click();
        await page.waitForTimeout(500);
      }
    }
    if (!dialogRendered) {
      throw new Error('Convert lead dialog never rendered its content after 3 attempts');
    }
    // Two "Convert Lead" buttons now exist (header split-button + dialog submit). The dialog is
    // portaled earlier in the DOM than the header, so it's .first(), not .last() — verified by
    // the header's split-button trigger (`now-dropdown` class, "Convert Lead" tooltip) being the
    // one `.last()` resolves to, which then fails to click (covered by the modal backdrop).
    const convertLeadButton = page.getByRole('button', { name: 'Convert Lead', exact: true }).first();
    await convertLeadButton.scrollIntoViewIfNeeded();
    await convertLeadButton.click();

    await expect(
      page.getByText('Congratulations! The lead was successfully converted.')
    ).toBeVisible({ timeout: 30_000 });

    // The success dialog's links share the literal aria-label "Accessible Label" (an app bug),
    // so identify them by href/table instead of accessible name.
    accountSysId = await hrefSysId(page.locator('a[href*="/customer_account/"]'));
    contactSysId = await hrefSysId(page.locator('a[href*="/customer_contact/"]'));
    opportunitySysId = await hrefSysId(page.locator('a[href*="/sn_opty_mgmt_core_opportunity/"]'));

    expect(accountSysId).toBeTruthy();
    expect(contactSysId).toBeTruthy();
    expect(opportunitySysId).toBeTruthy();

    // Re-read from the backend rather than trusting what rendered.
    const lead = await snGet('sn_lead_mgmt_core_lead', leadSysId, 'stage,closed_date');
    expect(lead.stage).toBe('Qualified');
    expect(lead.closed_date).not.toBe('');

    const opportunity = await snGet(
      'sn_opty_mgmt_core_opportunity',
      opportunitySysId!,
      'short_description,account'
    );
    expect(opportunity.short_description).toContain(LEAD_FIXTURE.short_description);
    expect(opportunity.account).toBe(LEAD_FIXTURE.company);
  });
});

async function hrefSysId(link: import('@playwright/test').Locator): Promise<string | undefined> {
  const href = await link.getAttribute('href');
  return href?.split('/').filter(Boolean).pop();
}
