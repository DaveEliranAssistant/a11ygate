import { describe, expect, it } from 'vitest';
import { findingsFromResults, parseAxeDocuments, parseAxeJson } from '@/lib/parse';
import { minimalResult } from './helpers';

describe('parser validation', () => {
  it('accepts a single axe result object', () => {
    const parsed = parseAxeJson(JSON.stringify(minimalResult()));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.results).toHaveLength(1);
    expect(parsed.synthetic).toBe(false);
    expect(parsed.results[0]?.testEngine.version).toBe('4.10.2');
  });

  it('accepts an array of results and ignores unknown fields', () => {
    const parsed = parseAxeJson(
      JSON.stringify([
        minimalResult({ _fixture: 'SYNTHETIC demo', passes: [], incomplete: [] }),
        minimalResult({ url: 'https://demo.shop/cart', violations: [] }),
      ]),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.results).toHaveLength(2);
    expect(parsed.synthetic).toBe(true);
    expect(parsed.results[1]?.violations).toEqual([]);
  });

  it('rejects invalid JSON', () => {
    const parsed = parseAxeJson('{');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.startsWith('Not valid JSON:')).toBe(true);
  });

  it('rejects the wrong top-level shape', () => {
    expect(parseAxeJson('42')).toEqual({
      ok: false,
      error: 'Expected an axe result object or an array of axe results.',
    });
    expect(parseAxeJson('[]')).toEqual({
      ok: false,
      error: 'The array does not contain any axe results.',
    });
    expect(parseAxeJson('   ')).toEqual({ ok: false, error: 'The file is empty.' });
  });

  it('rejects a missing engine version', () => {
    const parsed = parseAxeJson(JSON.stringify(minimalResult({ testEngine: {} })));
    expect(parsed).toEqual({
      ok: false,
      error: 'result.testEngine.version must be a non-empty string',
    });
  });

  it('rejects a bad impact', () => {
    const result = minimalResult();
    result.violations[0]!.impact = 'high' as 'serious';
    const parsed = parseAxeJson(JSON.stringify(result));
    expect(parsed).toEqual({
      ok: false,
      error: 'result.violations[0].impact must be minor, moderate, serious, critical, or null',
    });
  });

  it('rejects a node without a string target array', () => {
    const result = minimalResult();
    result.violations[0]!.nodes = [{ target: 'img' as unknown as string[], html: '<img>' }];
    const parsed = parseAxeJson(JSON.stringify(result));
    expect(parsed).toEqual({
      ok: false,
      error: 'result.violations[0].nodes[0].target must be an array of strings',
    });
  });

  it('rejects a timestamp that is not ISO-8601', () => {
    const parsed = parseAxeJson(JSON.stringify(minimalResult({ timestamp: 'yesterday' })));
    expect(parsed).toEqual({
      ok: false,
      error: 'result.timestamp must be an ISO date string',
    });
  });

  it('prefixes document names when several files are parsed', () => {
    const parsed = parseAxeDocuments([
      { name: 'home.json', text: JSON.stringify(minimalResult()) },
      { name: 'bad.json', text: '{"url":"https://demo.shop/"}' },
    ]);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.startsWith('bad.json:')).toBe(true);
  });

  it('turns each node into a finding and keeps the higher impact on a duplicate fingerprint', () => {
    const parsed = parseAxeJson(
      JSON.stringify(
        minimalResult({
          violations: [
            {
              id: 'color-contrast',
              impact: 'moderate',
              tags: ['wcag143'],
              help: 'Elements must have sufficient color contrast',
              helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast',
              nodes: [
                { target: ['.price-tag'], html: '<span class="price-tag">low</span>', impact: 'moderate' },
                { target: ['.title'], html: '<h1 class="title">Hi</h1>' },
              ],
            },
            {
              id: 'color-contrast',
              impact: 'serious',
              tags: ['wcag143'],
              help: 'Elements must have sufficient color contrast',
              helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast',
              nodes: [{ target: ['.price-tag'], html: '<span class="price-tag">high</span>' }],
            },
          ],
        }),
      ),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const findings = findingsFromResults(parsed.results);
    expect(findings).toHaveLength(2);
    expect(findings.find((finding) => finding.selector === '.price-tag')?.impact).toBe('serious');
    expect(findings.find((finding) => finding.selector === '.price-tag')?.html).toBe(
      '<span class="price-tag">high</span>',
    );
  });
});
