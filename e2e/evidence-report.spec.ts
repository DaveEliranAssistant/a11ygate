import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

test('the exported HTML evidence report has no axe violations and loads nothing external', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  const report = path.resolve('tests/__snapshots__/evidence-report/demo-shop.html');
  await page.goto(pathToFileURL(report).href);
  await expect(page.getByRole('heading', { level: 1, name: 'Accessibility evidence report — demo.shop' })).toBeVisible();
  expect(requests).toEqual([pathToFileURL(report).href]);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
});
