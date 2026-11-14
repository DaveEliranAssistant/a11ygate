import { existsSync, readFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createServer, type RequestListener, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { runBaseline } from '@/packages/cli/src/baseline';
import { runEvidence } from '@/packages/cli/src/evidence';
import { runScan } from '@/packages/cli/src/scan';
import { minimalResult } from './helpers';
import { blockNetwork } from './network-guard';

// Keys below were copied from Atlassian's published Bitbucket Pipelines configuration schema and docs:
//   https://api.bitbucket.org/schemas/pipelines-configuration (definitions pipelines_configuration, step_base, step,
//     artifacts_expanded, artifacts_upload; fetched 2026-11-14)
//   https://support.atlassian.com/bitbucket-cloud/docs/bitbucket-pipelines-configuration-reference/
//   https://support.atlassian.com/bitbucket-cloud/docs/pipeline-start-conditions/
//   https://support.atlassian.com/bitbucket-cloud/docs/use-artifacts-in-steps/
//   https://support.atlassian.com/bitbucket-cloud/docs/test-reporting-in-pipelines/
// This is a structure check of the documented subset. It does NOT replace running the pipeline: no Bitbucket
// account, runner or Docker is used. No Bitbucket endpoint is contacted by this suite.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const configPath = path.join(repoRoot, 'integrations/bitbucket/bitbucket-pipelines.yml');
const scriptPath = path.join(repoRoot, 'integrations/bitbucket/a11ygate-scan.sh');
const docPath = path.join(repoRoot, 'docs/integrations/bitbucket.md');
const yaml = createRequire(import.meta.url)('js-yaml') as { load: (text: string) => unknown };

type Upload = { name: string; type?: string; paths: string[]; 'capture-on'?: string } & Record<string, unknown>;
type Step = { name?: string; script: string[]; 'max-time'?: number; artifacts?: { upload?: Upload[] } & Record<string, unknown> } & Record<string, unknown>;
type Config = { image: string; pipelines: Record<string, Record<string, { step: Step }[]>> } & Record<string, unknown>;

const configText = readFileSync(configPath, 'utf8');
const scriptText = readFileSync(scriptPath, 'utf8');
const config = yaml.load(configText) as Config;
const SHA = '0123456789abcdef0123456789abcdef01234567';

const TOP_LEVEL_KEYS = ['clone', 'definitions', 'export', 'image', 'labels', 'options', 'pipelines', 'triggers'];
const PIPELINE_KEYS = ['branches', 'custom', 'default', 'pull-requests', 'tags'];
const STEP_KEYS = ['after-script', 'artifacts', 'auth', 'caches', 'clone', 'concurrency-group', 'condition', 'custom', 'deployment', 'environment', 'fail-fast', 'image', 'input-variables', 'max-time', 'name', 'oidc', 'runs-on', 'runtime', 'script', 'services', 'size', 'trigger', 'type'];
const ARTIFACTS_KEYS = ['download', 'paths', 'upload'];
const UPLOAD_KEYS = ['capture-on', 'depth', 'ignore-paths', 'name', 'paths', 'type'];
// test-reporting-in-pipelines: "supported default locations (with a directory depth of 3 levels)".
const TEST_REPORT_DIRS = ['surefire-reports', 'failsafe-reports', 'test-results', 'test-reports', 'TestResults'];

const items = Object.values(config.pipelines['pull-requests'] ?? {}).flat();
const step = items[0]!.step;
const scanLine = step.script.find((line) => line.includes('integrations/bitbucket/a11ygate-scan.sh'))!;
const outDir = /out_dir="\$\{A11YGATE_OUT_DIR:-([^}]+)}"/.exec(scriptText)![1]!;

/** Bitbucket's default JUnit locations: `./**\/<dir>/**\/*.xml`, at most 3 directory levels below the clone dir. */
function autoReadAsTestReport(rel: string): boolean {
  const parts = rel.split('/');
  return rel.endsWith('.xml') && parts.length - 1 <= 3 && parts.slice(0, -1).some((p) => TEST_REPORT_DIRS.includes(p));
}

describe('integrations/bitbucket/bitbucket-pipelines.yml structure (documented keys)', () => {
  it('uses only documented top-level, pipeline, step and artifact keys', () => {
    for (const key of Object.keys(config)) expect(TOP_LEVEL_KEYS, key).toContain(key);
    for (const key of Object.keys(config.pipelines)) expect(PIPELINE_KEYS, key).toContain(key);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(Object.keys(item)).toEqual(['step']);
      for (const key of Object.keys(item.step)) expect(STEP_KEYS, key).toContain(key);
      expect(Array.isArray(item.step.script) && item.step.script.length > 0).toBe(true);
      for (const line of item.step.script) expect(typeof line).toBe('string');
      if (item.step['max-time'] !== undefined) expect(Number.isInteger(item.step['max-time']) && item.step['max-time'] > 0).toBe(true);
      const artifacts = item.step.artifacts!;
      for (const key of Object.keys(artifacts)) expect(ARTIFACTS_KEYS, key).toContain(key);
      for (const upload of artifacts.upload!) {
        for (const key of Object.keys(upload)) expect(UPLOAD_KEYS, key).toContain(key);
        expect(typeof upload.name).toBe('string');
        expect(upload.paths.length).toBeGreaterThan(0);
        if (upload.type !== undefined) expect(['shared', 'scoped', 'test-reports']).toContain(upload.type);
        if (upload['capture-on'] !== undefined) expect(['success', 'failed', 'always']).toContain(upload['capture-on']);
      }
    }
  });

  it('runs only for pull requests, in a Playwright Node + Chromium image matching the installed playwright', () => {
    expect(Object.keys(config.pipelines)).toEqual(['pull-requests']);
    expect(Object.keys(config.pipelines['pull-requests']!)).toEqual(['**']);
    const version = (createRequire(import.meta.url)('playwright/package.json') as { version: string }).version;
    expect(config.image).toBe(`mcr.microsoft.com/playwright:v${version}-noble`);
    expect(step.name).toMatch(/^A11yGate: /);
  });

  it('runs the checked-in scan script with a fail-on policy, and stores reports, SARIF and evidence on every outcome', () => {
    expect(scanLine).toBe('A11YGATE_FAIL_ON="${A11YGATE_FAIL_ON:-serious}" sh integrations/bitbucket/a11ygate-scan.sh');
    expect(step.script.indexOf(scanLine)).toBe(step.script.length - 1);
    expect(step.script.some((line) => /--hostname 127\.0\.0\.1 --port 3000 &$/.test(line))).toBe(true);
    const [upload] = step.artifacts!.upload!;
    expect(upload).toMatchObject({ 'capture-on': 'always', paths: [`${outDir}/**`] });
    expect(outDir).toBe('test-results/a11ygate');
    // JUnit lands where Bitbucket reads test reports automatically; the artifacts glob keeps everything else.
    expect(autoReadAsTestReport(`${outDir}/a11ygate-scan.junit.xml`)).toBe(true);
    expect(autoReadAsTestReport('a11y/a11ygate-scan.junit.xml')).toBe(false);
    expect(autoReadAsTestReport('a/b/c/test-results/x.xml')).toBe(false);
  });

  it('keeps the disclaimer, loopback-only URLs and no secrets', () => {
    for (const text of [configText, scriptText]) {
      expect(text).toContain(AUTOMATED_TESTING_DISCLAIMER);
      expect(text).not.toMatch(/example\.(com|org)|https?:\/\/(?!127\.0\.0\.1|support\.atlassian\.com\/bitbucket-cloud\/docs\/)/);
      expect(text).not.toMatch(/\bsecret|token|password|npm publish/i);
    }
  });
});

// --- The scan script, executed as the pipeline would run it -------------------------------------------------

const shell = existsSync('/bin/dash') ? '/bin/dash' : '/bin/sh'; // dash is /bin/sh in the Ubuntu-based image.

function listen(handler: RequestListener): Promise<{ server: Server; url: string }> {
  const server = createServer(handler);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    resolve({ server, url: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}` });
  }));
}

/** Prepare a clone-dir-like workspace: the integration files and node_modules linked in. */
async function workspace(prefix: string): Promise<string> {
  const cwd = await mkdtemp(path.join(tmpdir(), prefix));
  await symlink(path.join(repoRoot, 'node_modules'), path.join(cwd, 'node_modules'), 'dir');
  await symlink(path.join(repoRoot, 'integrations'), path.join(cwd, 'integrations'), 'dir');
  return cwd;
}

/** Run the YAML's own scan line through the shell, as Bitbucket would. */
function runLine(cwd: string, env: Record<string, string>, pathPrefix = ''): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(shell, ['-c', scanLine], {
      cwd, stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, PATH: `${pathPrefix}${process.env.PATH}`, npm_config_offline: 'true', npm_config_update_notifier: 'false', ...env },
    });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += String(d); });
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code, stderr }));
  });
}

describe('integrations/bitbucket/a11ygate-scan.sh with the CLI in-process (no drift, no outbound network)', () => {
  let guard: ReturnType<typeof blockNetwork>;
  let app: { server: Server; url: string };
  beforeEach(async () => {
    app = await listen((_, res) => res.end('ok'));
    guard = blockNetwork();
  });
  afterEach(async () => {
    guard.restore();
    expect(guard.attempts).toEqual([]);
    await new Promise((resolve) => app.server.close(resolve));
  });

  // An `npx` shim on PATH records each argv the script passes and exits with SHIM_EXIT for `scan`.
  // The test then runs that exact argv through the CLI entry points with a stub browser.
  async function capture(cwd: string, env: Record<string, string>) {
    const bin = path.join(cwd, '.bin');
    const argvDir = path.join(cwd, '.argv');
    await rm(argvDir, { recursive: true, force: true });
    await mkdir(argvDir, { recursive: true });
    await mkdir(bin, { recursive: true });
    await writeFile(path.join(bin, 'npx'), [
      '#!/bin/sh',
      'n=$(ls "$ARGV_DIR" | wc -l | tr -d " ")',
      'for a in "$@"; do printf "%s\\0" "$a"; done > "$ARGV_DIR/$n"',
      '[ "$3" = scan ] && exit "${SHIM_EXIT:-0}"',
      'exit 0',
    ].join('\n'));
    await chmod(path.join(bin, 'npx'), 0o755);
    const { code, stderr } = await runLine(cwd, { ARGV_DIR: argvDir, ...env }, `${bin}${path.delimiter}`);
    const files = (await readdir(argvDir)).sort((a, b) => Number(a) - Number(b));
    const calls = await Promise.all(files.map(async (f) => (await readFile(path.join(argvDir, f), 'utf8')).split('\0').slice(0, -1)));
    for (const argv of calls) expect(argv.slice(0, 2)).toEqual(['--no-install', 'a11ygate']);
    return { code, stderr, calls: calls.map((argv) => argv.slice(2)) };
  }

  it('applies fail-on and the optional baseline, packs evidence on failure, and writes what the artifacts step uploads', async () => {
    const url = app.url;
    const result = minimalResult({ url: `${url}/`, violations: [{ id: 'image-alt', impact: 'critical', tags: ['wcag111'], help: 'Images must have alternate text', helpUrl: '', nodes: [{ target: ['img'], html: '<img>' }] }] });
    const engine = async () => ({ visit: async () => ({ status: 200, finalUrl: `${url}/`, links: [], result }), close: async () => {} });
    const fetch = async () => ({ ok: true, status: 200, text: async () => '' });
    const cwd = await workspace('a11ygate-bitbucket-');
    try {
      const io = { cwd, stdout: () => {}, stderr: () => {}, now: () => new Date('2026-11-14T00:00:00Z'), version: '0.2.0' };
      const env = { A11YGATE_URL: url, BITBUCKET_COMMIT: SHA };
      for (const [failOn, expected] of [['serious', 1], ['critical', 1], ['none', 0]] as const) {
        await rm(path.join(cwd, 'test-results'), { recursive: true, force: true });
        const first = await capture(cwd, { ...env, A11YGATE_FAIL_ON: failOn, SHIM_EXIT: '0' });
        expect(first.code).toBe(0);
        expect(first.calls).toHaveLength(1); // No out dir yet, so no evidence pack.
        const [scanArgv] = first.calls;
        expect(scanArgv).toEqual(['scan', url, '--crawl', '1', '--fail-on', failOn, '--format', 'junit,sarif', '--out-dir', outDir]);
        const exit = await runScan(scanArgv!.slice(1), { ...io, engine, fetch });
        expect(exit, failOn).toBe(expected);
        // Same exit from the scan: the script still packs evidence, then reports that exit.
        const second = await capture(cwd, { ...env, A11YGATE_FAIL_ON: failOn, SHIM_EXIT: String(exit) });
        expect(second.code).toBe(expected);
        expect(second.calls[1]).toEqual(['evidence', 'pack', '--from', outDir, '--out', `${outDir}/a11ygate-evidence.zip`, '--commit', SHA]);
        const errs: string[] = [];
        expect(await runEvidence(second.calls[1]!.slice(1), { ...io, stderr: (s: string) => errs.push(s), gitHead: async () => null }), errs.join('')).toBe(0);
      }
      // Default policy from the YAML line is serious.
      expect((await capture(cwd, env)).calls[0]).toContain('serious');
      // Without BITBUCKET_COMMIT the pack falls back to git HEAD (no --commit flag).
      expect((await capture(cwd, { A11YGATE_URL: url, BITBUCKET_COMMIT: '' })).calls[1]).not.toContain('--commit');

      // Optional baseline: accept current findings, then the same findings no longer fail.
      expect(await runBaseline(['create', outDir], io)).toBe(0);
      const withBaseline = await capture(cwd, { ...env, A11YGATE_BASELINE: '.a11ygate-baseline.json' });
      expect(withBaseline.calls[0]!.slice(-2)).toEqual(['--baseline', '.a11ygate-baseline.json']);
      expect(await runScan(withBaseline.calls[0]!.slice(1), { ...io, engine, fetch })).toBe(0);

      // Setup errors exit 2 before the CLI runs.
      expect(await capture(cwd, { ...env, A11YGATE_BASELINE: 'missing.json' })).toMatchObject({ code: 2, calls: [], stderr: expect.stringContaining('Baseline file not found') });
      expect(await capture(cwd, { ...env, A11YGATE_FAIL_ON: 'blocker' })).toMatchObject({ code: 2, calls: [] });
      expect(await capture(cwd, { ...env, A11YGATE_URL: 'http://127.0.0.1:9', A11YGATE_WAIT_SECONDS: '1' })).toMatchObject({ code: 2, calls: [], stderr: expect.stringContaining('did not respond') });

      // Every file the artifacts glob is meant to keep exists; JUnit sits where Bitbucket reads it.
      const junit = `${outDir}/a11ygate-scan.junit.xml`;
      expect(autoReadAsTestReport(junit)).toBe(true);
      expect(await readFile(path.join(cwd, junit), 'utf8')).toContain('<testsuite');
      for (const file of ['a11ygate-scan.html', 'a11ygate-scan.json', 'a11ygate-scan.sarif', 'a11ygate-evidence.zip']) expect((await stat(path.join(cwd, outDir, file))).isFile(), file).toBe(true);
      expect(JSON.parse(await readFile(path.join(cwd, outDir, 'a11ygate-scan.sarif'), 'utf8')).version).toBe('2.1.0');
      const xml = (await readdir(path.join(cwd, outDir))).filter((f) => f.endsWith('.xml'));
      expect(xml, 'only JUnit is picked up as a test report').toEqual(['a11ygate-scan.junit.xml']);
    } finally { await rm(cwd, { recursive: true, force: true }); }
  }, 60_000);
});

const hasChromium = (() => { try { return existsSync(chromium.executablePath()); } catch { return false; } })();

describe.skipIf(!hasChromium)('integrations/bitbucket/a11ygate-scan.sh against the loopback fixture (real CLI and Chromium)', () => {
  it('fails on serious, passes with none and with a baseline, and leaves JUnit, SARIF, reports and evidence', async () => {
    const fixture = path.join(repoRoot, 'fixtures/scan-site');
    const requests: string[] = [];
    const { server, url } = await listen(async (req, res) => {
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
    const cwd = await workspace('a11ygate-bitbucket-shell-');
    try {
      for (const [failOn, expected] of [['serious', 1], ['none', 0]] as const) {
        const { code, stderr } = await runLine(cwd, { A11YGATE_URL: url, A11YGATE_FAIL_ON: failOn, BITBUCKET_COMMIT: SHA });
        expect(code, `${failOn}: ${stderr}`).toBe(expected);
        expect(await readFile(path.join(cwd, outDir, 'a11ygate-scan.junit.xml'), 'utf8')).toContain('<testsuite');
        expect(await readFile(path.join(cwd, outDir, 'a11ygate-scan.sarif'), 'utf8')).toContain('image-alt');
        expect((await stat(path.join(cwd, outDir, 'a11ygate-evidence.zip'))).size).toBeGreaterThan(0);
        expect((await stat(path.join(cwd, outDir, 'a11ygate-scan.html'))).isFile()).toBe(true);
      }
      expect(await runBaseline(['create', outDir], { cwd, stdout: () => {}, stderr: () => {}, now: () => new Date() })).toBe(0);
      expect((await runLine(cwd, { A11YGATE_URL: url, A11YGATE_BASELINE: '.a11ygate-baseline.json', BITBUCKET_COMMIT: SHA })).code).toBe(0);
      expect(requests).toContain('/');
      expect(requests).not.toContain('/private/secret.html');
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await rm(cwd, { recursive: true, force: true });
    }
  }, 240_000);
});

const CLAIM_RE = /fixes everything|WCAG\/EAA compliant|\bcompliant\b|\bcertified\b|\bguarantee/i;
const LINK_RE = /\[[^\]]*]\(([^)\s]+)\)/g;

describe.each([['docs/integrations/bitbucket.md', docPath], ['bitbucket-pipelines.yml', configPath], ['a11ygate-scan.sh', scriptPath]])('%s claims', (_, file) => {
  it('keeps the disclaimer and makes no compliance claims', () => {
    const text = readFileSync(file, 'utf8');
    expect(text).toContain(AUTOMATED_TESTING_DISCLAIMER);
    expect(text).not.toMatch(CLAIM_RE);
    expect(text).not.toMatch(/example\.(com|org)/);
  });
});

describe('docs/integrations/bitbucket.md', () => {
  const doc = readFileSync(docPath, 'utf8');

  it('passes the markdown link check', async () => {
    const hrefs = [...doc.matchAll(LINK_RE)].map((m) => m[1]!);
    expect(hrefs.length).toBeGreaterThan(5);
    const missing: string[] = [];
    for (const href of hrefs) {
      if (/^https?:\/\//.test(href)) { expect(href).toMatch(/^https:\/\//); continue; }
      const [file, anchor] = href.split('#');
      if (!file) {
        const slugs = [...doc.matchAll(/^#+ (.+)$/gm)].map((m) => m[1]!.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-'));
        if (!slugs.includes(anchor!)) missing.push(href);
        continue;
      }
      try { await stat(path.resolve(path.dirname(docPath), file)); } catch { missing.push(href); }
    }
    expect(missing, missing.join(', ')).toEqual([]);
  });

  it('cites the Bitbucket docs, links both files, records the validation gap, and uses loopback URLs only', () => {
    expect(doc).toContain('(../../integrations/bitbucket/bitbucket-pipelines.yml)');
    expect(doc).toContain('(../../integrations/bitbucket/a11ygate-scan.sh)');
    expect(doc).toContain('https://support.atlassian.com/bitbucket-cloud/docs/test-reporting-in-pipelines/');
    expect(doc).toContain('https://support.atlassian.com/bitbucket-cloud/docs/bitbucket-pipelines-configuration-reference/');
    expect(doc).toContain('./**/test-results/**/*.xml');
    expect(doc).toContain('No Bitbucket pipeline has run this config.');
    expect(doc).toMatch(/Docker/);
    for (const m of doc.matchAll(/http:\/\/[^\s)`'"]+/g)) expect(m[0]).toMatch(/^http:\/\/127\.0\.0\.1(:\d+)?/);
  });
});
