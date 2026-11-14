import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { validateXML } from 'xmllint-wasm';
import { toJunit, parseJenkinsJunit } from '@/lib/export-junit';
import { toSarif } from '@/lib/export-sarif';
import { toGitlabCodeQuality, toGitlabDecided } from '@/lib/export-gitlab-codequality';
import { formatReportFromScan } from '@/lib/report-formats';
import { buildScanReport } from '@/lib/scan/report';
import { applyFingerprintBaseline, createFingerprintBaseline } from '@/lib/scan/baseline';
import { createGroupDecision } from '@/lib/scan/review';
import { groupSharedComponents } from '@/lib/group';
import { run } from '@/packages/cli/src/run';
import { minimalResult } from './helpers';
import { blockNetwork } from './network-guard';
import sarifSchema from './schemas/sarif-schema-2.1.0.json';
import gitlabSchema from './schemas/gitlab-codequality.schema.json';

const now = new Date('2026-11-14T12:00:00Z');
const kinds = ['to-fix', 'accepted-risk', 'false-positive'] as const;
// Three distinct shared groups of the same rule on the same pages exercise mixed JUnit cases.
function fixture() {
  return buildScanReport({ crawl: { pages: ['/', '/about'].map((p) => {
    const url = `http://localhost${p}`;
    return { url, finalUrl: url, status: 200, scanStatus: 'complete' as const, result: minimalResult({ url, violations: [{
      id: 'image-alt', impact: 'critical', help: 'Image alternative required', helpUrl: 'https://example.test/image-alt', tags: ['wcag111'],
      nodes: kinds.map((_, i) => ({ target: [`img.group-${i}`], html: `<img class="group-${i}" src="/fixture.png">` })),
    }] }) };
  }), skipped: [] }, version: '0.2.0', scannedAt: now.toISOString(), startUrl: 'http://localhost/', failOn: 'serious', maxPages: 2, delayMs: 0, userAgent: 'fixture', robotsNote: 'fixture' });
}
function baseline() {
  const scan = fixture();
  return { ...createFingerprintBaseline({ ...scan, findings: [] }), groupDecisions: groupSharedComponents(scan.findings).map((g) => {
    const kind = kinds[Number(g.normalizedSelector.match(/group-(\d)/)![1])]!;
    return createGroupDecision(g, { decision: kind, reason: kind === 'to-fix' ? undefined : `Review <${kind}> & rationale`,
      ...(kind === 'accepted-risk' ? { expires: '2026-11-30' } : {}), by: 'Fixture reviewer', now });
  }) };
}
const ajv = new Ajv({ strict: false, allErrors: true, unicodeRegExp: false });
addFormats(ajv);
const validSarif = ajv.compile(sarifSchema);
const validGitlab = new Ajv().compile(gitlabSchema);
const xsd = readFileSync(new URL('./schemas/junit-4.xsd', import.meta.url), 'utf8');
let guard: ReturnType<typeof blockNetwork>;
beforeEach(() => { guard = blockNetwork(); });
afterEach(() => { guard.restore(); expect(guard.attempts).toEqual([]); });

it('exports active decisions as SARIF suppressions, JUnit skips and a GitLab audit sidecar', async () => {
  const report = formatReportFromScan(applyFingerprintBaseline(fixture(), baseline(), now));
  const sarif = JSON.parse(toSarif(report));
  expect(validSarif(sarif), JSON.stringify(validSarif.errors)).toBe(true);
  expect(sarif.runs[0].results).toHaveLength(6);
  for (const result of sarif.runs[0].results) {
    const finding = report.findings.find((f) => f.selector === result.properties.selector)!;
    expect(result.suppressions).toEqual(finding.reviewDecision!.decision === 'to-fix' ? [] : [{ kind: 'external', status: 'accepted', justification: finding.reviewDecision!.reason }]);
  }
  const xml = toJunit(report);
  const validation = await validateXML({ xml, schema: xsd });
  expect(validation.valid, JSON.stringify(validation.errors)).toBe(true);
  const suite = parseJenkinsJunit(xml)[0]!;
  expect(suite).toMatchObject({ tests: 6, failures: 2, skipped: 4 });
  expect(suite.cases.filter((c) => c.status === 'skipped').map((c) => c.message)).toEqual(expect.arrayContaining([
    'accepted-risk: Review <accepted-risk> & rationale', 'false-positive: Review <false-positive> & rationale',
  ]));
  const gitlab = JSON.parse(toGitlabCodeQuality(report));
  expect(validGitlab(gitlab)).toBe(true);
  expect(gitlab).toHaveLength(2);
  const decided = JSON.parse(toGitlabDecided(report)!);
  expect(decided.findings).toHaveLength(4);
  expect(decided.disclaimer).toBe('Automated testing only. Not a WCAG audit, certification or legal advice.');
});

it('exports expired decisions as unsuppressed failing findings in every format', () => {
  const b = baseline();
  b.groupDecisions = b.groupDecisions.filter((d) => d.decision === 'accepted-risk');
  const scan = applyFingerprintBaseline(fixture(), b, new Date('2026-12-01T00:00:00Z'));
  expect(scan.verdict).toBe('FAIL');
  const report = formatReportFromScan(scan);
  expect(JSON.parse(toSarif(report)).runs[0].results.every((r: { suppressions: unknown[] }) => r.suppressions.length === 0)).toBe(true);
  expect(parseJenkinsJunit(toJunit(report))[0]).toMatchObject({ failures: 2, skipped: 0 });
  expect(JSON.parse(toGitlabCodeQuality(report))).toHaveLength(6);
  expect(toGitlabDecided(report)).toBeUndefined();
});

it('keeps all three exports byte identical to the no-decisions goldens', () => {
  const report = formatReportFromScan(fixture());
  expect(toJunit(report)).toMatchSnapshot();
  expect(toSarif(report)).toMatchSnapshot();
  expect(toGitlabCodeQuality(report)).toMatchSnapshot();
  expect(toGitlabDecided(report)).toBeUndefined();
  const plain = createFingerprintBaseline({ ...fixture(), findings: [] });
  const a = formatReportFromScan(applyFingerprintBaseline(fixture(), plain, now));
  const b = formatReportFromScan(applyFingerprintBaseline(fixture(), { ...plain, groupDecisions: [] }, now));
  for (const exporter of [toJunit, toSarif, toGitlabCodeQuality]) expect(exporter(a)).toBe(exporter(b));
});

it('writes the GitLab sidecar through report --baseline', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'a11ygate-decisions-'));
  try {
    await writeFile(path.join(cwd, 'scan.json'), JSON.stringify(fixture()));
    await writeFile(path.join(cwd, 'baseline.json'), JSON.stringify(baseline()));
    expect(await run(['report', 'scan.json', '--baseline', 'baseline.json', '--out-dir', 'out', '--format', 'junit,sarif,gitlab-codequality'], { cwd, now: () => now, stdout: () => {}, stderr: () => {} })).toBe(1);
    expect(JSON.parse(await readFile(path.join(cwd, 'out/codequality-decided.json'), 'utf8')).findings).toHaveLength(4);
    expect(JSON.parse(await readFile(path.join(cwd, 'out/a11ygate-scan.gitlab-codequality.json'), 'utf8'))).toHaveLength(2);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
