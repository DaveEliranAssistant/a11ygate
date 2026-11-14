import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { runEvidence } from '@/packages/cli/src/evidence';
import { runScan } from '@/packages/cli/src/scan';
import { minimalResult } from './helpers';
import { blockNetwork } from './network-guard';

// Task names and inputs were authored from Microsoft's task reference pages, cited in the template:
//   https://learn.microsoft.com/en-us/azure/devops/pipelines/tasks/reference/node-tool-v0
//   https://learn.microsoft.com/en-us/azure/devops/pipelines/tasks/reference/publish-test-results-v2
//   https://learn.microsoft.com/en-us/azure/devops/pipelines/tasks/reference/publish-build-artifacts-v1
//   https://learn.microsoft.com/en-us/azure/devops/pipelines/process/templates
// This checks the documented subset; it does not replace Azure DevOps template validation.
// No Azure DevOps organization is contacted: everything below runs locally.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const templatePath = path.join(repoRoot, 'integrations/azure-devops/a11ygate.yml');
const docPath = path.join(repoRoot, 'docs/integrations/azure-devops.md');
const yaml = createRequire(import.meta.url)('js-yaml') as { load: (text: string) => unknown };

type Step = { task?: string; script?: string; name?: string; displayName?: string; condition?: string; inputs?: Record<string, unknown> } & Record<string, unknown>;
type Param = { name: string; type: string; default: unknown; values?: string[] };
type Template = { parameters: Param[]; steps: Step[] };

const templateText = readFileSync(templatePath, 'utf8');
const template = yaml.load(templateText) as Template;
const defaults = Object.fromEntries(template.parameters.map((p) => [p.name, p.default])) as Record<string, unknown>;
const SHA = '0123456789abcdef0123456789abcdef01234567';

/** Expand the subset of Azure template syntax the template uses: `${{ parameters.x }}`, `${{ if eq(parameters.x, true) }}` and `$(Build.SourceVersion)`. */
function render(value: string, params: Record<string, unknown> = {}): string {
  const merged = { ...defaults, ...params };
  const out = value
    .replace(/\$\{\{\s*parameters\.(\w+)\s*\}\}/g, (_, name: string) => {
      if (!(name in merged)) throw new Error(`Unknown parameter ${name}`);
      return String(merged[name]);
    })
    .replace(/\$\(Build\.SourceVersion\)/g, SHA);
  expect(out).not.toMatch(/\$\{\{|\$\(/);
  return out;
}
function steps(params: Record<string, unknown> = {}): Step[] {
  const merged = { ...defaults, ...params };
  return template.steps.flatMap((step) => {
    const keys = Object.keys(step);
    const conditional = keys.find((k) => k.startsWith('${{ if'));
    if (!conditional) return [step];
    const match = /^\$\{\{ if eq\(parameters\.(\w+), true\) \}\}$/.exec(conditional);
    expect(match, conditional).not.toBeNull();
    return merged[match![1]!] === true ? (step[conditional] as Step[]) : [];
  });
}
function stepNamed(name: string): Step {
  const step = template.steps.find((s) => s.name === name);
  expect(step, name).toBeDefined();
  return step!;
}
/**
 * Split a rendered step script into argv. The script must avoid every character that
 * bash and cmd.exe treat differently, so the same line runs identically on Linux and Windows agents.
 */
function argvOf(script: string): string[] {
  expect(script).not.toMatch(/[\n&|;<>`%^'\\]/);
  const argv = [...script.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]!);
  expect(argv.slice(0, 3)).toEqual(['npx', '--no-install', 'a11ygate']);
  return argv.slice(3);
}

describe('integrations/azure-devops/a11ygate.yml structure', () => {
  it('declares typed parameters with a loopback default URL and the documented fail-on values', () => {
    expect(template.parameters).toEqual([
      { name: 'url', type: 'string', default: 'http://127.0.0.1:3000' },
      { name: 'failOn', type: 'string', default: 'serious', values: ['minor', 'moderate', 'serious', 'critical', 'none'] },
      { name: 'crawl', type: 'number', default: 1 },
      { name: 'outDir', type: 'string', default: 'a11y' },
      { name: 'nodeVersion', type: 'string', default: '22.x' },
      { name: 'installCommand', type: 'string', default: 'npm ci' },
      { name: 'installBrowsers', type: 'boolean', default: true },
      { name: 'artifactName', type: 'string', default: 'a11ygate' },
    ]);
    expect(templateText).toContain(AUTOMATED_TESTING_DISCLAIMER);
    expect(templateText).not.toMatch(/example\.(com|org)|https?:\/\/(?!127\.0\.0\.1|learn\.microsoft\.com|marketplace\.visualstudio\.com)/);
  });

  it('uses Microsoft task names and input names exactly as documented', () => {
    const all = steps();
    expect(all.map((s) => s.task ?? 'script')).toEqual([
      'NodeTool@0', 'script', 'script', 'script', 'script', 'PublishTestResults@2', 'PublishBuildArtifacts@1', 'PublishBuildArtifacts@1',
    ]);
    expect(steps({ installBrowsers: false })).toHaveLength(7);
    expect(all[0]!.inputs).toEqual({ versionSource: 'spec', versionSpec: '${{ parameters.nodeVersion }}' });
    expect(all[1]!.script).toBe('${{ parameters.installCommand }}');
    expect(all[2]!.script).toBe('npx --no-install playwright install --with-deps chromium');
    const junit = all[5]!;
    expect(junit.condition).toBe('succeededOrFailed()');
    expect(junit.inputs).toEqual({
      testResultsFormat: 'JUnit',
      testResultsFiles: '${{ parameters.outDir }}/a11ygate-scan.junit.xml',
      searchFolder: '$(System.DefaultWorkingDirectory)',
      testRunTitle: 'A11yGate',
      failTaskOnFailedTests: false,
    });
    expect(all[6]!.inputs).toEqual({ PathtoPublish: '${{ parameters.outDir }}', ArtifactName: '${{ parameters.artifactName }}', publishLocation: 'Container' });
    // The SARIF SAST Scans Tab reads *.sarif from an artifact named CodeAnalysisLogs.
    expect(all[7]!.inputs).toEqual({ PathtoPublish: '${{ parameters.outDir }}/a11ygate-scan.sarif', ArtifactName: 'CodeAnalysisLogs', publishLocation: 'Container' });
    for (const step of all.slice(4)) expect(step.condition).toBe('succeededOrFailed()');
    // The scan step keeps the default condition and no continueOnError, so its exit code is the fail-on policy.
    const scan = stepNamed('a11ygateScan');
    expect(scan.condition).toBeUndefined();
    expect(scan.continueOnError).toBeUndefined();
    for (const url of [
      'https://learn.microsoft.com/en-us/azure/devops/pipelines/tasks/reference/node-tool-v0',
      'https://learn.microsoft.com/en-us/azure/devops/pipelines/tasks/reference/publish-test-results-v2',
      'https://learn.microsoft.com/en-us/azure/devops/pipelines/tasks/reference/publish-build-artifacts-v1',
      'https://marketplace.visualstudio.com/items?itemName=sariftools.scans',
    ]) expect(templateText).toContain(url);
  });
});

describe('template step scripts executed in-process (no drift, no network)', () => {
  let guard: ReturnType<typeof blockNetwork>;
  beforeEach(() => { guard = blockNetwork(); });
  afterEach(() => { guard.restore(); expect(guard.attempts).toEqual([]); });

  it('runs the exact scan and evidence-pack commands and writes every file the publish steps reference', async () => {
    const url = 'http://127.0.0.1:3000/';
    const result = minimalResult({ url, violations: [{ id: 'image-alt', impact: 'critical', tags: ['wcag111'], help: 'Images must have alternate text', helpUrl: '', nodes: [{ target: ['img'], html: '<img>' }] }] });
    const engine = async () => ({ visit: async () => ({ status: 200, finalUrl: url, links: [], result }), close: async () => {} });
    const fetch = async () => ({ ok: true, status: 200, text: async () => '' });
    for (const [failOn, expected] of [['serious', 1], ['critical', 1], ['none', 0]] as const) {
      const cwd = await mkdtemp(path.join(tmpdir(), 'a11ygate-azure-'));
      try {
        const io = { cwd, stdout: () => {}, stderr: () => {}, now: () => new Date('2026-11-14T00:00:00Z'), version: '0.2.0' };
        const scanArgv = argvOf(render(stepNamed('a11ygateScan').script!, { failOn }));
        expect(scanArgv[0]).toBe('scan');
        expect(await runScan(scanArgv.slice(1), { ...io, engine, fetch }), failOn).toBe(expected);
        const packArgv = argvOf(render(stepNamed('a11ygateEvidence').script!));
        expect(packArgv.slice(0, 2)).toEqual(['evidence', 'pack']);
        const errs: string[] = [];
        expect(await runEvidence(packArgv.slice(1), { ...io, stderr: (s: string) => errs.push(s), gitHead: async () => null }), errs.join('')).toBe(0);
        const published = steps().filter((s) => s.task?.startsWith('Publish'));
        const junit = path.join(cwd, render(published[0]!.inputs!.testResultsFiles as string));
        expect(await readFile(junit, 'utf8')).toContain('<testsuite');
        const artifactDir = path.join(cwd, render(published[1]!.inputs!.PathtoPublish as string));
        for (const file of ['a11ygate-scan.html', 'a11ygate-scan.json', 'a11ygate-evidence.zip']) expect((await stat(path.join(artifactDir, file))).isFile(), file).toBe(true);
        const sarif = JSON.parse(await readFile(path.join(cwd, render(published[2]!.inputs!.PathtoPublish as string)), 'utf8'));
        expect(sarif.version).toBe('2.1.0');
        expect(JSON.stringify(sarif)).toContain('image-alt');
      } finally { await rm(cwd, { recursive: true, force: true }); }
    }
  });

  it('rejects rendered scripts whose characters bash and cmd.exe would treat differently', () => {
    expect(() => argvOf(render(stepNamed('a11ygateScan').script!, { url: 'http://127.0.0.1:3000/?a=1&b=2' }))).toThrow();
  });
});

const hasChromium = (() => { try { return existsSync(chromium.executablePath()); } catch { return false; } })();

describe.skipIf(!hasChromium)('template step scripts executed by a real shell against the loopback fixture', () => {
  it('fails on serious, passes on none, and packs evidence', async () => {
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
    const cwd = await mkdtemp(path.join(tmpdir(), 'a11ygate-azure-shell-'));
    const sh = (script: string) => new Promise<number | null>((resolve, reject) => {
      const child = spawn('/bin/sh', ['-c', script], { cwd, stdio: 'ignore', env: { ...process.env, npm_config_offline: 'true', npm_config_update_notifier: 'false' } });
      child.once('error', reject);
      child.once('exit', resolve);
    });
    try {
      await symlink(path.join(repoRoot, 'node_modules'), path.join(cwd, 'node_modules'), 'dir');
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
      for (const [failOn, expected] of [['serious', 1], ['none', 0]] as const) {
        expect(await sh(render(stepNamed('a11ygateScan').script!, { url, failOn })), failOn).toBe(expected);
        expect(await sh(render(stepNamed('a11ygateEvidence').script!))).toBe(0);
        expect(await readFile(path.join(cwd, 'a11y/a11ygate-scan.junit.xml'), 'utf8')).toContain('<testsuite');
        expect(JSON.stringify(JSON.parse(await readFile(path.join(cwd, 'a11y/a11ygate-scan.sarif'), 'utf8')))).toContain('image-alt');
        expect((await stat(path.join(cwd, 'a11y/a11ygate-evidence.zip'))).size).toBeGreaterThan(0);
        expect((await stat(path.join(cwd, 'a11y/a11ygate-scan.html'))).isFile()).toBe(true);
      }
      expect(requests).toContain('/');
      expect(requests).not.toContain('/private/secret.html');
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await rm(cwd, { recursive: true, force: true });
    }
  }, 180_000);
});

const CLAIM_RE = /fixes everything|WCAG\/EAA compliant|\bcompliant\b|\bcertified\b|\bguarantee/i;
const LINK_RE = /\[[^\]]*]\(([^)]+)\)/g;

describe('docs/integrations/azure-devops.md', () => {
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

  it('cites the Microsoft and SARIF Scans Tab sources and links the template file', () => {
    for (const url of [
      'https://learn.microsoft.com/en-us/azure/devops/pipelines/tasks/reference/node-tool-v0',
      'https://learn.microsoft.com/en-us/azure/devops/pipelines/tasks/reference/publish-test-results-v2',
      'https://learn.microsoft.com/en-us/azure/devops/pipelines/tasks/reference/publish-build-artifacts-v1',
      'https://learn.microsoft.com/en-us/azure/devops/pipelines/process/templates',
      'https://learn.microsoft.com/en-us/azure/devops/pipelines/scripts/cross-platform-scripting',
      'https://marketplace.visualstudio.com/items?itemName=sariftools.scans',
    ]) expect(doc).toContain(`(${url})`);
    expect(doc).toContain('(../../integrations/azure-devops/a11ygate.yml)');
    expect(doc).toContain('CodeAnalysisLogs');
  });

  it('keeps the disclaimer, scans only loopback examples, and makes no compliance claims', () => {
    expect(doc).toContain(AUTOMATED_TESTING_DISCLAIMER);
    expect(doc).not.toMatch(CLAIM_RE);
    expect(doc).not.toMatch(/example\.(com|org)/);
    for (const m of doc.matchAll(/url: '([^']+)'/g)) expect(m[1]).toMatch(/^http:\/\/127\.0\.0\.1:\d+/);
  });
});
