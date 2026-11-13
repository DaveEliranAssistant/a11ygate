/**
 * A small, forgiving opening-tag reader for HTML and JSX/TSX source.
 * It is not a full parser: it reads one opening tag at a time and gives
 * offsets so rules can make minimal, exact edits.
 */

export type SourceKind = 'html' | 'jsx';

export type Attr = {
  /** Name as written in the source. */
  raw: string;
  /** Normalized name: lowercased, className -> class, htmlFor -> for. */
  name: string;
  /** Literal value; '' for bare attributes; null for expressions/spreads. */
  value: string | null;
  kind: 'literal' | 'bare' | 'expression' | 'spread';
  start: number;
  end: number;
};

export type OpenTag = {
  tagName: string;
  attrs: Attr[];
  /** Offset of '<'. */
  start: number;
  /** Offset of the end of the tag name. */
  nameEnd: number;
  /** Offset just after '>'. */
  end: number;
  selfClosing: boolean;
};

export const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr',
]);

export function normalizeAttrName(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower === 'classname') return 'class';
  if (lower === 'htmlfor') return 'for';
  return lower;
}

function skipBraces(text: string, start: number): number {
  // text[start] === '{'; returns the offset after the matching '}', or -1.
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') {
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Reads the opening tag that starts at `start` (text[start] must be '<'). */
export function parseOpenTag(text: string, start: number): OpenTag | null {
  if (text[start] !== '<') return null;
  const nameMatch = /^[A-Za-z][\w:.-]*/.exec(text.slice(start + 1, start + 200));
  if (!nameMatch) return null;
  const tagName = nameMatch[0];
  const nameEnd = start + 1 + tagName.length;
  const attrs: Attr[] = [];
  let i = nameEnd;
  const limit = Math.min(text.length, start + 8000);
  while (i < limit) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      if (close < 0) return null;
      i = close + 2;
      continue;
    }
    if (ch === '/' && text[i + 1] === '>') {
      return { tagName, attrs, start, nameEnd, end: i + 2, selfClosing: true };
    }
    if (ch === '>') {
      return { tagName, attrs, start, nameEnd, end: i + 1, selfClosing: false };
    }
    if (ch === '{') {
      const close = skipBraces(text, i);
      if (close < 0) return null;
      attrs.push({ raw: text.slice(i, close), name: '{spread}', value: null, kind: 'spread', start: i, end: close });
      i = close;
      continue;
    }
    const attrName = /^[^\s=>/"'{]+/.exec(text.slice(i, i + 200));
    if (!attrName) return null;
    const raw = attrName[0];
    const attrStart = i;
    i += raw.length;
    let j = i;
    while (j < limit && /\s/.test(text[j])) j += 1;
    if (text[j] !== '=') {
      attrs.push({ raw, name: normalizeAttrName(raw), value: '', kind: 'bare', start: attrStart, end: i });
      continue;
    }
    j += 1;
    while (j < limit && /\s/.test(text[j])) j += 1;
    const q = text[j];
    if (q === '"' || q === "'") {
      const close = text.indexOf(q, j + 1);
      if (close < 0) return null;
      attrs.push({ raw, name: normalizeAttrName(raw), value: text.slice(j + 1, close), kind: 'literal', start: attrStart, end: close + 1 });
      i = close + 1;
    } else if (q === '{') {
      const close = skipBraces(text, j);
      if (close < 0) return null;
      const inner = text.slice(j + 1, close - 1).trim();
      // {"text"} or {'text'} is still a literal string.
      const str = /^(["'])((?:(?!\1)[^\\])*)\1$/.exec(inner);
      if (str) {
        attrs.push({ raw, name: normalizeAttrName(raw), value: str[2], kind: 'literal', start: attrStart, end: close });
      } else {
        attrs.push({ raw, name: normalizeAttrName(raw), value: null, kind: 'expression', start: attrStart, end: close });
      }
      i = close;
    } else {
      const unquoted = /^[^\s>]+/.exec(text.slice(j, j + 500));
      if (!unquoted) return null;
      let value = unquoted[0];
      // `<img src=a.png/>`: the slash belongs to the tag.
      if (value.endsWith('/') && text[j + value.length] === '>') value = value.slice(0, -1);
      attrs.push({ raw, name: normalizeAttrName(raw), value, kind: 'literal', start: attrStart, end: j + value.length });
      i = j + value.length;
    }
  }
  return null;
}

export function getAttr(tag: OpenTag, name: string): Attr | undefined {
  const wanted = normalizeAttrName(name);
  return tag.attrs.find((attr) => attr.name === wanted);
}

export function hasSpread(tag: OpenTag): boolean {
  return tag.attrs.some((attr) => attr.kind === 'spread');
}

/** Non-empty literal value, or undefined. */
export function literal(tag: OpenTag, name: string): string | undefined {
  const attr = getAttr(tag, name);
  if (!attr || attr.kind !== 'literal') return undefined;
  const value = (attr.value ?? '').trim();
  return value.length > 0 ? value : undefined;
}

export function sameTagName(a: string, b: string, kind: SourceKind): boolean {
  return kind === 'html' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** All opening tags with the given name in the text. */
export function findOpenTags(text: string, tagName: string, kind: SourceKind): OpenTag[] {
  const tags: OpenTag[] = [];
  const pattern = /<([A-Za-z][\w:.-]*)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (!sameTagName(match[1], tagName, kind)) continue;
    const tag = parseOpenTag(text, match.index);
    if (tag) tags.push(tag);
  }
  return tags;
}

export type ElementRange = {
  open: OpenTag;
  /** Offset just after the opening tag. */
  contentStart: number;
  /** Offset of the closing tag '<', or contentStart for void/self-closing. */
  contentEnd: number;
  /** Offset of the closing tag '<' and just after its '>' (null when there is none). */
  close: { start: number; end: number } | null;
};

/**
 * Finds the matching closing tag, counting nested tags of the same name.
 * Returns null when the element is not closed within `maxChars`.
 */
export function elementRange(text: string, open: OpenTag, kind: SourceKind, maxChars = 6000): ElementRange | null {
  if (open.selfClosing || (kind === 'html' && VOID_TAGS.has(open.tagName.toLowerCase()))) {
    return { open, contentStart: open.end, contentEnd: open.end, close: null };
  }
  const flags = kind === 'html' ? 'gi' : 'g';
  const escaped = open.tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<(/?)${escaped}(?=[\\s>/])`, flags);
  pattern.lastIndex = open.end;
  const limit = open.end + maxChars;
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) && match.index < limit) {
    if (match[1] === '/') {
      depth -= 1;
      if (depth === 0) {
        const gt = text.indexOf('>', match.index);
        if (gt < 0) return null;
        return { open, contentStart: open.end, contentEnd: match.index, close: { start: match.index, end: gt + 1 } };
      }
    } else {
      const nested = parseOpenTag(text, match.index);
      if (nested && !nested.selfClosing) depth += 1;
      if (nested) pattern.lastIndex = nested.end;
    }
  }
  return null;
}

/** Visible-ish text of markup: tags, comments and JSX expressions removed. */
export function plainText(markup: string): string {
  return markup
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hasExpression(markup: string): boolean {
  return /\{(?!\/\*)/.test(markup.replace(/<[^>]*>/g, ' '));
}

export function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

export function indentAt(text: string, offset: number): { lineStart: number; indent: string; atLineStart: boolean } {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const before = text.slice(lineStart, offset);
  const indent = /^[ \t]*/.exec(before)?.[0] ?? '';
  return { lineStart, indent, atLineStart: before.trim().length === 0 };
}
