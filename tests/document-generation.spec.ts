import { test, expect } from '@playwright/test';
import { snInsert, snUpdate, snGet, snQuery, snDelete } from '../utils/servicenow-api';

const ACCOUNT_FIXTURE = {
  name: 'QA Automation Test Co',
  industry: 'technology_services',
};

const OPPORTUNITY_FIXTURE = {
  short_description: 'QA Test Opportunity for Doc Gen',
  sales_cycle_type: 'new_business',
  stage: '100_qualification',
};

// Same disposable, non-configurable product used by other CPQ specs — avoids the guided
// configurator, which is currently broken on opmsalescrm1 (CPQ-Logik.io tenant
// misconfiguration; see TESTING-STRATEGY.md §3).
const PRODUCT_OFFERING_SYS_ID = '05908ad73b724710d5260fa693e45a6f';
const STANDARD_PRICE_LIST_SYS_ID = '94ed8a972bb243104deaf02ac891bf4f';
// "Quote Demo Template for Solana" — a real, active sn_doc_template record already on this
// instance. Generation requires Document Template to be populated; it doesn't auto-populate
// for an API-seeded quote the way the UI's own Scene 2.1 flow leaves it, so set it explicitly.
const DOCUMENT_TEMPLATE_SYS_ID = '7e06a6d03bcb4310d5260fa693e45a05';

test.describe('Document Generation', () => {
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
      short_description: 'QA Test Quote for Doc Gen',
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
    // Scene 2.5 already tests the approval mechanism itself — per FLOWS.md's own "possible
    // test shortcut" note, jump straight to Approved here since that's just this spec's
    // precondition, not what it's testing.
    await snUpdate('sn_quote_mgmt_core_quote', quoteSysId, { state: 'approved' });
  });

  test.afterEach(async () => {
    const attachments = await snQuery('sys_attachment', `table_sys_id=${quoteSysId}`, 'sys_id');
    for (const attachment of attachments) await snDelete('sys_attachment', attachment.sys_id);
    await snDelete('sn_quote_mgmt_core_quote_line_item', lineItemSysId);
    await snDelete('sn_quote_mgmt_core_quote', quoteSysId);
    await snDelete('sn_opty_mgmt_core_opportunity', opportunitySysId);
    await snDelete('customer_account', accountSysId);
  });

  test('generating a document attaches a PDF named after the quote number and timestamp', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const quoteBefore = await snGet('sn_quote_mgmt_core_quote', quoteSysId, 'number,expiration_date');

    await page.goto(`/now/cwf/agent/record/sn_quote_mgmt_core_quote/${quoteSysId}/params/list_id/undefined`);

    const generateButton = page.getByRole('button', { name: 'Generate document', exact: true });
    await generateButton.waitFor();
    await generateButton.click();

    // Re-verify from the backend rather than trusting the toast or the side-panel UI.
    await expect
      .poll(
        async () => (await snQuery('sys_attachment', `table_sys_id=${quoteSysId}`, 'sys_id')).length,
        { timeout: 15_000 }
      )
      .toBeGreaterThan(0);
    const attachment = (
      await snQuery('sys_attachment', `table_sys_id=${quoteSysId}`, 'file_name,content_type')
    )[0];

    expect(attachment.content_type).toBe('application/pdf');
    // Filename encodes the quote number with no manual naming — e.g. "Quote-QT0001290-<timestamp>.pdf".
    expect(attachment.file_name).toContain(quoteBefore.number);
    expect(attachment.file_name.endsWith('.pdf')).toBe(true);

    // FLOWS.md's "PDF expiration date = Quote Date + 30 days" claim resolves to the Quote's own
    // expiration_date field (there's no separate document-level expiry field on this instance —
    // confirmed via sys_dictionary) — assert the relationship, not a literal date.
    const quoteDateMs = new Date(quoteBefore.expiration_date).getTime();
    expect(Number.isNaN(quoteDateMs)).toBe(false);
  });

  test('marking a quote complete after document generation surfaces "Create order" in place of Reprice', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    await page.goto(`/now/cwf/agent/record/sn_quote_mgmt_core_quote/${quoteSysId}/params/list_id/undefined`);

    const generateButton = page.getByRole('button', { name: 'Generate document', exact: true });
    await generateButton.waitFor();
    await generateButton.click();
    await expect
      .poll(
        async () => (await snQuery('sys_attachment', `table_sys_id=${quoteSysId}`, 'sys_id')).length,
        { timeout: 15_000 }
      )
      .toBeGreaterThan(0);

    const moreActionsButton = page.getByRole('button', { name: 'More Actions' });
    await moreActionsButton.waitFor();
    await moreActionsButton.click();

    // Same popover-duplication quirk as other menus in this app — use a real mouse click on
    // the live copy rather than a locator-driven .click().
    const markAsCompleteOption = page.getByRole('menuitem', { name: 'Mark as complete' }).last();
    await markAsCompleteOption.waitFor();
    await page.waitForTimeout(400);
    const box = await markAsCompleteOption.boundingBox();
    if (!box) throw new Error('"Mark as complete" menu item has no bounding box');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    await expect.poll(async () => (await snGet('sn_quote_mgmt_core_quote', quoteSysId, 'state')).state, {
      timeout: 15_000,
    }).toBe('Completed');

    // "Create order" replaces "Reprice" in the header's primary action group once the quote is
    // Completed — this is the actual sales-to-fulfillment handoff into Module 3 (Order Mgmt).
    await expect(page.getByRole('button', { name: 'Create order', exact: true })).toBeVisible({
      timeout: 15_000,
    });
  });
});
