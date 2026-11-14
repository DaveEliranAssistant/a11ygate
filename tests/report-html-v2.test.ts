import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { AUTOMATED_LIMITS } from '@/lib/copy';
import { CRITERIA, understandingUrl, W3C_UNDERSTANDING_BASE } from '@/lib/mapping';
import { applyFingerprintBaseline, createFingerprintBaseline } from '@/lib/scan/baseline';
import type { EnginePageResult } from '@/lib/scan/engines/types';
import { AXE_TAGS, buildScanReport, scanHtml, type ScanReport } from '@/lib/scan/report';
import { CONTRAST_PAIRS, PALETTE, renderScanHtml, scanHtmlV2, summarizeRules, topFixes } from '@/lib/scan/report-html-v2';
import type { AxeResults } from '@/lib/types';
import { parseScanArgs, runScan, type ScanEngineFactory } from '@/packages/cli/src/scan';

const DISCLAIMER_VERBATIM = 'Automated testing only. Not a WCAG audit, certification or legal advice.';
const ORIGIN = 'https://site.test';
const DEQUE = 'https://dequeuniversity.com/rules/axe/4.14';

type Violation = AxeResults['violations'][number];
const v = (id: string, impact: Violation['impact'], tags: string[], help: string, targets: string[]): Violation => ({
  id, impact, tags, help, helpUrl: `${DEQUE}/${id}`, nodes: targets.map((t) => ({ target: [t], html: `<${t}>` })),
});
const IMAGE_ALT = v('image-alt', 'critical', ['wcag2a', 'wcag111'], 'Images must have alternative text', ['img']);
const CONTRAST = v('color-contrast', 'serious', ['wcag2aa', 'wcag143'], 'Elements must meet minimum color contrast ratio thresholds', ['p.faint', 'a.nav']);
const REGION = v('region', 'moderate', ['best-practice'], 'All page content should be contained by landmarks', ['div']);
const LABEL = v('label', 'critical', ['wcag2a', 'wcag412', 'wcag131'], 'Form elements must have labels', ['input']);

function axeResult(url: string, violations: Violation[]): AxeResults {
  return { url, timestamp: '2026-11-14T10:00:00.000Z', testEngine: { version: '4.14.0' }, violations, toolOptions: {}, scanConfig: {}, scanStatus: 'complete' };
}

function page(p: string, violations: Violation[]) {
  const url = `${ORIGIN}${p}`;
  return { url, finalUrl: url, status: 200, scanStatus: 'complete' as const, result: axeResult(url, violations) };
}

function report(pages = [page('/', [IMAGE_ALT, REGION, CONTRAST]), page('/about', [CONTRAST, LABEL, REGION]), page('/contact', [CONTRAST, REGION])], engineResults?: EnginePageResult[]): ScanReport {
  return buildScanReport({
    crawl: { pages: [...pages, { url: `${ORIGIN}/gone`, finalUrl: `${ORIGIN}/gone`, status: 404, scanStatus: 'failed', error: 'HTTP 404' }], skipped: [{ url: `${ORIGIN}/private/`, reason: 'robots' }] },
    version: '0.2.0', scannedAt: '2026-11-14T10:00:00.000Z', startUrl: `${ORIGIN}/`, failOn: 'serious',
    maxPages: 20, delayMs: 1000, userAgent: 'A11yGate/test', robotsNote: 'robots.txt honoured.', engineResults,
  });
}

function withBaseline(): ScanReport {
  const before = report([page('/', [IMAGE_ALT, REGION])]);
  return applyFingerprintBaseline(report(), createFingerprintBaseline(before));
}

/** Slice one top-level section (by id) out of the v2 report. */
function section(html: string, id: string): string {
  const start = html.indexOf(`<section id="${id}"`);
  expect(start, `section #${id}`).toBeGreaterThan(-1);
  const rest = html.slice(start);
  const end = rest.search(/\n<section id="(?:summary|top-fixes|by-wcag|by-page|how-to-fix|limits)"|\n<\/main>/);
  return rest.slice(0, end);
}

describe('HTML report v2 sections (snapshots)', () => {
  const html = scanHtmlV2(report());

  it.each(['summary', 'top-fixes', 'by-wcag', 'by-page', 'how-to-fix', 'limits'])('section #%s', (id) => {
    expect(section(html, id)).toMatchSnapshot();
  });

  it('header and footer carry the disclaimer', () => {
    expect(html.slice(0, html.indexOf('<main>'))).toMatchSnapshot('header');
    expect(html.slice(html.indexOf('</main>'))).toMatchSnapshot('footer');
  });

  it('executive summary with a baseline shows new vs existing and the engine line', () => {
    const summary = section(scanHtmlV2(withBaseline()), 'summary');
    expect(summary).toContain('Compared with baseline: <strong>');
    expect(summary).toMatch(/<strong>\d+ new<\/strong>; \d+ existing; \d+ fixed; \d+ unassessed\./);
    expect(summary).toContain('Engines used: axe-core 4.14.0.');
    expect(summary).toMatchSnapshot('summary with baseline');
  });

  it('executive summary lists engines used and errored for multi-engine scans', () => {
    const url = `${ORIGIN}/`;
    const finding = { ruleId: 'image-alt', engine: 'axe', wcagSc: ['1.1.1'], impact: 'critical' as const, url, selector: 'img', elementKey: 'img:nth-of-type(1)', snippet: '<img>', helpUrl: `${DEQUE}/image-alt` };
    const r = report([page('/', [IMAGE_ALT])], [
      { engine: 'axe', url, status: 'complete', findings: [finding] },
      { engine: 'htmlcs', url, status: 'errored', error: '<fixture failure>' },
    ]);
    const summary = section(scanHtmlV2(r), 'summary');
    expect(summary).toContain('Engines used: axe');
    expect(summary).toContain('Engines errored: htmlcs — https://site.test/ — &lt;fixture failure&gt;.');
  });
});

describe('Top 10 fixes ordering', () => {
  it('orders by impact weight × pages affected, then severity, occurrences, rule id', () => {
    const rules = summarizeRules(report().findings);
    expect(rules.map((r) => [r.ruleId, r.score])).toEqual([
      ['color-contrast', 9], // serious 3 × 3 pages
      ['region', 6], // moderate 2 × 3 pages
      ['image-alt', 4], // critical 4 × 1 page, tie broken by occurrences
      ['label', 4],
    ]);
    expect(rules[0]).toMatchObject({ occurrences: 6, pages: [`${ORIGIN}/`, `${ORIGIN}/about`, `${ORIGIN}/contact`] });
  });

  it('caps the list at 10 rules', () => {
    const many = Array.from({ length: 13 }, (_, i) => v(`rule-${String(i).padStart(2, '0')}`, 'minor', ['best-practice'], `Rule ${i}`, ['div']));
    const r = report([page('/', many)]);
    expect(topFixes(r.findings)).toHaveLength(10);
    expect(section(scanHtmlV2(r), 'top-fixes').match(/<li>/g)).toHaveLength(10);
  });

  it('says that no findings is not a pass', () => {
    expect(section(scanHtmlV2(report([page('/', [])])), 'top-fixes')).toContain('This does not mean the pages are accessible');
  });
});

describe('disclaimer', () => {
  const variants: [string, ScanReport][] = [
    ['default', report()],
    ['empty', report([page('/', [])])],
    ['with baseline', withBaseline()],
  ];
  it.each(variants)('v2 always contains the disclaimer verbatim (%s)', (_, r) => {
    const html = renderScanHtml(r);
    expect(html).toContain(`<p class="disclaimer" id="disclaimer">${DISCLAIMER_VERBATIM}</p>`);
    expect(html.split(DISCLAIMER_VERBATIM).length - 1).toBeGreaterThanOrEqual(2);
  });

  it('makes no compliance or certification claim', () => {
    const text = renderScanHtml(report()).replace(/<[^>]+>/g, ' ');
    expect(text).not.toMatch(/\b(is|are|fully) (compliant|conformant|accessible)\b|\bcertified\b|fixes everything|guarantee/i);
    for (const limit of AUTOMATED_LIMITS) expect(text).toContain(limit.replace(/&/g, '&amp;'));
  });
});

describe('--report-version 1', () => {
  it('renders the legacy scanHtml output byte-for-byte', () => {
    for (const r of [report(), withBaseline(), report([page('/', [])])]) expect(renderScanHtml(r, 1)).toBe(scanHtml(r));
  });

  it('parses the flag and rejects unknown versions', () => {
    expect(parseScanArgs([ORIGIN])).toMatchObject({ ok: true, options: { reportVersion: 2 } });
    expect(parseScanArgs([ORIGIN, '--report-version', '1'])).toMatchObject({ ok: true, options: { reportVersion: 1 } });
    expect(parseScanArgs([ORIGIN, '--report-version=2'])).toMatchObject({ ok: true, options: { reportVersion: 2 } });
    expect(parseScanArgs([ORIGIN, '--report-version', '3'])).toMatchObject({ ok: false, error: expect.stringContaining('--report-version') });
  });

  it('the CLI writes v1 or v2 HTML on request', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'a11ygate-v2-'));
    const engine: ScanEngineFactory = async () => ({
      visit: async (url) => ({ status: 200, finalUrl: url, links: [], result: axeResult(url, [IMAGE_ALT]) }),
      close: async () => undefined,
    });
    const io = { cwd: dir, stdout: () => undefined, stderr: () => undefined, version: '0.2.0', now: () => new Date('2026-11-14T10:00:00.000Z'), engine, fetch: async () => ({ ok: false, status: 404, text: async () => '' }), sleep: async () => undefined };
    try {
      await runScan([ORIGIN, '--out-dir', 'v1', '--report-version', '1'], io);
      await runScan([ORIGIN, '--out-dir', 'v2'], io);
      const json = JSON.parse(await readFile(path.join(dir, 'v1/a11ygate-scan.json'), 'utf8')) as ScanReport;
      expect(await readFile(path.join(dir, 'v1/a11ygate-scan.html'), 'utf8')).toBe(scanHtml(json));
      expect(await readFile(path.join(dir, 'v2/a11ygate-scan.html'), 'utf8')).toBe(scanHtmlV2(json));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('help links come only from the mapping table and the findings', () => {
  it('the v2 generator source has no hardcoded external URLs', () => {
    const source = readFileSync(path.join(__dirname, '../lib/scan/report-html-v2.ts'), 'utf8');
    expect(source.match(/[a-z][a-z0-9+.-]*:\/\/[^\s'"`)]+/gi) ?? []).toEqual([]);
    expect(source).not.toMatch(/www\.|w3\.org|deque/i);
  });

  it('every external href is a finding helpUrl or a mapping-table Understanding URL', () => {
    const r = report();
    const allowed = new Set([...r.findings.map((f) => f.helpUrl), ...CRITERIA.map((c) => understandingUrl(c))]);
    const hrefs = [...scanHtmlV2(r).matchAll(/href="([^"]*)"/g)].map((m) => m[1]!.replace(/&amp;/g, '&'));
    const external = hrefs.filter((h) => !h.startsWith('#'));
    expect(external.length).toBeGreaterThan(0);
    for (const href of external) expect(allowed, href).toContain(href);
    expect(external).toContain(`${W3C_UNDERSTANDING_BASE}contrast-minimum.html`);
    expect(external).toContain(`${DEQUE}/color-contrast`);
  });

  it('builds an Understanding URL for every mapped criterion', () => {
    for (const c of CRITERIA) expect(understandingUrl(c)).toMatch(/^https:\/\/www\.w3\.org\/WAI\/WCAG22\/Understanding\/[a-z0-9-]+\.html$/);
    expect(understandingUrl({ number: '3.3.4' })).toBe(`${W3C_UNDERSTANDING_BASE}error-prevention-legal-financial-data.html`);
    expect(understandingUrl({ number: '4.1.2' })).toBe(`${W3C_UNDERSTANDING_BASE}name-role-value.html`);
    expect(understandingUrl({ number: '9.9.9' })).toBeNull();
  });

  it('drops non-http help URLs instead of linking them', () => {
    const r = report([page('/', [{ ...IMAGE_ALT, helpUrl: 'javascript:alert(1)' }])]);
    expect(scanHtmlV2(r)).not.toContain('javascript:');
  });
});

describe('print and colour', () => {
  const html = scanHtmlV2(report());

  it('ships print CSS and a dark scheme', () => {
    expect(html).toContain('@media print{');
    expect(html).toContain('@media (prefers-color-scheme:dark)');
    expect(html).not.toMatch(/<script|<link\b|<img\b|<iframe/);
  });

  function luminance(hex: string): number {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  }
  function ratio(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
  }

  it.each(['light', 'dark'] as const)('%s palette pairs meet WCAG contrast minimums', (scheme) => {
    for (const [fg, bg, min] of CONTRAST_PAIRS) {
      expect(ratio(PALETTE[scheme][fg], PALETTE[scheme][bg]), `${scheme} ${fg} on ${bg}`).toBeGreaterThanOrEqual(min);
    }
  });
});

// Dogfood: run axe-core (the same engine and tags `a11ygate scan` uses) against the
// generated report, in light and dark schemes. CI runs `npm test` before
// `npx playwright install`, so this is skipped when Chromium is missing.
const hasChromium = existsSync(chromium.executablePath());

describe.skipIf(!hasChromium)('dogfood: the v2 report scans clean with axe-core', () => {
  const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

  it.each([['default', report()], ['with baseline', withBaseline()], ['empty', report([page('/', [])])]] as const)('%s report', async (_, r) => {
    const browser = await chromium.launch();
    try {
      for (const colorScheme of ['light', 'dark'] as const) {
        // The report's CSP forbids scripts, so bypass it only to inject axe.
        const context = await browser.newContext({ bypassCSP: true, colorScheme, javaScriptEnabled: true });
        await context.route('**/*', (route) => route.abort());
        const tab = await context.newPage();
        await tab.setContent(scanHtmlV2(r));
        await tab.addScriptTag({ content: axeSource });
        const result = await tab.evaluate(async (tags) => {
          const axe = (window as unknown as { axe: { run: (ctx: Document, opts: unknown) => Promise<{ violations: { id: string; nodes: unknown[] }[] }> } }).axe;
          return axe.run(document, { runOnly: { type: 'tag', values: tags } });
        }, [...AXE_TAGS]);
        expect(result.violations.map((x) => `${colorScheme}: ${x.id}`)).toEqual([]);
        await context.close();
      }
    } finally {
      await browser.close();
    }
  }, 60_000);
});
