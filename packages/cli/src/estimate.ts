import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { crawl } from '@/lib/scan/crawl';
import { fetchRobots, robotsAllowsUrl, type FetchLike } from '@/lib/scan/robots';
import { fetchSitemap } from '@/lib/scan/sitemap';
import { isHtmlContentType, normalizeUrl } from '@/lib/scan/url';
import axeBench from '../../../docs/perf/chromium-bench-axe-500.json';
import allBench from '../../../docs/perf/chromium-bench-all-40.json';
import followup from '../../../docs/perf/chromium-bench-r47-all-40-followup.json';
import { assertSafeOutputs } from './output-paths';
import type { RunIo } from './run';

const DISCLAIMER = 'Automated testing only. Not a WCAG audit, certification or legal advice.';
const NO_BENCHMARK = 'no benchmark for this configuration';
const AGENT = 'A11yGate estimate (crawl-only)';
const LOGIN = /(?:^|\/)(?:login|log-in|signin|sign-in|sso|oauth|authorize)(?:[/.]|$)/i;

export function clusterUrls(urls: string[]) {
  const groups = new Map<string, string[]>();
  for (const url of urls) {
    const pattern = new URL(url).pathname.split('/').map((s) => /^(?:\d+|[\da-f]{8}-[\da-f-]{27,})$/i.test(s) ? ':id' : s).join('/');
    groups.set(pattern, [...(groups.get(pattern) ?? []), url]);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([pattern, pages]) => ({ pattern, pages }));
}

/** Only successful recorded rows, exact engine set/concurrency/recycling/delay match. */
export function estimateTime(pages: number, engines: string, concurrency: number, delayMs: number) {
  const key = engines.split(',').sort().join(',');
  for (const bench of [followup, axeBench, allBench]) {
    const index = bench.runs.findIndex((r) => r.engineIds.split(',').sort().join(',') === key && r.concurrency === concurrency && r.recycleEvery === null && r.exitCode === 0 && !r.pageFailures && !r.engineErrors && !r.timedOut);
    if (delayMs !== 0 || index < 0) continue;
    const row = bench.runs[index]!;
    return { engines: key, concurrency, delayMs, estimatedSeconds: pages / row.pagesPerMinute * 60,
      source: `docs/perf/${bench.name}.json`, rowIndex: index, recordedAt: bench.recordedAt,
      row, note: 'Linear extrapolation from recorded local-fixture throughput; site and hardware differences are unmeasured.' };
  }
  return { engines: key, concurrency, delayMs, estimatedSeconds: null, note: NO_BENCHMARK };
}

export type EstimateOptions = { url: string; sitemap?: string; maxPages: number; maxDepth: number; concurrency: number; delayMs: number; timeoutMs: number; engines: string };

export async function estimateSite(options: EstimateOptions, fetchImpl: FetchLike = fetch) {
  const origin = new URL(options.url).origin;
  const robots = await fetchRobots(origin, AGENT, fetchImpl, options.timeoutMs);
  const warnings: string[] = [];
  const sitemap = options.sitemap ?? `${origin}/sitemap.xml`;
  let seeds: string[] = [];
  if (robotsAllowsUrl(robots.rules, sitemap)) {
    // Check each sitemap/index request too, including redirects.
    const guarded: FetchLike = (url, init) => {
      if (!robotsAllowsUrl(robots.rules, url)) throw new Error('Sitemap excluded by robots.txt.');
      return fetchImpl(url, init);
    };
    try { seeds = await fetchSitemap(sitemap, origin, AGENT, guarded, options.timeoutMs); }
    catch (error) { warnings.push(`Sitemap unavailable: ${(error as Error).message}`); }
  } else warnings.push('Sitemap excluded by robots.txt.');
  const signals: { url: string; login: string[]; spa: string[] }[] = [];
  const result = await crawl({ ...options, startUrl: options.url, pageLimit: options.maxPages, robots: robots.rules, seedUrls: seeds,
    visit: async (url, _collect, signal) => {
      let current = url;
      const login: string[] = [];
      for (let hop = 0; hop <= 5; hop++) {
        if (!robotsAllowsUrl(robots.rules, current)) throw new Error('Redirect excluded by robots.txt.');
        const response = await fetchImpl(current, { headers: { 'user-agent': AGENT }, signal: signal!, redirect: 'manual' });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers?.get('location');
          await response.body?.cancel();
          const next = location && normalizeUrl(location, current);
          if (!next) throw new Error('Invalid redirect.');
          if (LOGIN.test(new URL(next).pathname)) login.push('auth redirect');
          if (new URL(next).origin !== origin) {
            signals.push({ url, login, spa: [] });
            return { status: response.status, finalUrl: next, links: [] };
          }
          current = next; continue;
        }
        const contentType = response.headers?.get('content-type');
        // Stream bounded HTML: do not buffer arbitrary downloads.
        let html = '';
        if (isHtmlContentType(contentType)) {
          if (response.body) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let bytes = 0;
            try {
              while (true) {
                const chunk = await reader.read();
                if (chunk.done) { html += decoder.decode(); break; }
                bytes += chunk.value.byteLength;
                if (bytes > 2 * 1024 * 1024) throw new Error('HTML exceeds 2 MiB.');
                html += decoder.decode(chunk.value, { stream: true });
              }
            } finally { await reader.cancel().catch(() => undefined); }
          } else { html = await response.text(); if (Buffer.byteLength(html) > 2 * 1024 * 1024) throw new Error('HTML exceeds 2 MiB.'); }
        } else await response.body?.cancel();
        if (/<form\b[\s\S]*?<input\b[^>]*\btype\s*=\s*["']?password\b/i.test(html)) login.push('password login form');
        if (response.status === 401 || response.status === 403) login.push(`HTTP ${response.status}`);
        const spa: string[] = [];
        if (/\bid\s*=\s*["'](?:root|app|__next)["']/i.test(html)) spa.push('application root element');
        if (/<script\b[^>]*\btype\s*=\s*["']module["']/i.test(html)) spa.push('module script');
        if (/__NEXT_DATA__|__NUXT__|data-reactroot/.test(html)) spa.push('framework marker');
        signals.push({ url, login, spa });
        const links = [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)].slice(0, 10000).map((m) => normalizeUrl((m[1] ?? m[2] ?? m[3]!).replace(/&amp;/g, '&'), current)).filter((u): u is string => !!u);
        return { status: response.status, finalUrl: current, contentType, links, analysed: response.ok, ...(response.ok ? {} : { error: `HTTP ${response.status}` }) };
      }
      throw new Error('Too many redirects.');
    } });
  const pages = result.pages;
  return { schemaVersion: 1, disclaimer: DISCLAIMER, mode: 'crawl-only; no engines', pagesFound: pages.length, pages,
    templateGroups: clusterUrls(pages.map((p) => p.url)), loginNeeded: signals.some((s) => s.login.length) ? 'likely' : 'unknown', signals,
    robots: { note: robots.note, exclusions: result.skipped.filter((s) => s.reason === 'robots') }, skipped: result.skipped,
    limits: options, warnings, estimates: (options.engines === 'all' ? ['axe,htmlcs,ibm,lighthouse'] : [options.engines]).map((e) => estimateTime(pages.length, e, options.concurrency, options.delayMs)),
    limitations: 'Static HTML heuristics only. JavaScript routes, hidden login requirements, slug-based templates and authenticated content may be missed. Pages found is bounded, not a site total. Timing excludes undiscovered pages and is not a promise.' };
}

export function estimateMarkdown(report: Awaited<ReturnType<typeof estimateSite>>) {
  return `# Pilot scope estimate\n\n${DISCLAIMER}\n\nCrawl only; no engines. Pages found (within limits): ${report.pagesFound}. Login needed: ${report.loginNeeded}.\n\nLimits: ${report.limits.maxPages} pages, depth ${report.limits.maxDepth}, concurrency ${report.limits.concurrency}, delay ${report.limits.delayMs}ms, per-page timeout ${report.limits.timeoutMs}ms.\n\n${report.limitations}\n\n## Likely template groups\n\n${report.templateGroups.map((g) => `- ${JSON.stringify(g.pattern)}: ${g.pages.length} pages`).join('\n')}\n\n## Login and SPA signals\n\n${report.signals.filter((s) => s.login.length || s.spa.length).map((s) => `- ${JSON.stringify(s.url)}: ${[...s.login, ...s.spa].join(', ')}`).join('\n') || 'No signals detected; login requirements remain unknown.'}\n\n## Robots and discovery\n\n${report.robots.note}\n\n${report.skipped.map((s) => `- ${s.reason}: ${JSON.stringify(s.url)}`).join('\n')}\n${report.warnings.join('\n')}\n\n## Scan time estimates\n\n${report.estimates.map((e) => `- ${e.engines}, concurrency ${e.concurrency}, delay ${e.delayMs}ms: ${e.estimatedSeconds === null ? e.note : `${e.estimatedSeconds.toFixed(1)} seconds (extrapolated). Source: ${e.source}, runs[${e.rowIndex}], recorded ${e.recordedAt}; source row: ${JSON.stringify(e.row)}. ${e.note}`}`).join('\n')}\n`;
}

export async function runEstimate(argv: readonly string[], io: RunIo = {}) {
  const stdout = io.stdout ?? ((s: string) => process.stdout.write(s));
  const stderr = io.stderr ?? ((s: string) => process.stderr.write(s));
  if (argv.includes('--help') || argv.includes('-h')) {
    stdout(`a11ygate estimate <url> [--sitemap <url>] [--max-pages 1-1000] [--max-depth 0-1000] [--concurrency 1-8] [--delay-ms 0-60000] [--timeout-ms 1-300000] [--engines axe|all|comma-list] [--out-dir <dir>]\nDefaults: 20 pages, depth 1000, concurrency 1, delay 1000ms, timeout 10000ms, axe, out-dir estimate-out. Fetches /sitemap.xml automatically. No config or auth scripts loaded. Only use on authorized sites.\n${DISCLAIMER}\n`); return 0;
  }
  try {
    const url = normalizeUrl(argv[0] ?? '');
    if (!url) throw new Error('estimate requires an http(s) URL without credentials.');
    const options: EstimateOptions = { url, maxPages: 20, maxDepth: 1000, concurrency: 1, delayMs: 1000, timeoutMs: 10000, engines: 'axe' };
    let outDir = 'estimate-out';
    const numeric = { '--max-pages': ['maxPages', 1, 1000], '--max-depth': ['maxDepth', 0, 1000], '--concurrency': ['concurrency', 1, 8], '--delay-ms': ['delayMs', 0, 60000], '--timeout-ms': ['timeoutMs', 1, 300000] } as const;
    for (let i = 1; i < argv.length; i++) {
      const flag = argv[i]!;
      const value = argv[++i];
      if (!value) throw new Error(`${flag} needs a value.`);
      if (flag in numeric) {
        const [key, min, max] = numeric[flag as keyof typeof numeric];
        if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) throw new Error(`${flag} must be ${min}–${max}.`);
        options[key] = Number(value);
      } else if (flag === '--out-dir') outDir = value;
      else if (flag === '--sitemap') {
        const sitemap = normalizeUrl(value, url);
        if (!sitemap || new URL(sitemap).origin !== new URL(url).origin) throw new Error('--sitemap must be same-origin.');
        options.sitemap = sitemap;
      } else if (flag === '--engines') {
        if (value !== 'all' && (!value.split(',').every((e) => ['axe', 'htmlcs', 'ibm', 'lighthouse'].includes(e)) || new Set(value.split(',')).size !== value.split(',').length)) throw new Error('Unknown or duplicate engine.');
        options.engines = value;
      } else throw new Error(`Unknown estimate option: ${flag}`);
    }
    const dir = path.resolve(io.cwd ?? process.cwd(), outDir);
    await mkdir(dir, { recursive: true });
    const outputs = ['estimate.json', 'estimate.md'].map((name) => path.join(dir, name));
    await assertSafeOutputs(dir, [], outputs);
    const report = await estimateSite(options);
    await writeFile(outputs[0]!, JSON.stringify(report, null, 2) + '\n');
    const md = estimateMarkdown(report);
    await writeFile(outputs[1]!, md);
    stdout(md);
    return report.pages.some((p) => p.scanStatus === 'failed' || p.scanStatus === 'skipped') ? 2 : 0;
  } catch (error) { stderr(`Estimate: ${(error as Error).message}\n${DISCLAIMER}\n`); return 2; }
}
