import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CRITERIA,
  EN301549_COLUMN,
  EN301549_LABEL,
  EN301549_NOT_IN_EDITION,
  EN301549_SOURCE,
  en301549Inline,
  en301549Ref,
  formatStandards,
  getCriterion,
  lookupStandards,
} from '@/lib/mapping';

describe('standards mapping', () => {
  it('maps wcag143 to WCAG 1.4.3 and EN 301 549 9.1.4.3', () => {
    expect(getCriterion('wcag143')).toEqual({
      tag: 'wcag143',
      number: '1.4.3',
      name: 'Contrast (Minimum)',
      level: 'AA',
      en301549: '9.1.4.3',
      wcag: '2.1',
    });
    expect(getCriterion('WCAG143')?.number).toBe('1.4.3');
  });

  it('does not confuse 1.4.10 with 1.4.1', () => {
    expect(getCriterion('wcag1410')).toMatchObject({ number: '1.4.10', name: 'Reflow' });
    expect(getCriterion('wcag141')).toMatchObject({ number: '1.4.1', name: 'Use of Color' });
  });

  it('maps a WCAG 2.2 success criterion without guessing an EN 301 549 clause', () => {
    // EN 301 549 V3.2.1 clause 9 mirrors WCAG 2.1; 2.5.8 is not in that edition.
    expect(getCriterion('wcag258')).toEqual({
      tag: 'wcag258',
      number: '2.5.8',
      name: 'Target Size (Minimum)',
      level: 'AA',
      en301549: null,
      wcag: '2.2',
    });
  });

  it('returns best practice for unmapped tags', () => {
    expect(lookupStandards(['best-practice', 'cat.keyboard'])).toEqual([{ kind: 'best-practice' }]);
    expect(formatStandards(['wcag999'])).toBe('best practice');
  });

  it('returns best practice for level-only tags', () => {
    expect(getCriterion('wcag2aa')).toBeNull();
    expect(getCriterion('wcag21aa')).toBeNull();
    expect(formatStandards(['wcag2a', 'wcag21aa', 'cat.color'])).toBe('best practice');
  });

  it('returns every distinct criterion when several tags match', () => {
    const hits = lookupStandards(['wcag332', 'wcag131', 'wcag332', 'wcag2a']);
    expect(hits.map((hit) => (hit.kind === 'criterion' ? hit.number : hit.kind))).toEqual([
      '3.3.2',
      '1.3.1',
    ]);
    expect(formatStandards(['wcag332', 'wcag131'])).toBe(
      'WCAG 2.1 3.3.2 Labels or Instructions (A); EN 301 549 9.3.3.2 | WCAG 2.1 1.3.1 Info and Relationships (A); EN 301 549 9.1.3.1',
    );
  });

  it('keeps a unique tag and an EN clause for every A/AA criterion in the table', () => {
    expect(new Set(CRITERIA.map((criterion) => criterion.tag)).size).toBe(CRITERIA.length);
    for (const criterion of CRITERIA) {
      expect(criterion.tag).toBe(`wcag${criterion.number.split('.').join('')}`);
      expect(criterion.en301549).toBe(criterion.wcag === '2.1' ? `9.${criterion.number}` : null);
      expect(criterion.level === 'A' || criterion.level === 'AA').toBe(true);
    }
  });
});

describe('EN 301 549 reference column (A11Y-R59)', () => {
  it('cites the ETSI EN 301 549 V3.2.1 document and carries the reference-only label', () => {
    expect(EN301549_SOURCE.url).toBe('https://www.etsi.org/deliver/etsi_en/301500_301599/301549/03.02.01_60/en_301549v030201p.pdf');
    expect(EN301549_SOURCE.title).toContain('V3.2.1');
    expect(EN301549_COLUMN).toBe('EN 301 549 ref.');
    expect(EN301549_LABEL).toBe('Reference mapping only; does not indicate conformance.');
    const source = readFileSync(path.join(__dirname, '../lib/mapping.ts'), 'utf8');
    expect(source).toContain(EN301549_SOURCE.url);
  });

  it('gives every mapped WCAG 2.1 A/AA criterion exactly one 9.x clause in the expected format', () => {
    const wcag21 = CRITERIA.filter((c) => c.wcag === '2.1');
    expect(wcag21.length).toBeGreaterThan(40);
    const clauses = new Set<string>();
    for (const c of wcag21) {
      expect(c.level === 'A' || c.level === 'AA').toBe(true);
      expect(typeof c.en301549).toBe('string');
      expect(c.en301549).toMatch(/^9\.[1-4]\.\d+\.\d+$/);
      expect(c.en301549).toBe(`9.${c.number}`);
      expect(en301549Ref(c.number)).toBe(c.en301549);
      clauses.add(c.en301549!);
    }
    // One clause per criterion; no two criteria share a clause.
    expect(clauses.size).toBe(wcag21.length);
    expect(new Set(wcag21.map((c) => c.number)).size).toBe(wcag21.length);
  });

  it('shows "not in EN 301 549 V3.2.1" for WCAG 2.2-only criteria instead of a guessed clause', () => {
    const wcag22 = CRITERIA.filter((c) => c.wcag === '2.2');
    expect(wcag22.map((c) => c.number)).toEqual(expect.arrayContaining(['2.4.11', '2.5.7', '2.5.8', '3.2.6', '3.3.7', '3.3.8']));
    for (const c of wcag22) {
      expect(c.en301549).toBeNull();
      expect(en301549Ref(c.number)).toBe('not in EN 301 549 V3.2.1');
      expect(en301549Inline(c.number)).toBe(EN301549_NOT_IN_EDITION);
    }
    expect(en301549Ref('2.5.8')).not.toMatch(/^9\./);
    expect(formatStandards(['wcag258'])).toBe('WCAG 2.2 2.5.8 Target Size (Minimum) (AA); not in EN 301 549 V3.2.1');
    expect(en301549Ref('9.9.9')).toBe(EN301549_NOT_IN_EDITION);
  });
});
