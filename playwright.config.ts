import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';

dotenv.config({ path: `./${process.env.E2E_ENV_FILE ?? '.env'}`, override: true });

const baseURL = process.env.SERVICENOW_INSTANCE_URL;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [['html', { open: 'never' }], ['junit', { outputFile: 'results/junit.xml' }]]
    : [['html', { open: 'never' }], ['list']],
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  outputDir: './results/artifacts',
  use: {
    baseURL,
    storageState: './results/.auth/session.json',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // CRM Workspace's header action bar collapses buttons (e.g. "Convert Lead") into a "..."
    // overflow menu below ~1280px. devices['Desktop Chrome']'s default viewport triggers that
    // collapse; a wider viewport keeps actions directly clickable and matches how these demos
    // are actually presented on a full desktop screen.
    viewport: { width: 1600, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 900 } },
    },
  ],
});
