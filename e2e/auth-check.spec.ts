import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ScanReport } from '../lib/scan/report';
import { test, expect } from '@playwright/test';

const cli = path.resolve('packages/cli/dist/cli.mjs');
let origin: string;
let requests = 0;
let probeRequests = 0;
const server = createServer((req, res) => {
  const url = new URL(req.url!, origin);
  if (url.pathname === '/robots.txt') { res.writeHead(404).end(); return; }
  if (url.pathname === '/redirect') { res.writeHead(302, { location: '/login' }).end(); return; }
  if (url.pathname === '/denied') { res.writeHead(403, { 'content-type': 'text/html' }).end(); return; }
  if (url.pathname === '/probe') probeRequests++;
  let body = '<h1 id="member">Member</h1><input type="password">';
  if (url.pathname === '/login') body = '<h1 id="login">Login</h1>';
  if (url.pathname.startsWith('/expiry')) {
    requests++;
    body = req.headers.cookie?.includes('session=fixture') ? '<h1 id="member">Member</h1><a href="/expiry-next">Next</a><a href="/expiry-last">Last</a>' : '<h1 id="login">Login</h1>';
    if (requests === 1) res.setHeader('set-cookie', 'session=; Max-Age=0; Path=/');
  }
  res.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><html lang="en"><title>Auth check fixture</title><main>${body}</main></html>`);
});
test.beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });

async function scan(target: string, check?: Record<string, string>, extra = '') {
  const cwd = await mkdtemp(path.join(tmpdir(), 'a11ygate-check-'));
  try {
    await writeFile(path.join(cwd, '.a11ygate.yml'), `url: ${origin}${target}\nfailOn: none\ndelayMs: 0\n${extra}${check ? 'auth:\n  check:\n' + Object.entries(check).map(([key, value]) => `    ${key}: ${JSON.stringify(value)}\n`).join('') : ''}`);
    return await new Promise<{ code: number | null; report: ScanReport }>((resolve, reject) => {
      const child = spawn(process.execPath, [cli, 'scan', '--json', '-', ...(target === '/expiry' ? ['--cookie-env', 'session=FIXTURE_COOKIE'] : [])], { cwd, env: { ...process.env, FIXTURE_COOKIE: 'fixture' } });
      let out = ''; let err = '';
      child.stdout.on('data', chunk => { out += chunk; });
      child.stderr.on('data', chunk => { err += chunk; });
      child.once('error', reject);
      child.once('close', code => { try { resolve({ code, report: JSON.parse(out) }); } catch { reject(new Error(err)); } });
    });
  } finally { await rm(cwd, { recursive: true, force: true }); }
}

for (const [name, target, check, pass] of [
  ['required selector passes despite password heuristic', '/', { mustHaveSelector: '#member' }, true],
  ['required selector fails', '/', { mustHaveSelector: '#absent' }, false],
  ['forbidden selector passes', '/', { mustNotHaveSelector: '#login' }, true],
  ['forbidden selector fails', '/login', { mustNotHaveSelector: '#login' }, false],
  ['redirect check passes', '/', { mustNotRedirectTo: '/login' }, true],
  ['redirect check fails', '/redirect', { mustNotRedirectTo: '/login' }, false],
  ['probe passes once', '/', { url: '/probe' }, true],
  ['probe fails on HTTP denial', '/', { url: '/denied' }, false],
  ['probe selectors fail', '/', { url: '/login', mustHaveSelector: '#member' }, false],
  ['invalid selector fails closed', '/', { mustHaveSelector: '[' }, false],
] as [string, string, Record<string, string>, boolean][]) {
  test(name, async () => {
    const before = probeRequests;
    const { code, report } = await scan(target, check);
    expect(code).toBe(pass ? 0 : 2);
    expect(report.counts.pagesScanned).toBe(pass ? 1 : 0);
    expect(report.counts.pagesNotAuthenticated).toBe(pass ? 0 : 1);
    expect(report.counts.pagesFailed).toBe(0);
    expect(report.pages[0].scanStatus).toBe(pass ? 'complete' : 'not-authenticated');
    if (!pass) { expect(report.results).toEqual([]); expect(report.verdict).toBe('ERROR'); }
    if (check.url === '/probe') expect(probeRequests - before).toBe(1);
  });
}

test('cookie expires after N requests; later pages are separately counted and not scanned', async () => {
  requests = 0;
  const { code, report } = await scan('/expiry', { mustHaveSelector: '#member' }, 'crawl: 3\n');
  expect(code).toBe(2);
  expect(requests).toBe(3);
  expect(report.counts).toMatchObject({ pagesScanned: 1, pagesNotAuthenticated: 2, pagesFailed: 0 });
  expect(report.results).toHaveLength(1);
  expect(report.pages.slice(1).every((page: { scanStatus: string }) => page.scanStatus === 'not-authenticated')).toBe(true);
});

test('without auth.check the password heuristic and legacy report shape remain', async () => {
  const { code, report } = await scan('/');
  expect(code).toBe(2);
  expect(report.counts.pagesFailed).toBe(1);
  expect(report.counts).not.toHaveProperty('pagesNotAuthenticated');
  expect(report.pages[0].scanStatus).toBe('failed');
  expect(report.pages[0].error).toBe('Not authenticated: login page or access denied; protected content was not scanned.');
});
