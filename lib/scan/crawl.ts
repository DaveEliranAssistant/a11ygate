import type { AxeResults } from '@/lib/types';
import { robotsAllowsUrl, type RobotsRules } from '@/lib/scan/robots';
import { classifyLink, MAX_CRAWL_PAGES, normalizeUrl } from '@/lib/scan/url';

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
  error?: string;
};

export type PageRecord = {
  url: string;
  finalUrl: string;
  status: number | null;
  scanStatus: 'complete' | 'failed' | 'skipped';
  error?: string;
  result?: AxeResults;
};

export type SkipReason = 'robots' | 'external' | 'non-html' | 'logout' | 'not-http' | 'cap' | 'redirected-off-origin';

export type SkippedLink = { url: string; reason: SkipReason; from?: string };

export type CrawlOptions = {
  startUrl: string;
  maxPages: number;
  delayMs: number;
  robots: RobotsRules | null;
  visit: (url: string, collectLinks: boolean) => Promise<VisitOutcome>;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
};

export type CrawlResult = { pages: PageRecord[]; skipped: SkippedLink[] };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function clampPages(requested: number): number {
  if (!Number.isFinite(requested) || requested < 1) return 1;
  return Math.min(Math.floor(requested), MAX_CRAWL_PAGES);
}

/** Breadth-first, same-origin, robots-respecting crawl. Never visits more than `maxPages` (hard max 20). */
export async function crawl(options: CrawlOptions): Promise<CrawlResult> {
  const start = normalizeUrl(options.startUrl);
  if (!start) throw new Error(`Invalid start URL: ${options.startUrl}`);
  const origin = new URL(start).origin;
  const maxPages = clampPages(options.maxPages);
  const sleep = options.sleep ?? defaultSleep;
  const crawling = maxPages > 1;

  const queue: string[] = [start];
  const seen = new Set<string>([start]);
  const pages: PageRecord[] = [];
  const skipped: SkippedLink[] = [];
  const skippedSeen = new Set<string>();
  const skip = (entry: SkippedLink) => {
    const key = entry.reason + ' ' + entry.url;
    if (skippedSeen.has(key)) return;
    skippedSeen.add(key);
    skipped.push(entry);
  };

  let visits = 0;
  while (queue.length > 0) {
    const url = queue.shift() as string;
    if (pages.length >= maxPages) {
      skip({ url, reason: 'cap' });
      continue;
    }
    if (!robotsAllowsUrl(options.robots, url)) {
      skip({ url, reason: 'robots' });
      continue;
    }
    if (visits > 0 && options.delayMs > 0) await sleep(options.delayMs);
    visits += 1;
    options.log?.(`Scanning ${url}`);
    const outcome = await options.visit(url, crawling);

    if (outcome.finalUrl && normalizeUrl(outcome.finalUrl) && new URL(outcome.finalUrl).origin !== origin) {
      skip({ url, reason: 'redirected-off-origin' });
      pages.push({ url, finalUrl: outcome.finalUrl, status: outcome.status, scanStatus: 'skipped', error: 'Redirected to another origin; not scanned.' });
      continue;
    }
    if (outcome.result) {
      pages.push({ url, finalUrl: outcome.finalUrl, status: outcome.status, scanStatus: 'complete', result: outcome.result });
    } else {
      pages.push({ url, finalUrl: outcome.finalUrl, status: outcome.status, scanStatus: 'failed', error: outcome.error ?? 'Page was not analysed.' });
    }

    if (!crawling) continue;
    const base = outcome.finalUrl || url;
    for (const href of outcome.links) {
      const link = classifyLink(href, base, origin);
      if (!link.ok) {
        skip({ url: link.url, reason: link.reason, from: url });
        continue;
      }
      if (seen.has(link.url)) continue;
      seen.add(link.url);
      queue.push(link.url);
    }
  }
  return { pages, skipped };
}
