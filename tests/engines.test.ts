import { describe, expect, it } from 'vitest';
import { CRITERIA, lookupStandards } from '@/lib/mapping';
import { findingsFromResults } from '@/lib/parse';
import { createAxeEngine, toAxeResults, type AxeLike } from '@/lib/scan/engines/axe';
import { normalizeAxeResults, toLegacyFinding } from '@/lib/scan/engines/normalized';
import { runEngine, type Engine } from '@/lib/scan/engines/types';
import { WCAG_RULE_MAP } from '@/lib/scan/engines/wcag-map';
import { parseScanArgs } from '@/packages/cli/src/scan';

const native: AxeLike = {
  testEngine: { version: '4.11.1' }, timestamp: '2026-11-12T10:00:00.000Z',
  violations: [{ id: 'image-alt', impact: 'critical', tags: ['wcag2a', 'wcag111'],
    help: 'Images must have alternative text', helpUrl: 'https://dequeuniversity.com/rules/axe/4.11/image-alt',
    nodes: [{ target: [['iframe', 'img']], html: '<img src="fixture.png">' }] }],
};

describe('engine interface and normalized findings', () => {
  it('runs axe on the supplied session and preserves legacy finding bytes', async () => {
    const session = { page: 'local fixture' };
    const engine = createAxeEngine(async (context: typeof session) => {
      expect(context).toBe(session);
      return native;
    }, 'fixture-agent');
    expect(engine.id).toBe('axe');
    const result = await runEngine(engine, session, 'http://localhost/fixture');
    expect(result.status).toBe('complete');
    if (result.status !== 'complete') throw new Error(result.error);
    const legacy = findingsFromResults([toAxeResults('http://localhost/fixture', native, 'fixture-agent')]);
    expect(result.findings[0]).toMatchObject({ engine: 'axe', ruleId: 'image-alt', wcagSc: ['1.1.1'],
      url: 'http://localhost/fixture', selector: 'iframe img', snippet: '<img src="fixture.png">', impact: 'critical' });
    expect(JSON.stringify(result.findings.map(toLegacyFinding))).toBe(JSON.stringify(legacy));
    expect(normalizeAxeResults(result.native)).toEqual(result.findings);
  });

  it.each(['run', 'normalize'] as const)('isolates %s failures and allows the next engine to run', async (stage) => {
    const engine: Engine<null, number> = { id: 'test', displayName: 'Test engine',
      run: async () => { if (stage === 'run') throw new Error('fixture crash'); return 1; },
      normalize: () => { throw new Error('fixture crash'); },
    };
    expect(await runEngine(engine, null, 'http://localhost')).toEqual({ engine: 'test', status: 'errored', error: 'fixture crash' });
    expect(await runEngine(createAxeEngine(async () => native, 'fixture-agent'), null, 'http://localhost')).toMatchObject({ status: 'complete' });
  });

  it('isolates a hung engine and still runs axe', async () => {
    const hung: Engine<null, never> = { id: 'hung', displayName: 'Hung', run: () => new Promise(() => {}), normalize: () => [] };
    expect(await runEngine(hung, null, 'http://localhost', 10)).toMatchObject({ engine: 'hung', status: 'errored', error: expect.stringContaining('timed out') });
    expect(await runEngine(createAxeEngine(async () => native, 'fixture-agent'), null, 'http://localhost')).toMatchObject({ status: 'complete', findings: [expect.objectContaining({ ruleId: 'image-alt' })] });
  });

  it('has valid criterion IDs aligned with the existing standards map', () => {
    const known = new Set(CRITERIA.map((c) => c.number));
    expect(Object.keys(WCAG_RULE_MAP.axe!)).toContain('image-alt');
    for (const rules of Object.values(WCAG_RULE_MAP)) {
      for (const criteria of Object.values(rules)) {
        for (const sc of criteria) {
          expect(sc).toMatch(/^\d+\.\d+\.\d+[A-Z]?$/);
          expect(known.has(sc)).toBe(true);
        }
      }
    }
    expect(WCAG_RULE_MAP.axe?.['image-alt']).toEqual(lookupStandards(['wcag111']).flatMap((h) => h.kind === 'criterion' ? [h.number] : []));
  });

  it('defaults to axe only and accepts explicit opt-in selections', () => {
    for (const args of [[], ['--engines', 'axe'], ['--engines=axe']]) {
      expect(parseScanArgs(['http://localhost', ...args])).toMatchObject({ ok: true, options: { engines: ['axe'] } });
    }
    for (const selection of ['pa11y', 'axe,pa11y', 'AXE', 'axe,axe', 'axe,', ',htmlcs']) {
      expect(parseScanArgs(['http://localhost', '--engines', selection])).toMatchObject({ ok: false, error: expect.stringContaining('axe,htmlcs,ibm,lighthouse') });
    }
    expect(parseScanArgs(['http://localhost', '--engines', 'axe,htmlcs,ibm,lighthouse'])).toMatchObject({ ok: true, options: { engines: ['axe', 'htmlcs', 'ibm', 'lighthouse'] } });
    expect(parseScanArgs(['http://localhost', '--engines', 'lighthouse'])).toMatchObject({ ok: true, options: { engines: ['lighthouse'] } });
    expect(parseScanArgs(['http://localhost', '--engines'])).toMatchObject({ ok: false, error: '--engines needs a value.' });
    expect(parseScanArgs(['http://localhost', '--engines='])).toMatchObject({ ok: false });
  });
});
