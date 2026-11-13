import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compareScans } from '@/lib/compare';
import {
  buildEvidenceReport,
  computeTrend,
  parseSiteScan,
  renderEvidenceReport,
  REPORT_DISCLAIMER,
  REPORT_FORMATS,
  REQUIRED_DISCLAIMER,
  type EvidenceReportInput,
  type SiteScanSource,
} from '@/lib/evidence-report';
import { gateVerdict, verdictReason } from '@/lib/gate';
import { parseArgs } from '@/packages/cli/src/args';
import { run } from '@/packages/cli/src/run';
import { minimalResult } from './helpers';

const GENERATED_AT = '2026-11-12T10:00:00.000Z';

function scanFixture(name: 'current' | 'previous'): SiteScanSource {
  const text = readFileSync(fileURLToPath(new URL(`../fixtures/scan-report/${name}.json`, import.meta.url)), 'utf8');
  const parsed = parseSiteScan(text);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.scan;
}

function scanInput(previous: SiteScanSource | null): EvidenceReportInput {
  const current = scanFixture('current');
  const diff = compareScans(current.results, previous?.results ?? null);
  return {
    scan: { current, previous },
    generatedAt: GENERATED_AT,
    version: '0.1.0',
    projectName: 'shop.example',
    verdict: gateVerdict(diff.newFindings, 'serious', diff.coverage),
    threshold: 'serious',
    reason: verdictReason(diff.newFindings, 'serious'),
    synthetic: false,
    current: current.results,
    baseline: previous?.results ?? null,
    diff,
  };
}

const withPrevious = () => buildEvidenceReport(scanInput(scanFixture('previous')));

describe('parseSiteScan', () => {
  it('accepts a11ygate scan JSON and rejects other documents', () => {
    expect(scanFixture('current')).toMatchObject({ startUrl: 'https://shop.example/', axeVersion: '4.14.0' });
    expect(parseSiteScan('not json')).toEqual({ ok: false, error: 'The scan file is not valid JSON.' });
    const axe = parseSiteScan(JSON.stringify(minimalResult()));
    expect(axe.ok).toBe(false);
    expect(axe.ok ? '' : axe.error).toContain('Use --current');
    const noResults = parseSiteScan(JSON.stringify({ tool: 'a11ygate', kind: 'site-scan', schemaVersion: 1, scannedAt: 'x', startUrl: 'y' }));
    expect(noResults.ok).toBe(false);
    expect(parseSiteScan(JSON.stringify({ tool: 'a11ygate', kind: 'site-scan', schemaVersion: 9 })).ok).toBe(false);
  });
});

describe('computeTrend', () => {
  it('counts new, fixed and still-open per rule and in total; unassessed is neither fixed nor open', () => {
    const { rules, totals } = computeTrend([
      { ruleId: 'b-rule', counts: { new: 2, baselined: 1, fixed: 0, unassessed: 0 } },
      { ruleId: 'a-rule', counts: { new: 0, baselined: 0, fixed: 3, unassessed: 1 } },
      { ruleId: 'c-rule', counts: { new: 0, baselined: 2, fixed: 0, unassessed: 0 } },
    ]);
    expect(rules).toEqual([
      { ruleId: 'a-rule', baseline: 4, current: 0, delta: -4, new: 0, fixed: 3, stillOpen: 0 },
      { ruleId: 'c-rule', baseline: 2, current: 2, delta: 0, new: 0, fixed: 0, stillOpen: 2 },
      { ruleId: 'b-rule', baseline: 1, current: 3, delta: 2, new: 2, fixed: 0, stillOpen: 1 },
    ]);
    expect(totals).toEqual({ baseline: 7, current: 5, delta: -2, new: 2, fixed: 3, stillOpen: 3 });
    expect(computeTrend([]).totals).toEqual({ baseline: 0, current: 0, delta: 0, new: 0, fixed: 0, stillOpen: 0 });
  });

  it('compares a scan with a previous scan', () => {
    const report = withPrevious();
    expect(report.trend.totals).toEqual({ baseline: 3, current: 6, delta: 3, new: 4, fixed: 1, stillOpen: 2 });
    expect(report.trend.rules.find((row) => row.ruleId === 'color-contrast')).toMatchObject({ new: 2, fixed: 1, stillOpen: 0 });
  });

  it('reports no trend without a previous scan', () => {
    const report = buildEvidenceReport(scanInput(null));
    expect(report.trend).toEqual({ baselineSupplied: false, totals: null, rules: [] });
    expect(report.scope?.previousScannedAt).toBeNull();
    expect(renderEvidenceReport(report, 'md')).toContain('No previous scan was supplied');
  });
});

describe('scan-based evidence report', () => {
  it('records scope, severity, versions and scan time', () => {
    const report = withPrevious();
    expect(report.input).toBe('site-scan');
    expect(report.summary.bySeverity).toEqual({ critical: 2, serious: 3, moderate: 1, minor: 0, unknown: 0 });
    expect(report.tools).toEqual({ a11ygate: '0.1.0', axeCore: { current: ['4.14.0'], baseline: ['4.14.0'] } });
    expect(report.scope).toMatchObject({
      startUrl: 'https://shop.example/',
      scannedAt: '2026-11-12T09:00:00.000Z',
      previousScannedAt: '2026-11-01T09:00:00.000Z',
      maxPages: 3,
    });
    expect(report.scope?.pages.find((page) => page.scanStatus === 'failed')).toMatchObject({ error: 'HTTP 404' });
    expect(report.scope?.skipped.map((group) => group.reason)).toEqual(['cap', 'external', 'not-http', 'robots']);
    expect(report.scope?.boundaries.some((line) => line.startsWith('Read-only'))).toBe(true);
  });

  it('groups WCAG rules by success criterion and lists best-practice rules separately', () => {
    const report = withPrevious();
    expect(report.criteria.map((group) => [group.criterion.number, group.ruleIds])).toEqual([
      ['1.1.1', ['image-alt']],
      ['1.3.1', ['label']],
      ['1.4.3', ['color-contrast']],
      ['2.5.8', ['target-size']],
    ]);
    expect(report.rules.filter((rule) => rule.bestPractice).map((rule) => rule.ruleId)).toEqual(['region']);
    expect(report.rules.find((rule) => rule.ruleId === 'image-alt')?.fix).toMatch(/alternative text/);
    const md = renderEvidenceReport(report, 'md');
    expect(md.indexOf('## Findings by WCAG success criterion')).toBeLessThan(md.indexOf('#### target-size'));
    expect(md.indexOf('## Best-practice rules')).toBeLessThan(md.indexOf('### region'));
  });

  it('HTML is self-contained and print-ready', () => {
    const html = renderEvidenceReport(withPrevious(), 'html');
    expect(html).not.toMatch(/<script|<link|<img|<iframe|<[a-z][^>]*\ssrc=|url\(|@import/i);
    expect(html).toContain('@media print');
    expect(html).toContain('.sheet{break-before:page}');
    expect(html).toContain('tr,li{break-inside:avoid}');
    expect(html).toContain('a[href]::after{content:" (" attr(href) ")"');
    expect(html).not.toContain('<img class="hero"');
  });

  it.each(REPORT_FORMATS)('matches the %s snapshot for the scan fixture', async (format) => {
    const rendered = renderEvidenceReport(withPrevious(), format);
    await expect(rendered).toMatchFileSnapshot(`./__snapshots__/evidence-report/scan-shop.${format}`);
  });
});

describe('fixed disclaimer', () => {
  const reports = {
    'site scan': () => withPrevious(),
    'site scan without previous': () => buildEvidenceReport(scanInput(null)),
    'CI inputs': () => {
      const current = [minimalResult()];
      const diff = compareScans(current, null);
      return buildEvidenceReport({
        generatedAt: GENERATED_AT,
        version: '0.1.0',
        projectName: 'demo.shop',
        verdict: 'FAIL',
        threshold: 'serious',
        reason: 'x',
        synthetic: false,
        current,
        baseline: null,
        diff,
      });
    },
  };

  it('is the exact required sentence and refuses a full-compliance claim', () => {
    expect(REQUIRED_DISCLAIMER).toBe('Automated testing only. Not a WCAG audit, certification or legal advice.');
    expect(REPORT_DISCLAIMER).toContain(REQUIRED_DISCLAIMER);
    expect(REPORT_DISCLAIMER).toContain('do not cover all of WCAG or the European Accessibility Act (EAA)');
    expect(REPORT_DISCLAIMER).toContain('not a claim of full compliance');
    expect(REPORT_DISCLAIMER.toLowerCase()).not.toContain('fully compliant');
  });

  for (const [name, make] of Object.entries(reports)) {
    it.each(REPORT_FORMATS)(`appears verbatim in %s (${name}), even if the model is tampered with`, (format) => {
      const report = { ...make(), disclaimer: '' };
      const rendered = renderEvidenceReport(report, format);
      expect(rendered).toContain('Automated testing only. Not a WCAG audit, certification or legal advice.');
      if (format === 'json') {
        expect((JSON.parse(rendered) as { disclaimer: string }).disclaimer).toContain(REQUIRED_DISCLAIMER);
      }
    });
  }
});

describe('report flag parsing', () => {
  it('parses --scan and --previous-scan', () => {
    const parsed = parseArgs(['report', '--scan', 'a.json', '--previous-scan=b.json', '--out', 'r.html']);
    expect(parsed).toMatchObject({ ok: true, options: { command: 'report', scan: 'a.json', previousScan: 'b.json', out: 'r.html' } });
  });

  it.each([
    [['report', '--scan', 'a.json', '--current', 'c.json'], 'not both'],
    [['report', '--scan', 'a.json', '--baseline', 'c.json'], 'not both'],
    [['report', '--current', 'c.json', '--previous-scan', 'b.json'], '--previous-scan needs --scan'],
    [['report', '--scan', 'a.json', '--scan', 'b.json'], 'only be given once'],
    [['report', '--scan'], '--scan needs a value'],
    [['--scan', 'a.json'], 'only available with a11ygate report'],
    [['report', '--scan', 'a.json', '--no-disclaimer'], 'Unknown option --no-disclaimer'],
  ])('rejects %j', (argv, message) => {
    const parsed = parseArgs(argv);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? '' : parsed.error).toContain(message);
  });
});

describe('committed example (examples/w3c-bad-demo)', () => {
  it.each(['html', 'md'] as const)('report.%s is up to date with its scan.json', async (format) => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    let stdout = '';
    const code = await run(
      ['report', '--scan', 'examples/w3c-bad-demo/scan.json', '--generated-at', '2026-11-12T13:00:00Z', '--format', format],
      { cwd: root, env: {}, stdout: (chunk) => (stdout += chunk), stderr: () => undefined },
    );
    expect(code).toBe(0);
    expect(stdout).toBe(readFileSync(`${root}/examples/w3c-bad-demo/report.${format}`, 'utf8'));
    expect(stdout).toContain(REQUIRED_DISCLAIMER);
  });
});
