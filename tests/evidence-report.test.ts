import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compareScans } from '@/lib/compare';
import {
  buildEvidenceReport,
  evidenceReportHtml,
  evidenceReportJson,
  evidenceReportMarkdown,
  inferReportFormat,
  isReportFormat,
  renderEvidenceReport,
  REPORT_DISCLAIMER,
  wcagCriteria,
  type EvidenceReportInput,
} from '@/lib/evidence-report';
import { gateVerdict, verdictReason } from '@/lib/gate';
import { parseAxeJson } from '@/lib/parse';
import type { AxeResults } from '@/lib/types';
import { minimalResult } from './helpers';

const GENERATED_AT = '2026-11-10T09:00:00.000Z';

function fixture(name: string): AxeResults[] {
  const text = readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8');
  const parsed = parseAxeJson(text);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.results;
}

function input(current: AxeResults[], baseline: AxeResults[] | null, overrides: Partial<EvidenceReportInput> = {}) {
  const diff = compareScans(current, baseline);
  return {
    generatedAt: GENERATED_AT,
    version: '0.1.0',
    projectName: 'demo.shop',
    verdict: gateVerdict(diff.newFindings, 'serious', diff.coverage),
    threshold: 'serious',
    reason: verdictReason(diff.newFindings, 'serious'),
    synthetic: true,
    commit: '0123456789abcdef0123456789abcdef01234567',
    branch: 'feat/checkout',
    current,
    baseline,
    diff,
    ...overrides,
  } satisfies EvidenceReportInput;
}

const demo = () => input(fixture('demo-shop-current.json'), fixture('demo-shop-baseline.json'));

describe('evidence report helpers', () => {
  it('maps success-criterion tags, ignores level tags, and sorts numerically', () => {
    expect(wcagCriteria(['wcag2aa', 'wcag412', 'wcag111', 'cat.forms', 'wcag1410', 'wcag21aa'])).toEqual([
      { number: '1.1.1', name: 'Non-text Content', level: 'A', wcag: '2.1' },
      { number: '1.4.10', name: 'Reflow', level: 'AA', wcag: '2.1' },
      { number: '4.1.2', name: 'Name, Role, Value', level: 'A', wcag: '2.1' },
    ]);
    expect(wcagCriteria(['wcag258'])[0]).toMatchObject({ number: '2.5.8', wcag: '2.2' });
    expect(wcagCriteria(['wcag1414'])).toEqual([{ number: '1.4.14', name: null, level: null, wcag: null }]);
    expect(wcagCriteria(['best-practice'])).toEqual([]);
  });

  it('chooses the format from the flag, then the extension, then HTML', () => {
    expect(inferReportFormat('out/report.MD')).toBe('md');
    expect(inferReportFormat('report.markdown')).toBe('md');
    expect(inferReportFormat('report.json')).toBe('json');
    expect(inferReportFormat('report.html')).toBe('html');
    expect(inferReportFormat(undefined)).toBe('html');
    expect(isReportFormat('md')).toBe(true);
    expect(isReportFormat('pdf')).toBe(false);
  });
});

describe('buildEvidenceReport', () => {
  it('summarises new, baselined and fixed violations and the trend on the demo fixtures', () => {
    const report = buildEvidenceReport(demo());
    expect(report.disclaimer).toBe(
      'Automated checks only (axe-core). Not a WCAG conformance audit, certification, or legal advice. Automated tools detect a subset of accessibility issues.',
    );
    expect(report.summary).toEqual({
      new: 2,
      baselined: 5,
      fixed: 3,
      unassessed: 0,
      currentViolations: 7,
      baselineViolations: 8,
      rulesWithCurrentViolations: 7,
    });
    expect(report.trend.totals).toEqual({ baseline: 8, current: 7, delta: -1 });
    expect(report.trend.rules.find((row) => row.ruleId === 'region')).toEqual({
      ruleId: 'region',
      baseline: 0,
      current: 1,
      delta: 1,
    });
    expect(report.pages.map((page) => page.url)).toEqual([
      'https://demo.shop/',
      'https://demo.shop/cart',
      'https://demo.shop/products',
    ]);
    expect(report.tools).toEqual({ a11ygate: '0.1.0', axeCore: { current: ['4.10.2'], baseline: ['4.10.2'] } });
    expect(report.gate.verdict).toBe('FAIL');
  });

  it('groups by rule, current rules first by impact, with mapped WCAG criteria', () => {
    const report = buildEvidenceReport(demo());
    expect(report.rules.map((rule) => rule.ruleId)).toEqual([
      'button-name',
      'color-contrast',
      'html-has-lang',
      'image-alt',
      'label',
      'link-name',
      'region',
      'aria-required-attr',
      'document-title',
    ]);
    const contrast = report.rules.find((rule) => rule.ruleId === 'color-contrast');
    expect(contrast?.wcag.map((criterion) => criterion.number)).toEqual(['1.4.3']);
    expect(contrast?.counts).toEqual({ new: 1, baselined: 0, fixed: 1, unassessed: 0 });
    expect(contrast?.findings.map((finding) => finding.status)).toEqual(['new', 'fixed']);
    const region = report.rules.find((rule) => rule.ruleId === 'region');
    expect(region?.bestPractice).toBe(true);
  });

  it('treats every finding as new and reports no trend without a baseline', () => {
    const report = buildEvidenceReport(input(fixture('demo-shop-current.json'), null, { commit: null, branch: '  ' }));
    expect(report.summary.new).toBe(7);
    expect(report.summary.baselineViolations).toBeNull();
    expect(report.trend).toEqual({ baselineSupplied: false, totals: null, rules: [] });
    expect(report.source).toEqual({ commit: null, branch: null });
    expect(evidenceReportMarkdown(report)).toContain('No baseline was supplied');
    expect(evidenceReportHtml(report)).toContain('No baseline was supplied');
  });

  it('keeps lost pages as unassessed rather than fixed', () => {
    const report = buildEvidenceReport(
      input([minimalResult({ url: 'https://demo.shop/other', violations: [] })], [minimalResult()], { synthetic: false }),
    );
    expect(report.summary).toMatchObject({ fixed: 0, unassessed: 1 });
    expect(report.coverage.status).toBe('incomplete');
    expect(report.rules[0]?.findings[0]?.assessmentReason).toMatch(/coverage/i);
  });

  it('is deterministic: only the timestamp changes between runs and input order does not matter', () => {
    const current = fixture('demo-shop-current.json');
    const baseline = fixture('demo-shop-baseline.json');
    const first = renderEvidenceReport(buildEvidenceReport(input(current, baseline)), 'html');
    const again = renderEvidenceReport(buildEvidenceReport(input(current, baseline)), 'html');
    expect(again).toBe(first);
    const reversed = renderEvidenceReport(
      buildEvidenceReport(input([...current].reverse(), [...baseline].reverse())),
      'html',
    );
    expect(reversed).toBe(first);
    const later = renderEvidenceReport(
      buildEvidenceReport(input(current, baseline, { generatedAt: '2027-01-01T00:00:00.000Z' })),
      'html',
    );
    expect(later.replaceAll('2027-01-01T00:00:00.000Z', GENERATED_AT)).toBe(first);
  });
});

describe('rendered reports', () => {
  it('HTML is one self-contained document with no external assets or scripts', () => {
    const html = evidenceReportHtml(buildEvidenceReport(demo()));
    expect(html.startsWith('<!doctype html>\n<html lang="en">')).toBe(true);
    expect(html).toContain(`content="default-src 'none'; style-src 'unsafe-inline'"`);
    expect(html).not.toMatch(/<script|<link|<img|<iframe|<[a-z][^>]*\ssrc=|url\(|@import/i);
    expect(html).toContain(REPORT_DISCLAIMER);
    expect(html).toContain('0123456789abcdef0123456789abcdef01234567');
    expect(html).toContain('feat/checkout');
  });

  it('escapes hostile scan content and drops non-http documentation links', () => {
    const hostile = minimalResult({
      violations: [
        {
          id: 'x"><script>alert(1)</script>',
          impact: 'critical',
          tags: ['wcag111'],
          help: 'Help | with `ticks` <b>bold</b>',
          helpUrl: 'javascript:alert(1)',
          nodes: [{ target: ['a[title="|"]'], html: '<img src=x onerror=alert(1)>' }],
        },
      ],
    });
    const report = buildEvidenceReport(input([hostile], null, { synthetic: false }));
    const html = evidenceReportHtml(report);
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    const markdown = evidenceReportMarkdown(report);
    expect(markdown).not.toContain('javascript:');
    expect(markdown).toContain('`a[title="\\|"]`');
    expect(markdown).toContain('Help \\| with');
  });

  it('JSON round-trips the report model', () => {
    const report = buildEvidenceReport(demo());
    expect(JSON.parse(evidenceReportJson(report))).toEqual(report);
    expect(evidenceReportJson(report).endsWith('}\n')).toBe(true);
  });

  it.each([
    ['html', 'demo-shop.html'],
    ['md', 'demo-shop.md'],
    ['json', 'demo-shop.json'],
  ] as const)('matches the %s snapshot for the demo fixtures', async (format, file) => {
    const rendered = renderEvidenceReport(buildEvidenceReport(demo()), format);
    await expect(rendered).toMatchFileSnapshot(`./__snapshots__/evidence-report/${file}`);
  });
});
