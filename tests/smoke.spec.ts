import { test, expect } from '@playwright/test';

test('authenticated session can reach a CRM workspace', async ({ page }) => {
  await page.goto('/now/nav/ui/classic/params/target/home.do');
  await expect(page).not.toHaveURL(/login\.do/);
});
