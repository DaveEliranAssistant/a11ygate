import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';
import { describe, expect, it, vi } from 'vitest';
import pricing from '@/config/pricing.json';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { buildScanReport } from '@/lib/scan/report';
import type { AxeResults } from '@/lib/types';
import { isOwnProspectHost, runProspect } from '@/packages/cli/src/prospect';
import { run } from '@/packages/cli/src/run';
import { blockNetwork, guardLocalhostNetwork } from './network-guard';
import { pdfInfo } from './pdf-info';

const site = 'https://prospect.example/';
const scannedAt = '2026-11-14T10:00:00.000Z';
const result: AxeResults = {
  url: site, timestamp: scannedAt, testEngine: { version: '4.14.0' },
  violations: [
    { id: 'image-alt', impact: 'critical', tags: ['wcag111'], help: 'Images need text alternatives', helpUrl: '', nodes: [
      { target: ['img.hero'], html: '<img alt="PRIVATE IMAGE WORDING">' },
    ] },
    { id: 'label', impact: 'serious', tags: ['wcag332'], help: 'Inputs need labels', helpUrl: '', nodes: [
      { target: ['#email'], html: '<input aria-label="PRIVATE LABEL WORDING">' },
    ] },
  ],
};
const quiet = { stdout: () => {}, stderr: () => {} };
const htmlName = 'prospect-summary.html';
const pdfName = 'prospect-summary.pdf';
const manifestName = 'prospect-manifest.json';

async function inWorkDir(work: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(path.join(process.cwd(), '.prospect-test-'));
  try { await work(cwd); }
  finally { await rm(cwd, { recursive: true, force: true }); }
}

it('(c) refuses external URLs without both fields before any fetch or browser launch', async () => {
  const network = blockNetwork();
  const launch = vi.spyOn(chromium, 'launch').mockRejectedValue(new Error('Browser launch must not be attempted'));
  const engine = vi.fn();
  const stderr = vi.fn();
  try {
    for (const args of [[], ['--authorized-by', 'Eliran'], ['--authorization-note', 'Permission']]) {
      expect(await runProspect([site, ...args], { ...quiet, stderr, engine })).toBe(2);
    }
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('both --authorized-by and --authorization-note'));
    expect(network.attempts).toEqual([]);
    expect(engine).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  } finally {
    launch.mockRestore();
    network.restore();
  }
});

it('(c) uses exact hostnames and rejects embedded credentials', () => {
  for (const url of ['http://localhost:3000/', 'http://127.0.0.1/', 'http://[::1]/', 'https://a11ygate.vercel.app/', 'https://qe-atlas.vercel.app/']) {
    expect(isOwnProspectHost(url), url).toBe(true);
  }
  for (const url of [site, 'https://other.vercel.app/', 'https://sub.a11ygate.vercel.app/', 'http://localhost.invalid/', 'http://user@localhost/']) {
    expect(isOwnProspectHost(url), url).toBe(false);
  }
});

describe.skipIf(!existsSync(chromium.executablePath()))('prospect reports with local Chromium', () => {
  it('(a) scans the local site and makes both reports with scope, top issues and a disclaimer on every PDF page', async () => {
    const network = guardLocalhostNetwork();
    const hits: string[] = [];
    const siteRoot = path.resolve('fixtures/scan-site');
    const server = createServer(async (req, res) => {
      const route = new URL(req.url ?? '/', 'http://localhost').pathname;
      hits.push(`${req.method} ${route}`);
      const file = route === '/' ? '/index.html' : route;
      try {
        const bytes = await readFile(path.join(siteRoot, file));
        res.setHeader('content-type', file.endsWith('.html') ? 'text/html' : file.endsWith('.png') ? 'image/png' : 'text/plain');
        // Confirm browser-side POST and a same-origin redirect to a robots exclusion are blocked.
        if (route === '/') {
          res.end(String(bytes).replace('</body>', '<script>fetch("/write", {method:"POST"}).catch(()=>{});fetch("/jump").catch(()=>{});</script><a href="/redirect">Redirect</a></body>'));
        } else res.end(bytes);
      } catch {
        if (route === '/redirect' || route === '/jump') {
          res.writeHead(302, { location: route === '/redirect' ? '/private/secret.html' : `http://localhost:${(server.address() as { port: number }).port}/off-origin` }).end();
        } else res.writeHead(404).end();
      }
    });
    try {
      await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
      const address = server.address() as { port: number };
      await inWorkDir(async cwd => {
        await writeFile(path.join(cwd, '.a11ygate.yml'), 'ignoreRobots: true\nmaxPages: 1\n');
        const stderr = vi.fn();
        expect(await run(['prospect', `http://127.0.0.1:${address.port}/`, '--max-pages', '5'], { ...quiet, stderr, cwd }),
          JSON.stringify(stderr.mock.calls)).toBe(0);
        const html = await readFile(path.join(cwd, 'prospect-out', htmlName), 'utf8');
        const { pages } = await pdfInfo(await readFile(path.join(cwd, 'prospect-out', pdfName)));
        for (const text of ['Scan scope', 'axe-core', '4 page(s) scanned', 'image-alt', 'color-contrast', 'label', '1.1.1', 'What this means in CI']) {
          expect(html).toContain(text);
          expect(pages.join(' ')).toContain(text);
        }
        expect(pages.length).toBeGreaterThan(1);
        for (const page of pages) expect(page).toContain(AUTOMATED_TESTING_DISCLAIMER);
      });
      expect(hits).toEqual(expect.arrayContaining(['GET /robots.txt', 'GET /', 'GET /contact.html', 'GET /redirect', 'GET /jump']));
      expect(hits).not.toContain('GET /private/secret.html');
      expect(hits).not.toContain('POST /write');
      expect(hits).not.toContain('GET /off-origin');
      expect(network.attempts).toEqual([]);
    } finally {
      if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      network.restore();
    }
  }, 60_000);

  it('(b, d, e, f) matches the offline golden, stabilizes PDF bytes and only adds the configured offer on request', async () => {
    const network = blockNetwork();
    try {
      await inWorkDir(async cwd => {
        const report = buildScanReport({
          crawl: { pages: [{ url: site, finalUrl: site, status: 200, scanStatus: 'complete', result }], skipped: [] },
          version: '0.2.0', scannedAt, startUrl: site, failOn: 'serious', maxPages: 1, delayMs: 0,
          userAgent: 'A11yGate/test', robotsNote: 'robots.txt honoured.',
        });
        await writeFile(path.join(cwd, 'a11ygate-scan.json'), JSON.stringify(report));
        const io = { ...quiet, cwd };
        expect(await run(['prospect', '--from', '.'], io)).toBe(0);
        // Ensure the Chromium wall-clock metadata differs before normalization.
        await new Promise(resolve => setTimeout(resolve, 1100));
        expect(await run(['prospect', '--from=.', '--out-dir=repeat'], io)).toBe(0);
        for (const name of [htmlName, pdfName, manifestName]) {
          expect(await readFile(path.join(cwd, 'repeat', name))).toEqual(await readFile(path.join(cwd, 'prospect-out', name)));
        }
        const html = await readFile(path.join(cwd, 'prospect-out', htmlName), 'utf8');
        expect(html).toMatchSnapshot();
        expect(html).not.toMatch(/free pilot|\$\d+\/yr/i);
        expect(html).toContain('leave a TODO');
        expect(html).not.toMatch(/PRIVATE (IMAGE|LABEL) WORDING|<(img|input|label)\b|(?:alt|aria-label)=/i);
        expect(await run(['prospect', '.', '--out-dir', 'offer', '--offer'], io)).toBe(0);
        const offered = await readFile(path.join(cwd, 'offer', htmlName), 'utf8');
        expect(offered).toContain(`$${pricing.priceUsdPerYear.toLocaleString('en-US')}/yr`);
        expect(offered).toContain(`${pricing.pilot.lengthDays}-day free pilot`);
        for (const summary of [html, offered]) {
          expect(summary).not.toMatch(/fixes everything|\bcomplian(?:t|ce)\b|\bcertified\b|\bguarantee|\bconformant\b|lawsuit-proof/i);
        }
      });
      expect(network.attempts).toEqual([]);
    } finally { network.restore(); }
  }, 30_000);

  it('(c) records approval for an external URL with the scan transport stubbed', async () => {
    const network = blockNetwork();
    try {
      await inWorkDir(async cwd => {
        const fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
        const visit = vi.fn().mockResolvedValue({ status: 200, finalUrl: site, links: [], result });
        expect(await runProspect([site, '--authorized-by', 'Eliran', '--authorization-note', 'Approved scope <homepage>'], {
          ...quiet, cwd, fetch, now: () => new Date(scannedAt), engine: async () => ({ visit, close: async () => {} }),
        })).toBe(0);
        expect(fetch).toHaveBeenCalledWith(new URL('/robots.txt', site).href, expect.anything());
        expect(visit).toHaveBeenCalledTimes(1);
        const output = path.join(cwd, 'prospect-out');
        expect(JSON.parse(await readFile(path.join(output, manifestName), 'utf8'))).toMatchObject({
          startUrl: site, authorizedBy: 'Eliran', authorizationNote: 'Approved scope <homepage>',
        });
        expect(await readFile(path.join(output, htmlName), 'utf8')).toMatch(/<footer>\s*<p>Authorized by: Eliran<br>Authorization note: Approved scope &lt;homepage&gt;/);
        expect((await pdfInfo(await readFile(path.join(output, pdfName)))).pages.join(' ')).toContain('Authorization note: Approved scope <homepage>');
      });
      expect(network.attempts).toEqual([]);
    } finally { network.restore(); }
  }, 30_000);
});
