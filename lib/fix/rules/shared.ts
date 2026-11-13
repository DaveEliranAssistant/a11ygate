import type { SourceKind } from '@/lib/fix/element';
import { indentAt } from '@/lib/fix/element';
import type { TextEdit } from '@/lib/fix/types';

/** `name="value"`, or null when the value cannot be written safely as a plain attribute. */
export function attribute(name: string, value: string): string | null {
  if (/["{}<>\n\r]/.test(value)) return null;
  return `${name}="${value.replace(/&/g, '&amp;')}"`;
}

/** Inserts ` text` right after the tag name. */
export function insertAfterName(nameEnd: number, text: string): TextEdit {
  return { start: nameEnd, end: nameEnd, text: ` ${text}` };
}

/** True when a JSX element at `offset` sits among JSX children, where `{/* … *\/}` is valid. */
export function inJsxChildren(source: string, offset: number): boolean {
  let i = offset - 1;
  while (i >= 0 && /\s/.test(source[i])) i -= 1;
  if (i < 0) return false;
  if (source[i] === '>') return source[i - 1] !== '=';
  if (source[i] === '}') {
    // After another JSX comment or expression child, e.g. `{/* … */}` or `{items}`.
    const lineStart = source.lastIndexOf('\n', i) + 1;
    return /^\s*\{[\s\S]*\}$/.test(source.slice(lineStart, i + 1));
  }
  return false;
}

/**
 * A TODO comment placed right before the element. On its own line when the
 * element starts a line, inline otherwise. Returns null when no safe comment
 * syntax is available at that position.
 */
export function commentBefore(source: string, offset: number, kind: SourceKind, message: string): TextEdit | null {
  let comment: string;
  if (kind === 'html') {
    comment = `<!-- ${message.replace(/--/g, '—')} -->`;
  } else {
    if (!inJsxChildren(source, offset)) return null;
    comment = `{/* ${message.replace(/\*\//g, '* /')} */}`;
  }
  const { indent, atLineStart } = indentAt(source, offset);
  const text = atLineStart ? `${comment}\n${indent}` : comment;
  return { start: offset, end: offset, text };
}
