import { chromium, type FullConfig } from '@playwright/test';
import * as dotenv from 'dotenv';
import { mkdirSync, writeFileSync } from 'node:fs';

dotenv.config({ path: `./${process.env.E2E_ENV_FILE ?? '.env'}`, override: true });

export default async function globalSetup(config: FullConfig) {
  mkdirSync('./results', { recursive: true });
  writeFileSync('./results/drift-findings.jsonl', '');
  const baseURL = process.env.SERVICENOW_INSTANCE_URL;
  const username = process.env.SERVICENOW_USERNAME;
  const password = process.env.SERVICENOW_PASSWORD;

  if (!baseURL || !username || !password) {
    throw new Error(
      'SERVICENOW_INSTANCE_URL, SERVICENOW_USERNAME, and SERVICENOW_PASSWORD must be set ' +
        '(in .env — copy .env.example) before running the e2e suite.'
    );
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL });

  await page.goto('/login.do');
  await page.getByRole('textbox', { name: 'User name' }).fill(username);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL(/nav_to\.do|home\.do|now\/nav|\/now\//, { timeout: 30_000 });

  await page.context().storageState({ path: './results/.auth/session.json' });
  await browser.close();
}
