import AxeBuilder from '@axe-core/playwright';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';

const repoRoot = path.resolve(__dirname, '..');
const cli = path.join(repoRoot, 'packages/cli/dist/cli.mjs');

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

test('generates an HTML evidence report from the sample scan and axe-checks it on screen and in print', async ({ page }) => {
  const built = spawnSync(process.execPath, [path.join(repoRoot, 'packages/cli/build.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  expect(built.status, built.stderr).toBe(0);

  const dir = await mkdtemp(path.join(tmpdir(), 'a11ygate-report-e2e-'));
  try {
    const out = path.join(dir, 'report.html');
    const generated = spawnSync(
      process.execPath,
      [
        cli,
        'report',
        '--scan',
        'examples/w3c-bad-demo/scan.json',
        '--generated-at',
        '2026-11-12T13:00:00Z',
        '--format',
        'html',
        '--out',
        out,
      ],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    expect(generated.status, generated.stderr).toBe(0);

    const html = await readFile(out, 'utf8');
    const committed = await readFile(path.join(repoRoot, 'examples/w3c-bad-demo/report.html'), 'utf8');
    expect(html).toBe(committed);
    expect(html).toContain('do not cover all of WCAG or the European Accessibility Act (EAA)');
    expect(html).toContain('not a claim of full compliance');
    expect(html.toLowerCase()).not.toMatch(/fully compliant|eaa compliant|wcag compliant/);

    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await page.goto(pathToFileURL(out).href);
    await expect(page.getByRole('heading', { level: 2, name: 'Findings by WCAG success criterion' })).toBeVisible();
    await expect(page.getByRole('note').first()).toContainText(
      'Automated testing only. Not a WCAG audit, certification or legal advice.',
    );
    expect(requests).toEqual([pathToFileURL(out).href]);

    for (const media of ['screen', 'print'] as const) {
      await page.emulateMedia({ media });
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations, `${media}: ${JSON.stringify(results.violations, null, 2)}`).toEqual([]);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
