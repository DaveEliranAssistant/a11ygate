import { describe, expect, it } from 'vitest';
import { diffScans } from '@/lib/diff';
import { baselineDocument } from '@/lib/export-baseline';
import { findingsToCsv } from '@/lib/export-csv';
import { prSummaryMarkdown } from '@/lib/export-markdown';
import { findingsFromResults, parseAxeJson } from '@/lib/parse';
import { statementMarkdown } from '@/lib/statement';
import { DISCLAIMER } from '@/lib/copy';
import { makeFinding, minimalResult } from './helpers';

describe('markdown and CSV export', () => {
  const diff = diffScans(
    [
      makeFinding({
        fingerprint: 'color-contrast|.price-tag|/products',
        ruleId: 'color-contrast',
        impact: 'serious',
        help: 'Contrast | minimum',
        html: '<span class="price-tag">€12</span>',
      }),
    ],
    [],
  );

  it('includes the verdict, counts, escaped pipes, and the disclaimer', () => {
    const markdown = prSummaryMarkdown({
      projectName: 'Demo Shop',
      verdict: 'FAIL',
      threshold: 'serious',
      diff,
      generatedAt: '2026-10-31T12:00:00.000Z',
      reason: '1 new finding at or above serious: color-contrast.',
    });
    expect(markdown).toContain('**Verdict: FAIL** (impact threshold: serious)');
    expect(markdown).toContain('| New | 1 |');
    expect(markdown).toContain('| Fixed | 0 |');
    expect(markdown).toContain('| Still open | 0 |');
    expect(markdown).toContain('Contrast \\| minimum');
    expect(markdown).toContain(DISCLAIMER);
    expect(markdown).toContain(
      'Automated checks cover only part of WCAG; this is evidence, not certification.',
    );
  });

  it('quotes CSV fields, escapes quotes, and neutralises formula text', () => {
    const formula = makeFinding({
      fingerprint: 'custom|=cmd|/',
      ruleId: 'custom',
      impact: null,
      selector: '=cmd',
      html: '<img alt="x">',
      path: '/',
      tags: ['best-practice'],
    });
    const csv = findingsToCsv([
      { ...diff.newFindings[0]!, status: 'new' },
      { ...formula, status: 'new' },
    ]);
    expect(
      csv.startsWith(
        '\uFEFF"status","rule","impact","page","selector","html","help","helpUrl","standards","fingerprint"\n',
      ),
    ).toBe(true);
    expect(csv).toContain(
      '"new","color-contrast","serious","/products",".price-tag","<span class=""price-tag"">€12</span>"',
    );
    expect(csv).toContain('"\'=cmd"');
    expect(csv).toContain('"best practice"');
  });

  it('writes a statement with the organisation, email, date, and disclaimer', () => {
    const markdown = statementMarkdown({
      organisation: ' Demo Shop ',
      email: 'access@demo.shop',
      date: '2026-10-31',
      projectName: 'Demo Shop',
      verdict: 'FAIL',
      threshold: 'serious',
      counts: { newCount: 2, fixedCount: 3, stillOpen: 5 },
    });
    expect(markdown).toContain('**Organisation:** Demo Shop');
    expect(markdown).toContain('**Contact:** access@demo.shop');
    expect(markdown).toContain('**Date:** 2026-10-31');
    expect(markdown).toContain('- New: 2');
    expect(markdown).toContain('- Fixed: 3');
    expect(markdown).toContain('- Still open: 5');
    expect(markdown).toContain(DISCLAIMER);
    expect(markdown).toContain('not a certification');
  });

  it('round-trips a downloaded baseline through the parser', () => {
    const original = parseAxeJson(JSON.stringify(minimalResult()));
    expect(original.ok).toBe(true);
    if (!original.ok) return;
    const document = baselineDocument(original.results);
    const again = parseAxeJson(document);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(findingsFromResults(again.results).map((finding) => finding.fingerprint)).toEqual(
      findingsFromResults(original.results).map((finding) => finding.fingerprint),
    );
  });
});
