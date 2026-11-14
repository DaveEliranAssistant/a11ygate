import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import sarifSchema from './schemas/sarif-schema-2.1.0.json';
import { applyFingerprintBaseline, baselineFingerprint, createFingerprintBaseline, parseFingerprintBaseline } from '@/lib/scan/baseline';
import { buildScanReport, scanMarkdown, scanHtml } from '@/lib/scan/report';
import { formatReportFromScan } from '@/lib/report-formats';
import { parseJenkinsJunit, toJunit } from '@/lib/export-junit';
import { toSarif } from '@/lib/export-sarif';
import { run } from '@/packages/cli/src/run';
import { runScan, type ScanEngineFactory } from '@/packages/cli/src/scan';
import type { AxeResults } from '@/lib/types';
import type { EnginePageResult } from '@/lib/scan/engines/types';

const url = 'http://localhost/fixture';
function axe(selectors = ['img'], html = '<img id="logo" src="logo.png">'): AxeResults {
  return { url, timestamp: '2026-11-14T00:00:00Z', testEngine: { version: '4.11.1' },
    violations: selectors.length ? [{ id: 'image-alt', impact: 'critical', tags: ['wcag111'], help: 'Image alt', helpUrl: 'https://example.test/rule', nodes: selectors.map((selector) => ({ target: [selector], html })) }] : [] };
}
function report(selectors = ['img'], html?: string, engineResults?: EnginePageResult[]) {
  return buildScanReport({ crawl: { pages: [{ url, finalUrl: url, status: 200, scanStatus: 'complete', result: axe(selectors, html) }], skipped: [] },
    version: '0.1.0', scannedAt: '2026-11-14T00:00:00Z', startUrl: url, failOn: 'serious', maxPages: 1, delayMs: 0, userAgent: 'fixture', robotsNote: 'fixture', engineResults });
}
const engine: ScanEngineFactory = async () => ({ visit: async () => ({ status: 200, finalUrl: url, links: [], result: axe() }), close: async () => {} });
const fetch = async () => ({ ok: true, status: 200, text: async () => '' });

async function temporary(work: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'fingerprint-baseline-'));
  try { await work(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

describe('fingerprint baselines', () => {
  it('is deterministic across runs, timestamps, HTML attribute order and locator spacing', () => {
    const first = report(['main > img']);
    const next = report(['main>img'], '<img src="logo.png" id="logo">');
    next.scannedAt = '2027-01-01T00:00:00Z';
    expect(baselineFingerprint(first.findings[0]!)).toBe(baselineFingerprint(next.findings[0]!));
    expect(createFingerprintBaseline(first).findings.map((f) => f.fingerprint)).toEqual(createFingerprintBaseline(next).findings.map((f) => f.fingerprint));
    expect(createFingerprintBaseline(report())).toEqual(createFingerprintBaseline(report(['img'], '<img src="logo.png" id="logo">')));
    expect(createFingerprintBaseline(first)).toEqual(createFingerprintBaseline(first));
    expect(baselineFingerprint(report(['img.other']).findings[0]!)).not.toBe(baselineFingerprint(first.findings[0]!));
  });

  it('passes existing debt, fails a new finding on the same rule/page, and reports fixes', () => {
    const baseline = createFingerprintBaseline(report());
    const existing = applyFingerprintBaseline(report(), baseline);
    expect(existing).toMatchObject({ verdict: 'PASS', baseline: { new: 0, existing: 1, fixed: 0, unassessed: 0 } });
    const added = applyFingerprintBaseline(report(['img', 'img.new']), baseline);
    expect(added).toMatchObject({ verdict: 'FAIL', baseline: { new: 1, existing: 1, fixed: 0 } });
    const fixed = applyFingerprintBaseline(report([]), baseline);
    expect(fixed).toMatchObject({ verdict: 'PASS', baseline: { new: 0, existing: 0, fixed: 1 } });
    expect(scanMarkdown(added)).toContain('1 new; 1 existing; 0 fixed');
    expect(scanHtml(fixed)).toContain('0 new; 0 existing; 1 fixed');
  });

  it('does not call absent findings fixed on failed or unvisited pages', () => {
    const current = report([]);
    current.pages[0]!.scanStatus = 'failed';
    const diff = applyFingerprintBaseline(current, createFingerprintBaseline(report()));
    expect(diff.baseline).toMatchObject({ fixed: 0, unassessed: 1 });
  });

  it('makes existing-only JUnit cases pass and keeps new instances failing in mixed groups', () => {
    const baseline = createFingerprintBaseline(report());
    const existing = formatReportFromScan(applyFingerprintBaseline(report(), baseline));
    expect(parseJenkinsJunit(toJunit(existing))[0]).toMatchObject({ tests: 1, failures: 0, cases: [{ status: 'passed' }] });
    const mixed = formatReportFromScan(applyFingerprintBaseline(report(['img', 'img.new']), baseline));
    const suite = parseJenkinsJunit(toJunit(mixed))[0]!;
    expect(suite.failures).toBe(1);
    expect(suite.cases[0]!.body).toContain('img.new');
    expect(suite.cases[0]!.body).not.toContain('— img —');
  });

  it('exports schema-valid SARIF states and suppresses only existing findings', () => {
    const baseline = createFingerprintBaseline(report());
    const output = JSON.parse(toSarif(formatReportFromScan(applyFingerprintBaseline(report(['img', 'img.new']), baseline))));
    const ajv = new Ajv({ strict: false, unicodeRegExp: false });
    addFormats(ajv);
    const validate = ajv.compile(sarifSchema);
    expect(validate(output), JSON.stringify(validate.errors)).toBe(true);
    const results = output.runs.flatMap((r: { results: unknown[] }) => r.results);
    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({ baselineState: 'unchanged', suppressions: [expect.objectContaining({ kind: 'external', status: 'accepted' })] }),
      expect.objectContaining({ baselineState: 'new', suppressions: [] }),
    ]));
  });

  it('uses one R12 identity per merged finding and survives representative engine changes', () => {
    const finding = { ruleId: 'image-alt', engine: 'axe', wcagSc: ['1.1.1'], impact: 'critical' as const, url, selector: 'img', elementKey: 'html:nth-of-type(1)>body:nth-of-type(1)>img:nth-of-type(1)', snippet: '<img>', helpUrl: '' };
    const both: EnginePageResult[] = [{ engine: 'axe', url, status: 'complete', findings: [finding] },
      { engine: 'htmlcs', url, status: 'complete', findings: [{ ...finding, engine: 'htmlcs', ruleId: 'H37' }] }];
    const initial = report([], undefined, both);
    expect(initial.findings).toHaveLength(1);
    const baseline = createFingerprintBaseline(initial);
    expect(baseline.findings).toHaveLength(1);
    const next = report([], undefined, [both[1]!]);
    expect(applyFingerprintBaseline(next, baseline)).toMatchObject({ verdict: 'PASS', baseline: { existing: 1, new: 0 } });
  });

  it('rejects axe JSON, unknown versions and duplicate fingerprints', () => {
    expect(() => parseFingerprintBaseline(axe())).toThrow('Axe JSON baselines belong');
    const baseline = createFingerprintBaseline(report());
    expect(() => parseFingerprintBaseline({ ...baseline, schemaVersion: 2 })).toThrow();
    expect(() => parseFingerprintBaseline({ ...baseline, findings: [...baseline.findings, ...baseline.findings] })).toThrow('Duplicate');
  });

  it('creates from an out-dir, scans with it and re-exports reports without a browser', async () => temporary(async (cwd) => {
    const io = { cwd, stdout: () => {}, stderr: () => {} };
    expect(await runScan([url, '--out-dir', 'initial'], { ...io, engine, fetch })).toBe(1);
    expect(await run(['baseline', 'create', '--out-dir', 'initial'], io)).toBe(0);
    const baseline = JSON.parse(await readFile(path.join(cwd, '.a11ygate-baseline.json'), 'utf8'));
    expect(baseline.kind).toBe('a11ygate-fingerprint-baseline');
    expect(await runScan([url, '--baseline', '.a11ygate-baseline.json', '--out-dir', 'next', '--format', 'junit,sarif'], { ...io, engine, fetch })).toBe(0);
    expect(await run(['report', 'initial', '--baseline', '.a11ygate-baseline.json', '--out-dir', 'export', '--format', 'junit,sarif'], io)).toBe(0);
    expect(parseJenkinsJunit(await readFile(path.join(cwd, 'export/a11ygate-scan.junit.xml'), 'utf8'))[0]!.failures).toBe(0);
    // Creation refuses to overwrite accepted debt silently.
    expect(await run(['baseline', 'create', 'initial'], io)).toBe(2);
  }));

  it('rejects an axe baseline before scan setup and keeps the axe-JSON gate working', async () => temporary(async (cwd) => {
    const io = { cwd, stdout: () => {}, stderr: () => {} };
    await writeFile(path.join(cwd, 'axe.json'), JSON.stringify(axe()));
    const neverEngine: ScanEngineFactory = async () => { throw new Error('Must not launch'); };
    expect(await runScan([url, '--baseline', 'axe.json'], { ...io, engine: neverEngine, fetch })).toBe(2);
    expect(await run(['ci', '--current', 'axe.json', '--baseline', 'axe.json'], io)).toBe(0);
    await writeFile(path.join(cwd, 'baseline.json'), JSON.stringify(createFingerprintBaseline(report())));
    expect(await run(['ci', '--current', 'axe.json', '--baseline', 'baseline.json'], io)).toBe(2);
  }));
});

describe('baseline coverage and evidence preservation', () => {
  it('leaves missing findings unassessed when a baseline engine is no longer selected', () => {
    const baseline = { ...createFingerprintBaseline(report()), engines: ['axe', 'htmlcs'] };
    expect(applyFingerprintBaseline(report([]), baseline).baseline).toMatchObject({ fixed: 0, unassessed: 1 });
  });

  it('keeps engine errors as errors, without reporting missing findings as fixed', () => {
    const current = report([], undefined, [{ url, engine: 'htmlcs', status: 'errored', error: 'fixture error' }]);
    expect(applyFingerprintBaseline(current, createFingerprintBaseline(report()))).toMatchObject({ verdict: 'ERROR', baseline: { fixed: 0, unassessed: 1 } });
  });

  it('keeps distinct R12 findings without locators distinct in the baseline', () => {
    const finding = { engine: 'htmlcs', ruleId: 'H37', wcagSc: ['1.1.1'], impact: 'critical' as const, url, selector: '', snippet: '', helpUrl: '' };
    const current = report([], undefined, [{ engine: 'htmlcs', url, status: 'complete', findings: [finding, finding] }]);
    expect(current.findings).toHaveLength(2);
    const baseline = createFingerprintBaseline(current);
    expect(baseline.findings).toHaveLength(2);
    expect(applyFingerprintBaseline(current, baseline).baseline).toMatchObject({ existing: 2, new: 0 });
  });

  it('protects the baseline and saved scan from output aliases', async () => temporary(async (cwd) => {
    const io = { cwd, stdout: () => {}, stderr: () => {} };
    const baseline = JSON.stringify(createFingerprintBaseline(report()));
    await writeFile(path.join(cwd, 'baseline.json'), baseline);
    expect(await runScan([url, '--baseline', 'baseline.json', '--json', 'baseline.json'], { ...io, engine, fetch })).toBe(2);
    expect(await readFile(path.join(cwd, 'baseline.json'), 'utf8')).toBe(baseline);
    const original = JSON.stringify(report());
    await writeFile(path.join(cwd, 'scan.json'), original);
    expect(await run(['report', 'scan.json', '--json', 'scan.json'], io)).toBe(2);
    expect(await readFile(path.join(cwd, 'scan.json'), 'utf8')).toBe(original);
  }));

  it('preserves the saved threshold and accepts --fail-on overrides', async () => temporary(async (cwd) => {
    const io = { cwd, stdout: () => {}, stderr: () => {} };
    const original = report();
    await writeFile(path.join(cwd, 'scan.json'), JSON.stringify(original));
    expect(await run(['report', 'scan.json'], io)).toBe(1);
    expect(await run(['report', 'scan.json', '--fail-on', 'none'], io)).toBe(0);
  }));

  it('creates a baseline from the default post-scan JSON and rejects malformed/incomplete inputs', async () => temporary(async (cwd) => {
    const io = { cwd, stdout: () => {}, stderr: () => {} };
    await writeFile(path.join(cwd, 'a11ygate-scan.json'), JSON.stringify(report()));
    expect(await run(['baseline', 'create'], io)).toBe(0);
    expect(await run(['baseline', 'create', '--output'], io)).toBe(2);
    const incomplete = report();
    incomplete.counts.pagesFailed = 1;
    await writeFile(path.join(cwd, 'failed.json'), JSON.stringify(incomplete));
    expect(await run(['baseline', 'create', 'failed.json', '--output', 'bad.json'], io)).toBe(2);
    await writeFile(path.join(cwd, 'malformed.json'), '{');
    expect(await run(['baseline', 'create', 'malformed.json'], io)).toBe(2);
    expect(await run(['report', 'malformed.json'], io)).toBe(2);
  }));
});
