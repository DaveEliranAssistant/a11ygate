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

for (const file of ['tests/__snapshots__/evidence-report/scan-shop.html', 'examples/w3c-bad-demo/report.html']) {
  test(`the scan-based evidence report ${file} has no axe violations on screen or in print`, async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    const report = path.resolve(file);
    await page.goto(pathToFileURL(report).href);
    await expect(page.getByRole('heading', { level: 2, name: 'Findings by WCAG success criterion' })).toBeVisible();
    await expect(page.getByRole('note').first()).toContainText(
      'Automated testing only. Not a WCAG audit, certification or legal advice.',
    );
    expect(requests).toEqual([pathToFileURL(report).href]);

    for (const media of ['screen', 'print'] as const) {
      await page.emulateMedia({ media });
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations, `${media}: ${JSON.stringify(results.violations, null, 2)}`).toEqual([]);
    }
  });
}
