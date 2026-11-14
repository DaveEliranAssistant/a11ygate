import { normalizeUrl } from './url';
import type { FetchLike } from './robots';

const MAX_XML_BYTES = 512 * 1024;

/** Bounded metadata fetch; redirects may only remain on the start origin. */
export async function fetchSiteText(url: string, origin: string, userAgent: string, fetchImpl: FetchLike, timeoutMs = 5000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (new URL(url).origin !== origin) throw new Error('Metadata URL must be same-origin.');
      const response = await fetchImpl(url, { headers: { 'user-agent': userAgent }, signal: controller.signal, redirect: 'manual' });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers?.get('location');
        await response.body?.cancel();
        if (!location) throw new Error('Metadata redirect has no location.');
        const next = normalizeUrl(location, url);
        if (!next) throw new Error('Invalid metadata redirect.');
        url = next;
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}`);
      }
      if (!response.body) {
        const text = await response.text();
        if (Buffer.byteLength(text) > MAX_XML_BYTES) throw new Error('Metadata exceeds 512 KiB.');
        return text;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let bytes = 0;
      let text = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) return text + decoder.decode();
          bytes += value.byteLength;
          if (bytes > MAX_XML_BYTES) throw new Error('Metadata exceeds 512 KiB.');
          text += decoder.decode(value, { stream: true });
        }
      } finally { await reader.cancel().catch(() => undefined); }
    }
    throw new Error('Too many metadata redirects.');
  } finally { clearTimeout(timer); }
}

function decodeXml(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (entity, key: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (named[key]) return named[key];
    const n = key.startsWith('#x') ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : entity;
  }).trim();
}

/** URL sets and same-origin sitemap indexes, no DTD/entity expansion, max 10 documents / 10000 URLs. */
export async function fetchSitemap(url: string, origin: string, userAgent: string, fetchImpl: FetchLike, timeoutMs = 5000): Promise<string[]> {
  const pending = [url];
  const seen = new Set<string>();
  const urls = new Set<string>();
  while (pending.length && seen.size < 10 && urls.size < 10_000) {
    const current = pending.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    const xml = await fetchSiteText(current, origin, userAgent, fetchImpl, timeoutMs);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml) || !/<(?:\w+:)?(?:urlset|sitemapindex)\b/i.test(xml)) throw new Error('Unsupported sitemap XML.');
    const index = /<(?:\w+:)?sitemapindex\b/i.test(xml);
    for (const match of xml.matchAll(/<(?:\w+:)?loc\b[^>]*>([\s\S]*?)<\/(?:\w+:)?loc\s*>/gi)) {
      const location = normalizeUrl(decodeXml(match[1]!), current);
      if (!location) continue;
      if (index) {
        if (new URL(location).origin !== origin) throw new Error('Sitemap index must be same-origin.');
        if (pending.length < 10 && !seen.has(location)) pending.push(location);
      } else urls.add(location);
      if (urls.size >= 10_000) break;
    }
  }
  return [...urls];
}
