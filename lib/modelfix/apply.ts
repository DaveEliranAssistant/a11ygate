import type { ModelDraft } from '@/lib/modelfix/types';

/**
 * Exact replacement of draft ranges in one file's content, bottom-up so
 * earlier ranges keep their line numbers. No fuzzy matching. Shared by the
 * isolated verifier and the draft publisher so both produce the same bytes.
 */
export function applyDrafts(content: string, drafts: readonly Pick<ModelDraft, 'startLine' | 'endLine' | 'replacement'>[]): string {
  const next = content.split('\n');
  for (const draft of [...drafts].sort((a, b) => b.startLine - a.startLine)) {
    next.splice(draft.startLine - 1, draft.endLine - draft.startLine + 1, ...draft.replacement);
  }
  return next.join('\n');
}
