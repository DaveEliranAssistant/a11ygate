import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { runBaseline } from '@/packages/cli/src/baseline';
import { runEvidence } from '@/packages/cli/src/evidence';
import { runScan } from '@/packages/cli/src/scan';
import { minimalResult } from './helpers';
import { blockNetwork } from './network-guard';

// Keys and parameter types were authored from CircleCI's configuration reference, cited in the config:
//   https://circleci.com/docs/reference/configuration-reference/
//   https://circleci.com/developer/images/image/cimg/node
// This is a YAML structure check of the documented subset. It does NOT replace `circleci config validate`:
// the CircleCI CLI and Docker are not available where this suite was written. No CircleCI account is contacted.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const configPath = path.join(repoRoot, 'integrations/circleci/config.yml');
const docPath = path.join(repoRoot, 'docs/integrations/circleci.md');
const yaml = createRequire(import.meta.url)('js-yaml') as { load: (text: string) => unknown };

type Param = { type: string; default?: unknown; enum?: string[]; description?: string };
type Run = { name?: string; command: string; background?: boolean; when?: string } & Record<string, unknown>;
type Step = string | Record<string, unknown>;
type Job = { parameters: Record<string, Param>; docker: { image: string }[]; resource_class?: string; steps: Step[] };
type Config = { version: number; jobs: Record<string, Job>; workflows: Record<string, { jobs: (string | Record<string, Record<string, unknown>>)[] }> } & Record<string, unknown>;

const configText = readFileSync(configPath, 'utf8');
const config = yaml.load(configText) as Config;
const job = config.jobs['a11ygate-scan']!;
const defaults = Object.fromEntries(Object.entries(job.parameters).map(([k, p]) => [k, p.default])) as Record<string, unknown>;
const SHA = '0123456789abcdef0123456789abcdef01234567';

/** Expand CircleCI's `<< parameters.x >>` syntax (the only template syntax the config uses). */
function render(value: string, params: Record<string, unknown> = {}): string {
  const merged = { ...defaults, ...params };
  const out = value.replace(/<<\s*parameters\.([\w-]+)\s*>>/g, (_, name: string) => {
    if (!(name in merged)) throw new Error(`Unknown parameter ${name}`);
    return String(merged[name]);
  });
  expect(out).not.toMatch(/<<|>>/);
  return out;
}
/** Flatten the job's steps for given parameters, resolving `when: condition:` blocks the way CircleCI does (non-empty string = truthy). */
function steps(params: Record<string, unknown> = {}): [string, Record<string, unknown>][] {
  const flat = (list: Step[]): [string, Record<string, unknown>][] => list.flatMap((step): [string, Record<string, unknown>][] => {
    if (typeof step === 'string') return [[step, {}]];
    const [[kind, body]] = Object.entries(step) as [[string, Record<string, unknown>]];
    if (kind !== 'when') return [[kind, body]];
    const condition = render(String(body.condition), params);
    return condition && condition !== 'false' ? flat(body.steps as Step[]) : [];
  });
  return flat(job.steps);
}
function runNamed(prefix: string): Run {
  const found = steps().find(([kind, body]) => kind === 'run' && String(body.name).startsWith(prefix));
  expect(found, prefix).toBeDefined();
  return found![1] as Run;
}

const TOP_LEVEL_KEYS = ['version', 'setup', 'orbs', 'commands', 'parameters', 'executors', 'jobs', 'workflows'];
const JOB_KEYS = ['docker', 'machine', 'macos', 'shell', 'parameters', 'steps', 'working_directory', 'parallelity', 'parallelism', 'environment', 'resource_class'];
const RUN_KEYS = ['name', 'command', 'shell', 'environment', 'background', 'working_directory', 'no_output_timeout', 'when', 'max_auto_reruns', 'auto_rerun_delay'];
const STEP_KINDS = ['checkout', 'run', 'when', 'unless', 'store_test_results', 'store_artifacts', 'persist_to_workspace', 'attach_workspace', 'save_cache', 'restore_cache', 'setup_remote_docker', 'add_ssh_keys'];
const PARAM_TYPES = ['string', 'boolean', 'integer', 'enum', 'executor', 'steps', 'env_var_name'];

describe('integrations/circleci/config.yml structure (stand-in for circleci config validate)', () => {
  it('is a version 2.1 config using only documented top-level, job, step and parameter keys', () => {
    expect(config.version).toBe(2.1);
    for (const key of Object.keys(config)) expect(TOP_LEVEL_KEYS, key).toContain(key);
    expect(config.orbs, 'no orb is published or consumed').toBeUndefined();
    for (const key of Object.keys(job)) expect(JOB_KEYS, key).toContain(key);
    for (const [name, p] of Object.entries(job.parameters)) {
      expect(PARAM_TYPES, name).toContain(p.type);
      if (p.type === 'enum') expect(p.enum, name).toContain(p.default);
      if (p.type === 'integer') expect(Number.isInteger(p.default), name).toBe(true);
      if (p.type === 'string') expect(typeof p.default, name).toBe('string');
    }
    const walk = (list: Step[]) => list.forEach((step) => {
      if (typeof step === 'string') { expect(STEP_KINDS).toContain(step); return; }
      const entries = Object.entries(step);
      expect(entries).toHaveLength(1);
      const [kind, body] = entries[0]! as [string, Record<string, unknown>];
      expect(STEP_KINDS, kind).toContain(kind);
      if (kind === 'run') {
        for (const key of Object.keys(body)) expect(RUN_KEYS, key).toContain(key);
        expect(typeof body.command).toBe('string');
        if (body.when !== undefined) expect(['always', 'on_success', 'on_fail']).toContain(body.when);
      }
      if (kind === 'when') { expect(Object.keys(body).sort()).toEqual(['condition', 'steps']); walk(body.steps as Step[]); }
      if (kind === 'store_test_results') expect(Object.keys(body)).toEqual(['path']);
      if (kind === 'store_artifacts') expect(Object.keys(body).sort()).toEqual(['destination', 'path']);
    });
    walk(job.steps);
    // Every `<< parameters.x >>` reference resolves to a declared job parameter.
    for (const m of configText.matchAll(/<<\s*parameters\.([\w-]+)\s*>>/g)) expect(Object.keys(job.parameters), m[1]).toContain(m[1]);
    expect(configText).not.toMatch(/<<\s*pipeline\./);
    // Workflow job invocations pass only declared parameters with valid enum values.
    const invocations = Object.values(config.workflows).flatMap((w) => w.jobs);
    expect(invocations.length).toBeGreaterThan(0);
    for (const inv of invocations) {
      const [[name, args]] = typeof inv === 'string' ? [[inv, {}]] : Object.entries(inv);
      expect(Object.keys(config.jobs)).toContain(name);
      for (const [key, value] of Object.entries(args ?? {})) {
        const p = config.jobs[name]!.parameters[key];
        expect(p, key).toBeDefined();
        if (p!.type === 'enum') expect(p!.enum).toContain(value);
      }
    }
  });

  it('uses a cimg/node browsers image, a loopback default URL, and the documented fail-on values', () => {
    expect(job.docker).toHaveLength(1);
    expect(job.docker[0]!.image).toMatch(/^cimg\/node:\d+\.\d+-browsers$/);
    expect(job.parameters.url!.default).toBe('http://127.0.0.1:3000');
    expect(job.parameters['fail-on']).toMatchObject({ type: 'enum', enum: ['minor', 'moderate', 'serious', 'critical', 'none'], default: 'serious' });
    expect(job.parameters.baseline).toMatchObject({ type: 'string', default: '' });
    expect(configText).toContain(AUTOMATED_TESTING_DISCLAIMER);
    expect(configText).not.toMatch(/example\.(com|org)|https?:\/\/(?!127\.0\.0\.1|circleci\.com\/(docs|developer)\/)/);
    expect(configText).not.toMatch(/\bsecret|token|password|orb publish/i);
  });

  it('stores JUnit results and the report, SARIF and evidence pack, after the scan even when it fails', () => {
    const kinds = steps().map(([kind, body]) => (kind === 'run' ? `run:${String(body.name).replace(/^A11yGate: /, '').split(' ')[0]}` : kind));
    expect(kinds).toEqual(['checkout', 'run:install', 'run:install', 'run:start', 'run:wait', 'run:scan', 'run:evidence', 'store_test_results', 'store_artifacts']);
    expect(steps({ 'start-command': '' })).toHaveLength(7);
    expect(runNamed('A11yGate: start').background).toBe(true);
    // The scan keeps the default when (on_success) and its exit code is the fail-on policy.
    expect(runNamed('A11yGate: scan').when).toBeUndefined();
    expect(runNamed('A11yGate: evidence').when).toBe('always');
    const store = Object.fromEntries(steps().filter(([k]) => k.startsWith('store_'))) as Record<string, Record<string, string>>;
    expect(render(store.store_test_results!.path!)).toBe('a11y/a11ygate-scan.junit.xml');
    expect(store.store_artifacts).toEqual({ path: '<< parameters.out-dir >>', destination: 'a11ygate' });
    expect(runNamed('A11yGate: install Chromium').command).toBe('npx --no-install playwright install --with-deps chromium');
  });
});

/** Run a rendered `run:` command in bash the way CircleCI's default shell does (`/bin/bash -eo pipefail`). */
function bash(script: string, cwd: string, env: Record<string, string> = {}, prelude = '') {
  return new Promise<number | null>((resolve, reject) => {
    const child = spawn('/bin/bash', ['-eo', 'pipefail', '-c', `${prelude}\n${script}`], {
      cwd, stdio: 'ignore',
      env: { ...process.env, CIRCLE_SHA1: SHA, npm_config_offline: 'true', npm_config_update_notifier: 'false', ...env },
    });
    child.once('error', reject);
    child.once('exit', resolve);
  });
}
const hasBash = spawnSync('/bin/bash', ['-c', 'true']).status === 0;

describe.skipIf(!hasBash)('job run commands executed by bash with the CLI in-process (no drift, no network)', () => {
  let guard: ReturnType<typeof blockNetwork>;
  beforeEach(() => { guard = blockNetwork(); });
  afterEach(() => { guard.restore(); expect(guard.attempts).toEqual([]); });

  // Bash runs the config's own command text; an `npx` shell function records the argv it would pass to the CLI.
  // The test then runs that exact argv through the CLI entry points with a stub browser.
  async function captureArgv(script: string, cwd: string): Promise<{ code: number | null; argv: string[] | null }> {
    const argvFile = path.join(cwd, '.argv');
    await rm(argvFile, { force: true });
    const code = await bash(script, cwd, { ARGV_FILE: argvFile }, `npx() { printf '%s\\0' "$@" > "$ARGV_FILE"; }`);
    if (!existsSync(argvFile)) return { code, argv: null };
    const argv = (await readFile(argvFile, 'utf8')).split('\0').slice(0, -1);
    expect(argv.slice(0, 2)).toEqual(['--no-install', 'a11ygate']);
    return { code, argv: argv.slice(2) };
  }

  it('applies fail-on, the optional baseline, and writes every file the store steps reference', async () => {
    const url = 'http://127.0.0.1:3000/';
    const result = minimalResult({ url, violations: [{ id: 'image-alt', impact: 'critical', tags: ['wcag111'], help: 'Images must have alternate text', helpUrl: '', nodes: [{ target: ['img'], html: '<img>' }] }] });
    const engine = async () => ({ visit: async () => ({ status: 200, finalUrl: url, links: [], result }), close: async () => {} });
    const fetch = async () => ({ ok: true, status: 200, text: async () => '' });
    const cwd = await mkdtemp(path.join(tmpdir(), 'a11ygate-circleci-'));
    try {
      const io = { cwd, stdout: () => {}, stderr: () => {}, now: () => new Date('2026-11-14T00:00:00Z'), version: '0.2.0' };
      const scan = async (params: Record<string, unknown>) => {
        const { code, argv } = await captureArgv(render(runNamed('A11yGate: scan').command, params), cwd);
        expect(code).toBe(0);
        expect(argv![0]).toBe('scan');
        return { argv: argv!, exit: await runScan(argv!.slice(1), { ...io, engine, fetch }) };
      };
      for (const [failOn, expected] of [['serious', 1], ['critical', 1], ['none', 0]] as const) {
        const { argv, exit } = await scan({ 'fail-on': failOn });
        expect(argv).not.toContain('--baseline');
        expect(exit, failOn).toBe(expected);
      }
      // Optional baseline: accept current findings, then the same findings no longer fail the gate.
      expect(await runBaseline(['create', 'a11y'], io)).toBe(0);
      const withBaseline = await scan({ baseline: '.a11ygate-baseline.json' });
      expect(withBaseline.argv.slice(-2)).toEqual(['--baseline', '.a11ygate-baseline.json']);
      expect(withBaseline.exit).toBe(0);
      // A missing baseline file is a setup error (exit 2) before the CLI runs.
      expect(await captureArgv(render(runNamed('A11yGate: scan').command, { baseline: 'missing.json' }), cwd)).toEqual({ code: 2, argv: null });

      const pack = await captureArgv(render(runNamed('A11yGate: evidence').command), cwd);
      expect(pack.argv).toEqual(['evidence', 'pack', '--from', 'a11y', '--out', 'a11y/a11ygate-evidence.zip', '--commit', SHA]);
      const errs: string[] = [];
      expect(await runEvidence(pack.argv!.slice(1), { ...io, stderr: (s: string) => errs.push(s), gitHead: async () => null }), errs.join('')).toBe(0);

      const store = Object.fromEntries(steps().filter(([k]) => k.startsWith('store_'))) as Record<string, Record<string, string>>;
      expect(await readFile(path.join(cwd, render(store.store_test_results!.path!)), 'utf8')).toContain('<testsuite');
      const artifactDir = path.join(cwd, render(store.store_artifacts!.path!));
      for (const file of ['a11ygate-scan.html', 'a11ygate-scan.json', 'a11ygate-scan.sarif', 'a11ygate-evidence.zip']) expect((await stat(path.join(artifactDir, file))).isFile(), file).toBe(true);
      expect(JSON.parse(await readFile(path.join(artifactDir, 'a11ygate-scan.sarif'), 'utf8')).version).toBe('2.1.0');
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
});

const hasChromium = (() => { try { return existsSync(chromium.executablePath()); } catch { return false; } })();
const hasCurl = spawnSync('curl', ['--version']).status === 0;

describe.skipIf(!hasChromium || !hasBash || !hasCurl)('job run commands executed by bash against the loopback fixture', () => {
  it('waits for the app, fails on serious, passes with none and with a baseline, and packs evidence', async () => {
    const fixture = path.join(repoRoot, 'fixtures/scan-site');
    const requests: string[] = [];
    const server = createServer(async (req, res) => {
      const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
      requests.push(pathname);
      const file = path.resolve(fixture, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!file.startsWith(fixture + path.sep)) { res.writeHead(403).end(); return; }
      try {
        const data = await readFile(file);
        res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.png') ? 'image/png' : 'text/plain');
        res.end(data);
      } catch { res.writeHead(404).end(); }
    });
    const cwd = await mkdtemp(path.join(tmpdir(), 'a11ygate-circleci-shell-'));
    try {
      await symlink(path.join(repoRoot, 'node_modules'), path.join(cwd, 'node_modules'), 'dir');
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
      expect(await bash(render(runNamed('A11yGate: wait').command, { url }), cwd)).toBe(0);
      for (const [params, expected] of [[{ 'fail-on': 'serious' }, 1], [{ 'fail-on': 'none' }, 0]] as const) {
        expect(await bash(render(runNamed('A11yGate: scan').command, { url, ...params }), cwd), JSON.stringify(params)).toBe(expected);
        expect(await bash(render(runNamed('A11yGate: evidence').command), cwd)).toBe(0);
        expect(await readFile(path.join(cwd, 'a11y/a11ygate-scan.junit.xml'), 'utf8')).toContain('<testsuite');
        expect(JSON.stringify(JSON.parse(await readFile(path.join(cwd, 'a11y/a11ygate-scan.sarif'), 'utf8')))).toContain('image-alt');
        expect((await stat(path.join(cwd, 'a11y/a11ygate-evidence.zip'))).size).toBeGreaterThan(0);
        expect((await stat(path.join(cwd, 'a11y/a11ygate-scan.html'))).isFile()).toBe(true);
      }
      // Documented baseline flow: accept the current findings, then the gate passes at serious.
      expect(await bash('npx --no-install a11ygate baseline create a11y', cwd)).toBe(0);
      expect(await bash(render(runNamed('A11yGate: scan').command, { url, baseline: '.a11ygate-baseline.json' }), cwd)).toBe(0);
      expect(requests).toContain('/');
      expect(requests).not.toContain('/private/secret.html');
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await rm(cwd, { recursive: true, force: true });
    }
  }, 240_000);
});

const CLAIM_RE = /fixes everything|WCAG\/EAA compliant|\bcompliant\b|\bcertified\b|\bguarantee/i;
const LINK_RE = /\[[^\]]*]\(([^)]+)\)/g;

describe.each([['docs/integrations/circleci.md', docPath], ['integrations/circleci/config.yml', configPath]])('%s claims', (_, file) => {
  it('keeps the disclaimer and makes no compliance claims', () => {
    const text = readFileSync(file, 'utf8');
    expect(text).toContain(AUTOMATED_TESTING_DISCLAIMER);
    expect(text).not.toMatch(CLAIM_RE);
    expect(text).not.toMatch(/example\.(com|org)/);
  });
});

describe('docs/integrations/circleci.md', () => {
  const doc = readFileSync(docPath, 'utf8');

  it('passes the markdown link check', async () => {
    const hrefs = [...doc.matchAll(LINK_RE)].map((m) => m[1]!);
    expect(hrefs.length).toBeGreaterThan(5);
    const missing: string[] = [];
    for (const href of hrefs) {
      if (/^https?:\/\//.test(href)) { expect(href).toMatch(/^https:\/\//); continue; }
      const [file] = href.split('#');
      if (!file) continue;
      try { await stat(path.resolve(path.dirname(docPath), file)); } catch { missing.push(href); }
    }
    expect(missing, missing.join(', ')).toEqual([]);
  });

  it('links the config, records the validation gap and the orb as a future owner action, and uses loopback URLs only', () => {
    expect(doc).toContain('(../../integrations/circleci/config.yml)');
    expect(doc).toContain('circleci config validate');
    expect(doc).toMatch(/brew install circleci/);
    expect(doc).toMatch(/orb/i);
    expect(doc).toMatch(/future owner action/i);
    for (const m of doc.matchAll(/url: '([^']+)'/g)) expect(m[1]).toMatch(/^http:\/\/127\.0\.0\.1:\d+/);
  });
});
