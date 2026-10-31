import { describe, expect, it } from 'vitest';
import { loadDemo } from '@/lib/demo';
import { diffScans } from '@/lib/diff';
import { gatingFindings, gateVerdict, verdictReason } from '@/lib/gate';
import { groupFindings } from '@/lib/group';
import { formatStandards } from '@/lib/mapping';
import { findingsFromResults, parseAxeJson } from '@/lib/parse';
import baselineFixture from '@/fixtures/demo-shop-baseline.json';
import currentFixture from '@/fixtures/demo-shop-current.json';

describe('Demo Shop fixtures', () => {
  const demo = loadDemo();
  const diff = diffScans(findingsFromResults(demo.current), findingsFromResults(demo.baseline));

  it('marks both fixture files as synthetic axe results for three pages', () => {
    const baseline = parseAxeJson(JSON.stringify(baselineFixture));
    const current = parseAxeJson(JSON.stringify(currentFixture));
    expect(baseline.ok && current.ok).toBe(true);
    if (!baseline.ok || !current.ok) return;
    expect(baseline.synthetic).toBe(true);
    expect(current.synthetic).toBe(true);
    expect(baseline.results).toHaveLength(3);
    expect(current.results).toHaveLength(3);
    expect(demo.projectName).toBe('Demo Shop');
  });

  it('diffs to 2 new, 3 fixed, and 5 still open', () => {
    expect(diff.newFindings).toHaveLength(2);
    expect(diff.fixedFindings).toHaveLength(3);
    expect(diff.stillOpen).toHaveLength(5);
    expect(diff.newFindings.map((finding) => finding.ruleId).sort()).toEqual([
      'color-contrast',
      'region',
    ]);
    expect(diff.fixedFindings.map((finding) => finding.ruleId).sort()).toEqual([
      'aria-required-attr',
      'color-contrast',
      'document-title',
    ]);
  });

  it('fails the default serious gate because of one new color-contrast finding', () => {
    expect(gateVerdict(diff.newFindings, 'serious')).toBe('FAIL');
    const gating = gatingFindings(diff.newFindings, 'serious');
    expect(gating).toHaveLength(1);
    expect(gating[0]).toMatchObject({
      ruleId: 'color-contrast',
      impact: 'serious',
      path: '/products',
      selector: '.product-card .price-tag',
    });
    expect(verdictReason(diff.newFindings, 'serious')).toBe(
      '1 new finding at or above serious: color-contrast.',
    );
    expect(gateVerdict(diff.newFindings, 'critical')).toBe('PASS');
  });

  it('matches stable fingerprints across nth-child and generated ids', () => {
    expect(diff.stillOpen.find((finding) => finding.ruleId === 'image-alt')?.fingerprint).toBe(
      'image-alt|#main > img.hero-photo|/',
    );
    expect(diff.stillOpen.find((finding) => finding.ruleId === 'button-name')?.fingerprint).toBe(
      'button-name|button.add-to-cart|/products',
    );
  });

  it('maps the gating finding and leaves the unmapped region as best practice', () => {
    const contrast = diff.newFindings.find((finding) => finding.ruleId === 'color-contrast');
    const region = diff.newFindings.find((finding) => finding.ruleId === 'region');
    expect(formatStandards(contrast?.tags ?? [])).toContain('1.4.3 Contrast (Minimum)');
    expect(formatStandards(contrast?.tags ?? [])).toContain('EN 301 549 9.1.4.3');
    expect(formatStandards(region?.tags ?? [])).toBe('best practice');
  });

  it('groups the same findings by rule, page, and impact', () => {
    expect(groupFindings(diff.all, 'rule').find((group) => group.key === 'color-contrast')?.findings).toHaveLength(
      2,
    );
    expect(groupFindings(diff.all, 'page').map((group) => group.key)).toEqual(['/', '/cart', '/products']);
    expect(groupFindings(diff.all, 'impact').map((group) => group.key)).toEqual([
      'critical',
      'serious',
      'moderate',
    ]);
  });
});
