import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { clusterUrls, estimateMarkdown, estimateSite, estimateTime, runEstimate, type EstimateOptions } from '../packages/cli/src/estimate';
import axeBench from '../docs/perf/chromium-bench-axe-500.json';
import { guardLocalhostNetwork } from './network-guard';
// The existing performance fixture is JS used by npm run bench.
import { startFixture } from '../scripts/bench-chromium.mjs';

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
function options(url: string): EstimateOptions {
  return { url, maxPages: 20, maxDepth: 10, concurrency: 1, delayMs: 0, timeoutMs: 5000, engines: 'axe' };
}
async function fixture() {
  const hits: string[] = [];
  const server = createServer((req, res) => {
    const route = req.url!; hits.push(route);
    res.setHeader('content-type', 'text/html');
    if (route === '/robots.txt') return res.end('User-agent: *\nDisallow: /private\n');
    if (route === '/sitemap.xml') return res.end('<urlset><url><loc>/sitemap-only</loc></url><url><loc>/shared</loc></url><url><loc>/private</loc></url></urlset>');
    if (route === '/') return res.end('<a href="/crawl-only">crawl</a><a href="/shared">shared</a><a href="/private">private</a><a href="/protected">protected</a><a href="/offsite">offsite</a><a href="/blocked-redirect">blocked redirect</a>');
    if (route === '/protected') { res.writeHead(302, { location: '/login' }); return res.end(); }
    if (route === '/offsite') { res.writeHead(302, { location: 'https://external.invalid/login' }); return res.end(); }
    if (route === '/blocked-redirect') { res.writeHead(302, { location: '/private' }); return res.end(); }
    if (route === '/login') return res.end('<form><input type="password"></form><div id="app"></div><script type="module"></script>');
    return res.end('<p>fixture</p>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  return { url: `http://127.0.0.1:${address.port}/`, hits };
}

test('numeric URL patterns cluster /p/1 through /p/50 into one likely template', () => {
  const urls = Array.from({ length: 50 }, (_, i) => `http://localhost/p/${i + 1}`);
  expect(clusterUrls(urls)).toEqual([{ pattern: '/p/:id', pages: urls }]);
  expect(clusterUrls(['http://localhost/about', 'http://localhost/contact'])).toHaveLength(2);
});

test('sitemap and crawl union, login form/auth redirect, SPA heuristics, and robots exclusions', async () => {
  const guard = guardLocalhostNetwork(); cleanup.push(guard.restore);
  const { url, hits } = await fixture();
  const report = await estimateSite(options(url));
  expect(report.pages.map((p) => new URL(p.url).pathname)).toEqual(['/', '/sitemap-only', '/shared', '/crawl-only', '/protected', '/offsite', '/blocked-redirect']);
  expect(hits).not.toContain('/private');
  expect(report.robots.exclusions.map((s) => new URL(s.url).pathname)).toEqual(['/private']);
  expect(report.loginNeeded).toBe('likely');
  expect(report.signals.find((s) => s.url.endsWith('/protected'))).toMatchObject({ login: ['auth redirect', 'password login form'], spa: ['application root element', 'module script'] });
  expect(report.skipped.some((s) => s.reason === 'redirected-off-origin')).toBe(true);
  expect(guard.attempts).toEqual([]);
  const md = estimateMarkdown(report);
  expect(md).toContain('password login form');
  expect(md).toContain('robots');
  expect(md).toContain('Automated testing only. Not a WCAG audit, certification or legal advice.');
});

test('time quotes the exact recorded benchmark row and refuses unmatched configurations', () => {
  const estimate = estimateTime(50, 'axe', 2, 0);
  expect(estimate).toMatchObject({ source: 'docs/perf/chromium-bench-axe-500.json', rowIndex: 1, row: axeBench.runs[1], estimatedSeconds: 50 / 112.2 * 60 });
  expect(estimateTime(50, 'axe', 2, 1000).note).toBe('no benchmark for this configuration');
  expect(estimateTime(50, 'htmlcs', 1, 0).note).toBe('no benchmark for this configuration');
  expect(estimateTime(50, 'axe', 3, 0).note).toBe('no benchmark for this configuration');
  expect(estimateTime(50, 'lighthouse,ibm,htmlcs,axe', 4, 0)).toMatchObject({ source: 'docs/perf/chromium-bench-r47-all-40-followup.json', rowIndex: 0 });
  // Original all-engine concurrency 2 row recorded engine errors; never use it.
  expect(estimateTime(50, 'axe,htmlcs,ibm,lighthouse', 2, 0).note).toBe('no benchmark for this configuration');
});

test('CLI writes MD and JSON, enforces bounds and never loads scan engines', async () => {
  const guard = guardLocalhostNetwork(); cleanup.push(guard.restore);
  const { url } = await fixture();
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'estimate-')); cleanup.push(() => rm(cwd, { recursive: true, force: true }));
  let stdout = '';
  const io = { cwd, stdout: (s: string) => { stdout += s; }, stderr: () => {} };
  expect(await runEstimate([url, '--max-pages', '2', '--delay-ms', '0'], io)).toBe(0);
  const json = JSON.parse(await readFile(path.join(cwd, 'estimate-out/estimate.json'), 'utf8'));
  expect(json.pagesFound).toBe(2);
  expect(json.skipped.some((s: { reason: string }) => s.reason === 'cap')).toBe(true);
  expect(stdout).toBe(await readFile(path.join(cwd, 'estimate-out/estimate.md'), 'utf8'));
  expect(stdout).toContain('source row:');
  for (const args of [[url, '--max-pages', '1001'], [url, '--sitemap', 'https://external.invalid/sitemap.xml'], [url, '--engines', 'unknown'], [url, '--model-fixes', 'on']]) expect(await runEstimate(args, io)).toBe(2);
  expect(guard.attempts).toEqual([]);
});

test('500-page existing benchmark fixture completes crawl-only within two minutes', async () => {
  const guard = guardLocalhostNetwork(); cleanup.push(guard.restore);
  const { server, origin } = await startFixture(500);
  cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const started = performance.now();
  const report = await estimateSite({ ...options(origin + '/'), maxPages: 500, concurrency: 4 });
  const elapsedMs = performance.now() - started;
  expect(report.pagesFound).toBe(500);
  expect(report.pages.every((p) => p.scanStatus === 'complete')).toBe(true);
  expect(elapsedMs).toBeLessThan(120000);
  expect(guard.attempts).toEqual([]);
  console.info(`R55 existing 500-page fixture crawl-only: ${elapsedMs.toFixed(0)} ms; concurrency 4, delay 0ms.`);
}, 120000);
