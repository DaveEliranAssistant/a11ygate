import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Ajv from 'ajv';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { toGitlabCodeQuality, type GitlabCodeQualityIssue } from '@/lib/export-gitlab-codequality';
import { formatReportFromGate, formatReportFromScan, parseFormatList } from '@/lib/report-formats';
import { applyFingerprintBaseline, baselineFingerprint, createFingerprintBaseline } from '@/lib/scan/baseline';
import { buildScanReport } from '@/lib/scan/report';
import type { EnginePageResult } from '@/lib/scan/engines/types';
import { run } from '@/packages/cli/src/run';
import { parseScanArgs, runScan } from '@/packages/cli/src/scan';
import { minimalResult } from './helpers';
import { blockNetwork } from './network-guard';
import schema from './schemas/gitlab-codequality.schema.json';

// Authored from https://docs.gitlab.com/ci/testing/code_quality/#code-quality-report-format
// and https://docs.gitlab.com/ci/yaml/ (rules, image, script, artifacts:reports).
// This checks the documented subset; it does not claim to replace GitLab CI Lint.
const yaml = createRequire(import.meta.url)('js-yaml') as { load: (text: string) => unknown };
const validate = new Ajv({ allErrors: true }).compile(schema);
const url = 'http://127.0.0.1:3000/';
function result() {
  return minimalResult({ url, violations: [{ id: 'image-alt', impact: 'critical', tags: ['wcag111'], help: 'Images must have alternate text', helpUrl: 'https://dequeuniversity.com/rules/axe/4.11/image-alt', nodes: [
    { target: ['iframe', 'main > img'], html: '<img src="/pixel.png">' },
    { target: ['img.footer'], html: '<img>' },
  ] }] });
}
function report(engineResults?: EnginePageResult[]) {
  const axe = result();
  return buildScanReport({ crawl: { pages: [{ url, finalUrl: url, status: 200, scanStatus: 'complete', result: axe }], skipped: [] },
    version: '0.2.0', scannedAt: '2026-11-14T00:00:00.000Z', startUrl: url, failOn: 'serious', maxPages: 1, delayMs: 0, userAgent: 'fixture', robotsNote: 'fixture', engineResults });
}
function issues(text: string): GitlabCodeQualityIssue[] {
  const parsed = JSON.parse(text);
  expect(validate(parsed), JSON.stringify(validate.errors)).toBe(true);
  expect(text.charCodeAt(0)).not.toBe(0xfeff);
  return parsed;
}
let guard: ReturnType<typeof blockNetwork>;
beforeEach(() => { guard = blockNetwork(); });
afterEach(() => { guard.restore(); expect(guard.attempts).toEqual([]); });

describe('GitLab Code Quality', () => {
  it('validates against the documented subset and snapshots actionable issues', () => {
    const text = toGitlabCodeQuality(formatReportFromScan(report()));
    expect(issues(text)).toHaveLength(2);
    for (const issue of issues(text)) {
      expect(issue.description).toContain(url);
      expect(issue.description).toContain('selector:');
      expect(issue.description).toContain(AUTOMATED_TESTING_DISCLAIMER);
      expect(issue.location).toEqual({ path: 'a11ygate-pages/127.0.0.1-3000/index.html', lines: { begin: 1 } });
    }
    expect(text).toMatchSnapshot();
  });

  it('reuses exact R18 identities with and without a baseline, including frame selector components', () => {
    const scan = report();
    const expected = createFingerprintBaseline(scan).findings.map((f) => f.fingerprint).sort();
    const fingerprints = (text: string) => issues(text).map((i) => i.fingerprint).sort();
    expect(fingerprints(toGitlabCodeQuality(formatReportFromScan(scan)))).toEqual(expected);
    expect(fingerprints(toGitlabCodeQuality(formatReportFromScan(applyFingerprintBaseline(scan, createFingerprintBaseline(scan)))))).toEqual(expected);
    const next = report();
    next.scannedAt = '2027-01-01T00:00:00Z';
    next.findings[0]!.html = '<img changed>'; next.findings[0]!.impact = 'minor';
    next.findings[0]!.selectors = ['iframe', 'main>img'];
    expect(fingerprints(toGitlabCodeQuality(formatReportFromScan(next)))).toEqual(expected);
    next.findings[0]!.selectors = ['iframe', 'img.other'];
    expect(fingerprints(toGitlabCodeQuality(formatReportFromScan(next)))).not.toEqual(expected);
    const gate = formatReportFromGate({ version: '0.2.0', generatedAt: scan.scannedAt, projectName: 'fixture', verdict: 'FAIL', reason: 'fixture', currentResults: [result()], findings: [] });
    expect(fingerprints(toGitlabCodeQuality(gate))).toEqual(expected);
  });

  it('reuses merged engine R18 identities and distinguishes unlocated occurrences', () => {
    const finding = { ruleId: 'image-alt', engine: 'axe', wcagSc: ['1.1.1'], impact: 'critical' as const, url, selector: 'img', elementKey: 'html>body>img', snippet: '<img>', helpUrl: '' };
    const scan = report([{ engine: 'axe', url, status: 'complete', findings: [finding] }, { engine: 'htmlcs', url, status: 'complete', findings: [{ ...finding, engine: 'htmlcs', ruleId: 'H37' }] }]);
    expect(issues(toGitlabCodeQuality(formatReportFromScan(scan))).map((i) => i.fingerprint)).toEqual(createFingerprintBaseline(scan).findings.map((f) => f.fingerprint));
    const baseline = createFingerprintBaseline(scan);
    expect(issues(toGitlabCodeQuality(formatReportFromScan(applyFingerprintBaseline(scan, baseline)))).map((i) => i.fingerprint)).toEqual(baseline.findings.map((f) => f.fingerprint));
    const mergedUnlocated = report([{ engine: 'htmlcs', url, status: 'complete', findings: [
      { ...finding, engine: 'htmlcs', ruleId: 'H37', selector: '', elementKey: '' },
      { ...finding, engine: 'htmlcs', ruleId: 'H37', selector: '', elementKey: '' },
    ] }]);
    const unlocatedBaseline = createFingerprintBaseline(mergedUnlocated);
    expect(issues(toGitlabCodeQuality(formatReportFromScan(applyFingerprintBaseline(mergedUnlocated, unlocatedBaseline)))).map((i) => i.fingerprint).sort()).toEqual(unlocatedBaseline.findings.map((f) => f.fingerprint).sort());
    const unlocated = report();
    unlocated.findings.forEach((f) => { f.selectors = []; f.selector = ''; });
    const exported = issues(toGitlabCodeQuality(formatReportFromScan(unlocated)));
    expect(new Set(exported.map((i) => i.fingerprint)).size).toBe(2);
    expect(exported.map((i) => i.fingerprint).sort()).toEqual(unlocated.findings.map(baselineFingerprint).sort());
  });

  it('maps impacts to GitLab severities and returns a valid empty array for clean scans', () => {
    const formatted = formatReportFromScan(report());
    for (const [impact, severity] of [['critical', 'critical'], ['serious', 'major'], ['moderate', 'minor'], ['minor', 'info'], [null, 'info']] as const) {
      formatted.findings[0]!.impact = impact;
      expect(issues(toGitlabCodeQuality(formatted)).find((i) => i.description.includes('iframe'))!.severity).toBe(severity);
    }
    formatted.findings = [];
    expect(toGitlabCodeQuality(formatted)).toBe('[]\n');
    issues(toGitlabCodeQuality(formatted));
  });

  it('uses mapped relative paths and positive lines, falling back for invalid mappings', () => {
    const formatted = formatReportFromScan(report());
    formatted.findings = [formatted.findings[0]!];
    formatted.findings[0]!.source = { file: './src\\hero.tsx', startLine: 24, endLine: 26 };
    expect(issues(toGitlabCodeQuality(formatted))[0]!.location).toEqual({ path: 'src/hero.tsx', lines: { begin: 24, end: 26 } });
    for (const file of ['/tmp/file', '../file', 'src/../../file', 'https://host/file', 'C:\\file']) {
      formatted.findings[0]!.source = { file, startLine: 24 };
      expect(issues(toGitlabCodeQuality(formatted))[0]!.location).toEqual({ path: 'a11ygate-pages/127.0.0.1-3000/index.html', lines: { begin: 1 } });
    }
  });

  it('rejects malformed issues through the documented schema', () => {
    const issue = issues(toGitlabCodeQuality(formatReportFromScan(report())))[0]!;
    for (const invalid of [{ ...issue, severity: 'serious' }, { ...issue, fingerprint: undefined }, { ...issue, location: { path: './bad', lines: { begin: 0 } } }]) expect(validate([invalid])).toBe(false);
  });

  it('parses flags and writes scan, report, and gate artifacts without changing default output or policy', async () => {
    expect(parseFormatList('gitlab-codequality,junit,gitlab-codequality')).toEqual({ ok: true, formats: ['gitlab-codequality', 'junit'] });
    const cwd = await mkdtemp(path.join(tmpdir(), 'a11ygate-gitlab-'));
    try {
      const engine = async () => ({ visit: async () => ({ status: 200, finalUrl: url, links: [], result: result() }), close: async () => {} });
      const fetch = async () => ({ ok: true, status: 200, text: async () => '' });
      const outputs: string[] = [];
      const base = { cwd, engine, fetch, now: () => new Date('2026-11-14T00:00:00Z'), stderr: () => {} };
      expect(await runScan([url, '--out-dir', 'plain'], { ...base, stdout: (s) => outputs.push(s) })).toBe(1);
      expect(await runScan([url, '--out-dir', 'formatted', '--format', 'gitlab-codequality,junit'], { ...base, stdout: (s) => outputs.push(s) })).toBe(1);
      expect(outputs[1]).toBe(outputs[0]);
      for (const ext of ['json', 'md', 'html']) expect(await readFile(path.join(cwd, `formatted/a11ygate-scan.${ext}`), 'utf8')).toBe(await readFile(path.join(cwd, `plain/a11ygate-scan.${ext}`), 'utf8'));
      issues(await readFile(path.join(cwd, 'formatted/a11ygate-scan.gitlab-codequality.json'), 'utf8'));
      const io = { cwd, stdout: () => {}, stderr: () => {} };
      expect(await run(['report', 'plain', '--out-dir', 'reexport', '--format', 'gitlab-codequality', '--fail-on', 'none'], io)).toBe(0);
      issues(await readFile(path.join(cwd, 'reexport/a11ygate-scan.gitlab-codequality.json'), 'utf8'));
      await writeFile(path.join(cwd, 'axe.json'), JSON.stringify(result()));
      expect(await run(['ci', '--current', 'axe.json', '--out-dir', 'gate', '--format', 'gitlab-codequality'], io)).toBe(1);
      issues(await readFile(path.join(cwd, 'gate/a11ygate.gitlab-codequality.json'), 'utf8'));
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
});

it('checks the includable YAML structure against documented GitLab job keys and report paths', () => {
  const config = yaml.load(readFileSync('integrations/gitlab/a11ygate.gitlab-ci.yml', 'utf8')) as Record<string, Record<string, unknown>>;
  expect(Object.keys(config)).toEqual(['a11ygate']);
  const job = config.a11ygate!;
  expect(job.image).toBe('mcr.microsoft.com/playwright:v1.64.1-noble');
  expect(job.stage).toBe('test');
  expect(job.allow_failure).toBe(false);
  expect(job.rules).toEqual([{ if: '$CI_PIPELINE_SOURCE == "merge_request_event"' }, { when: 'never' }]);
  expect(job.before_script).toEqual(['npm ci']);
  expect(job.variables).toEqual({ A11YGATE_URL: 'http://127.0.0.1:3000', A11YGATE_FAIL_ON: 'serious' });
  expect(job.artifacts).toEqual({ when: 'always', paths: ['a11y/'], reports: { codequality: 'a11y/a11ygate-scan.gitlab-codequality.json', junit: 'a11y/a11ygate-scan.junit.xml' } });
  const script = (job.script as string[])[0]!;
  const args = script.replace('"$A11YGATE_URL"', url).replace('"$A11YGATE_FAIL_ON"', 'serious').split(' ').slice(4);
  expect(parseScanArgs(args)).toMatchObject({ ok: true, options: { formats: ['gitlab-codequality', 'junit'], maxPages: 1, failOn: 'serious' } });
  expect(job.script).toEqual(['npx --no-install a11ygate scan "$A11YGATE_URL" --crawl 1 --fail-on "$A11YGATE_FAIL_ON" --format gitlab-codequality,junit --out-dir a11y']);
});
