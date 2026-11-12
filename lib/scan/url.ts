/** URL helpers for the read-only site scanner. Pure functions; no network access. */

export const MAX_CRAWL_PAGES = 20;

const NON_HTML_EXTENSION =
  /\.(?:pdf|zip|gz|tgz|rar|7z|tar|dmg|exe|msi|apk|iso|png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?|mp3|wav|ogg|m4a|mp4|m4v|mov|avi|webm|mkv|css|js|mjs|json|xml|rss|atom|txt|csv|xlsx?|docx?|pptx?|odt|ods|woff2?|ttf|otf|eot)$/i;

const LOGOUT_LIKE = /(?:^|[\/_\-.?=&])(?:log-?out|log-?off|sign-?out|sign-?off|logoff|signout|end-?session|destroy-?session)(?:$|[\/_\-.?=&])/i;

/** Parse and normalise an http(s) URL: drop the hash, keep the query. Returns null if invalid. */
export function normalizeUrl(input: string, base?: string): string | null {
  let url: URL;
  try {
    url = base === undefined ? new URL(input) : new URL(input, base);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  url.hash = '';
  return url.toString();
}

export function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

export type LinkSkipReason = 'not-http' | 'external' | 'non-html' | 'logout';

/** Decide whether a discovered href is crawlable from `origin`. */
export function classifyLink(href: string, pageUrl: string, origin: string): { ok: true; url: string } | { ok: false; reason: LinkSkipReason; url: string } {
  const url = normalizeUrl(href, pageUrl);
  if (!url) return { ok: false, reason: 'not-http', url: href };
  if (new URL(url).origin !== origin) return { ok: false, reason: 'external', url };
  const parsed = new URL(url);
  if (NON_HTML_EXTENSION.test(parsed.pathname)) return { ok: false, reason: 'non-html', url };
  if (LOGOUT_LIKE.test(parsed.pathname + parsed.search)) return { ok: false, reason: 'logout', url };
  return { ok: true, url };
}

export function isHtmlContentType(value: string | undefined | null): boolean {
  if (!value) return true;
  const type = value.split(';')[0]?.trim().toLowerCase() ?? '';
  return type === '' || type === 'text/html' || type === 'application/xhtml+xml';
}
