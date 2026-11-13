import { findOpenTags, parseOpenTag, type OpenTag, type SourceKind } from '@/lib/fix/element';
import type { SourceFile } from '@/lib/fix/types';

const KINDS: Record<string, SourceKind> = {
  html: 'html',
  htm: 'html',
  jsx: 'jsx',
  tsx: 'jsx',
  js: 'jsx',
  mjs: 'jsx',
};

export function sourceKind(path: string): SourceKind | null {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? '';
  return KINDS[ext] ?? null;
}

/** Attributes that never identify an element (they differ between source and the rendered DOM). */
const IGNORED = new Set(['style', 'key', 'ref']);

/** The first opening tag of axe's `node.html`. */
export function findingTag(html: string): OpenTag | null {
  const text = String(html ?? '').trim();
  const start = text.indexOf('<');
  if (start < 0) return null;
  return parseOpenTag(text, start);
}

function norm(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}

/**
 * Whether a source tag can be the element axe rendered. Literal attributes
 * must agree on both sides; JSX expressions and spreads are unknown, so they
 * neither confirm nor reject.
 */
export function tagMatches(finding: OpenTag, candidate: OpenTag): boolean {
  const rendered = new Map<string, string>();
  for (const attr of finding.attrs) {
    if (attr.kind === 'spread' || IGNORED.has(attr.name)) continue;
    rendered.set(attr.name, norm(attr.value ?? ''));
  }
  const spread = candidate.attrs.some((attr) => attr.kind === 'spread');
  const seen = new Set<string>();
  for (const attr of candidate.attrs) {
    if (attr.kind === 'spread' || IGNORED.has(attr.name)) continue;
    seen.add(attr.name);
    if (attr.kind === 'expression') continue;
    const value = rendered.get(attr.name);
    // React drops event handlers from the DOM; anything else literal must be rendered.
    if (value === undefined) {
      if (attr.name.startsWith('on')) continue;
      return false;
    }
    if (norm(attr.value ?? '') !== value) return false;
  }
  if (spread) return true;
  for (const name of rendered.keys()) if (!seen.has(name)) return false;
  return true;
}

export type MappedElement = { file: SourceFile; kind: SourceKind; tag: OpenTag };

export type MapOutcome =
  | { status: 'matched'; element: MappedElement }
  | { status: 'no-match' | 'ambiguous' };

/**
 * Maps an axe finding to exactly one opening tag across the given files.
 * Every file is searched in full, so an element that also exists outside the
 * diff makes the match ambiguous instead of landing on the wrong line.
 */
export function mapFinding(html: string, files: readonly SourceFile[]): MapOutcome {
  const target = findingTag(html);
  if (!target) return { status: 'no-match' };
  const found: MappedElement[] = [];
  for (const file of files) {
    const kind = sourceKind(file.path);
    if (!kind) continue;
    for (const tag of findOpenTags(file.content, target.tagName.toLowerCase(), kind)) {
      if (tagMatches(target, tag)) found.push({ file, kind, tag });
    }
  }
  if (found.length === 0) return { status: 'no-match' };
  if (found.length > 1) return { status: 'ambiguous' };
  return { status: 'matched', element: found[0] };
}
