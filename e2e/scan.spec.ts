import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { parseAxeJson } from '../lib/parse';
import { serveFixture, type FixtureServer } from './scan-server';

const repoRoot = path.resolve(__dirname, '..');
const cli = path.join(repoRoot, 'packages/cli/dist/cli.mjs');
const site = path.join(repoRoot, 'fixtures/scan-site');

type Report = {
  version: string;
  axeVersion: string;
  scannedAt: string;
  startUrl: string;
  verdict: string;
  pages: { url: string; status: number; findings: number }[];
  skipped: { url: string; reason: string }[];
  findings: { pageUrl: string; ruleId: string; selector: string; impact: string; helpUrl: string; wcag: { number: string }[] }[];
};

// The CLI must run asynchronously: the fixture server lives in this process.
function runCli(args: string[], executable = cli): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [executable, ...args], { cwd: repoRoot });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test.describe('a11ygate scan against a local fixture site', () => {
  test.describe.configure({ mode: 'serial', timeout: 120_000 });
  let server: FixtureServer;
  let dir: string;

  test.beforeAll(async () => {
    const built = spawnSync(process.execPath, [path.join(repoRoot, 'packages/cli/build.mjs')], { cwd: repoRoot, encoding: 'utf8' });
    expect(built.status, built.stderr).toBe(0);
    server = await serveFixture(site);
    dir = await mkdtemp(path.join(tmpdir(), 'a11ygate-scan-e2e-'));
  });

  test.afterAll(async () => {
    await server?.close();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  test('crawls same-origin pages, honours robots.txt and reports known issues', async () => {
    server.requests.length = 0;
    const out = path.join(dir, 'crawl');
    const result = await runCli(['scan', `${server.origin}/`, '--crawl', '--delay-ms', '0', '--out-dir', out]);
    expect(result.code, result.stderr).toBe(1);
    expect(result.stdout).toContain('**Verdict: FAIL**');

    const report = JSON.parse(await readFile(path.join(out, 'a11ygate-scan.json'), 'utf8')) as Report;
    expect(report.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(report.axeVersion).toMatch(/^\d+\.\d+/);
    expect(Date.parse(report.scannedAt)).not.toBeNaN();
    expect(report.startUrl).toBe(`${server.origin}/`);

    const pagePaths = report.pages.map((p) => new URL(p.url).pathname + new URL(p.url).search);
    expect(pagePaths).toEqual(['/', '/about.html', '/contact.html', '/products.html', '/about.html?ref=products']);
    expect(report.pages.every((p) => p.status === 200)).toBe(true);

    // Same origin only, and the robots.txt-disallowed page was never requested.
    expect(report.pages.every((p) => p.url.startsWith(server.origin))).toBe(true);
    expect(report.skipped).toContainEqual(expect.objectContaining({ url: 'https://external.example/page', reason: 'external' }));
    expect(report.skipped).toContainEqual(expect.objectContaining({ url: `${server.origin}/private/secret.html`, reason: 'robots' }));
    expect(report.skipped).toContainEqual(expect.objectContaining({ url: `${server.origin}/logout`, reason: 'logout' }));
    expect(server.requests.map((r) => r.path)).not.toContain('/private/secret.html');
    expect(server.requests.map((r) => r.path)).not.toContain('/logout');
    expect(server.requests[0]?.path).toBe('/robots.txt');
    expect(server.requests.every((r) => r.userAgent.includes('A11yGate'))).toBe(true);

    const find = (rule: string, page: string) => report.findings.find((f) => f.ruleId === rule && new URL(f.pageUrl).pathname === page);
    expect(find('image-alt', '/')).toMatchObject({ selector: 'img', impact: 'critical', wcag: [expect.objectContaining({ number: '1.1.1' })] });
    expect(find('color-contrast', '/about.html')).toMatchObject({ impact: 'serious', wcag: [expect.objectContaining({ number: '1.4.3' })] });
    expect(find('label', '/contact.html')).toMatchObject({ selector: 'input', helpUrl: expect.stringContaining('label') });
    expect(report.findings.some((f) => new URL(f.pageUrl).pathname === '/products.html')).toBe(false);

    const markdown = await readFile(path.join(out, 'a11ygate-scan.md'), 'utf8');
    expect(markdown).toContain('### WCAG 1.1.1 Non-text Content (A)');
    const html = await readFile(path.join(out, 'a11ygate-scan.html'), 'utf8');
    expect(html).toContain('Findings by WCAG criterion');
    expect(html).not.toContain('<script');

    // The JSON is valid --current input for the gate.
    const parsed = parseAxeJson(JSON.stringify(report));
    expect(parsed.ok && parsed.results.length).toBe(5);
    const gate = await runCli(['--current', path.join(out, 'a11ygate-scan.json')]);
    expect(gate.code, gate.stderr).toBe(1);
    expect(gate.stdout).toContain('Coverage: complete');
  });

  test('stops at the --crawl cap and scans one page by default', async () => {
    const capped = await runCli(['scan', `${server.origin}/`, '--crawl', '2', '--delay-ms', '0', '--json', '-']);
    const report = JSON.parse(capped.stdout) as Report;
    expect(report.pages).toHaveLength(2);
    expect(report.skipped.some((s) => s.reason === 'cap')).toBe(true);

    const single = await runCli(['scan', `${server.origin}/products.html`, '--json', '-']);
    expect(single.code, single.stderr).toBe(0);
    expect((JSON.parse(single.stdout) as Report).pages).toHaveLength(1);
    const explicit = await runCli(['scan', `${server.origin}/products.html`, '--engines', 'axe', '--json', '-']);
    expect(explicit.code, explicit.stderr).toBe(single.code);
    // Only run timestamps vary between these two local browser scans.
    const deterministic = (json: string) => JSON.stringify(JSON.parse(json), (key, value) =>
      key === 'timestamp' || key === 'scannedAt' ? '<timestamp>' : value);
    expect(deterministic(explicit.stdout)).toBe(deterministic(single.stdout));
    expect(explicit.stdout).not.toContain('"engine":');
    const unknown = await runCli(['scan', `${server.origin}/`, '--engines', 'pa11y']);
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain('axe,htmlcs,ibm,lighthouse');

  });

  test('opt-in engines share one visit and report their findings separately', async () => {
    server.requests.length = 0;
    const out = path.join(dir, 'engines');
    const result = await runCli(['scan', `${server.origin}/`, '--engines', 'axe,htmlcs,ibm,lighthouse', '--out-dir', out]);
    expect(result.code, result.stderr).toBe(1);
    const report = JSON.parse(await readFile(path.join(out, 'a11ygate-scan.json'), 'utf8'));
    expect(report.engineResults.map((e: { engine: string }) => e.engine)).toEqual(['axe', 'htmlcs', 'ibm', 'lighthouse']);
    for (const execution of report.engineResults) {
      expect(execution.status, execution.error).toBe('complete');
      expect(execution.findings.length).toBeGreaterThan(0);
    }
    expect(server.requests.filter((r) => r.path === '/')).toHaveLength(1);
    expect(result.stdout).toContain('Engine results (separate, not deduplicated)');
    const html = await readFile(path.join(out, 'a11ygate-scan.html'), 'utf8');
    expect(html).toContain('Engine results (separate, not deduplicated)');
    expect(html).not.toContain('<script');
    const only = await runCli(['scan', `${server.origin}/`, '--engines', 'ibm', '--json', '-']);
    expect(only.code, only.stderr).toBe(1);
    expect(JSON.parse(only.stdout).engineResults).toEqual([expect.objectContaining({ engine: 'ibm', status: 'complete' })]);
    expect(JSON.parse(only.stdout).results).toEqual([]);
  });

  test('missing selected peers are errored while an installed engine still reports', async () => {
    // Copy the real bundle outside the workspace so Node cannot find its peers
    // through the repository's node_modules. Only these two packages are supplied.
    const isolated = path.join(dir, 'isolated');
    await mkdir(path.join(isolated, 'node_modules'), { recursive: true });
    const executable = path.join(isolated, 'cli.mjs');
    await copyFile(cli, executable);
    for (const name of ['playwright', 'html_codesniffer']) {
      await symlink(path.join(repoRoot, 'node_modules', name), path.join(isolated, 'node_modules', name), 'dir');
    }
    const result = await runCli(['scan', `${server.origin}/`, '--engines', 'axe,htmlcs,ibm,lighthouse', '--json', '-'], executable);
    expect(result.code, result.stderr).toBe(2);
    const report = JSON.parse(result.stdout);
    expect(report.verdict).toBe('ERROR');
    expect(report.engineResults).toEqual([
      expect.objectContaining({ engine: 'axe', status: 'errored', error: expect.stringContaining('npm install') }),
      expect.objectContaining({ engine: 'htmlcs', status: 'complete', findings: expect.arrayContaining([expect.objectContaining({ engine: 'htmlcs' })]) }),
      expect.objectContaining({ engine: 'ibm', status: 'errored', error: expect.stringContaining('npm install') }),
      expect.objectContaining({ engine: 'lighthouse', status: 'errored', error: expect.stringContaining('npm install') }),
    ]);
  });

  test('exit codes follow --fail-on and errors exit 2', async () => {
    expect((await runCli(['scan', `${server.origin}/about.html`, '--fail-on', 'critical'])).code).toBe(0);
    expect((await runCli(['scan', `${server.origin}/about.html`, '--fail-on', 'serious'])).code).toBe(1);
    expect((await runCli(['scan', `${server.origin}/about.html`, '--fail-on', 'none'])).code).toBe(0);
    const missing = await runCli(['scan', `${server.origin}/does-not-exist.html`]);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('Start page could not be scanned');
    const disallowed = await runCli(['scan', `${server.origin}/private/secret.html`]);
    expect(disallowed.code).toBe(2);
    expect(disallowed.stderr).toContain('robots.txt');
    expect((await runCli(['scan', 'not-a-url'])).code).toBe(2);
  });
});
