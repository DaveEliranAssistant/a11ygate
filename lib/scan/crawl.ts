import type { AxeResults } from '@/lib/types';
import { robotsAllowsUrl, type RobotsRules } from '@/lib/scan/robots';
import { classifyLink, isHtmlContentType, MAX_CRAWL_PAGES, normalizeUrl } from '@/lib/scan/url';

export type VisitOutcome = {
  /** HTTP status of the main document, or null when navigation failed. */
  status: number | null;
  /** URL after redirects. */
  finalUrl: string;
  contentType?: string | null;
  /** Absolute hrefs found in a[href]; only read when crawling. */
  links: string[];
  /** axe result when the page was analysed. */
  result?: AxeResults;
  analysed?: boolean;
  error?: string;
  navigationError?: boolean;
};

export type PageRecord = {
  url: string;
  finalUrl: string;
  status: number | null;
  scanStatus: 'complete' | 'failed' | 'skipped';
  error?: string;
  result?: AxeResults;
};

export type SkipReason = 'robots' | 'external' | 'non-html' | 'logout' | 'not-http' | 'cap' | 'redirected-off-origin' | 'depth' | 'excluded' | 'not-included' | 'timeout' | 'navigation-error' | 'discovery-cap';

export type SkippedLink = { url: string; reason: SkipReason; from?: string };

export type CrawlOptions = {
  startUrl: string;
  maxPages: number;
  delayMs: number;
  robots: RobotsRules | null;
  maxDepth?: number;
  include?: string[];
  exclude?: string[];
  concurrency?: number;
  timeoutMs?: number;
  seedUrls?: string[];
  /** Explicit opt-in beyond the legacy 20-page cap; hard ceiling 1000. */
  pageLimit?: number;
  visit: (url: string, collectLinks: boolean, signal?: AbortSignal) => Promise<VisitOutcome>;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
};

export type CrawlResult = { pages: PageRecord[]; skipped: SkippedLink[] };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function clampPages(requested: number): number {
  if (!Number.isFinite(requested) || requested < 1) return 1;
  return Math.min(Math.floor(requested), MAX_CRAWL_PAGES);
}

/** Bounded glob syntax: * matches within a path segment, ** across segments, ? one character. */
export function matchesGlob(url: string, glob: string): boolean {
  const target = glob.includes('://') ? url : new URL(url).pathname + new URL(url).search;
  // Dynamic programming avoids regex backtracking on customer-supplied patterns.
  let previous = new Uint8Array(target.length + 1);
  previous[0] = 1;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    const across = c === '*' && glob[i + 1] === '*';
    if (across) i++;
    const next = new Uint8Array(target.length + 1);
    if (c === '*') next[0] = previous[0]!;
    for (let j = 1; j <= target.length; j++) {
      if (c === '*') next[j] = previous[j]! || ((across || target[j - 1] !== '/') ? next[j - 1]! : 0);
      else if ((c === '?' && target[j - 1] !== '/') || c === target[j - 1]) next[j] = previous[j - 1]!;
    }
    previous = next;
  }
  return previous[target.length] === 1;
}

export const MAX_DISCOVERED_URLS = 10_000;

/** Breadth-first batches, deterministic result order, bounded workers and frontier. */
export async function crawl(options: CrawlOptions): Promise<CrawlResult> {
  const start = normalizeUrl(options.startUrl);
  if (!start) throw new Error(`Invalid start URL: ${options.startUrl}`);
  const origin = new URL(start).origin;
  const maxPages = options.pageLimit === undefined ? clampPages(options.maxPages)
    : Math.min(1000, Number.isFinite(options.pageLimit) ? Math.max(1, Math.floor(options.pageLimit)) : 1);
  const concurrency = Math.min(8, Math.max(1, Math.floor(options.concurrency ?? 1) || 1));
  const timeoutMs = Math.min(300_000, Math.max(1, options.timeoutMs ?? 30_000));
  const sleep = options.sleep ?? defaultSleep;
  const crawling = maxPages > 1;
  const queue: { url: string; depth: number }[] = [];
  const seen = new Set<string>();
  const pages: PageRecord[] = [];
  const skipped: SkippedLink[] = [];
  const skippedSeen = new Set<string>();
  const skip = (entry: SkippedLink) => {
    const key = entry.reason + ' ' + entry.url;
    if (skippedSeen.has(key)) return;
    if (skipped.length >= MAX_DISCOVERED_URLS) {
      skipped[MAX_DISCOVERED_URLS - 1] = { url: start, reason: 'discovery-cap' };
      return;
    }
    skippedSeen.add(key);
    skipped.push(entry);
  };
  const enqueue = (href: string, base: string, depth: number, from?: string) => {
    const link = classifyLink(href, base, origin);
    if (!link.ok) { skip({ url: link.url, reason: link.reason, ...(from ? { from } : {}) }); return; }
    if (seen.has(link.url)) return;
    if (seen.size >= MAX_DISCOVERED_URLS) {
      skip({ url: start, reason: 'discovery-cap' }); return;
    }
    seen.add(link.url);
    let reason: SkipReason | undefined;
    if (options.exclude?.some((g) => matchesGlob(link.url, g))) reason = 'excluded';
    else if (options.include?.length && !options.include.some((g) => matchesGlob(link.url, g))) reason = 'not-included';
    else if (depth > (options.maxDepth ?? Infinity)) reason = 'depth';
    else if (!robotsAllowsUrl(options.robots, link.url)) reason = 'robots';
    if (reason) { skip({ url: link.url, reason, ...(from ? { from } : {}) }); return; }
    queue.push({ url: link.url, depth });
  };
  enqueue(start, start, 0);
  if (crawling) for (const seed of (options.seedUrls ?? []).slice(0, MAX_DISCOVERED_URLS)) enqueue(seed, start, 0);

  // Serialize starts, including retries: delay is global, not per worker.
  let starts = 0;
  let gate = Promise.resolve();
  const visit = async (url: string): Promise<VisitOutcome> => {
    const turn = gate.then(async () => { if (starts++ > 0 && options.delayMs > 0) await sleep(options.delayMs); });
    gate = turn;
    await turn;
    options.log?.(`Scanning ${url}`);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve().then(() => options.visit(url, crawling, controller.signal)),
        new Promise<VisitOutcome>((resolve) => {
          timer = setTimeout(() => {
            controller.abort();
            resolve({ status: null, finalUrl: url, links: [], error: `Page timeout after ${timeoutMs}ms.` });
          }, timeoutMs);
        }),
      ]);
    } catch (error) {
      return { status: null, finalUrl: url, links: [], error: error instanceof Error ? error.message : 'Navigation failed.', navigationError: true };
    } finally { clearTimeout(timer); }
  };

  const navigationFailed = (outcome: VisitOutcome) => !!outcome.error
    && !outcome.error.startsWith('Not authenticated:')
    && (outcome.navigationError === true || (outcome.navigationError === undefined && outcome.status === null));

  while (queue.length > 0 && pages.length < maxPages) {
    const depth = queue[0]!.depth;
    const batch: { url: string; depth: number }[] = [];
    while (queue.length && queue[0]!.depth === depth && batch.length < concurrency && pages.length + batch.length < maxPages) batch.push(queue.shift()!);
    const outcomes = await Promise.all(batch.map(async ({ url }) => {
      let outcome = await visit(url);
      if (navigationFailed(outcome) && !outcome.error?.startsWith('Page timeout')) outcome = await visit(url);
      return outcome;
    }));
    for (let i = 0; i < batch.length; i++) {
      const { url, depth } = batch[i]!;
      const outcome = outcomes[i]!;
      if (outcome.error?.startsWith('Page timeout')) {
        skip({ url, reason: 'timeout' });
        pages.push({ url, finalUrl: outcome.finalUrl, status: outcome.status, scanStatus: 'skipped', error: outcome.error });
        continue;
      }
      if (outcome.finalUrl && normalizeUrl(outcome.finalUrl) && new URL(outcome.finalUrl).origin !== origin) {
        skip({ url, reason: 'redirected-off-origin' });
        pages.push({ url, finalUrl: outcome.finalUrl, status: outcome.status, scanStatus: 'skipped', error: 'Redirected to another origin; not scanned.' });
        continue;
      }
      if (!isHtmlContentType(outcome.contentType)) {
        skip({ url, reason: 'non-html' });
        pages.push({ url, finalUrl: outcome.finalUrl, status: outcome.status, scanStatus: 'skipped', error: outcome.error ?? 'Not an HTML page.' });
        continue;
      }
      if (outcome.result || outcome.analysed) {
        pages.push({ url, finalUrl: outcome.finalUrl, status: outcome.status, scanStatus: 'complete', result: outcome.result });
      } else {
        if (navigationFailed(outcome)) skip({ url, reason: 'navigation-error' });
        pages.push({ url, finalUrl: outcome.finalUrl, status: outcome.status, scanStatus: 'failed', error: outcome.error ?? 'Page was not analysed.' });
      }
      if (crawling) for (const href of outcome.links.slice(0, MAX_DISCOVERED_URLS)) enqueue(href, outcome.finalUrl || url, depth + 1, url);
    }
  }
  for (const { url } of queue) skip({ url, reason: 'cap' });
  return { pages, skipped };
}
