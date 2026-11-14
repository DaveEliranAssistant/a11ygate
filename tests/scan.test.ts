import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAxeJson } from '@/lib/parse';
import { clampPages, crawl, type VisitOutcome } from '@/lib/scan/crawl';
import { buildScanReport, groupByCriterion, groupBySeverity, scanExitCode, scanHtml, scanMarkdown, type ScanFinding } from '@/lib/scan/report';
import { fetchRobots, isAllowedByRobots, parseRobots, robotsAllowsUrl, type FetchLike } from '@/lib/scan/robots';
import { classifyLink, isHtmlContentType, normalizeUrl, sameOrigin } from '@/lib/scan/url';
import type { AxeResults } from '@/lib/types';
import { parseScanArgs, runScan, ScanSetupError, INSTALL_HINT, type ScanEngineFactory } from '@/packages/cli/src/scan';
import { run } from '@/packages/cli/src/run';

const ORIGIN = 'https://site.test';

function axeResult(url: string, violations: AxeResults['violations'] = []): AxeResults {
  return { url, timestamp: '2026-11-12T10:00:00.000Z', testEngine: { version: '4.14.0' }, violations, toolOptions: {}, scanConfig: {}, scanStatus: 'complete' };
}

const IMAGE_ALT = { id: 'image-alt', impact: 'critical' as const, tags: ['wcag2a', 'wcag111'], help: 'Images must have alternative text', helpUrl: 'https://dequeuniversity.com/rules/axe/4.14/image-alt', nodes: [{ target: ['img'], html: '<img src="a.png">' }] };
const CONTRAST = { id: 'color-contrast', impact: 'serious' as const, tags: ['wcag2aa', 'wcag143'], help: 'Contrast', helpUrl: 'https://dequeuniversity.com/rules/axe/4.14/color-contrast', nodes: [{ target: ['p.faint'], html: '<p class="faint">x</p>' }] };
const REGION = { id: 'region', impact: 'moderate' as const, tags: ['best-practice'], help: 'Content in landmarks', helpUrl: 'https://dequeuniversity.com/rules/axe/4.14/region', nodes: [{ target: ['div'], html: '<div>' }] };
const LABEL = { id: 'label', impact: 'critical' as const, tags: ['wcag2a', 'wcag412', 'wcag131'], help: 'Form elements must have labels', helpUrl: 'https://dequeuniversity.com/rules/axe/4.14/label', nodes: [{ target: ['input'], html: '<input>' }] };

/** A fake site: each path maps to links and violations. */
function fakeSite(pages: Record<string, { links?: string[]; violations?: AxeResults['violations']; status?: number }>) {
  const visited: string[] = [];
  const visit = async (url: string): Promise<VisitOutcome> => {
    visited.push(url);
    const parsed = new URL(url);
    const page = pages[parsed.pathname + parsed.search];
    if (!page) return { status: 404, finalUrl: url, links: [], error: 'HTTP 404' };
    if (page.status && page.status >= 400) return { status: page.status, finalUrl: url, links: [], error: `HTTP ${page.status}` };
    return { status: 200, finalUrl: url, links: (page.links ?? []).map((l) => new URL(l, url).toString()), result: axeResult(url, page.violations ?? []) };
  };
  return { visit, visited };
}

describe('scan argument parsing', () => {
  it('parses the URL and defaults', () => {
    const parsed = parseScanArgs(['https://site.test/#x']);
    expect(parsed).toMatchObject({ ok: true, options: { url: 'https://site.test/', maxPages: 1, failOn: 'serious', delayMs: 1000 } });
  });

  it('parses every flag, including inline values', () => {
    const parsed = parseScanArgs(['https://site.test', '--crawl', '5', '--fail-on=critical', '--json', 'a.json', '--markdown', 'a.md', '--html', 'a.html', '--delay-ms', '250']);
    expect(parsed).toMatchObject({ ok: true, options: { maxPages: 5, failOn: 'critical', json: 'a.json', markdown: 'a.md', html: 'a.html', delayMs: 250 } });
    expect(parseScanArgs(['--out-dir', 'out', 'https://site.test', '--fail-on', 'none'])).toMatchObject({ ok: true, options: { outDir: 'out', failOn: 'none' } });
  });

  it('treats a bare --crawl as the cap and clamps above 20', () => {
    expect(parseScanArgs(['--crawl', 'https://site.test'])).toMatchObject({ ok: true, options: { maxPages: 20, url: 'https://site.test/' } });
    const big = parseScanArgs(['https://site.test', '--crawl=500']);
    expect(big).toMatchObject({ ok: true, options: { maxPages: 20 } });
    expect(big.ok && big.options.warnings[0]).toContain('hard maximum');
  });

  it('rejects bad input', () => {
    expect(parseScanArgs([])).toMatchObject({ ok: false });
    expect(parseScanArgs(['ftp://site.test'])).toMatchObject({ ok: false, error: expect.stringContaining('valid http(s) URL') });
    expect(parseScanArgs(['not a url'])).toMatchObject({ ok: false });
    expect(parseScanArgs(['https://a.test', 'https://b.test'])).toMatchObject({ ok: false });
    expect(parseScanArgs(['https://a.test', '--fail-on', 'high'])).toMatchObject({ ok: false, error: expect.stringContaining('--fail-on') });
    expect(parseScanArgs(['https://a.test', '--crawl=0'])).toMatchObject({ ok: false });
    expect(parseScanArgs(['https://a.test', '--delay-ms', '-5'])).toMatchObject({ ok: false });
    expect(parseScanArgs(['https://a.test', '--out-dir', 'o', '--json', 'a.json'])).toMatchObject({ ok: false, error: expect.stringContaining('--out-dir') });
    expect(parseScanArgs(['https://a.test', '--click'])).toMatchObject({ ok: false, error: expect.stringContaining('Unknown') });
  });
});

describe('URL normalisation and same-origin filtering', () => {
  it('normalises and strips hashes', () => {
    expect(normalizeUrl('https://Site.test/a#b')).toBe('https://site.test/a');
    expect(normalizeUrl('/b?q=1#c', 'https://site.test/a')).toBe('https://site.test/b?q=1');
    expect(normalizeUrl('mailto:x@y.z')).toBeNull();
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('https://user:pw@site.test/')).toBeNull();
    expect(sameOrigin('https://site.test/a', 'https://site.test/b')).toBe(true);
    expect(sameOrigin('https://site.test/a', 'http://site.test/a')).toBe(false);
    expect(sameOrigin('https://site.test/a', 'https://sub.site.test/a')).toBe(false);
  });

  it('classifies links', () => {
    const page = 'https://site.test/dir/page';
    expect(classifyLink('other', page, ORIGIN)).toEqual({ ok: true, url: 'https://site.test/dir/other' });
    expect(classifyLink('https://evil.test/', page, ORIGIN)).toMatchObject({ ok: false, reason: 'external' });
    expect(classifyLink('tel:+1', page, ORIGIN)).toMatchObject({ ok: false, reason: 'not-http' });
    expect(classifyLink('/files/a.PDF', page, ORIGIN)).toMatchObject({ ok: false, reason: 'non-html' });
    for (const href of ['/logout', '/account/sign-out', '/auth?action=logoff', '/signout/']) {
      expect(classifyLink(href, page, ORIGIN)).toMatchObject({ ok: false, reason: 'logout' });
    }
    expect(classifyLink('/blog/logging-out-of-habits', page, ORIGIN)).toMatchObject({ ok: true });
    expect(isHtmlContentType('text/html; charset=utf-8')).toBe(true);
    expect(isHtmlContentType('application/pdf')).toBe(false);
  });
});

describe('robots.txt', () => {
  const text = `# comment
User-agent: Googlebot
Disallow: /

User-agent: *
Disallow: /private/
Allow: /private/public.html
Disallow: /*.cgi$

User-agent: A11yGate
Disallow: /no-a11ygate
`;

  it('parses wildcard and A11yGate groups, ignoring other agents', () => {
    const robots = parseRobots(text);
    expect(isAllowedByRobots(robots, '/')).toBe(true);
    expect(isAllowedByRobots(robots, '/private/secret.html')).toBe(false);
    expect(isAllowedByRobots(robots, '/private/public.html')).toBe(true);
    expect(isAllowedByRobots(robots, '/run.cgi')).toBe(false);
    expect(isAllowedByRobots(robots, '/run.cgi?x')).toBe(true);
    expect(isAllowedByRobots(robots, '/no-a11ygate/page')).toBe(false);
    expect(robotsAllowsUrl(robots, 'https://site.test/private/x?y=1')).toBe(false);
  });

  it('treats empty Disallow and missing rules as allow-all', () => {
    expect(isAllowedByRobots(parseRobots('User-agent: *\nDisallow:\n'), '/anything')).toBe(true);
    expect(isAllowedByRobots(null, '/anything')).toBe(true);
    expect(isAllowedByRobots(parseRobots('User-agent: other\nDisallow: /\n'), '/x')).toBe(true);
  });

  it('fetches with the A11yGate user agent and proceeds when unreachable', async () => {
    const seen: string[] = [];
    const ok: FetchLike = async (url, init) => {
      seen.push(url + ' ' + init.headers['user-agent']);
      return { ok: true, status: 200, text: async () => 'User-agent: *\nDisallow: /x' };
    };
    const fetched = await fetchRobots(ORIGIN, 'A11yGate/test', ok);
    expect(seen).toEqual(['https://site.test/robots.txt A11yGate/test']);
    expect(isAllowedByRobots(fetched.rules, '/x/y')).toBe(false);

    const missing = await fetchRobots(ORIGIN, 'A11yGate', async () => ({ ok: false, status: 404, text: async () => '' }));
    expect(missing.rules).toBeNull();
    const down = await fetchRobots(ORIGIN, 'A11yGate', async () => { throw new Error('ECONNREFUSED'); });
    expect(down.rules).toBeNull();
    expect(down.note).toContain('unreachable');
  });
});

describe('crawl', () => {
  it('scans one page by default', async () => {
    const site = fakeSite({ '/': { links: ['/a'] }, '/a': {} });
    const result = await crawl({ startUrl: ORIGIN, maxPages: 1, delayMs: 0, robots: null, visit: site.visit });
    expect(site.visited).toEqual(['https://site.test/']);
    expect(result.pages).toHaveLength(1);
  });

  it('is breadth-first, same-origin, de-duplicated and respects robots', async () => {
    const site = fakeSite({
      '/': { links: ['/a', '/b#frag', 'https://other.test/x', 'mailto:a@b.c', '/private/p', '/a'] },
      '/a': { links: ['/a/deep', '/'] },
      '/b': { links: ['/b/deep'] },
      '/a/deep': {},
      '/b/deep': {},
      '/private/p': {},
    });
    const result = await crawl({ startUrl: ORIGIN, maxPages: 20, delayMs: 0, robots: parseRobots('User-agent: *\nDisallow: /private/'), visit: site.visit });
    expect(site.visited).toEqual(['https://site.test/', 'https://site.test/a', 'https://site.test/b', 'https://site.test/a/deep', 'https://site.test/b/deep']);
    expect(result.skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ url: 'https://other.test/x', reason: 'external' }),
      expect.objectContaining({ url: 'https://site.test/private/p', reason: 'robots' }),
    ]));
    expect(site.visited.every((u) => u.startsWith(ORIGIN + '/'))).toBe(true);
  });

  it('never visits more than 20 pages even when asked for more', async () => {
    const pages: Record<string, { links: string[] }> = {};
    for (let i = 0; i < 40; i += 1) pages[i === 0 ? '/' : `/p${i}`] = { links: Array.from({ length: 40 }, (_, j) => `/p${j + 1}`) };
    const site = fakeSite(pages);
    const result = await crawl({ startUrl: ORIGIN, maxPages: 100, delayMs: 0, robots: null, visit: site.visit });
    expect(site.visited).toHaveLength(20);
    expect(result.pages).toHaveLength(20);
    expect(result.skipped.some((s) => s.reason === 'cap')).toBe(true);
    expect(clampPages(100)).toBe(20);
    expect(clampPages(0)).toBe(1);
  });

  it('waits between page loads but not before the first', async () => {
    const site = fakeSite({ '/': { links: ['/a', '/b'] }, '/a': {}, '/b': {} });
    const sleeps: number[] = [];
    await crawl({ startUrl: ORIGIN, maxPages: 3, delayMs: 1000, robots: null, visit: site.visit, sleep: async (ms) => { sleeps.push(ms); } });
    expect(sleeps).toEqual([1000, 1000]);
  });

  it('does not analyse pages that redirect off-origin', async () => {
    const result = await crawl({
      startUrl: ORIGIN,
      maxPages: 2,
      delayMs: 0,
      robots: null,
      visit: async (url) => (url === `${ORIGIN}/` ? { status: 200, finalUrl: url, links: [`${ORIGIN}/out`], result: axeResult(url) } : { status: 200, finalUrl: 'https://elsewhere.test/', links: [] }),
    });
    expect(result.pages[1]).toMatchObject({ scanStatus: 'skipped' });
    expect(result.skipped).toContainEqual({ url: `${ORIGIN}/out`, reason: 'redirected-off-origin' });
  });
});

function report(failOn: 'serious' | 'critical' | 'minor' | 'none' = 'serious') {
  return buildScanReport({
    crawl: {
      pages: [
        { url: `${ORIGIN}/`, finalUrl: `${ORIGIN}/`, status: 200, scanStatus: 'complete', result: axeResult(`${ORIGIN}/`, [IMAGE_ALT, REGION]) },
        { url: `${ORIGIN}/about`, finalUrl: `${ORIGIN}/about`, status: 200, scanStatus: 'complete', result: axeResult(`${ORIGIN}/about`, [CONTRAST, LABEL]) },
        { url: `${ORIGIN}/gone`, finalUrl: `${ORIGIN}/gone`, status: 404, scanStatus: 'failed', error: 'HTTP 404' },
      ],
      skipped: [{ url: `${ORIGIN}/private/`, reason: 'robots' }],
    },
    version: '0.1.0',
    scannedAt: '2026-11-12T10:00:00.000Z',
    startUrl: `${ORIGIN}/`,
    failOn,
    maxPages: 20,
    delayMs: 1000,
    userAgent: 'A11yGate/test',
    robotsNote: 'robots.txt honoured.',
  });
}

describe('scan report', () => {
  it('preserves the pre-plugin axe-only report bytes for a local result fixture', () => {
    const r = report();
    expect(JSON.stringify(r, null, 2) + '\n').toMatchSnapshot('axe-only JSON');
    expect(scanMarkdown(r)).toMatchSnapshot('axe-only Markdown');
    expect(scanHtml(r)).toMatchSnapshot('axe-only HTML');
  });

  it('builds the machine-readable JSON with mapped WCAG criteria', () => {
    const r = report();
    expect(r).toMatchObject({ tool: 'a11ygate', kind: 'site-scan', version: '0.1.0', axeVersion: '4.14.0', startUrl: `${ORIGIN}/`, verdict: 'FAIL' });
    expect(r.pages.map((p) => [p.url, p.status, p.findings])).toEqual([[`${ORIGIN}/`, 200, 2], [`${ORIGIN}/about`, 200, 2], [`${ORIGIN}/gone`, 404, 0]]);
    const alt = r.findings.find((f) => f.ruleId === 'image-alt') as ScanFinding;
    expect(alt).toMatchObject({ pageUrl: `${ORIGIN}/`, selector: 'img', selectors: ['img'], impact: 'critical', helpUrl: IMAGE_ALT.helpUrl, bestPractice: false });
    expect(alt.wcag).toEqual([expect.objectContaining({ number: '1.1.1', level: 'A' })]);
    expect(r.findings.find((f) => f.ruleId === 'region')?.bestPractice).toBe(true);
    expect(r.counts).toMatchObject({ pagesScanned: 2, pagesFailed: 1, findings: 4, byImpact: { critical: 2, serious: 1, moderate: 1, minor: 0 } });
  });

  it('per-page results are valid input for the gate', () => {
    const parsed = parseAxeJson(JSON.stringify(report()));
    expect(parsed.ok && parsed.results.map((x) => x.url)).toEqual([`${ORIGIN}/`, `${ORIGIN}/about`]);
  });

  it('maps --fail-on to exit codes', () => {
    const findings = report().findings;
    expect(scanExitCode(findings, 'serious')).toBe(1);
    expect(scanExitCode(findings, 'critical')).toBe(1);
    expect(scanExitCode(findings, 'none')).toBe(0);
    const onlyModerate = findings.filter((f) => f.impact === 'moderate');
    expect(scanExitCode(onlyModerate, 'serious')).toBe(0);
    expect(scanExitCode(onlyModerate, 'moderate')).toBe(1);
    expect(scanExitCode([], 'minor')).toBe(0);
    expect(report('none').verdict).toBe('PASS');
  });

  it('groups by WCAG criterion (numeric order, best practice last) and by severity', () => {
    const r = report();
    const byCriterion = groupByCriterion(r.findings);
    expect(byCriterion.map((g) => g.key)).toEqual(['1.1.1', '1.3.1', '1.4.3', '4.1.2', 'best-practice']);
    expect(byCriterion.find((g) => g.key === '4.1.2')?.findings.map((f) => f.ruleId)).toEqual(['label']);
    const bySeverity = groupBySeverity(r.findings);
    expect(bySeverity.map((g) => [g.key, g.findings.length])).toEqual([['critical', 2], ['serious', 1], ['moderate', 1]]);
    expect(bySeverity[0]?.findings[0]).toHaveProperty('pageUrl');
  });

  it('renders Markdown and self-contained, escaped HTML', () => {
    const r = report();
    r.findings[0]!.selector = '<script>alert(1)</script>';
    const md = scanMarkdown(r);
    expect(md).toContain('**Verdict: FAIL**');
    expect(md).toContain('## Findings by WCAG criterion');
    expect(md).toContain('### WCAG 1.1.1 Non-text Content (A)');
    expect(md).toContain('disallowed by robots.txt');
    const html = scanHtml(r);
    expect(html).toContain('<html lang="en">');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toMatch(/<(?:link|img|iframe)\b/);
    expect(html).toContain(`${ORIGIN}/about`);
  });
});

describe('runScan with an injected engine', () => {
  const quiet = { stdout: () => undefined, stderr: () => undefined };
  const noRobots: FetchLike = async () => ({ ok: false, status: 404, text: async () => '' });

  function engineFor(pages: Parameters<typeof fakeSite>[0]): ScanEngineFactory {
    const site = fakeSite(pages);
    return async () => ({ visit: site.visit, close: async () => undefined });
  }

  it('prints an install hint and exits 2 when peer dependencies are missing', async () => {
    let err = '';
    const code = await runScan(['https://site.test'], { ...quiet, stderr: (c) => { err += c; }, fetch: noRobots, engine: async () => { throw new ScanSetupError(INSTALL_HINT); } });
    expect(code).toBe(2);
    expect(err).toContain('npm install --save-dev playwright @axe-core/playwright');
  });

  it('exits 2 when the start page is unreachable or disallowed, and on bad URLs', async () => {
    expect(await runScan(['https://site.test/missing'], { ...quiet, fetch: noRobots, engine: engineFor({}) })).toBe(2);
    const disallowAll: FetchLike = async () => ({ ok: true, status: 200, text: async () => 'User-agent: *\nDisallow: /' });
    expect(await runScan(['https://site.test/'], { ...quiet, fetch: disallowAll, engine: engineFor({ '/': {} }) })).toBe(2);
    expect(await runScan(['nope'], quiet)).toBe(2);
  });

  it('writes JSON/Markdown/HTML to --out-dir and applies --fail-on', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'a11ygate-scan-'));
    try {
      const pages = { '/': { links: ['/a'], violations: [CONTRAST] }, '/a': { violations: [REGION] } };
      const opts = { ...quiet, cwd: dir, fetch: noRobots, version: '9.9.9', sleep: async () => undefined };
      expect(await runScan([ORIGIN, '--crawl', '--out-dir', 'out'], { ...opts, engine: engineFor(pages) })).toBe(1);
      const json = JSON.parse(await readFile(path.join(dir, 'out/a11ygate-scan.json'), 'utf8'));
      expect(json).toMatchObject({ version: '9.9.9', counts: { pagesScanned: 2, findings: 2 } });
      expect(await readFile(path.join(dir, 'out/a11ygate-scan.md'), 'utf8')).toContain('color-contrast');
      expect(await readFile(path.join(dir, 'out/a11ygate-scan.html'), 'utf8')).toContain('<!doctype html>');
      expect(await runScan([ORIGIN, '--crawl', '--fail-on', 'critical'], { ...opts, engine: engineFor(pages) })).toBe(0);
      expect(await runScan([ORIGIN, '--crawl', '--fail-on', 'none'], { ...opts, engine: engineFor(pages) })).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('is reachable as the scan subcommand without changing gate mode', async () => {
    let out = '';
    expect(await run(['scan', '--help'], { stdout: (c) => { out += c; } })).toBe(0);
    expect(out).toContain('a11ygate scan <url>');
    let help = '';
    expect(await run(['--help'], { stdout: (c) => { help += c; } })).toBe(0);
    expect(help).toContain('a11ygate scan <url>');
  });
});
