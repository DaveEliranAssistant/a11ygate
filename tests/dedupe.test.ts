import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runScan } from '@/packages/cli/src/scan';
import { describe, expect, it } from 'vitest';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { toJunit } from '@/lib/export-junit';
import { toSarif } from '@/lib/export-sarif';
import { formatReportFromScan } from '@/lib/report-formats';
import { dedupeFindings, normalizeLocator } from '@/lib/scan/engines/dedupe';
import type { NormalizedFinding } from '@/lib/scan/engines/normalized';
import type { EnginePageResult } from '@/lib/scan/engines/types';
import { buildScanReport, scanHtml, scanMarkdown } from '@/lib/scan/report';

const url = 'https://site.test/';
const finding = (engine: string, overrides: Partial<NormalizedFinding> = {}): NormalizedFinding => ({
  engine, url, selector: 'main > img', ruleId: engine === 'axe' ? 'image-alt' : 'img_alt_valid',
  wcagSc: ['1.1.1'], impact: 'serious', snippet: '<img src="fixture.png">', helpUrl: 'https://site.test/rule', ...overrides,
});
const complete = (engine: string, findings = [finding(engine)]): EnginePageResult => ({ engine, url, status: 'complete', findings });
const errored: EnginePageResult = { engine: 'htmlcs', url, status: 'errored', error: '<fixture failure>' };

function report(results: EnginePageResult[]) {
  return buildScanReport({
    crawl: { pages: [{ url, finalUrl: url, status: 200, scanStatus: 'complete' }], skipped: [] },
    engineResults: results, version: '0.1.0', scannedAt: '2026-11-14T00:00:00.000Z',
    startUrl: url, failOn: 'serious', maxPages: 1, delayMs: 0, userAgent: 'fixture', robotsNote: 'fixture',
  });
}

describe('cross-engine deduplication', () => {
  it.each([
    ['same element and mapped SC', { selector: ' main>img ', wcagSc: [] }, 1],
    ['different element', { selector: 'main > img:nth-child(2)' }, 2],
    ['different SC', { wcagSc: ['1.4.3'] }, 2],
    ['different page', {}, 2],
  ] as const)('%s', (name, overrides, total) => {
    const second = complete('ibm', [finding('ibm', overrides as Partial<NormalizedFinding>)]);
    if (name === 'different page') second.url = `${url}other`;
    const merged = dedupeFindings([complete('axe'), second]);
    expect(merged).toHaveLength(total);
    if (total === 1) expect(merged[0]).toMatchObject({ engines: ['axe', 'ibm'], confidence: { confirmedBy: 2, enginesRan: 2, agreement: 1 } });
  });

  it('normalizes page fragments and default ports', () => {
    const second = complete('ibm');
    second.url = 'https://SITE.test:443/#fragment';
    expect(dedupeFindings([complete('axe'), second])).toHaveLength(1);
  });

  it('matches resolved CSS/XPath identity without using identical snippets', () => {
    const key = 'html:nth-of-type(1)>body:nth-of-type(1)>img:nth-of-type(2)';
    expect(dedupeFindings([
      complete('axe', [finding('axe', { selector: '#photo', elementKey: key })]),
      complete('ibm', [finding('ibm', { selector: '/html[1]/body[1]/img[2]', elementKey: key })]),
    ])).toHaveLength(1);
    expect(dedupeFindings([complete('axe'), complete('ibm', [finding('ibm', { selector: '#other' })])])).toHaveLength(2);
  });

  it('normalizes simple XPath and conservative CSS formatting', () => {
    expect(normalizeLocator('/html/body/img[2]')).toBe(normalizeLocator('html:nth-of-type(1) > body:nth-of-type(1)>img:nth-of-type(2)'));
    expect(normalizeLocator('[id="photo"]')).toBe('#photo');
    expect(normalizeLocator('/html/body/img')).not.toBe(normalizeLocator('html:nth-of-type(1)>body:nth-of-type(1)>img:nth-of-type(1)'));
    expect(normalizeLocator('[aria-label="a > b"]')).toBe('[aria-label="a > b"]');
    expect(normalizeLocator('main img')).not.toBe(normalizeLocator('main > img'));
    expect(normalizeLocator('img:nth-child(2)')).not.toBe(normalizeLocator('img:nth-of-type(2)'));
  });

  it('splits multi-SC rules without transitively merging different criteria', () => {
    const merged = dedupeFindings([
      complete('axe', [finding('axe', { wcagSc: ['1.3.1', '4.1.2'] })]),
      complete('ibm', [finding('ibm', { wcagSc: ['4.1.2'] })]),
    ]);
    expect(merged.map((f) => [f.wcagSc, f.engines])).toEqual([[['1.3.1'], ['axe']], [['4.1.2'], ['axe', 'ibm']]]);
  });

  it('counts distinct engines, excludes errors and uses page-local agreement and highest severity', () => {
    const results = [complete('axe', [finding('axe'), finding('axe')]), complete('ibm', [finding('ibm', { impact: 'critical' })]), complete('lighthouse', []), errored];
    expect(dedupeFindings(results)[0]).toMatchObject({ impact: 'critical', confidence: { confirmedBy: 2, enginesRan: 3, agreement: 2 / 3 } });
    expect(dedupeFindings([...results, { engine: 'other', url: `${url}other`, status: 'complete', findings: [] }])[0]?.confidence.enginesRan).toBe(3);
  });

  it('keeps unmapped rules and missing locators separate', () => {
    expect(dedupeFindings([complete('axe', [finding('axe', { ruleId: 'unknown', wcagSc: [] })]), complete('ibm', [finding('ibm', { ruleId: 'unknown', wcagSc: [] })])])).toHaveLength(2);
    expect(dedupeFindings([complete('axe', [finding('axe', { selector: '' })]), complete('ibm', [finding('ibm', { selector: '' })])])).toHaveLength(2);
  });

  it('uses deduped totals for page, severity, summary and gating, including non-axe-only runs', () => {
    const built = report([complete('axe'), complete('ibm', [finding('ibm'), finding('ibm', { selector: '#other', impact: 'critical' })])]);
    expect(built.counts.findings).toBe(2);
    expect(built.findings).toHaveLength(2);
    expect(built.pages[0]?.findings).toBe(2);
    expect(built.counts.byImpact).toEqual({ critical: 1, serious: 1, moderate: 0, minor: 0, unknown: 0 });
    expect(built.reason).toContain('2 findings at or above serious');
    expect(built.verdict).toBe('FAIL');
    expect(report([complete('ibm')]).counts.findings).toBe(1);
  });

  it('shows merged attribution, engine status and disclaimer in all extended formats', () => {
    const built = report([complete('axe'), complete('ibm'), errored]);
    const formats = formatReportFromScan(built);
    const outputs = { markdown: scanMarkdown(built), html: scanHtml(built), junit: toJunit(formats), sarif: toSarif(formats) };
    for (const output of Object.values(outputs)) {
      expect(output).toContain('detected by: axe, ibm');
      expect(output).toContain(AUTOMATED_TESTING_DISCLAIMER);
      expect(output).toContain('htmlcs');
    }
    expect(built.disclaimer).toBe(AUTOMATED_TESTING_DISCLAIMER);
    expect(built.verdict).toBe('ERROR');
    expect(outputs.markdown).toContain('Engines used: axe, ibm.');
    expect(outputs.html).toContain('&lt;fixture failure&gt;');
    expect(outputs).toMatchSnapshot();
    const sarif = JSON.parse(outputs.sarif);
    expect(sarif.runs[0].results).toHaveLength(1);
    expect(sarif.runs[0].results[0].properties.engines).toEqual(['axe', 'ibm']);
  });

  it('includes disclaimer and engine status even with zero findings', () => {
    const built = report([complete('ibm', []), errored]);
    expect(scanMarkdown(built)).toContain(AUTOMATED_TESTING_DISCLAIMER);
    expect(scanHtml(built)).toContain('Engines used: ibm.');
    expect(toJunit(formatReportFromScan(built))).toContain('engines-errored');
    expect(toSarif(formatReportFromScan(built))).toContain('enginesErrored');
  });

  it('archives native evidence and engine errors unchanged, including with reporting-only gating', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'a11ygate-dedupe-'));
    const raw = [
      { engine: 'axe', url, status: 'complete', native: { original: ['native fixture evidence'], findings: 7 } },
      { engine: 'ibm', url, status: 'errored', error: 'fixture engine error' },
    ];
    const evidence: EnginePageResult[] = [complete('axe'), { engine: 'ibm', url, status: 'errored', error: 'fixture engine error' }];
    const before = JSON.stringify(evidence);
    try {
      const code = await runScan([url, '--engines', 'axe,ibm', '--fail-on', 'none', '--out-dir', dir], {
        stdout: () => undefined, stderr: () => undefined,
        fetch: async () => ({ ok: false, status: 404, text: async () => '' }),
        engine: async () => ({
          engineResults: evidence, rawEngineResults: raw,
          visit: async () => ({ status: 200, finalUrl: url, links: [], analysed: true }),
          close: async () => undefined,
        }),
      });
      expect(code).toBe(2);
      expect(JSON.parse(await readFile(path.join(dir, 'engines/axe.json'), 'utf8'))).toEqual([raw[0]]);
      expect(JSON.parse(await readFile(path.join(dir, 'engines/ibm.json'), 'utf8'))).toEqual([raw[1]]);
      expect(JSON.parse(await readFile(path.join(dir, 'a11ygate-scan.json'), 'utf8'))).toMatchObject({ verdict: 'ERROR', counts: { findings: 1 } });
      expect(JSON.stringify(evidence)).toBe(before);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

});
