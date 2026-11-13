import type { Suggestion } from '@/lib/fix/types';
import { PLACEHOLDER } from '@/lib/fix/types';

export const SUGGESTION_MARKER_PREFIX = '<!-- a11ygate-suggestion:';

export function suggestionMarker(fingerprint: string): string {
  const safe = String(fingerprint ?? '').replace(/[^\w:.@/+=-]/g, '_').slice(0, 200);
  return `${SUGGESTION_MARKER_PREFIX}${safe} -->`;
}

function fence(lines: readonly string[]): string {
  let ticks = '```';
  while (lines.some((line) => line.includes(ticks))) ticks += '`';
  return ticks;
}

/** Review-comment body with the marker and a ```suggestion block holding the exact replacement lines. */
export function buildSuggestionBody(suggestion: Suggestion): string {
  const ticks = fence(suggestion.replacement);
  const parts = [
    suggestionMarker(suggestion.fingerprint),
    `**A11yGate rule-based suggestion** for axe \`${suggestion.ruleId}\``,
    '',
    suggestion.note,
    '',
    `${ticks}suggestion`,
    ...suggestion.replacement,
    ticks,
    '',
  ];
  if (suggestion.placeholder) {
    parts.push(`Text marked \`${PLACEHOLDER}\` is a placeholder, not final text. Replace it before merging.`, '');
  }
  parts.push(
    '_Review before clicking **Apply suggestion**. A11yGate never commits changes. This is an automated check of one finding, not a full accessibility review._',
  );
  return `${parts.join('\n')}\n`;
}

export function findSuggestionComment<T extends { id?: unknown; body?: unknown }>(
  comments: readonly (T | null)[],
  fingerprint: string,
): (T & { id: number; body: string }) | null {
  const marker = suggestionMarker(fingerprint);
  for (const comment of comments) {
    if (!comment || typeof comment.id !== 'number' || typeof comment.body !== 'string') continue;
    if (comment.body.includes(marker)) return comment as T & { id: number; body: string };
  }
  return null;
}
