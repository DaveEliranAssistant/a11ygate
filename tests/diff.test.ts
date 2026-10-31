import { describe, expect, it } from 'vitest';
import { diffScans } from '@/lib/diff';
import { makeFinding } from './helpers';

describe('diff', () => {
  const shared = makeFinding({
    fingerprint: 'label|input.quantity|/cart',
    ruleId: 'label',
    path: '/cart',
    selector: 'input.quantity',
    url: 'https://demo.shop/cart',
  });
  const onlyBaseline = makeFinding({
    fingerprint: 'document-title|html|/cart',
    ruleId: 'document-title',
    path: '/cart',
    selector: 'html',
  });
  const onlyCurrent = makeFinding({
    fingerprint: 'region|body|/cart',
    ruleId: 'region',
    impact: 'moderate',
    path: '/cart',
    selector: 'body',
  });

  it('classifies new, fixed, and still open findings', () => {
    const diff = diffScans([shared, onlyCurrent], [shared, onlyBaseline]);
    expect(diff.newFindings.map((finding) => finding.ruleId)).toEqual(['region']);
    expect(diff.fixedFindings.map((finding) => finding.ruleId)).toEqual(['document-title']);
    expect(diff.stillOpen.map((finding) => finding.ruleId)).toEqual(['label']);
    expect(diff.all.map((finding) => finding.status)).toEqual(['new', 'fixed', 'still-open']);
  });

  it('treats a missing baseline as all new', () => {
    const diff = diffScans([shared, onlyCurrent], null);
    expect(diff.newFindings).toHaveLength(2);
    expect(diff.fixedFindings).toHaveLength(0);
    expect(diff.stillOpen).toHaveLength(0);
  });

  it('keeps one copy when a scan repeats a fingerprint', () => {
    const diff = diffScans([shared, { ...shared, html: '<input class="quantity">' }], []);
    expect(diff.newFindings).toHaveLength(1);
    expect(diff.newFindings[0]?.html).toBe(shared.html);
  });
});
