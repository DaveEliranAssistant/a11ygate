import { normaliseSelector } from '@/lib/fingerprint';
import { impactRank } from '@/lib/gate';
import { isImpact, type DiffedFinding, type FindingGroup, type GroupKey } from '@/lib/types';

function groupLabel(key: GroupKey, value: string): string {
  if (key === 'impact' && value === 'unknown') return 'unknown impact';
  return value;
}

export function groupFindings(findings: readonly DiffedFinding[], by: GroupKey): FindingGroup[] {
  const groups = new Map<string, DiffedFinding[]>();
  for (const finding of findings) {
    const key =
      by === 'rule' ? finding.ruleId : by === 'page' ? finding.path : (finding.impact ?? 'unknown');
    const existing = groups.get(key);
    if (existing) existing.push(finding);
    else groups.set(key, [finding]);
  }

  const grouped = [...groups.entries()].map(([key, items]) => ({
    key,
    label: groupLabel(by, key),
    findings: items,
  }));

  if (by === 'impact') {
    const rank = (key: string) => (isImpact(key) ? impactRank(key) : 0);
    grouped.sort((a, b) => rank(b.key) - rank(a.key));
  } else {
    grouped.sort((a, b) => a.label.localeCompare(b.label));
  }

  return grouped;
}

/** Conservative, model-free hints; these never establish a root cause. */
export const SHARED_COMPONENT_DISCLAIMER = 'Likely shared components are heuristic suggestions based on matching rules, normalized selector paths and similar HTML. Review examples to confirm whether one component fix applies. Finding totals and gate decisions are unchanged.';

type ComponentFinding = { ruleId: string; selector: string; selectors?: string[]; html: string; pageUrl: string };
export type SharedComponentGroup = {
  key: string;
  ruleId: string;
  normalizedSelector: string;
  likelySharedComponent: boolean;
  pageCount: number;
  findingCount: number;
  pages: string[];
  examples: { pageUrl: string; selector: string; html: string }[];
};

// Ignore content text and destination URLs, while retaining tag structure,
// attribute names, semantic attributes and stable classes/ids. Empty snippets
// or selector paths are insufficient evidence for a cross-page match.
export function normalizedComponentHtml(html: string): string {
  return html.trim().replace(/<!--[^]*?-->/g, '').replace(/>([^<]+)</g, (_, text: string) => text.trim() ? '>TEXT<' : '><')
    .replace(/<([\w:-]+)([^<>]*?)(\/?)>/g, (_, tag: string, attrs: string, closing: string) => {
      const attributes = [...attrs.matchAll(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+)))?/g)]
        .map((match) => {
          const name = match[1]!.toLowerCase();
          let value = match[2] ?? match[3] ?? match[4] ?? '';
          if (/^(href|src|value)$/.test(name)) value = '*';
          else if (name === 'id') value = normaliseSelector(`#${value}`);
          else if (name === 'class') value = normaliseSelector(value.split(/\s+/).filter(Boolean).sort().map((c) => `.${c}`).join(''));
          return [name, value.replace(/\s+/g, ' ').trim()];
        }).sort((a, b) => compareText(JSON.stringify(a), JSON.stringify(b)));
      return `<${tag.toLowerCase()} ${JSON.stringify(attributes)}${closing}>`;
    }).replace(/\s+/g, ' ').trim();
}

function compareText(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

export function componentGroupKey(finding: ComponentFinding): string {
  const path = (finding.selectors ?? [finding.selector]).map(normaliseSelector);
  const html = normalizedComponentHtml(finding.html);
  return JSON.stringify([finding.ruleId, path, html, !html || path.every((p) => !p) ? finding.pageUrl : '']);
}

/** A partition of the input findings, including singletons; never deduplicates or mutates input. */
export function groupSharedComponents(findings: readonly ComponentFinding[]): SharedComponentGroup[] {
  const buckets = new Map<string, ComponentFinding[]>();
  for (const finding of findings) {
    const key = componentGroupKey(finding);
    const bucket = buckets.get(key) ?? [];
    bucket.push(finding);
    buckets.set(key, bucket);
  }
  return [...buckets.entries()].map(([key, members]) => {
    const sorted = [...members].sort((a, b) => compareText(JSON.stringify([a.pageUrl, a.selector, a.html]), JSON.stringify([b.pageUrl, b.selector, b.html])));
    const pages = [...new Set(sorted.map((f) => f.pageUrl))].sort(compareText);
    const first = sorted[0]!;
    return {
      key, ruleId: first.ruleId,
      normalizedSelector: (first.selectors ?? [first.selector]).map(normaliseSelector).join(' → '),
      likelySharedComponent: pages.length > 1,
      pageCount: pages.length, findingCount: members.length, pages,
      examples: pages.slice(0, 3).map((pageUrl) => {
        const f = sorted.find((item) => item.pageUrl === pageUrl)!;
        return { pageUrl, selector: f.selector, html: f.html };
      }),
    };
  }).sort((a, b) => b.pageCount - a.pageCount || compareText(a.key, b.key));
}
