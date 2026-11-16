import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { scanKeyboard } from '../lib/scan/keyboard';
import { serveFixture, type FixtureServer } from './scan-server';

// CI installs local Chromium and runs this suite through npm run test:e2e.
// Keep the opt-in Vitest browser suite for focused development as well.
test.describe('keyboard heuristic acceptance', () => {
  let server: FixtureServer;
  test.beforeAll(async () => { server = await serveFixture(path.resolve(__dirname, '../tests/fixtures/keyboard')); });
  test.afterAll(async () => { await server?.close(); });
  test.beforeEach(async ({ page }) => {
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== server.origin) return route.abort();
      if (url.pathname === '/frame.html') return route.fulfill({ contentType: 'text/html', body: await readFile('tests/fixtures/keyboard/iframe-trap-inner.html', 'utf8') });
      return route.continue();
    });
  });
  for (const [fixture, rule] of [
    ['shadow-no-focus', 'keyboard-focus-indicator'],
    ['iframe-trap', 'keyboard-trap'],
    ['reverse-order', 'keyboard-reverse-order'],
    ['broken-tablist', 'keyboard-composite'],
    ['cycle-trap', 'keyboard-trap'],
  ]) {
    test(`${fixture} produces mapped human-review evidence`, async ({ page }) => {
      const url = `${server.origin}/${fixture}.html`;
      await page.goto(url);
      const result = await scanKeyboard(page, url, { budget: 40 });
      expect(result.findings.some(finding => finding.ruleId === rule)).toBe(true);
      for (const finding of result.findings) {
        expect(finding.reviewStatus).toBe('needs human review');
        expect(finding.help).toMatch(/^Needs human review:/);
        expect(finding.wcag[0].number).toMatch(/^(2\.1\.[12]|2\.4\.[37])$/);
      }
    });
  }
  test('ordered cross-origin frame does not create a reverse-order finding', async ({ page }) => {
    const frameUrl = server.origin.replace('127.0.0.1', 'localhost') + '/iframe-ordered-inner.html';
    await page.route('**/*', async route => {
      const url = route.request().url();
      if (url === frameUrl) return route.fulfill({ contentType: 'text/html', body: await readFile('tests/fixtures/keyboard/iframe-ordered-inner.html', 'utf8') });
      if (url === `${server.origin}/cross-origin-ordered.html`) return route.fulfill({ contentType: 'text/html', body: (await readFile('tests/fixtures/keyboard/cross-origin-ordered.html', 'utf8')).replaceAll('CROSS_ORIGIN_URL', frameUrl) });
      return route.fallback();
    });
    const url = `${server.origin}/cross-origin-ordered.html`;
    await page.goto(url);
    const result = await scanKeyboard(page, url, { budget: 40 });
    expect(result.stopReason).toBe('cycle');
    expect(result.notAssessedFrames).toHaveLength(1);
    expect(result.observations.filter(o => o.key === 'Shift+Tab' && o.selector === 'iframe' && o.domIndex === null)).toHaveLength(2);
    expect(result.observations.filter(o => o.key === 'Shift+Tab' && o.domIndex !== null)).toHaveLength(2);
    expect(result.findings).toEqual([]);
  });
  for (const fixture of ['correct-tablist', 'background-focus', 'sane']) {
    test(`${fixture} has zero findings`, async ({ page }) => {
      const url = `${server.origin}/${fixture}.html`;
      await page.goto(url);
      const result = await scanKeyboard(page, url, { budget: 40 });
      expect(result.findings).toEqual([]);
      if (fixture === 'background-focus') expect(result.observations[0].indicatorChanged).toBe(true);
    });
  }
});
