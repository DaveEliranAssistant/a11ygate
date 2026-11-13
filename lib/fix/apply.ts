import type { Suggestion, TextEdit } from '@/lib/fix/types';

/** Applies offset edits (non-overlapping) to a text. */
export function applyEdits(text: string, edits: readonly TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let out = text;
  let floor = Number.POSITIVE_INFINITY;
  for (const edit of sorted) {
    if (edit.end > floor) throw new Error('Overlapping edits.');
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    floor = edit.start;
  }
  return out;
}

/**
 * What GitHub's "Apply suggestion" does: replace head lines startLine..endLine
 * with the suggestion lines.
 */
export function applySuggestion(source: string, suggestion: Pick<Suggestion, 'startLine' | 'endLine' | 'replacement'>): string {
  const lines = source.split('\n');
  const eol = lines.length > 1 && lines[0].endsWith('\r') ? '\r' : '';
  const replacement = suggestion.replacement.map((line) => line + eol);
  lines.splice(suggestion.startLine - 1, suggestion.endLine - suggestion.startLine + 1, ...replacement);
  return lines.join('\n');
}
