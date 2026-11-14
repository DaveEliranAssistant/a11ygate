import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { readZip } from '../lib/evidence/zip';
import { serveAuthFixture } from './auth-server';

const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'packages/cli/dist/cli.mjs');
let dir: string;
let secret: string;
let fixture: Awaited<ReturnType<typeof serveAuthFixture>>;

function run(args: string[], extra: Record<string, string> = {}) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: root, env: { ...process.env, ...extra } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
  });
}

async function assertRedacted(folder: string) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) await assertRedacted(file);
    else {
      const content = await readFile(file);
      // Boolean assertions never print a credential, even on failure. Inspect the
      // decompressed ZIP entries as well: searching compressed bytes is insufficient.
      const artifacts = [{ path: entry.name, data: content }, ...(entry.name.endsWith('.zip') ? readZip(content) : [])];
      for (const artifact of artifacts) for (const value of [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64')]) {
        expect(Buffer.from(artifact.data).includes(Buffer.from(value)), `credential absent from ${artifact.path}`).toBe(false);
      }
    }
  }
}

test.beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'a11ygate-auth-'));
  secret = randomBytes(24).toString('hex') + '+/fixture';
  fixture = await serveAuthFixture(secret);
});
test.afterAll(async () => {
  await fixture?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

test('unauthenticated redirect and HTTP denial are errors, with saved reports', async () => {
  for (const pathname of ['/protected', '/denied']) {
    const out = path.join(dir, `unauth-${pathname.slice(1)}`);
    const result = await run(['scan', fixture.origin + pathname, '--out-dir', out]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Not authenticated');
    const report = JSON.parse(await readFile(path.join(out, 'a11ygate-scan.json'), 'utf8'));
    expect(report.verdict).toBe('ERROR');
    expect(report.counts.pagesScanned).toBe(0);
    expect(report.pages[0].error).toContain('Not authenticated');
  }
});

for (const method of ['storage-state', 'login-script', 'cookie-env', 'header-env']) {
  test(`${method} scans protected content and redacts all outputs and the evidence pack`, async () => {
    const out = path.join(dir, `out-${method}`);
    let args: string[];
    let env: Record<string, string> = {};
    if (method === 'storage-state') {
      const file = path.join(dir, 'state.json');
      await writeFile(file, JSON.stringify({ cookies: [{ name: 'session', value: encodeURIComponent(secret), domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }], origins: [] }));
      args = ['--storage-state', file];
    } else if (method === 'login-script') {
      const file = path.join(dir, 'login.mjs');
      await writeFile(file, `export default async (page, env) => {
        console.log(env.TEST_AUTH_SECRET); console.error(env.TEST_AUTH_SECRET);
        await page.goto(${JSON.stringify(fixture.origin + '/login')});
        await page.getByLabel('Test password').fill(env.TEST_AUTH_SECRET);
        await Promise.all([page.waitForURL('**/protected'), page.getByRole('button', { name: 'Log in' }).click()]);
      };`);
      // Login must be allowed to replace an initially invalid injected session.
      args = ['--login-script', file, '--cookie-env', 'session=TEST_AUTH_INITIAL_COOKIE'];
      env = { TEST_AUTH_SECRET: secret, TEST_AUTH_INITIAL_COOKIE: 'not-authenticated' };
    } else if (method === 'cookie-env') { args = ['--cookie-env', 'session=TEST_AUTH_COOKIE']; env = { TEST_AUTH_COOKIE: encodeURIComponent(secret) }; }
    else { args = ['--header-env', 'Authorization=TEST_AUTH_HEADER']; env = { TEST_AUTH_HEADER: `Bearer ${secret}` }; }
    const result = await run(['scan', fixture.origin + '/protected', ...args, '--out-dir', out, '--format', 'junit,sarif,gitlab-codequality'], env);
    expect(result.code, 'protected page has a deliberate image-alt violation').toBe(1);
    const report = JSON.parse(await readFile(path.join(out, 'a11ygate-scan.json'), 'utf8'));
    expect(report.pages[0].finalUrl).toBe(fixture.origin + '/protected');
    expect(report.counts.pagesScanned).toBe(1);
    expect(report.boundaries.join(' ')).toContain('Authentication was explicitly configured');
    expect(report.boundaries.join(' ')).not.toContain('without logging in');
    expect(report.findings.some((f: { ruleId: string }) => f.ruleId === 'image-alt')).toBe(true);
    expect(JSON.stringify(report).includes('[REDACTED]')).toBe(true);
    await writeFile(path.join(out, 'scan.log'), result.stdout + result.stderr);
    const pack = await run(['evidence', 'pack', '--from', out]);
    expect(pack.code).toBe(0);
    await writeFile(path.join(out, 'pack.log'), pack.stdout + pack.stderr);
    const exported = path.join(out, 'exported');
    const reexport = await run(['report', out, '--out-dir', exported, '--format', 'junit,sarif,gitlab-codequality']);
    expect(reexport.code).toBe(1);
    await writeFile(path.join(out, 'report.log'), reexport.stdout + reexport.stderr);
    await assertRedacted(out);
  });
}

test('a later expired session makes the crawl ERROR even with --fail-on none', async () => {
  const result = await run(['scan', fixture.origin + '/protected', '--header-env', 'Authorization=TEST_AUTH_HEADER', '--crawl', '2', '--delay-ms', '0', '--fail-on', 'none', '--json', '-'], { TEST_AUTH_HEADER: `Bearer ${secret}` });
  expect(result.code).toBe(2);
  const report = JSON.parse(result.stdout);
  expect(report.verdict).toBe('ERROR');
  expect(report.pages[1].error).toContain('Not authenticated');
});

test('login failures and CPU-bound scripts have bounded, secret-free diagnostics', async () => {
  for (const [name, body, expected] of [
    ['throw', 'console.log(env.TEST_AUTH_SECRET); throw new Error(env.TEST_AUTH_SECRET)', 'Login script failed'],
    ['pending', 'await new Promise(() => {})', 'Login script timed out'],
    ['loop', 'while (true) {}', 'Login script timed out'],
    ['import', '', 'Login script timed out'],
  ]) {
    const file = path.join(dir, `${name}.mjs`);
    await writeFile(file, name === 'import' ? 'while (true) {}' : `export default async (page, env) => { ${body} };`);
    const result = await run(['scan', fixture.origin + '/protected', '--login-script', file, '--login-timeout-ms', name === 'throw' ? '5000' : '1500'], { TEST_AUTH_SECRET: secret });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(expected);
    expect((result.stdout + result.stderr).includes(secret)).toBe(false);
  }
});


test('injected headers never follow a redirect to another origin', async () => {
  let leaked = false;
  let received = false;
  const other = createServer((req, res) => {
    received = true;
    leaked ||= Object.values(req.headers).some(value => String(value).includes(secret));
    res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>Other origin</title><h1>Other origin</h1>');
  });
  await new Promise<void>(resolve => other.listen(0, '127.0.0.1', resolve));
  try {
    const target = `http://127.0.0.1:${(other.address() as AddressInfo).port}/`;
    const result = await run(['scan', fixture.origin + '/redirect?to=' + encodeURIComponent(target), '--header-env', 'X-Session=TEST_HEADER', '--json', '-'], { TEST_HEADER: secret });
    expect(result.code).toBe(2);
    expect(received).toBe(true);
    expect(leaked, 'headers must be scoped to the scan origin across redirects').toBe(false);
  } finally { await new Promise<void>((resolve, reject) => other.close(error => error ? reject(error) : resolve())); }
});
