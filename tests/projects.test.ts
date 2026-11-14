import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import schema from '@/schema/a11ygate.projects.schema.json';
import { runProjects } from '@/packages/cli/src/projects';
import { parseProjects } from '@/packages/cli/src/projects-schema';
import { run } from '@/packages/cli/src/run';
import { runScan, type ScanEngineFactory } from '@/packages/cli/src/scan';
import { createFingerprintBaseline } from '@/lib/scan/baseline';
import { parseJenkinsJunit } from '@/lib/export-junit';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { blockNetwork } from './network-guard';

const violation = { id: 'image-alt', impact: 'critical' as const, tags: ['wcag2a', 'wcag111'], help: 'Images must have alternative text', helpUrl: 'https://example.invalid/help', nodes: [{ target: ['img'], html: '<img src="fixture.png">' }] };
const now = () => new Date('2026-11-14T00:00:00Z');
const quiet = { stdout: () => {}, stderr: () => {}, env: { NODE_ENV: 'test' as const }, now };
async function fixture() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'a11ygate-projects-'));
  await mkdir(path.join(cwd, 'configs'));
  for (const name of ['clean', 'violations', 'unreachable']) {
    await writeFile(path.join(cwd, 'configs', `${name}.yml`), `url: http://127.0.0.1/${name}\ndelayMs: 0\n`);
  }
  await writeFile(path.join(cwd, 'projects.yml'), `projects:\n${['clean', 'unreachable', 'violations'].map(name => `  - name: ${name}\n    config: configs/${name}.yml`).join('\n')}\n`);
  return cwd;
}

function engineFixture() {
  let active = 0;
  let peak = 0;
  const seen: string[] = [];
  const engine: ScanEngineFactory = async ({ auth }) => {
    expect(auth?.headers).toEqual({});
    active++;
    peak = Math.max(active, peak);
    return {
      visit: async url => {
        seen.push(new URL(url).pathname);
        await new Promise(resolve => setTimeout(resolve, 5));
        if (url.endsWith('/unreachable')) return { status: null, finalUrl: url, links: [], error: 'Local fixture unreachable' };
        return { status: 200, finalUrl: url, links: [], result: { url, timestamp: now().toISOString(), testEngine: { version: '4.11.1' }, violations: url.endsWith('/violations') ? [violation] : [] } };
      },
      close: async () => { active--; },
    };
  };
  return { engine, seen, peak: () => peak };
}

describe('multi-project runs', () => {
  it.each([1, 2])('isolates clean, violations and unreachable projects (parallel %i)', async parallel => {
    const cwd = await fixture();
    const guard = blockNetwork();
    const fake = engineFixture();
    try {
      const code = await runProjects(['--projects', 'projects.yml', '--parallel', String(parallel), '--out-dir', 'out'], { ...quiet, cwd, engine: fake.engine, fetch: async () => ({ ok: false, status: 404, text: async () => '' }) });
      expect(code).toBe(2);
      const summary = JSON.parse(await readFile(path.join(cwd, 'out/a11ygate-projects.json'), 'utf8'));
      expect(summary.counts).toEqual({ projects: 3, passed: 1, failed: 1, errored: 1, pagesScanned: 2, pagesFailed: 1, findings: 1, new: 1, existing: 0 });
      expect(summary.projects.map((p: {name: string; status: string; exitCode: number}) => [p.name, p.status, p.exitCode])).toEqual([['clean', 'passed', 0], ['unreachable', 'errored', 2], ['violations', 'failed', 1]]);
      expect(fake.peak()).toBe(parallel);
      // Navigation failures receive the scanner's existing single retry.
      expect([...fake.seen].sort()).toEqual(['/clean', '/unreachable', '/unreachable', '/violations']);
      for (const name of ['clean', 'violations', 'unreachable']) {
        const result = JSON.parse(await readFile(path.join(cwd, 'out', name, 'project-result.json'), 'utf8'));
        expect(result.disclaimer).toBe(AUTOMATED_TESTING_DISCLAIMER);
        const report = JSON.parse(await readFile(path.join(cwd, 'out', name, 'a11ygate-scan.json'), 'utf8'));
        expect(report.startUrl).toBe(`http://127.0.0.1/${name}`);
      }
      const xml = await readFile(path.join(cwd, 'out/a11ygate-projects.junit.xml'), 'utf8');
      expect(parseJenkinsJunit(xml).map(s => [s.name, s.failures, s.errors])).toEqual([['clean', 0, 0], ['unreachable', 0, 1], ['violations', 1, 0]]);
      for (const extension of ['md', 'html', 'json', 'junit.xml']) expect(await readFile(path.join(cwd, `out/a11ygate-projects.${extension}`), 'utf8')).toContain(AUTOMATED_TESTING_DISCLAIMER);
      expect(guard.attempts).toEqual([]);
    } finally { guard.restore(); await rm(cwd, { recursive: true, force: true }); }
  });

  it('continues after missing config and browser startup failure; ignores stale reports', async () => {
    const cwd = await fixture();
    const guard = blockNetwork();
    try {
      await rm(path.join(cwd, 'configs/unreachable.yml'));
      await mkdir(path.join(cwd, 'out/violations'), { recursive: true });
      await writeFile(path.join(cwd, 'out/violations/a11ygate-scan.json'), '{"counts":{"findings":999}}');
      const code = await runProjects(['--projects=projects.yml', '--out-dir=out'], { ...quiet, cwd, fetch: async () => ({ ok: false, status: 404, text: async () => '' }), engine: async options => {
        if (options.origin) throw new Error('Browser missing');
        throw new Error('unexpected');
      } });
      expect(code).toBe(2);
      const summary = JSON.parse(await readFile(path.join(cwd, 'out/a11ygate-projects.json'), 'utf8'));
      expect(summary.counts).toMatchObject({ errored: 3, findings: 0 });
      expect(guard.attempts).toEqual([]);
    } finally { guard.restore(); await rm(cwd, { recursive: true, force: true }); }
  });

  it('uses config-relative baseline and auth without changing a direct single-project scan', async () => {
    const cwd = await fixture();
    const guard = blockNetwork();
    try {
      await writeFile(path.join(cwd, 'configs/baseline.json'), JSON.stringify({ kind: 'a11ygate-fingerprint-baseline', schemaVersion: 1, findings: [] }));
      await writeFile(path.join(cwd, 'configs/state.json'), '{"cookies":[],"origins":[]}');
      await writeFile(path.join(cwd, 'configs/clean.yml'), 'url: http://127.0.0.1/clean\nbaseline: baseline.json\nauth:\n  storageState: state.json\n');
      await writeFile(path.join(cwd, 'projects.yml'), 'projects:\n  - name: clean\n    config: configs/clean.yml\n');
      const fetch = async () => ({ ok: false, status: 404, text: async () => '' });
      const fake = engineFixture();
      expect(await runProjects(['--projects', 'projects.yml', '--out-dir', 'out'], { ...quiet, cwd, engine: fake.engine, fetch })).toBe(0);
      const repoConfig = await readFile(path.join(cwd, 'configs/clean.yml'), 'utf8');
      expect(await runScan(['--out-dir', path.join(cwd, 'direct')], { ...quiet, cwd: path.join(cwd, 'configs'), repoConfig, engine: fake.engine, fetch })).toBe(0);
      for (const ext of ['json', 'md', 'html']) expect(await readFile(path.join(cwd, `out/clean/a11ygate-scan.${ext}`), 'utf8')).toBe(await readFile(path.join(cwd, `direct/a11ygate-scan.${ext}`), 'utf8'));
      expect(guard.attempts).toEqual([]);
    } finally { guard.restore(); await rm(cwd, { recursive: true, force: true }); }
  });

  it('returns 1 for violations, then 0 with that project’s own baseline and auth', async () => {
    const cwd = await fixture();
    const guard = blockNetwork();
    try {
      await writeFile(path.join(cwd, 'projects.yml'), 'projects:\n  - name: violations\n    config: configs/violations.yml\n');
      const fake = engineFixture();
      const io = { ...quiet, cwd, engine: fake.engine, fetch: async () => ({ ok: false, status: 404, text: async () => '' }) };
      expect(await runProjects(['--projects', 'projects.yml', '--out-dir', 'out'], io)).toBe(1);
      const report = JSON.parse(await readFile(path.join(cwd, 'out/violations/a11ygate-scan.json'), 'utf8'));
      await writeFile(path.join(cwd, 'configs/known.json'), JSON.stringify(createFingerprintBaseline(report)));
      await writeFile(path.join(cwd, 'configs/violations.yml'), 'url: http://127.0.0.1/violations\nbaseline: known.json\nauth:\n  cookieEnv: [session=PROJECT_SESSION]\n');
      expect(await runProjects(['--projects', 'projects.yml', '--out-dir', 'out'], { ...io, env: { NODE_ENV: 'test', PROJECT_SESSION: 'fixture-secret' }, engine: async options => {
        expect(options.auth?.cookies).toEqual([{ name: 'session', value: 'fixture-secret', url: 'http://127.0.0.1' }]);
        return fake.engine(options);
      } })).toBe(0);
      const summary = JSON.parse(await readFile(path.join(cwd, 'out/a11ygate-projects.json'), 'utf8'));
      expect(summary.counts).toMatchObject({ passed: 1, new: 0, existing: 1, findings: 1 });
      expect(JSON.stringify(summary)).not.toContain('fixture-secret');
      expect(guard.attempts).toEqual([]);
    } finally { guard.restore(); await rm(cwd, { recursive: true, force: true }); }
  });

  it('protects another project’s baseline from output aliases before scanning', async () => {
    const cwd = await fixture();
    try {
      const evidence = path.join(cwd, 'out/clean/a11ygate-scan.json');
      await mkdir(path.dirname(evidence), { recursive: true });
      await writeFile(evidence, 'original evidence');
      await writeFile(path.join(cwd, 'configs/violations.yml'), 'url: http://127.0.0.1/violations\nbaseline: ../out/clean/a11ygate-scan.json\n');
      let starts = 0;
      expect(await runProjects(['--projects', 'projects.yml', '--out-dir', 'out'], { ...quiet, cwd, engine: async () => { starts++; throw new Error('must not start'); } })).toBe(2);
      expect(starts).toBe(0);
      expect(await readFile(evidence, 'utf8')).toBe('original evidence');
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });

  it('dispatches only opt-in ci projects and validates options/schema through CLI', async () => {
    const cwd = await fixture();
    try {
      let err = '';
      const io = { ...quiet, cwd, stderr: (s: string) => { err += s; } };
      expect(await run(['ci', '--projects', 'projects.yml', '--parallel', '0'], io)).toBe(2);
      expect(err).toContain('--parallel');
      expect(await run(['config', 'validate', '--projects', 'projects.yml'], io)).toBe(0);
      await writeFile(path.join(cwd, 'projects.yml'), 'projects:\n  - name: ../escape\n    config: clean.yml\n    typo: true\n');
      expect(await run(['ci', '--projects', 'projects.yml'], io)).toBe(2);
      expect(await run(['config', 'validate', '--projects', 'projects.yml'], io)).toBe(2);
      expect(err).toContain('schema/a11ygate.projects.schema.json');
      expect(err).toContain('typo');
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
});

describe('projects schema', () => {
  it('is valid JSON schema and agrees with runtime on required fields and types', () => {
    const validate = new Ajv({ strict: true }).compile(schema);
    for (const value of [{ projects: [] }, { projects: [{name: 'x'}] }, { projects: [{ name: '../x', config: 'c.yml' }] }, { projects: [{ name: 'x', config: 'c.yml' }] }]) {
      const text = `projects:\n${value.projects.map(p => `  - name: ${p.name}\n${'config' in p ? `    config: ${p.config}\n` : ''}`).join('')}`;
      // Empty YAML lists use the explicit flow syntax.
      expect(parseProjects(value.projects.length ? text : 'projects: []').errors.length === 0).toBe(validate(value));
    }
    expect(parseProjects('projects:\n  - name: X\n    config: a\n  - name: x\n    config: b').errors.join()).toContain('Duplicate');
    expect(parseProjects('null').errors.length).toBeGreaterThan(0);
    expect(parseProjects('projects: [').errors.length).toBeGreaterThan(0);
  });
});
