import { impactRank } from '@/lib/gate';
import { normalizeUrl } from '@/lib/scan/url';
import type { NormalizedFinding } from './normalized';
import type { EnginePageResult } from './types';
import { WCAG_RULE_MAP } from './wcag-map';

export type Agreement = { engines: string[]; confidence: { confirmedBy: number; enginesRan: number; agreement: number } };
export type MergedFinding = NormalizedFinding & Agreement;

/** Conservative text fallback; DOM-resolved elementKey handles CSS/XPath equivalence.
 * Never collapse descendant/child combinators, case-sensitive values or different indexes.
 */
export function normalizeLocator(locator: string): string {
  const value = locator.trim().replace(/^xpath=/, '');
  // Only transform simple absolute XPath paths whose indexes are unambiguous.
  if (/^\/(?:[a-zA-Z][\w-]*(?:\[\d+\])?\/)*[a-zA-Z][\w-]*(?:\[\d+\])?$/.test(value) &&
      value.slice(1).split('/').every((part) => /\[\d+\]$/.test(part) || /^(html|body)$/.test(part))) {
    return value.slice(1).split('/').map((part) => {
      const [, tag, index] = part.match(/^([\w-]+)(?:\[(\d+)\])?$/)!;
      return `${tag!.toLowerCase()}:nth-of-type(${index ?? '1'})`;
    }).join('>');
  }
  // Normalize only outside quoted CSS strings.
  return value.split(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g).map((part, i) =>
    i % 2 ? part : part.replace(/\s*([>+~])\s*/g, '$1').replace(/\s+/g, ' '),
  ).join('').replace(/\[id=("|')([\w-]+)\1\]/g, '#$2');
}

/** One occurrence per page + element + SC. Multi-SC rules split per SC; unmapped
 * rules stay engine/rule-specific. Confidence = distinct confirming engines / distinct
 * successfully completed engines on that page (errors excluded, also reported).
 * This measures agreement, not probability of conformance. Highest impact wins.
 */
export function dedupeFindings(results: readonly EnginePageResult[]): MergedFinding[] {
  const completed = results.filter((r) => r.status === 'complete');
  const enginesByPage = new Map<string, Set<string>>();
  for (const r of completed) {
    const page = normalizeUrl(r.url) ?? r.url;
    const engines = enginesByPage.get(page) ?? new Set<string>();
    engines.add(r.engine);
    enginesByPage.set(page, engines);
  }
  const merged = new Map<string, MergedFinding>();
  for (const result of completed) {
    if (result.status !== 'complete') continue;
    for (const f of result.findings) {
      const page = normalizeUrl(result.url) ?? result.url;
      const locator = f.elementKey ?? normalizeLocator(f.selector);
      const scs = [...new Set(f.wcagSc.length ? f.wcagSc : WCAG_RULE_MAP[f.engine]?.[f.ruleId] ?? [])].sort();
      for (const sc of scs.length ? scs : [null]) {
        // Missing locators are not evidence of element identity.
        const key = JSON.stringify([page, locator || [f.engine, f.ruleId, merged.size], sc ?? `${f.engine}:${f.ruleId}`]);
        const existing = merged.get(key);
        const engines = [...new Set([...(existing?.engines ?? []), result.engine])].sort();
        const enginesRan = enginesByPage.get(page)!.size;
        const representative = existing && impactRank(existing.impact) >= impactRank(f.impact) ? existing : f;
        merged.set(key, { ...representative, url: page, wcagSc: sc ? [sc] : [], engines,
          confidence: { confirmedBy: engines.length, enginesRan, agreement: engines.length / enginesRan } });
      }
    }
  }
  return [...merged.values()];
}

export function engineSummary(results: readonly EnginePageResult[]) {
  return {
    used: [...new Set(results.filter((r) => r.status === 'complete').map((r) => r.engine))].sort(),
    errored: results.flatMap((r) => r.status === 'errored' ? [{ engine: r.engine, url: r.url, error: r.error }] : []),
  };
}

export function attribution(finding: Partial<Agreement>): string {
  return finding.engines ? `detected by: ${finding.engines.join(', ')}; confirmed by ${finding.confidence!.confirmedBy} of ${finding.confidence!.enginesRan} engines` : '';
}
