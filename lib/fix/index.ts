import { applyEdits } from '@/lib/fix/apply';
import { lineOf } from '@/lib/fix/element';
import { mapFinding, type MappedElement } from '@/lib/fix/mapper';
import { accessibleNameRule } from '@/lib/fix/rules/accessible-name';
import { clickableRule, isClickableDivOrSpan } from '@/lib/fix/rules/clickable';
import { htmlLangRule } from '@/lib/fix/rules/html-lang';
import { imageAltRule } from '@/lib/fix/rules/image-alt';
import { labelRule } from '@/lib/fix/rules/label';
import type { FixFinding, FixOptions, PlanResult, Rule, RuleResult, SourceFile, Suggestion } from '@/lib/fix/types';

export { applyEdits, applySuggestion } from '@/lib/fix/apply';
export { patchLines, unifiedDiffLines } from '@/lib/fix/diff';
export { mapFinding, sourceKind } from '@/lib/fix/mapper';
export { buildSuggestionBody, suggestionMarker, findSuggestionComment, SUGGESTION_MARKER_PREFIX } from '@/lib/fix/comment';
export { PLACEHOLDER } from '@/lib/fix/types';
export type { FixFinding, FixOptions, PlanResult, SourceFile, Suggestion } from '@/lib/fix/types';

/** Rule ids that have a rule-based suggestion. */
export const SUPPORTED_RULES = ['label', 'button-name', 'link-name', 'image-alt', 'html-has-lang'] as const;

/** Picks the rule for an axe rule id and the matched source element. */
export function ruleFor(ruleId: string, element: Pick<MappedElement, 'tag'>): Rule | null {
  if (ruleId === 'html-has-lang') return htmlLangRule;
  if (ruleId === 'image-alt') return imageAltRule;
  if (ruleId === 'label') return labelRule;
  // Any finding on a clickable div/span (aria-prohibited-attr, aria-command-name, …).
  if (isClickableDivOrSpan(element.tag)) return clickableRule;
  if (ruleId === 'button-name' || ruleId === 'link-name') return accessibleNameRule;
  return null;
}

/** Turns a rule's offset edits into a head-side line replacement. */
export function toSuggestion(file: SourceFile, finding: FixFinding, result: RuleResult): Suggestion | null {
  if (result.edits.length === 0) return null;
  const source = file.content;
  const start = Math.min(...result.edits.map((edit) => edit.start));
  const end = Math.max(...result.edits.map((edit) => edit.end));
  const startLine = lineOf(source, start);
  const endLine = lineOf(source, end);
  const next = applyEdits(source, result.edits);
  const oldLines = source.split('\n');
  const newLines = next.split('\n');
  const tail = oldLines.length - endLine;
  const strip = (line: string) => line.replace(/\r$/, '');
  return {
    fingerprint: finding.fingerprint,
    ruleId: finding.ruleId,
    rule: result.rule,
    path: file.path,
    startLine,
    endLine,
    original: oldLines.slice(startLine - 1, endLine).map(strip),
    replacement: newLines.slice(startLine - 1, newLines.length - tail).map(strip),
    placeholder: result.placeholder,
    note: result.note,
  };
}

/** Suggestion for one finding against one already-mapped element (no diff check). */
export function suggestForElement(finding: FixFinding, element: MappedElement, options: FixOptions = {}): Suggestion | null {
  const rule = ruleFor(finding.ruleId, element);
  if (!rule) return null;
  const result = rule({ source: element.file.content, kind: element.kind, tag: element.tag, ruleId: finding.ruleId, lang: options.lang ?? 'en' });
  return result ? toSuggestion(element.file, finding, result) : null;
}

/**
 * Plans suggested changes for new findings. A suggestion is kept only when the
 * element maps to exactly one place and every replaced line is inside the diff.
 */
export function planSuggestions(findings: readonly FixFinding[], files: readonly SourceFile[], options: FixOptions = {}): PlanResult {
  const plan: PlanResult = { suggestions: [], skipped: [] };
  const taken = new Map<string, [number, number][]>();
  for (const finding of findings) {
    const skip = (reason: PlanResult['skipped'][number]['reason']) =>
      plan.skipped.push({ fingerprint: finding.fingerprint, ruleId: finding.ruleId, reason });
    if (finding.status !== undefined && finding.status !== 'new') {
      skip('not-new');
      continue;
    }
    const mapped = mapFinding(finding.html, files);
    if (mapped.status !== 'matched') {
      skip(mapped.status);
      continue;
    }
    if (!ruleFor(finding.ruleId, mapped.element)) {
      skip('unsupported-rule');
      continue;
    }
    const suggestion = suggestForElement(finding, mapped.element, options);
    if (!suggestion) {
      skip('no-safe-fix');
      continue;
    }
    const diff = mapped.element.file.diffLines;
    let inside = true;
    for (let line = suggestion.startLine; line <= suggestion.endLine; line += 1) if (!diff.has(line)) inside = false;
    if (!inside) {
      skip('outside-diff');
      continue;
    }
    const ranges = taken.get(suggestion.path) ?? [];
    if (ranges.some(([a, b]) => suggestion.startLine <= b && a <= suggestion.endLine)) {
      skip('overlaps');
      continue;
    }
    ranges.push([suggestion.startLine, suggestion.endLine]);
    taken.set(suggestion.path, ranges);
    plan.suggestions.push(suggestion);
  }
  return plan;
}
