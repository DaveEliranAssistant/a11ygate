import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { diffScans } from '@/lib/diff';
import { CSV_EN301549_HEADER, findingsToCsv } from '@/lib/export-csv';
import { toSarif } from '@/lib/export-sarif';
import { EN301549_COLUMN, EN301549_LABEL, EN301549_SOURCE } from '@/lib/mapping';
import { formatReportFromScan } from '@/lib/report-formats';
import { buildScanReport, type ScanReport } from '@/lib/scan/report';
import { renderScanHtml, scanHtmlV2 } from '@/lib/scan/report-html-v2';
import type { AxeResults } from '@/lib/types';
import { parseScanArgs } from '@/packages/cli/src/scan';
import { makeFinding } from './helpers';

const DISCLAIMER_VERBATIM = 'Automated testing only. Not a WCAG audit, certification or legal advice.';
const CLAIM_RE = /fixes everything|WCAG\/EAA compliant|\bcompliant\b|\bconformant\b|\bcertified\b|\bguarantee/i;
const ORIGIN = 'https://site.test';

type Violation = AxeResults['violations'][number];
const v = (id: string, impact: Violation['impact'], tags: string[], help: string, target: string): Violation => ({
  id, impact, tags, help, helpUrl: `https://rules.test/${id}`, nodes: [{ target: [target], html: `<${target}>` }],
});
const CONTRAST = v('color-contrast', 'serious', ['wcag2aa', 'wcag143'], 'Elements must meet minimum color contrast ratio thresholds', 'p.faint');
const LABEL = v('label', 'critical', ['wcag2a', 'wcag412', 'wcag131'], 'Form elements must have labels', 'input');
// WCAG 2.2-only criterion: not in EN 301 549 V3.2.1.
const TARGET = v('target-size', 'serious', ['wcag22aa', 'wcag258'], 'All touch targets must be 24px large, or leave sufficient space', 'button.tiny');
const REGION = v('region', 'moderate', ['best-practice'], 'All page content should be contained by landmarks', 'div');

function report(): ScanReport {
  const url = `${ORIGIN}/`;
  const result: AxeResults = { url, timestamp: '2026-11-14T10:00:00.000Z', testEngine: { version: '4.14.0' }, violations: [CONTRAST, LABEL, TARGET, REGION], toolOptions: {}, scanConfig: {}, scanStatus: 'complete' };
  return buildScanReport({
    crawl: { pages: [{ url, finalUrl: url, status: 200, scanStatus: 'complete', result }], skipped: [] },
    version: '0.2.0', scannedAt: '2026-11-14T10:00:00.000Z', startUrl: url, failOn: 'serious',
    maxPages: 1, delayMs: 1000, userAgent: 'A11yGate/test', robotsNote: 'robots.txt honoured.',
  });
}

describe('EN 301 549 reference column is opt-in (default output unchanged)', () => {
  it('report v2 without the option has no EN 301 549 ref. column and equals the default render', () => {
    const r = report();
    const html = scanHtmlV2(r);
    expect(html).not.toContain(EN301549_COLUMN);
    expect(html).not.toContain(EN301549_LABEL);
    expect(renderScanHtml(r)).toBe(html);
    expect(renderScanHtml(r, 2, { en301549Ref: false })).toBe(html);
  });

  it('SARIF and CSV without the option are unchanged', () => {
    const fr = formatReportFromScan(report());
    expect(toSarif(fr, { en301549Ref: false })).toBe(toSarif(fr));
    expect(toSarif(fr)).not.toContain('en301549Ref');
    const diff = diffScans([makeFinding({ fingerprint: 'a', ruleId: 'color-contrast' })], []);
    expect(findingsToCsv(diff.all)).not.toContain(EN301549_COLUMN);
  });

  it('report v1 ignores the option', () => {
    const r = report();
    expect(renderScanHtml(r, 1, { en301549Ref: true })).toBe(renderScanHtml(r, 1));
  });
});

describe('EN 301 549 ref. column with the label everywhere it appears', () => {
  it('report v2 table (snapshot)', () => {
    const html = renderScanHtml(report(), 2, { en301549Ref: true });
    const start = html.indexOf('<table id="en301549-ref">');
    expect(start).toBeGreaterThan(-1);
    const table = html.slice(start, html.indexOf('</p>', start) + 4);
    expect(table).toMatchSnapshot();
    expect(table).toContain(EN301549_COLUMN);
    expect(table).toContain(EN301549_LABEL);
    expect(table).toContain(`<a href="${EN301549_SOURCE.url}">${EN301549_SOURCE.title}</a>`);
    expect(table).toContain('<td>9.1.4.3</td>');
    expect(table).toContain('<td>not in EN 301 549 V3.2.1</td>');
    expect(table).not.toContain('9.2.5.8');
    expect(html).toContain(DISCLAIMER_VERBATIM);
    expect(html).not.toMatch(CLAIM_RE);
  });

  it('SARIF rule properties (snapshot)', () => {
    const log = JSON.parse(toSarif(formatReportFromScan(report()), { en301549Ref: true })) as {
      runs: { tool: { driver: { rules: { id: string; properties: Record<string, unknown> }[] } } }[];
    };
    const rules = log.runs[0]!.tool.driver.rules;
    const props = Object.fromEntries(rules.map((r) => [r.id, r.properties.en301549Ref]));
    expect(props).toMatchSnapshot();
    // Best-practice rules have no WCAG criterion, so no column.
    expect(props.region).toBeUndefined();
    for (const id of ['color-contrast', 'label', 'target-size']) {
      expect(props[id]).toMatchObject({ column: EN301549_COLUMN, label: EN301549_LABEL, sourceUri: EN301549_SOURCE.url });
    }
    expect(props['target-size']).toMatchObject({ refs: [{ wcag: '2.5.8', en301549: 'not in EN 301 549 V3.2.1' }] });
    expect(JSON.stringify(log)).not.toMatch(CLAIM_RE);
  });

  it('CSV ticket export (snapshot)', () => {
    const diff = diffScans(
      [
        makeFinding({ fingerprint: 'contrast|p|/', ruleId: 'color-contrast', tags: ['wcag2aa', 'wcag143'] }),
        makeFinding({ fingerprint: 'target|b|/', ruleId: 'target-size', tags: ['wcag22aa', 'wcag258'] }),
        makeFinding({ fingerprint: 'region|div|/', ruleId: 'region', tags: ['best-practice'] }),
      ],
      [],
    );
    const csv = findingsToCsv(diff.all, { en301549Ref: true });
    expect(csv).toMatchSnapshot();
    const [header, ...rows] = csv.replace(/^﻿/, '').trim().split('\n');
    expect(CSV_EN301549_HEADER).toBe(`${EN301549_COLUMN} (${EN301549_LABEL})`);
    expect(header!.endsWith(`"${CSV_EN301549_HEADER}"`)).toBe(true);
    expect(rows.find((r) => r.includes('color-contrast'))!.endsWith('"1.4.3: 9.1.4.3"')).toBe(true);
    expect(rows.find((r) => r.includes('target-size'))!.endsWith('"2.5.8: not in EN 301 549 V3.2.1"')).toBe(true);
    expect(rows.find((r) => r.includes('region'))!.endsWith('""')).toBe(true);
    expect(csv).not.toMatch(CLAIM_RE);
  });

  it('the web export shows the label next to the EN 301 549 CSV button', () => {
    const source = readFileSync(path.join(__dirname, '../components/Exports.tsx'), 'utf8');
    expect(source).toContain('findingsToCsv(diff.all, { en301549Ref: true })');
    expect(source).toContain('{EN301549_COLUMN}: {EN301549_LABEL}');
  });
});

describe('a11ygate scan --en301549-ref', () => {
  it('is off by default and turns on with the flag', () => {
    const off = parseScanArgs(['https://site.test/']);
    expect(off.ok && off.options.en301549Ref).toBeFalsy();
    const on = parseScanArgs(['https://site.test/', '--en301549-ref']);
    expect(on.ok && on.options.en301549Ref).toBe(true);
    expect(parseScanArgs(['https://site.test/', '--en301549-ref=yes'])).toEqual({ ok: false, error: '--en301549-ref takes no value.' });
  });
});
