import { expect, test } from '@playwright/test';
import { expectNoSeriousViolations } from './support';

test('pages have no serious or critical accessibility violations', async ({ page }) => {
  await page.goto('/');
  await expectNoSeriousViolations(page, 'home');

  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();

  await page.getByRole('button', { name: 'Load demo data' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('verdict')).toHaveText('FAIL');
  await expectNoSeriousViolations(page, 'workspace with demo data');

  await page.getByRole('link', { name: 'Report', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'EAA evidence report' })).toBeVisible();
  await expectNoSeriousViolations(page, 'report with demo data');

  await page.goto('/privacy');
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy' })).toBeVisible();
  await expectNoSeriousViolations(page, 'privacy');

  await page.goto('/report');
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(page.getByText('No scan is loaded.')).toBeVisible();
  await expectNoSeriousViolations(page, 'empty report');

  await page.goto('/');
  await page.locator('#current-paste').fill('{');
  await page.getByRole('button', { name: 'Parse pasted current JSON' }).click();
  await expect(page.locator('#import-error')).toContainText('Not valid JSON');
  await expectNoSeriousViolations(page, 'import error');
});
