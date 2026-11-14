import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crawl, matchesGlob, MAX_DISCOVERED_URLS, type CrawlOptions, type VisitOutcome } from '@/lib/scan/crawl';
import { fetchRobots, type FetchLike } from '@/lib/scan/robots';
import { fetchSitemap, fetchSiteText } from '@/lib/scan/sitemap';
import { scanHtmlV2 } from '@/lib/scan/report-html-v2';
import { buildScanReport, scanHtml, scanMarkdown } from '@/lib/scan/report';
import { validateConfig } from '@/packages/cli/src/config';
import { parseScanArgs, runScan, playwrightEngine } from '@/packages/cli/src/scan';
import { guardLocalhostNetwork } from './network-guard';

let server: Server;
let origin: string;
let redirectTarget = 'https://example.com/never';
let guard: ReturnType<typeof guardLocalhostNetwork>;
const hits: string[] = [];
const nativeFetch: FetchLike = (url, init) => fetch(url, init);

beforeAll(async () => {
  guard = guardLocalhostNetwork();
  server = createServer((req, res) => {
    const path = req.url!;
    hits.push(path);
    if (path === '/browser-redirect') { res.writeHead(302, { location: redirectTarget }); res.end(); return; }
    if (path === '/slow') return; // Cancellation must release this socket.
    if (path === '/robots.txt') { res.end('User-agent: *\nDisallow: /private'); return; }
    if (path === '/redirect.xml' || path === '/redirect-robots') { res.writeHead(302, { location: 'https://example.com/never' }); res.end(); return; }
    if (path === '/sitemap.xml') { res.end(`<?xml version="1.0"?><urlset><url><loc>${origin}/seed?a=1&amp;b=2</loc></url><url><loc>${origin}/private</loc></url><url><loc>https://example.com/no</loc></url></urlset>`); return; }
    if (path === '/index.xml') { res.end(`<sitemapindex><sitemap><loc>${origin}/sitemap.xml</loc></sitemap><sitemap><loc>${origin}/index.xml</loc></sitemap></sitemapindex>`); return; }
    if (path === '/large.xml') { res.end('x'.repeat(600_000)); return; }
    if (path === '/dtd.xml') { res.end('<!DOCTYPE urlset [<!ENTITY x "unsafe">]><urlset/>'); return; }
    if (path === '/flaky' && hits.filter((p) => p === '/flaky').length === 1) { req.socket.destroy(); return; }
    if (path === '/binary') { res.setHeader('content-type', 'application/octet-stream'); res.end('binary fixture'); return; }
    res.setHeader('content-type', 'text/html');
    if (path === '/') res.end('<a href="/a">a</a><a href="/private">private</a><a href="/excluded">exclude</a><a href="/slow">slow</a><a href="https://example.com/no">external</a>');
    else if (path === '/a') res.end('<a href="/deep">deep</a>');
    else if (path === '/generated') res.end(Array.from({ length: 499 }, (_, i) => `<a href="/generated/${i}">${i}</a>`).join(''));
    else if (path === '/spa') res.end('<script>history.pushState({}, "", "/spa-route");history.replaceState({}, "", "/spa-final")</script><a href="/anchor">anchor</a>');
    else res.end('<main>fixture</main>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  expect(guard.attempts).toEqual([]);
  guard.restore();
});

const visit: CrawlOptions['visit'] = async (url, collectLinks, signal): Promise<VisitOutcome> => {
  const response = await fetch(url, { signal, redirect: 'manual' });
  const html = await response.text();
  return { status: response.status, finalUrl: url, contentType: response.headers.get('content-type'), analysed: true,
    links: collectLinks ? [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!) : [] };
};
function options(extra: Partial<CrawlOptions> = {}): CrawlOptions {
  return { startUrl: origin, maxPages: 20, delayMs: 0, robots: null, visit, ...extra };
}

describe('local customer-site crawler limits', () => {
  it('caps pages without requesting the rest', async () => {
    const result = await crawl(options({ maxPages: 2, exclude: ['/slow'] }));
    expect(result.pages.map((p) => p.url)).toEqual([`${origin}/`, `${origin}/a`]);
    expect(result.skipped).toContainEqual({ url: `${origin}/private`, reason: 'cap' });
  });
  it('limits depth, excludes before visiting, and reports off-origin links', async () => {
    const before = hits.length;
    const result = await crawl(options({ maxDepth: 1, exclude: ['/slow', '/excluded', '/private'] }));
    expect(result.pages.map((p) => p.url)).toEqual([`${origin}/`, `${origin}/a`]);
    expect(result.skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ url: `${origin}/deep`, reason: 'depth' }),
      expect.objectContaining({ url: `${origin}/excluded`, reason: 'excluded' }),
      expect.objectContaining({ url: 'https://example.com/no', reason: 'external' }),
    ]));
    expect(hits.slice(before)).toEqual(['/', '/a']);
  });
  it('only visits included paths and classifies non-HTML responses as skipped', async () => {
    const before = hits.length;
    const included = await crawl(options({ include: ['/', '/a'] }));
    expect(hits.slice(before)).toEqual(['/', '/a']);
    expect(included.skipped).toContainEqual(expect.objectContaining({ url: `${origin}/deep`, reason: 'not-included' }));
    const binary = await crawl(options({ startUrl: `${origin}/binary` }));
    expect(binary.pages[0].scanStatus).toBe('skipped');
    expect(binary.skipped[0].reason).toBe('non-html');
  });
  it('honours fetched robots rules and never requests a disallowed URL', async () => {
    const robots = await fetchRobots(origin, 'A11yGate/test', nativeFetch);
    const before = hits.length;
    const result = await crawl(options({ robots: robots.rules, exclude: ['/slow'] }));
    expect(result.skipped).toContainEqual(expect.objectContaining({ url: `${origin}/private`, reason: 'robots' }));
    expect(hits.slice(before)).not.toContain('/private');
  });
  it('cancels a timed out page and reports its reason in all report formats', async () => {
    const before = performance.now();
    const result = await crawl(options({ startUrl: `${origin}/slow`, timeoutMs: 40 }));
    expect(performance.now() - before).toBeLessThan(2000);
    expect(result.pages[0]).toMatchObject({ scanStatus: 'skipped' });
    expect(result.skipped).toEqual([{ url: `${origin}/slow`, reason: 'timeout' }]);
    const report = buildScanReport({ crawl: result, version: 'test', scannedAt: '2026-11-14T00:00:00Z', startUrl: `${origin}/slow`, failOn: 'none', maxPages: 20, delayMs: 0, userAgent: 'test', robotsNote: 'test' });
    expect(scanMarkdown(report)).toContain('## Skipped pages');
    expect(scanHtml(report)).toContain('<h2>Skipped pages</h2>');
    expect(scanHtml(report)).toContain('timeout');
    expect(scanHtmlV2(report)).toContain('<h3>Skipped pages</h3>');
    expect(scanHtmlV2(report)).toContain('timeout');
  });
  it('retries once on a navigation error, including thrown network errors', async () => {
    let attempts = 0;
    const result = await crawl(options({ startUrl: `${origin}/flaky`, visit: async (...args) => { attempts++; return visit(...args); } }));
    expect(attempts).toBe(2);
    expect(result.pages[0].scanStatus).toBe('complete');
    attempts = 0;
    const failed = await crawl(options({ visit: async () => { attempts++; throw new Error('connection reset'); } }));
    expect(attempts).toBe(2);
    expect(failed.skipped[0].reason).toBe('navigation-error');
  });
  it('does not retry HTTP failures, authentication failures or analysis errors', async () => {
    for (const outcome of [
      { status: 503, error: 'HTTP 503' },
      { status: 401, error: 'Not authenticated: access denied' },
      { status: null, error: 'Analysis failed', navigationError: false },
    ]) {
      let calls = 0;
      const result = await crawl(options({ visit: async (url) => { calls++; return { ...outcome, finalUrl: url, links: [] }; } }));
      expect(calls).toBe(1);
      expect(result.pages[0].scanStatus).toBe('failed');
    }
  });
  it('keeps active workers bounded and paces all starts/retries globally', async () => {
    let active = 0;
    let peak = 0;
    const starts: number[] = [];
    const result = await crawl(options({ startUrl: `${origin}/generated`, pageLimit: 12, concurrency: 3, delayMs: 15,
      visit: async (...args) => {
        starts.push(performance.now()); active++; peak = Math.max(peak, active);
        try { await new Promise((r) => setTimeout(r, 45)); return await visit(...args); } finally { active--; }
      } }));
    expect(result.pages).toHaveLength(12);
    expect(peak).toBe(3);
    expect(starts.slice(1).every((t, i) => t - starts[i] >= 12)).toBe(true);
    expect(active).toBe(0);
  });
  it('scans a generated 500-page site within 15 seconds and records bounded peak RSS', async () => {
    const baseline = process.memoryUsage().rss;
    let peak = baseline;
    const sample = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 5);
    const started = performance.now();
    try {
      const result = await crawl(options({ startUrl: `${origin}/generated`, pageLimit: 500, concurrency: 4, timeoutMs: 2000 }));
      const elapsedMs = performance.now() - started;
      peak = Math.max(peak, process.memoryUsage().rss);
      console.info(JSON.stringify({ fixturePages: 500, pagesScanned: result.pages.length, elapsedMs: Math.round(elapsedMs), peakRssBytes: peak, rssGrowthBytes: peak - baseline }));
      expect(result.pages).toHaveLength(500);
      expect(result.skipped).toHaveLength(0);
      expect(elapsedMs).toBeLessThan(15_000);
      expect(peak - baseline).toBeLessThan(128 * 1024 * 1024);
    } finally { clearInterval(sample); }
  }, 20_000);
  it('bounds frontier and skipped records on adversarial link expansion', async () => {
    const result = await crawl(options({ maxPages: 2, visit: async (url) => ({ status: 200, finalUrl: url, analysed: true,
      links: Array.from({ length: 15000 }, (_, i) => `${origin}/fan/${url.endsWith('/') ? 'a' : 'b'}/${i}`) }) }));
    expect(result.pages).toHaveLength(2);
    expect(result.skipped.length).toBeLessThanOrEqual(MAX_DISCOVERED_URLS);
    expect(result.skipped.some((s) => s.reason === 'discovery-cap')).toBe(true);
  });
});

describe('sitemaps and filters', () => {
  it('reads sitemap XML/indexes, decodes XML entities, deduplicates cycles, filters every seed', async () => {
    const seeds = await fetchSitemap(`${origin}/index.xml`, origin, 'test', nativeFetch);
    expect(seeds).toContain(`${origin}/seed?a=1&b=2`);
    const result = await crawl(options({ startUrl: `${origin}/empty`, seedUrls: seeds, include: ['/empty', '/seed**'], exclude: ['/private'] }));
    expect(result.pages.map((p) => p.url)).toEqual([`${origin}/empty`, `${origin}/seed?a=1&b=2`]);
    expect(result.skipped).toContainEqual(expect.objectContaining({ reason: 'external' }));
    expect(result.skipped).toContainEqual(expect.objectContaining({ reason: 'excluded' }));
  });
  it('uses sitemap seeds through the CLI with filters, robots and explicit page budget', async () => {
    let output = '';
    const code = await runScan([`${origin}/empty`, '--sitemap=/index.xml', '--max-pages=3', '--max-depth=0', '--concurrency=2', '--delay-ms=0', '--json=-'], {
      engine: async () => ({ visit, close: async () => undefined }), stdout: (s) => { output += s; }, stderr: () => undefined,
    });
    expect(code).toBe(0);
    const report = JSON.parse(output);
    expect(report.pages.map((p: { url: string }) => p.url)).toEqual([`${origin}/empty`, `${origin}/seed?a=1&b=2`]);
    expect(report.skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'robots', url: `${origin}/private` }),
      expect.objectContaining({ reason: 'external' }),
    ]));
  });
  it('rejects external metadata redirects before making an external request, oversized XML and DTDs', async () => {
    await expect(fetchSitemap(`${origin}/redirect.xml`, origin, 'test', nativeFetch)).rejects.toThrow('same-origin');
    await expect(fetchSiteText(`${origin}/redirect-robots`, origin, 'test', nativeFetch)).rejects.toThrow('same-origin');
    await expect(fetchSitemap(`${origin}/large.xml`, origin, 'test', nativeFetch)).rejects.toThrow('512 KiB');
    await expect(fetchSitemap(`${origin}/dtd.xml`, origin, 'test', nativeFetch)).rejects.toThrow('Unsupported');
    await expect(fetchSitemap(`${origin}/slow`, origin, 'test', nativeFetch, 30)).rejects.toThrow();
  });
  it('supports documented globs with literal regex characters', () => {
    expect(matchesGlob(`${origin}/docs/a/b`, '/docs/**')).toBe(true);
    expect(matchesGlob(`${origin}/docs/a/b`, '/docs/*')).toBe(false);
    expect(matchesGlob(`${origin}/a.html`, '/?.html')).toBe(true);
    expect(matchesGlob(`${origin}/a+b`, '/a+b')).toBe(true);
    expect(matchesGlob(`${origin}/ab`, '/a+b')).toBe(false);
    expect(matchesGlob(`${origin}/a`, `${origin}/**`)).toBe(true);
  });
  it('keeps the repository config schema compatible with the crawler controls', () => {
    expect(validateConfig({ maxPages: 500, maxDepth: 0, timeoutMs: 50, concurrency: 4, sitemap: '/sitemap.xml', include: ['/**'], exclude: ['/private'], ignoreRobots: false })).toEqual([]);
    expect(validateConfig({ maxPages: 1001, maxDepth: -1, timeoutMs: 0, concurrency: 9 })).toHaveLength(4);
  });
  it('parses and validates explicit budgets and documents the robots opt-out', async () => {
    expect(parseScanArgs([origin, '--sitemap=/sitemap.xml'])).toMatchObject({ ok: true, options: { maxPages: 20 } });
    expect(parseScanArgs([origin, '--max-pages=500', '--max-depth=0', '--concurrency=4', '--timeout-ms=50', '--sitemap=/sitemap.xml', '--include=/**', '--exclude=/private', '--ignore-robots'])).toMatchObject({ ok: true, options: { maxPages: 500, pageLimit: 500, maxDepth: 0, concurrency: 4, timeoutMs: 50, ignoreRobots: true } });
    for (const flag of ['--max-pages=1001', '--max-depth=-1', '--concurrency=9', '--timeout-ms=0', '--sitemap=https://example.com/sitemap.xml']) expect(parseScanArgs([origin, flag]).ok).toBe(false);
    let report = '';
    const before = hits.length;
    expect(await runScan([`${origin}/private`, '--ignore-robots', '--json=-'], { engine: async () => ({ visit, close: async () => undefined }), stdout: (s) => { report += s; }, stderr: () => undefined })).toBe(0);
    expect(hits.slice(before)).toEqual(['/private']);
    expect(report).toContain('explicit --ignore-robots');
    expect(JSON.parse(report).boundaries.join(' ')).toContain('ignored by explicit opt-out');
    expect(JSON.parse(report).boundaries.join(' ')).not.toContain('rules were honoured');
  });
});

// Browser integration is deliberately opt-in: npm test never launches Chromium by default.
it.skipIf(process.env.A11YGATE_CRAWL_BROWSER_TESTS !== '1')('discovers runtime history routes without clicks and cancels browser pages', async () => {
  const engine = await playwrightEngine({ userAgent: 'A11yGate/test', origin, engines: [] });
  try {
    const result = await crawl(options({ startUrl: `${origin}/spa`, maxPages: 5, visit: engine.visit }));
    expect(result.pages.map((p) => p.url)).toContain(`${origin}/spa-route`);
    expect(result.pages.map((p) => p.url)).toContain(`${origin}/spa-final`);
    let externalHits = 0;
    const external = createServer((_req, res) => { externalHits++; res.end('off-origin'); });
    external.listen(0, '127.0.0.1');
    await once(external, 'listening');
    redirectTarget = `http://127.0.0.1:${(external.address() as import('node:net').AddressInfo).port}/outside`;
    try {
      const redirected = await crawl(options({ startUrl: `${origin}/browser-redirect`, visit: engine.visit }));
      expect(redirected.skipped[0].reason).toBe('redirected-off-origin');
      expect(externalHits).toBe(0);
    } finally {
      external.closeAllConnections();
      await new Promise<void>((resolve) => external.close(() => resolve()));
    }
    const timeout = await crawl(options({ startUrl: `${origin}/slow`, timeoutMs: 50, visit: engine.visit }));
    expect(timeout.skipped[0].reason).toBe('timeout');
  } finally { await engine.close(); }
});
