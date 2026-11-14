import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { buildEvidencePack, parseScanReport } from '@/lib/evidence/pack';
import { createZip, readZip } from '@/lib/evidence/zip';
import { createFingerprintBaseline } from '@/lib/scan/baseline';
import type { VisitOutcome } from '@/lib/scan/crawl';
import { AXE_TAGS } from '@/lib/scan/report';
import { buildTrend, renderTrendHtml, type TrendReport } from '@/lib/trend';
import type { AxeResults } from '@/lib/types';
import { run } from '@/packages/cli/src/run';
import { runScan, type ScanEngineFactory } from '@/packages/cli/src/scan';
import { parseTrendArgs, TREND_HTML, TREND_JSON } from '@/packages/cli/src/trend';
import { blockNetwork } from './network-guard';

const ORIGIN = 'https://site.test';
const DEQUE = 'https://dequeuniversity.com/rules/axe/4.14';
type Violation = AxeResults['violations'][number];
const v = (id: string, impact: Violation['impact'], tags: string[], targets: string[]): Violation => ({
  id, impact, tags, help: id, helpUrl: `${DEQUE}/${id}`, nodes: targets.map((t) => ({ target: [t], html: `<${t}>` })),
});

/**
 * Three runs of the same two-page site. Expected counts are worked out by hand:
 *   Sep: /      contrast p.faint, contrast a.nav, (p.faint reported twice → deduped)
 *        /about image-alt img                                      total 3, new 3
 *   Oct: /      contrast p.faint
 *        /about image-alt img, label input                        total 3, new 1 (label), existing 2, fixed 1 (a.nav)
 *   Nov: /      contrast p.faint, label input
 *        /about label input                                       total 3, new 1 (/ label), existing 2, fixed 1 (img)
 */
const RUNS = [
  { file: 'c-september.zip', scannedAt: '2026-09-01T08:00:00Z', sha: 'aaaaaaa1111111111111111111111111111111111', pages: {
    '/': [v('color-contrast', 'serious', ['wcag2aa', 'wcag143'], ['p.faint', 'p.faint', 'a.nav'])],
    '/about': [v('image-alt', 'critical', ['wcag2a', 'wcag111'], ['img'])] } },
  { file: 'a-october.zip', scannedAt: '2026-10-01T08:00:00Z', sha: 'bbbbbbb2222222222222222222222222222222222', pages: {
    '/': [v('color-contrast', 'serious', ['wcag2aa', 'wcag143'], ['p.faint'])],
    '/about': [v('image-alt', 'critical', ['wcag2a', 'wcag111'], ['img']), v('label', 'critical', ['wcag2a', 'wcag412'], ['input'])] } },
  { file: 'b-november.zip', scannedAt: '2026-11-01T08:00:00Z', sha: 'ccccccc3333333333333333333333333333333333', pages: {
    '/': [v('color-contrast', 'serious', ['wcag2aa', 'wcag143'], ['p.faint']), v('label', 'critical', ['wcag2a', 'wcag412'], ['input'])],
    '/about': [v('label', 'critical', ['wcag2a', 'wcag412'], ['input'])] } },
] as const;

function engineFor(pages: Record<string, readonly Violation[]>): ScanEngineFactory {
  return async () => ({
    axeVersion: '4.14.0',
    visit: async (url: string): Promise<VisitOutcome> => {
      const { pathname } = new URL(url);
      const violations = pages[pathname];
      if (!violations) return { status: 404, finalUrl: url, links: [], error: 'HTTP 404' };
      return { status: 200, finalUrl: url, links: pathname === '/' ? [`${ORIGIN}/about`] : [], result: {
        url, timestamp: '2026-09-01T08:00:00.000Z', testEngine: { version: '4.14.0' }, violations: [...violations], toolOptions: {}, scanConfig: {}, scanStatus: 'complete' } };
    },
    close: async () => undefined,
  });
}

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'a11ygate-trend-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

/** Builds the three fixture evidence packs through the real scan + pack code, offline. */
async function writeFixturePacks(): Promise<string> {
  const packs = path.join(dir, 'packs');
  await mkdir(packs, { recursive: true });
  for (const [index, fixture] of RUNS.entries()) {
    const out = path.join(dir, `scan-${index}`);
    const code = await runScan([ORIGIN, '--crawl', '2', '--out-dir', out, '--fail-on', 'none'], {
      stdout: () => undefined, stderr: () => undefined, cwd: dir, version: '0.1.0', now: () => new Date(fixture.scannedAt),
      engine: engineFor(fixture.pages), sleep: async () => undefined, fetch: async () => ({ ok: false, status: 404, text: async () => '' }),
    });
    expect(code).toBe(0);
    const result = buildEvidencePack({
      scanJson: await readFile(path.join(out, 'a11ygate-scan.json'), 'utf8'), files: [], toolVersion: '0.1.0',
      // Packed in reverse order, so packedAt alone would give the wrong order.
      commit: { sha: fixture.sha, source: 'flag' }, packedAt: new Date(Date.UTC(2026, 10, 14, 12 - index)),
    });
    if (!result.ok) throw new Error(result.error);
    await writeFile(path.join(packs, fixture.file), result.zip);
  }
  return packs;
}

async function trendFor(packs: string): Promise<{ code: number; err: string; trend: TrendReport; html: string }> {
  let err = '';
  const code = await run(['trend', packs], { cwd: dir, stdout: () => undefined, stderr: (c) => { err += c; } });
  const trend = JSON.parse(await readFile(path.join(packs, TREND_JSON), 'utf8')) as TrendReport;
  return { code, err, trend, html: await readFile(path.join(packs, TREND_HTML), 'utf8') };
}

describe('a11ygate trend', () => {
  it('(a) per-run counts equal the deduped totals and the hand-computed new/existing/fixed', async () => {
    const packs = await writeFixturePacks();
    const { code, err, trend } = await trendFor(packs);
    expect(code).toBe(0);
    expect(err).toBe('');
    expect(trend.runs.map(({ total, new: added, existing, fixed, unassessed }) => ({ total, new: added, existing, fixed, unassessed }))).toEqual([
      { total: 3, new: 3, existing: 0, fixed: 0, unassessed: 0 },
      { total: 3, new: 1, existing: 2, fixed: 1, unassessed: 0 },
      { total: 3, new: 1, existing: 2, fixed: 1, unassessed: 0 },
    ]);
    // Cross-check against R18's deduped baseline of each pack's own scan report.
    for (const r of trend.runs) {
      const entries = new Map(readZip(await readFile(path.join(packs, r.source))).map((e) => [e.path, e.data]));
      const report = parseScanReport(Buffer.from(entries.get('scan/a11ygate-scan.json')!).toString('utf8'))!;
      expect(r.total).toBe(createFingerprintBaseline(report).findings.length);
      expect(r.new + r.existing).toBe(r.total);
    }
    // September's raw report lists p.faint twice; the trend counts it once.
    expect(trend.topRules).toEqual([
      { ruleId: 'color-contrast', total: 4, perRun: [2, 1, 1] },
      { ruleId: 'label', total: 3, perRun: [0, 1, 2] },
      { ruleId: 'image-alt', total: 2, perRun: [1, 1, 0] },
    ]);
    expect(trend.regressionPages.map((p) => [new URL(p.pageUrl).pathname, p.regressions, p.runsWithRegressions])).toEqual([['/', 1, 1], ['/about', 1, 1]]);
  });

  it('(b) orders runs by the manifest scan timestamp, not file name or pack time', async () => {
    const packs = await writeFixturePacks();
    const { trend } = await trendFor(packs);
    expect(trend.runs.map((r) => r.source)).toEqual(['c-september.zip', 'a-october.zip', 'b-november.zip']);
    expect(trend.runs.map((r) => r.timestamp)).toEqual(RUNS.map((r) => new Date(r.scannedAt).toISOString()));
    expect(trend.runs.map((r) => r.commit)).toEqual(RUNS.map((r) => r.sha));
    expect(trend.runs.map((r) => r.comparedWith)).toEqual([null, 'c-september.zip', 'a-october.zip']);
  });

  it('(c) HTML has the disclaimer, an inline SVG chart, a table view, and no scripts or external resources', async () => {
    const { html } = await trendFor(await writeFixturePacks());
    expect(html).toContain(AUTOMATED_TESTING_DISCLAIMER);
    expect(html).toMatch(/<svg role="img"[^>]*aria-labelledby="chart-title chart-desc"/);
    expect(html).toContain('<caption>Runs</caption>');
    expect(html).not.toMatch(/<script|<link|<img|<iframe|@import|url\(/i);
    expect(html).not.toMatch(/(?:src|href)=["']?https?:/i);
    expect(html).toContain("default-src 'none'");
    expect(html).not.toMatch(/\b(?:compliant|compliance|certified|conformant)\b/i);
  });

  it('(d) runs offline: no network attempt while reading packs and writing reports', async () => {
    const packs = await writeFixturePacks();
    const guard = blockNetwork();
    try {
      const code = await run(['trend', packs, '--out-dir', path.join(dir, 'trend-out')], { cwd: dir, stdout: () => undefined, stderr: () => undefined });
      expect(code).toBe(0);
    } finally {
      guard.restore();
    }
    expect(guard.attempts).toEqual([]);
    expect(existsSync(path.join(dir, 'trend-out', TREND_HTML))).toBe(true);
  });

  it('is deterministic and independent of input order', async () => {
    const packs = await writeFixturePacks();
    const inputs = [];
    for (const name of ['a-october.zip', 'b-november.zip', 'c-september.zip']) {
      const entries = new Map(readZip(await readFile(path.join(packs, name))).map((e) => [e.path, e.data]));
      inputs.push({ source: name, manifest: JSON.parse(Buffer.from(entries.get('manifest.json')!).toString('utf8')), report: parseScanReport(Buffer.from(entries.get('scan/a11ygate-scan.json')!).toString('utf8'))! });
    }
    const forward = buildTrend(inputs);
    expect(buildTrend([...inputs].reverse())).toEqual(forward);
    expect(renderTrendHtml(forward)).toBe(renderTrendHtml(buildTrend(inputs)));
  });

  it('skips tampered or foreign zips and reads extracted pack directories', async () => {
    const packs = await writeFixturePacks();
    const entries = readZip(await readFile(path.join(packs, 'a-october.zip')));
    const tampered = entries.map((e) => e.path === 'scan/a11ygate-scan.json' ? { ...e, data: Buffer.from(Buffer.from(e.data).toString('utf8').replace('"label"', '"lbl"')) } : e);
    await writeFile(path.join(packs, 'a-october.zip'), createZip(tampered));
    await writeFile(path.join(packs, 'other.zip'), createZip([{ path: 'readme.txt', data: Buffer.from('hi') }]));
    const extracted = path.join(packs, 'extracted-october');
    await mkdir(path.join(extracted, 'scan'), { recursive: true });
    for (const e of entries.filter((x) => x.path === 'manifest.json' || x.path === 'scan/a11ygate-scan.json')) await writeFile(path.join(extracted, e.path), e.data);
    const { code, err, trend } = await trendFor(packs);
    expect(code).toBe(0);
    expect(err).toContain('a-october.zip: scan/a11ygate-scan.json does not match the SHA-256 in manifest.json.');
    expect(err).toContain('other.zip: not an evidence pack');
    expect(trend.runs.map((r) => r.source)).toEqual(['c-september.zip', 'extracted-october', 'b-november.zip']);
  });

  it('rejects bad arguments and empty directories', async () => {
    expect(parseTrendArgs([])).toEqual({ ok: false, error: 'Pass the directory of evidence packs: a11ygate trend <dir>.' });
    expect(parseTrendArgs(['a', 'b'])).toEqual({ ok: false, error: 'Unexpected argument b.' });
    expect(parseTrendArgs(['a', '--nope'])).toEqual({ ok: false, error: 'Unknown trend option --nope.' });
    let err = '';
    await mkdir(path.join(dir, 'empty'));
    expect(await run(['trend', 'empty'], { cwd: dir, stdout: () => undefined, stderr: (c) => { err += c; } })).toBe(2);
    expect(err).toContain('no evidence packs found');
    let out = '';
    expect(await run(['trend', '--help'], { cwd: dir, stdout: (c) => { out += c; } })).toBe(0);
    expect(out).toContain('Not a WCAG audit, certification or legal advice.');
  });
});

// Dogfood: axe-core with the same tags `a11ygate scan` uses, light and dark.
// Skipped when Chromium is not installed (CI runs npm test before playwright install).
const hasChromium = existsSync(chromium.executablePath());

describe.skipIf(!hasChromium)('dogfood: the trend report scans clean with axe-core', () => {
  const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

  it('three-run trend report', async () => {
    const { html } = await trendFor(await writeFixturePacks());
    const browser = await chromium.launch();
    try {
      for (const colorScheme of ['light', 'dark'] as const) {
        const context = await browser.newContext({ bypassCSP: true, colorScheme, javaScriptEnabled: true });
        await context.route('**/*', (route) => route.abort());
        const tab = await context.newPage();
        await tab.setContent(html);
        await tab.addScriptTag({ content: axeSource });
        const result = await tab.evaluate(async (tags) => {
          const axe = (window as unknown as { axe: { run: (ctx: Document, opts: unknown) => Promise<{ violations: { id: string }[] }> } }).axe;
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
