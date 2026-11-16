import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { cell } from '@/lib/export-markdown';
import { blockNetwork } from './network-guard';
import { runProjects } from '@/packages/cli/src/projects';
import { run } from '@/packages/cli/src/run';
import { runScan, type ScanEngineFactory } from '@/packages/cli/src/scan';
import { configProblems, validateConfig } from '@/packages/cli/src/config-schema';
import { selectRoutes } from '@/packages/cli/src/diff-routes';
import { renderScanHtml } from '@/lib/scan/report-html-v2';
import { createFingerprintBaseline, parseScanReport } from '@/lib/scan/baseline';
import type { ScanReport } from '@/lib/scan/report';
import type { AxeResults } from '@/lib/types';
import { createGroupDecision } from '@/lib/scan/review';
import { groupSharedComponents } from '@/lib/group';

let network: ReturnType<typeof blockNetwork>;
beforeEach(() => { network = blockNetwork(); });
afterEach(() => { network.restore(); expect(network.attempts).toEqual([]); });
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(cwd => rm(cwd, { recursive: true, force: true }))); });
const routes = { 'src/pages/pricing/**': '/pricing', 'src/pages/about/**': '/about', 'src/components/Nav/**': '*' };
const yaml = 'url: http://127.0.0.1:12345/\ncrawl: 3\ndelayMs: 0\nignoreRobots: true\nroutes:\n  src/pages/pricing/**: /pricing\n  src/pages/about/**: /about\n  src/components/Nav/**: "*"\n';
function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.test', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.test' } }).trim();
}
async function repo(files: string[]) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'a11ygate-diff-')); dirs.push(cwd);
  git(cwd, 'init', '-q');
  await writeFile(path.join(cwd, '.a11ygate.yml'), yaml);
  await writeFile(path.join(cwd, 'initial'), 'base');
  git(cwd, 'add', '.'); git(cwd, 'commit', '-qm', 'base'); git(cwd, 'tag', 'base');
  for (const file of files) {
    await mkdir(path.dirname(path.join(cwd, file)), { recursive: true });
    await writeFile(path.join(cwd, file), 'changed');
  }
  git(cwd, 'add', '.'); git(cwd, 'commit', '--allow-empty', '-qm', 'changes');
  return cwd;
}
const violation: AxeResults['violations'][number] = { id: 'image-alt', impact: 'critical', tags: ['wcag2a', 'wcag111'], help: 'Images must have alternative text', helpUrl: 'https://example.test/rules/image-alt', nodes: [{ target: ['img'], html: '<img src="x.png">' }] };
async function scan(cwd: string, args = ['--changed-since', 'base'], violations = false) {
  const visited: string[] = []; let starts = 0; let stdout = ''; let stderr = ''; let report: ScanReport | undefined;
  const engine: ScanEngineFactory = async () => { starts++; return {
    close: async () => {},
    visit: async url => {
      visited.push(new URL(url).pathname);
      return { status: 200, finalUrl: url, links: ['/pricing', '/about'].map(p => new URL(p, url).href), result: { url, timestamp: '2026-11-15T00:00:00Z', testEngine: { version: '4.14.0' }, violations: violations ? [violation] : [], toolOptions: {}, scanConfig: {}, scanStatus: 'complete' } };
    },
  }; };
  const code = await runScan(args, { cwd, env: { NODE_ENV: 'test' }, engine, now: () => new Date('2026-11-15T00:00:00Z'), stdout: s => { stdout += s; }, stderr: s => { stderr += s; }, onReport: r => { report = r; }, fetch: async () => { throw Error('no network'); } });
  return { code, starts, visited, stdout, stderr, report: report! };
}

describe('diff-aware committed PR route selection', () => {
  it('scans only mapped routes, without following their links; summaries list scanned/skipped paths', async () => {
    const cwd = await repo(['src/pages/pricing/page.ts']);
    const result = await scan(cwd);
    expect(result.code, result.stderr).toBe(0);
    expect(result.visited).toEqual(['/pricing']);
    expect(result.report.diffScan).toMatchObject({ mode: 'diff-aware', reasonCode: 'mapped', scannedRoutes: ['/pricing'], skippedRoutes: ['/', '/about'] });
    for (const output of [result.stdout, renderScanHtml(result.report, 1), renderScanHtml(result.report, 2)]) {
      expect(output).toContain('Scan mode: diff-aware');
      expect(output).toContain('Scanned routes: /pricing');
      expect(output).toContain('Skipped routes: /, /about');
      expect(output).toContain('Automated testing only.');
    }
  });
  it.each([
    [['unmapped.txt'], 'unmapped'],
    [['src/components/Nav/index.ts'], 'wildcard'],
    [[], 'noChanges'],
  ] as const)('falls back to the normal full crawl for %j', async (files, reasonCode) => {
    const result = await scan(await repo([...files]));
    expect(result.code, result.stderr).toBe(0);
    expect(result.visited).toEqual(['/', '/pricing', '/about']);
    expect(result.report.diffScan).toMatchObject({ mode: 'full', reasonCode, scannedRoutes: ['/', '/pricing', '/about'], skippedRoutes: [] });
    expect(result.stdout).toContain('Scan mode: full');
    expect(result.stdout).toContain(cell(result.report.diffScan!.reason));
  });
  it.each(['missing-ref', '-HEAD', '--output=oops', 'HEAD~999'])('rejects bad ref %s before engines or scans start', async ref => {
    const result = await scan(await repo(['src/pages/pricing/page.ts']), ['--changed-since', ref]);
    expect(result.code).toBe(2);
    expect(result.starts).toBe(0);
    expect(result.visited).toEqual([]);
    expect(result.stderr).toContain('--changed-since');
    expect(result.report).toBeUndefined();
  });
  it('uses merge-base vs HEAD, ignores working-tree edits, and handles spaces/newlines in paths', async () => {
    const cwd = await repo(['src/pages/pricing/with space\nand newline.ts']);
    await writeFile(path.join(cwd, 'untracked'), 'not in HEAD');
    await writeFile(path.join(cwd, 'initial'), 'working tree edit');
    expect((await selectRoutes('base', routes, cwd)).mode).toBe('diff-aware');
    const head = git(cwd, 'rev-parse', 'HEAD');
    git(cwd, 'checkout', '-qb', 'other', 'base');
    await writeFile(path.join(cwd, 'base-only'), 'other branch edit');
    git(cwd, 'add', 'base-only'); git(cwd, 'commit', '-qm', 'other base');
    git(cwd, 'tag', 'other-base'); git(cwd, 'checkout', '-q', head);
    expect(await selectRoutes('other-base', routes, cwd)).toMatchObject({ mode: 'diff-aware', selectedRoutes: ['/pricing'] });
  });
  it('selects all mapped routes, including deletions and both sides of renames', async () => {
    const cwd = await repo(['src/pages/pricing/a.ts', 'src/pages/about/b.ts']);
    expect((await scan(cwd)).visited).toEqual(['/about', '/pricing']);
    git(cwd, 'tag', 'before-delete');
    git(cwd, 'rm', 'src/pages/pricing/a.ts');
    git(cwd, 'commit', '-qm', 'delete');
    expect((await selectRoutes('before-delete', routes, cwd)).selectedRoutes).toEqual(['/pricing']);
    git(cwd, 'tag', 'before-rename');
    git(cwd, 'mv', 'src/pages/about/b.ts', 'unmapped.ts');
    git(cwd, 'commit', '-qm', 'rename');
    expect((await selectRoutes('before-rename', routes, cwd)).reasonCode).toBe('unmapped');
  });
  it('matches repository-root paths when launched from a subdirectory', async () => {
    const cwd = await repo(['src/pages/pricing/a.ts']);
    expect(await selectRoutes('base', routes, path.join(cwd, 'src'))).toMatchObject({ mode: 'diff-aware', selectedRoutes: ['/pricing'] });
  });
  it('requires every changed file to be mapped and considers all overlapping patterns', async () => {
    const cwd = await repo(['src/pages/pricing/a.ts', 'unmapped']);
    expect((await selectRoutes('base', routes, cwd)).reasonCode).toBe('unmapped');
    expect((await selectRoutes('base', { '**': '*', ...routes }, cwd)).reasonCode).toBe('wildcard');
  });
  it('keeps skipped baseline pages unassessed and applies review decisions on scanned routes', async () => {
    const cwd = await repo(['src/pages/pricing/a.ts']);
    const full = await scan(cwd, [], true);
    const baseline = createFingerprintBaseline(full.report);
    await writeFile(path.join(cwd, 'baseline.json'), JSON.stringify(baseline));
    const selected = await scan(cwd, ['--changed-since', 'base', '--baseline', 'baseline.json'], true);
    expect(selected.code).toBe(0);
    expect(selected.report.baseline).toMatchObject({ new: 0, existing: 1, fixed: 0, unassessed: 2 });
    const groups = groupSharedComponents(full.report.findings);
    const decision = createGroupDecision(groups[0]!, { decision: 'accepted-risk', reason: 'Fixture review', by: 'Fixture', now: new Date('2026-11-15') });
    await writeFile(path.join(cwd, 'baseline.json'), JSON.stringify({ ...baseline, findings: [], groupDecisions: [decision] }));
    const reviewed = await scan(cwd, ['--changed-since', 'base', '--baseline', 'baseline.json'], true);
    expect(reviewed.code).toBe(0);
    expect(reviewed.report.findings[0]?.reviewDecision?.decision).toBe('accepted-risk');
  });
  it('supports project scan configs while the saved-result ci parser rejects the flag', async () => {
    const cwd = await repo(['src/pages/pricing/a.ts']);
    await writeFile(path.join(cwd, '.a11ygate.yml'), yaml + 'changedSince: base\n');
    await writeFile(path.join(cwd, 'projects.yml'), 'projects:\n  - name: fixture\n    config: .a11ygate.yml\n');
    const visited: string[] = [];
    const engine: ScanEngineFactory = async () => ({ close: async () => {}, visit: async url => {
      visited.push(new URL(url).pathname);
      return { status: 200, finalUrl: url, links: [], result: { url, violations: [], timestamp: '2026-11-15T00:00:00Z', testEngine: { version: '4.14.0' } } };
    } });
    const io = { cwd, env: { NODE_ENV: 'test' as const }, engine, stdout: () => {}, stderr: () => {} };
    expect(await runProjects(['--projects', 'projects.yml', '--out-dir', 'out'], io)).toBe(0);
    expect(visited).toEqual(['/pricing']);
    const report = JSON.parse(await readFile(path.join(cwd, 'out/fixture/a11ygate-scan.json'), 'utf8'));
    expect(report.diffScan.mode).toBe('diff-aware');
    expect(await run(['ci', '--changed-since', 'base'], io)).toBe(2);
  });
  it('without the flag, mapping does not change JSON/Markdown or v1/v2 HTML bytes', async () => {
    const cwd = await repo(['src/pages/pricing/a.ts']);
    const withMap = await scan(cwd, []);
    await writeFile(path.join(cwd, '.a11ygate.yml'), yaml.slice(0, yaml.indexOf('routes:')));
    const withoutMap = await scan(cwd, []);
    expect(withMap.stdout).toBe(withoutMap.stdout);
    expect(JSON.stringify(withMap.report)).toBe(JSON.stringify(withoutMap.report));
    for (const version of [1, 2] as const) expect(renderScanHtml(withMap.report, version)).toBe(renderScanHtml(withoutMap.report, version));
  });
});

it('validates malformed routes values without crashes (R61 property coverage)', () => {
  fc.assert(fc.property(fc.jsonValue({ maxDepth: 3 }), routes => {
    const errors = validateConfig({ routes });
    expect(Array.isArray(errors)).toBe(true);
    if (routes === null || Array.isArray(routes) || typeof routes !== 'object') expect(errors.join(' ')).toContain('routes');
  }), { numRuns: 250, seed: 57 });
  for (const text of ['routes: []', 'routes: null', 'routes:\n  src/**: 3', 'routes:\n  src/**: https://other.test/', 'routes:\n  src/**: //other.test/', 'changedSince: -bad']) expect(configProblems(text).join(' ')).toMatch(/routes|changedSince/);
});

it('rejects malformed saved diff scope metadata before rendering (R61)', async () => {
  const result = await scan(await repo(['src/pages/pricing/a.ts']));
  fc.assert(fc.property(fc.jsonValue({ maxDepth: 3 }), diffScan => {
    try { parseScanReport({ ...result.report, diffScan }); }
    catch (error) { expect(error).toBeInstanceOf(Error); expect((error as Error).constructor).toBe(Error); expect((error as Error).message).toContain('diffScan'); }
  }), { numRuns: 250, seed: 57 });
});
