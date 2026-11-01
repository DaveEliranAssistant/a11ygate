import { describe, expect, it } from 'vitest';
import { CRITERIA, formatStandards, getCriterion, lookupStandards } from '@/lib/mapping';

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

  it('maps a WCAG 2.2 success criterion', () => {
    expect(getCriterion('wcag258')).toEqual({
      tag: 'wcag258',
      number: '2.5.8',
      name: 'Target Size (Minimum)',
      level: 'AA',
      en301549: '9.2.5.8',
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
      expect(criterion.en301549).toBe(`9.${criterion.number}`);
      expect(criterion.level === 'A' || criterion.level === 'AA').toBe(true);
    }
  });
});
