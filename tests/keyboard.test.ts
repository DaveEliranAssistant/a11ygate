import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import { scanKeyboard, KEYBOARD_DISCLAIMER, type KeyboardResult } from '@/lib/scan/keyboard';
import { buildScanReport, scanMarkdown } from '@/lib/scan/report';
import { renderScanHtml } from '@/lib/scan/report-html-v2';
import { parseScanArgs, runScan } from '@/packages/cli/src/scan';

// State-machine tests never launch a browser; real DOM fixtures are separately opt-in.
function mockPage(sequence: (number | null)[], indicatorChanged = true) {
  let tabs = 0;
  const candidates = Array.from({ length: 6 }, (_, i) => ({ selector: `button:nth-child(${i + 1})`, html: '<button>Control</button>', outline: 'none|0px|black', shadow: 'none' }));
  return { get tabs() { return tabs; }, page: {
    keyboard: { press: async () => { tabs++; } },
    evaluate: async (_fn: unknown, items?: unknown) => {
      if (!items) return candidates;
      const domIndex = sequence[(tabs - 1) % sequence.length];
      return { domIndex, selector: domIndex === null ? null : candidates[domIndex].selector, indicatorChanged: domIndex === null ? null : indicatorChanged };
    },
  } as unknown as Page };
}
it('respects the exact per-page budget and does not infer unreachable controls from truncation', async () => {
  const mock = mockPage([0, 1, 2, 3, 4, 5, null]);
  const result = await scanKeyboard(mock.page, 'https://fixture.test/', { budget: 2 });
  expect(mock.tabs).toBe(2); expect(result.steps).toBe(2); expect(result.stopReason).toBe('budget'); expect(result.findings).toEqual([]);
});
it('detects stuck focus after three repeated tabs', async () => {
  const mock = mockPage([0]);
  const result = await scanKeyboard(mock.page, 'https://fixture.test/', { budget: 20 });
  expect(mock.tabs).toBe(4); expect(result.stopReason).toBe('trap'); expect(result.findings[0]).toMatchObject({ ruleId: 'keyboard-trap', reviewStatus: 'needs human review', tags: ['wcag212'] });
});
it('detects missing style changes, backward jumps and unreached candidates with existing mappings', async () => {
  const mock = mockPage([5, 0, null], false);
  const result = await scanKeyboard(mock.page, 'https://fixture.test/', { budget: 20 });
  expect(new Set(result.findings.map(f => f.wcag[0].number))).toEqual(new Set(['2.4.7', '2.4.3', '2.1.1']));
  expect(result.findings.every(f => f.help.startsWith('Needs human review:') && f.helpUrl.startsWith('https://www.w3.org/WAI/WCAG22/Understanding/'))).toBe(true);
});
it('a sane traversal has zero findings', async () => {
  const mock = mockPage([0, 1, 2, 3, 4, 5, null]);
  expect((await scanKeyboard(mock.page, 'https://fixture.test/', { budget: 20 })).findings).toEqual([]);
});
it('validates budgets and leaves the feature disabled without the flag', async () => {
  expect(parseScanArgs(['https://fixture.test/'])).not.toHaveProperty('options.keyboard');
  for (const budget of ['0', '-1', '1001', '1.5']) expect(parseScanArgs(['https://fixture.test/', '--keyboard-budget', budget]).ok).toBe(false);
  expect(parseScanArgs(['https://fixture.test/', '--keyboard=true']).ok).toBe(false);
  await expect(scanKeyboard(mockPage([]).page, 'https://fixture.test/', { budget: 0 })).rejects.toThrow();
});
function report(keyboardResults?: KeyboardResult[]) {
  return buildScanReport({ crawl: { pages: [{ url: 'https://fixture.test/', finalUrl: 'https://fixture.test/', status: 200, scanStatus: 'complete' }], skipped: [] }, version: 'test', scannedAt: '2026-01-01', startUrl: 'https://fixture.test/', failOn: 'moderate', maxPages: 1, delayMs: 0, userAgent: 'test', robotsNote: '', ...(keyboardResults ? { keyboardResults } : {}) });
}
it('keeps the disclaimer and human-review label across JSON, Markdown and HTML, including zero findings', async () => {
  for (const sequence of [[0], [0, 1, 2, 3, 4, 5, null]]) {
    const result = await scanKeyboard(mockPage(sequence).page, 'https://fixture.test/', { budget: 20 });
    const output = report([result]);
    expect(output.counts.findings).toBe(result.findings.length);
    expect(output.pages[0].findings).toBe(result.findings.length);
    for (const rendered of [JSON.stringify(output), scanMarkdown(output), renderScanHtml(output, 1), renderScanHtml(output, 2)]) {
      expect(rendered).toContain('Absence of findings does not confirm keyboard accessibility.');
      expect(rendered).toContain('human review');
      expect(rendered).not.toMatch(/keyboard accessibility (is )?confirmed/i);
    }
  }
  expect(report()).not.toHaveProperty('keyboard');
});
it('wires opt-in keyboard options through runScan without a model', async () => {
  let output = '';
  const code = await runScan(['https://fixture.test/', '--keyboard', '--keyboard-budget', '7', '--ignore-robots', '--json', '-'], {
    env: { NODE_ENV: 'test' }, stdout: s => { output += s; }, stderr: () => {},
    engine: async options => {
      expect(options.keyboard).toEqual({ budget: 7 });
      return { keyboardResults: [], visit: async url => ({ finalUrl: url, status: 200, contentType: 'text/html', links: [], analysed: true }), close: async () => {} };
    },
  });
  expect(code).toBe(0); expect(JSON.parse(output).keyboard).toEqual([]);
});

// Normal npm test never starts Chromium. Explicitly enable for headless fixture acceptance.
describe.skipIf(process.env.A11YGATE_BROWSER_TESTS !== '1')('keyboard browser fixtures', () => {
  async function scan(name: string, budget = 20) {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(await readFile(`tests/fixtures/keyboard/${name}.html`, 'utf8'));
      return await scanKeyboard(page, 'https://fixture.test/', { budget });
    } finally { await browser.close(); }
  }
  it('runs the shipped CLI browser adapter and includes labelled keyboard evidence', async () => {
    const html = await readFile('tests/fixtures/keyboard/no-focus-style.html', 'utf8');
    const server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const url = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/`;
      let output = ''; let errors = '';
      const code = await runScan([url, '--keyboard', '--keyboard-budget', '10', '--ignore-robots', '--delay-ms', '0', '--json', '-'], {
        env: { NODE_ENV: 'test' }, stdout: value => { output += value; }, stderr: value => { errors += value; },
      });
      expect(code, errors).not.toBe(2);
      const result = JSON.parse(output) as ReturnType<typeof report>;
      expect(result.keyboard?.[0].steps).toBeLessThanOrEqual(10);
      expect(result.findings.find(f => f.ruleId === 'keyboard-focus-indicator')).toMatchObject({ reviewStatus: 'needs human review', tags: ['wcag247'] });
      expect(result.disclaimer).toContain(KEYBOARD_DISCLAIMER);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  }, 30_000);
  it('no focus style needs review', async () => { expect((await scan('no-focus-style')).findings.some(f => f.ruleId === 'keyboard-focus-indicator')).toBe(true); }, 30_000);
  it('a keyboard trap needs review', async () => { expect((await scan('trap')).findings.some(f => f.ruleId === 'keyboard-trap')).toBe(true); }, 30_000);
  it('an unreachable button needs review', async () => { expect((await scan('unreachable')).findings.some(f => f.ruleId === 'keyboard-unreachable')).toBe(true); }, 30_000);
  it('a sane page produces zero findings', async () => { expect((await scan('sane')).findings).toEqual([]); }, 30_000);
  it('a backward DOM jump needs review', async () => { expect((await scan('order-jump')).findings.some(f => f.ruleId === 'keyboard-order-jump')).toBe(true); }, 30_000);
  it('respects the budget on a real page', async () => { const result = await scan('sane', 1); expect(result.steps).toBe(1); expect(result.stopReason).toBe('budget'); expect(result.findings).toEqual([]); }, 30_000);
});
