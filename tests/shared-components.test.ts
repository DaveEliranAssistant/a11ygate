import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runScan } from '@/packages/cli/src/scan';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { componentGroupKey, groupSharedComponents, normalizedComponentHtml } from '@/lib/group';
import { buildScanReport } from '@/lib/scan/report';
import { scanHtmlV2 } from '@/lib/scan/report-html-v2';
import { formatReportFromScan } from '@/lib/report-formats';
import { toSarif } from '@/lib/export-sarif';
import type { EnginePageResult } from '@/lib/scan/engines/types';

// Synthetic local fixture site: no browser, network, or external resources.
function fixtureSite() {
  return Array.from({ length: 20 }, (_, i) => {
    const url = `https://fixture.test/page-${i}`;
    return { url, finalUrl: url, status: 200, scanStatus: 'complete' as const, result: {
      url, timestamp: '2026-11-14T10:00:00Z', testEngine: { version: '4.14.0' }, violations: [{
        id: 'link-name', impact: 'serious' as const, tags: ['wcag412'], help: 'Links need names', helpUrl: 'https://fixture.test/rules/link-name',
        nodes: [{ target: [`nav.site-nav > a:nth-child(${i + 1})`], html: `<a class="nav-link" href="/page-${i}"><svg></svg></a>` }],
      }],
    } };
  });
}
function report(engineResults?: EnginePageResult[]) {
  return buildScanReport({ crawl: { pages: fixtureSite(), skipped: [] }, version: '0.2.0', scannedAt: '2026-11-14T10:00:00Z', startUrl: 'https://fixture.test/', failOn: 'serious', maxPages: 20, delayMs: 0, userAgent: 'fixture', robotsNote: 'fixture', engineResults });
}

describe('likely shared component grouping', () => {
  it('groups the same nav bug on 20 fixture pages into one group, with deterministic examples', () => {
    const r = report();
    expect(r.sharedComponentGroups).toHaveLength(1);
    expect(r.sharedComponentGroups![0]).toMatchObject({ pageCount: 20, findingCount: 20, likelySharedComponent: true });
    expect(r.sharedComponentGroups![0]!.examples).toHaveLength(3);
    expect(JSON.parse(JSON.stringify(r)).sharedComponentGroups).toEqual(r.sharedComponentGroups);
    const html = scanHtmlV2(r);
    expect(html).toContain('likely shared component on 20 pages');
    expect(html).toContain('&lt;a class=&quot;nav-link&quot;');
    expect(html).toContain('Review examples to confirm');
    expect(html).toContain('Automated testing only. Not a WCAG audit, certification or legal advice.');
  });

  it('crawls the 20-page fixture through the CLI and writes grouped JSON, HTML and SARIF', async () => {
    const site = fixtureSite();
    const dir = await mkdtemp(path.join(tmpdir(), 'a11ygate-groups-'));
    try {
      const code = await runScan([site[0]!.url, '--crawl', '--max-pages', '20', '--out-dir', dir, '--format', 'sarif'], {
        stdout: () => undefined, stderr: () => undefined, sleep: async () => undefined,
        fetch: async () => ({ ok: false, status: 404, text: async () => '' }),
        engine: async () => ({ close: async () => undefined, visit: async (url) => {
          const page = site.find((p) => p.url === url)!;
          return { status: 200, finalUrl: url, links: site.map((p) => p.url), result: page.result };
        } }),
      });
      expect(code).toBe(1);
      const json = JSON.parse(await readFile(path.join(dir, 'a11ygate-scan.json'), 'utf8'));
      expect(json.counts).toMatchObject({ pagesScanned: 20, findings: 20 });
      expect(json.sharedComponentGroups).toHaveLength(1);
      expect(json.sharedComponentGroups[0].pageCount).toBe(20);
      expect(await readFile(path.join(dir, 'a11ygate-scan.html'), 'utf8')).toContain('likely shared component on 20 pages');
      const sarif = JSON.parse(await readFile(path.join(dir, 'a11ygate-scan.sarif'), 'utf8'));
      expect(sarif.runs[0].results[0].relatedLocations).toHaveLength(19);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('separates different selector paths, HTML structures, semantics and rules', () => {
    const f = report().findings[0]!;
    const groups = groupSharedComponents([f,
      { ...f, pageUrl: 'https://fixture.test/other', selector: 'footer > a', selectors: ['footer > a'] },
      { ...f, html: '<button class="nav-link"><svg></svg></button>' },
      { ...f, html: '<a class="nav-link" role="button"><svg></svg></a>' },
      { ...f, ruleId: 'color-contrast' },
    ]);
    expect(groups).toHaveLength(5);
    expect(groups.every((g) => !g.likelySharedComponent)).toBe(true);
  });

  it('is deterministic under permutations and does not mutate the findings', () => {
    const findings = report().findings;
    const before = JSON.stringify(findings);
    const expected = groupSharedComponents(findings);
    expect(groupSharedComponents([...findings].reverse())).toEqual(expected);
    expect(groupSharedComponents([...findings.slice(7), ...findings.slice(0, 7)])).toEqual(expected);
    expect(JSON.stringify(findings)).toBe(before);
  });

  it('preserves all deduped multi-engine findings and gate totals', () => {
    const engineResults: EnginePageResult[] = fixtureSite().flatMap((p) => ['axe', 'htmlcs'].map((engine) => ({
      engine, url: p.url, status: 'complete' as const, findings: [{ engine, url: p.url, ruleId: 'link-name', impact: 'serious' as const, wcagSc: ['4.1.2'], selector: 'nav > a', elementKey: 'nav > a', snippet: '<a><svg></svg></a>', helpUrl: 'https://fixture.test/rules/link-name' }],
    })));
    const r = report(engineResults);
    expect(r.counts.findings).toBe(20);
    expect(r.findings).toHaveLength(20);
    expect(r.sharedComponentGroups!.reduce((n, g) => n + g.findingCount, 0)).toBe(20);
    expect(r.pages.reduce((n, p) => n + p.findings, 0)).toBe(20);
    expect(Object.values(r.counts.byImpact).reduce((a, b) => a + b, 0)).toBe(20);
    expect(r.verdict).toBe('FAIL');
  });

  it('counts distinct pages rather than occurrences and handles empty input', () => {
    const f = report().findings[0]!;
    expect(groupSharedComponents([f, { ...f, selector: 'nav.site-nav > a:nth-child(2)' }])[0]).toMatchObject({ findingCount: 2, pageCount: 1, likelySharedComponent: false });
    expect(groupSharedComponents([])).toEqual([]);
  });

  it('normalizes generated selectors, attribute order, whitespace and text without losing structure', () => {
    expect(normalizedComponentHtml('<a href="/one" class="nav"> One </a>')).toBe(normalizedComponentHtml('<a class="nav" href="/two">Two</a>'));
    expect(normalizedComponentHtml('<a>\n <svg></svg> </a>')).toBe(normalizedComponentHtml('<a><svg></svg></a>'));
    const f = report().findings[0]!;
    expect(componentGroupKey({ ...f, selectors: ['iframe', 'nav > a'] })).not.toBe(componentGroupKey({ ...f, selectors: ['iframe nav > a'] }));
    expect(groupSharedComponents([{ ...f, html: '' }, { ...f, html: '', pageUrl: 'https://fixture.test/other' }])).toHaveLength(2);
  });

  it('exports related pages in SARIF while retaining all results and fingerprints', () => {
    const r = report();
    const formatted = formatReportFromScan(r);
    const log = JSON.parse(toSarif(formatted));
    const ajv = new Ajv({ strict: false, allErrors: true, unicodeRegExp: false });
    addFormats(ajv);
    const schema = JSON.parse(readFileSync(new URL('./schemas/sarif-schema-2.1.0.json', import.meta.url), 'utf8'));
    const validate = ajv.compile(schema);
    expect(validate(log), ajv.errorsText(validate.errors)).toBe(true);
    expect(log.runs[0].results).toHaveLength(20);
    for (const result of log.runs[0].results) {
      expect(result.relatedLocations).toHaveLength(19);
      expect(new Set(result.relatedLocations.map((l: { physicalLocation: { artifactLocation: { uri: string } } }) => l.physicalLocation.artifactLocation.uri)).size).toBe(19);
      expect(result.relatedLocations[0].message.text).toContain('Likely shared component');
      expect(result.properties.likelySharedComponent.pageCount).toBe(20);
      expect(result.fingerprints.a11ygate).toBeTruthy();
    }
    const capped = JSON.parse(toSarif(formatted, { limits: { maxLocationsPerResult: 2 } }));
    expect(capped.runs[0].results[0].relatedLocations).toHaveLength(2);
    expect(capped.runs[0].results[0].properties.likelySharedComponent.relatedLocationsTruncated).toBe(17);
  });
});
