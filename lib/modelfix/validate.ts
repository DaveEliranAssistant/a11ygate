import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import {
  DRAFT_LIMITS,
  HUMAN_REVIEW_FLAGS,
  type DraftRejectionCode,
  type DraftValidation,
  type HumanReviewFlag,
  type ModelDraft,
  type ModelDraftRequest,
} from '@/lib/modelfix/types';

/**
 * Strict validator for model drafts (design: docs/design/model-written-fix-prs.md §2, §7).
 *
 * Every draft is untrusted input. This module is pure apart from optional
 * read-only `lstat`/`realpath` calls for the symlink check: it never runs a
 * shell, never evaluates draft content, and makes no network request.
 */

const PLACEHOLDER = 'TODO(a11ygate)';

/**
 * Source blob hash: the Git blob SHA-1 of the whole file content, as
 * `git hash-object` and the GitHub contents API compute it
 * (`sha1("blob " + byteLength + "\0" + content)`). One hash per file, so a draft
 * written against any other version of the file is rejected.
 */
export function gitBlobHash(content: string): string {
  const body = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');
}

const DRAFT_KEYS = ['findingId', 'sourceBlobHash', 'path', 'startLine', 'endLine', 'original', 'replacement', 'rationale', 'humanReview'] as const;
/** Keys that would smuggle more files or raw patches into a single-file draft. */
const MULTI_FILE_KEYS = new Set(['files', 'edits', 'patches', 'patch', 'diff', 'additionalFiles', 'changes', 'paths']);

/**
 * Files that configure the scanner, the gate, CI or the build/test tooling.
 * Editing them could weaken the gate, so drafts may never target them.
 */
const SCANNER_CONFIG: readonly RegExp[] = [
  /(^|\/)\.?a11ygate\.ya?ml$/i,
  /(^|\/)\.?a11ygate(rc)?(\.[a-z]+)?$/i,
  /(^|\/)\.axerc(\.[a-z]+)?$/i,
  /(^|\/)axe(\.config)?\.(json|js|cjs|mjs|ts|ya?ml)$/i,
  /(^|\/)\.?lighthouserc(\.[a-z]+)?$/i,
  /(^|\/)\.?pa11y(ci|rc)?(\.[a-z]+)?$/i,
  /(^|\/)\.htmlcsrc(\.[a-z]+)?$/i,
  /(^|\/)\.github\//i,
  /(^|\/)action\.ya?ml$/i,
  /(^|\/)\.gitlab-ci\.ya?ml$/i,
  /(^|\/)(package|package-lock|npm-shrinkwrap)\.json$/i,
  /(^|\/)(yarn\.lock|pnpm-lock\.yaml)$/i,
  /(^|\/)(playwright|vitest|jest|cypress)\.config\.[a-z]+$/i,
  /(^|\/)(eslint\.config\.[a-z]+|\.eslintrc(\.[a-z]+)?)$/i,
  /(^|\/)(stylelint\.config\.[a-z]+|\.stylelintrc(\.[a-z]+)?)$/i,
];

/** Test files: a draft may not edit (or empty) them. */
const TEST_FILE: readonly RegExp[] = [/(^|\/)(tests?|__tests__|e2e|spec)\//i, /\.(test|spec)\.[a-z]+$/i];

/** Markers that suppress or hide a check. Rejected when the replacement adds one. */
const SUPPRESSION: readonly RegExp[] = [
  /eslint-disable/i,
  /stylelint-disable/i,
  /@ts-(ignore|nocheck|expect-error)/i,
  /axe-(skip|ignore|disable)/i,
  /data-axe-[a-z-]*/i,
  /a11ygate-(skip|ignore|disable)/i,
  /htmlcs-(ignore|skip|disable)/i,
  /pa11y-(ignore|skip|disable)/i,
  /lighthouse-(ignore|skip|disable)/i,
  /\bnoqa\b/i,
  /aria-hidden\s*=\s*["'{]?\s*true/i,
  /\brole\s*=\s*["'{]?\s*(presentation|none)\b/i,
  /\balt\s*=\s*(""|''|\{\s*(""|''|``)\s*\})/i,
  /display\s*:\s*["']?none/i,
  /visibility\s*:\s*["']?hidden/i,
  /\bhidden\b(?=[\s>=/])/i,
  /opacity\s*:\s*["']?0(\.0+)?\s*[;"'}]/i,
];

/** Executable content. Rejected when the replacement adds one. */
const EXECUTABLE: readonly RegExp[] = [
  /<\s*script\b/i,
  /javascript\s*:/i,
  /\son[a-z]+\s*=/i,
  /<\s*(iframe|object|embed|base|meta)\b/i,
  /\bsrcdoc\s*=/i,
  /dangerouslySetInnerHTML/,
  /\binnerHTML\b/,
  /\beval\s*\(/,
  /\bnew\s+Function\b/,
  /\b(require|import)\s*\(/,
  /child_process/,
  /^\s*#!/m,
];

/** Attributes that set an image alternative or an accessible name/description. */
const NAME_ATTRS = ['alt', 'aria-label', 'aria-labelledby', 'aria-description', 'aria-describedby', 'title', 'label'];
const NAME_ATTR = new RegExp(`(?:^|[\\s<])(${NAME_ATTRS.join('|')})\\s*=\\s*("[^"]*"|'[^']*'|\\{[^}]*\\}|[^\\s>]+)`, 'gi');
const PRESENTATION_ATTR = /(?:^|[\s<])(style|class|className|color|bgcolor|background)\s*=\s*("[^"]*"|'[^']*'|\{[^}]*\}|[^\s>]+)/gi;
const CSS_COLOR = /\b(color|background(?:-color)?|fill|stroke)\s*:[^;"'}]*/gi;

function count(text: string, pattern: RegExp): number {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  return (text.match(new RegExp(pattern.source, flags)) ?? []).length;
}

/** First pattern that appears more often in `after` than in `before`. */
function added(before: string, after: string, patterns: readonly RegExp[]): RegExp | null {
  return patterns.find((pattern) => count(after, pattern) > count(before, pattern)) ?? null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isLine(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

type Fail = { code: DraftRejectionCode; detail: string };

/** Structural schema check. Returns the typed draft or the reason it is malformed. */
function parseSchema(input: unknown): ModelDraft | Fail {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { code: 'schema', detail: 'draft is not an object' };
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (MULTI_FILE_KEYS.has(key)) return { code: 'extra-file', detail: `draft carries extra file entries (${key})` };
    if (!(DRAFT_KEYS as readonly string[]).includes(key)) return { code: 'schema', detail: `unknown field ${key}` };
  }
  for (const key of DRAFT_KEYS) if (!(key in record)) return { code: 'schema', detail: `missing field ${key}` };
  const { findingId, sourceBlobHash, path: file, startLine, endLine, original, replacement, rationale, humanReview } = record;
  if (typeof findingId !== 'string' || !findingId) return { code: 'schema', detail: 'findingId must be a non-empty string' };
  if (typeof sourceBlobHash !== 'string' || !/^[0-9a-f]{40}$/.test(sourceBlobHash)) return { code: 'schema', detail: 'sourceBlobHash must be 40 lower-case hex characters' };
  if (typeof file !== 'string') return { code: 'schema', detail: 'path must be a string' };
  if (!isLine(startLine) || !isLine(endLine) || endLine < startLine) return { code: 'schema', detail: 'startLine/endLine must be positive integers with endLine >= startLine' };
  if (!isStringArray(original) || !isStringArray(replacement)) return { code: 'schema', detail: 'original and replacement must be string arrays' };
  if (typeof rationale !== 'string' || !rationale.trim()) return { code: 'schema', detail: 'rationale must be a non-empty string' };
  if (rationale.length > DRAFT_LIMITS.maxRationaleLength) return { code: 'oversize', detail: 'rationale too long' };
  if (!isStringArray(humanReview) || !humanReview.every((flag) => (HUMAN_REVIEW_FLAGS as readonly string[]).includes(flag))) {
    return { code: 'schema', detail: 'humanReview must list known flags only' };
  }
  return input as ModelDraft;
}

/** Rejects paths that are not plain, repository-relative, `/`-separated paths. */
function unsafePath(file: string): string | null {
  if (!file) return 'empty path';
  if (file.includes('\0')) return 'null byte in path';
  if (/[\u0000-\u001f\u007f]/.test(file)) return 'control character in path';
  if (file.includes('\\')) return 'backslash in path';
  if (file.startsWith('/') || /^[a-z]:/i.test(file) || file.startsWith('~')) return 'absolute path';
  if (/%2e|%2f|%5c/i.test(file)) return 'encoded path separator';
  const segments = file.split('/');
  if (segments.some((segment) => segment === '..')) return 'parent directory segment';
  if (segments.some((segment) => segment === '' || segment === '.')) return 'non-normalized path';
  if (path.posix.normalize(file) !== file) return 'non-normalized path';
  return null;
}

/** Resolves `file` under `repoRoot` and rejects any symlink that leaves the root. */
function symlinkEscape(repoRoot: string, file: string): Fail | null {
  let root: string;
  try {
    root = realpathSync(repoRoot);
  } catch {
    return { code: 'missing-file', detail: 'repository root not found' };
  }
  const target = path.join(root, ...file.split('/'));
  try {
    lstatSync(target);
  } catch {
    return { code: 'missing-file', detail: 'file not found under the repository root' };
  }
  let real: string;
  try {
    real = realpathSync(target);
  } catch {
    return { code: 'symlink-escape', detail: 'path does not resolve inside the repository' };
  }
  const relative = path.relative(root, real);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return { code: 'symlink-escape', detail: 'path resolves outside the repository root' };
  }
  return null;
}

function attrValues(text: string, pattern: RegExp): Map<string, string[]> {
  const values = new Map<string, string[]>();
  for (const match of text.matchAll(pattern)) {
    const name = match[1].toLowerCase();
    values.set(name, [...(values.get(name) ?? []), match[2]]);
  }
  return values;
}

/** Visible text: tags, comments and JSX comment containers removed, whitespace collapsed. */
function visibleText(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Presentation fingerprint: style/class attribute values and CSS colour declarations, in order. */
function presentation(text: string): string {
  return JSON.stringify([...attrValues(text, PRESENTATION_ATTR)], null, 0) + (text.match(CSS_COLOR) ?? []).join('|');
}

/** Flags the validator requires for a change, whatever the adapter declared (design §7). */
export function requiredReviewFlags(original: string, replacement: string): HumanReviewFlag[] {
  const flags = new Set<HumanReviewFlag>(['model-drafted']);
  const nameFlag = (text: string): HumanReviewFlag => (text.includes(PLACEHOLDER) ? 'placeholder-accessible-name' : 'generated-accessible-name');
  const before = attrValues(original, NAME_ATTR);
  for (const [name, values] of attrValues(replacement, NAME_ATTR)) {
    const previous = before.get(name) ?? [];
    for (const value of values) if (!previous.includes(value)) flags.add(nameFlag(value));
  }
  const textBefore = visibleText(original);
  const textAfter = visibleText(replacement);
  if (textBefore !== textAfter) {
    flags.add('visible-text-changed');
    // Element text can be an accessible name (button, link, label): new wording is treated as generated.
    flags.add(nameFlag(textAfter));
  }
  if (presentation(original) !== presentation(replacement)) flags.add('visual-change');
  return HUMAN_REVIEW_FLAGS.filter((flag) => flags.has(flag));
}

export type ValidateContext = {
  /** The request the draft answers. Its path/range/hash are the only allowed scope. */
  request: ModelDraftRequest;
  /** Current content of the requested file at the scanned commit. */
  content: string;
  /** Repository root on disk. When set, the path is resolved and symlink escapes are rejected. */
  repoRoot?: string;
};

/**
 * Validates one untrusted draft against its request. Never throws and never
 * executes anything from the draft. A rejected draft must not be applied,
 * published or echoed into any comment.
 */
export function validateDraft(input: unknown, context: ValidateContext): DraftValidation {
  try {
    return validate(input, context);
  } catch {
    return { ok: false, rejection: { code: 'schema', detail: 'draft could not be read' } };
  }
}

function reject(code: DraftRejectionCode, detail: string): DraftValidation {
  return { ok: false, rejection: { code, detail } };
}

function validate(input: unknown, { request, content, repoRoot }: ValidateContext): DraftValidation {
  const parsed = parseSchema(input);
  if ('code' in parsed) return reject(parsed.code, parsed.detail);
  const draft = parsed;

  if (draft.findingId !== request.findingId) return reject('finding-mismatch', 'draft answers a different finding');

  const unsafe = unsafePath(draft.path);
  if (unsafe) return reject('path-traversal', unsafe);
  if (SCANNER_CONFIG.some((pattern) => pattern.test(draft.path))) return reject('scanner-config', 'draft targets scanner, CI or gate configuration');
  if (TEST_FILE.some((pattern) => pattern.test(draft.path))) return reject('check-suppression', 'draft targets a test file');
  if (draft.path !== request.path) return reject('extra-file', 'draft names a file outside the request');
  if (repoRoot !== undefined) {
    const escape = symlinkEscape(repoRoot, draft.path);
    if (escape) return reject(escape.code, escape.detail);
  }

  if (draft.startLine !== request.startLine || draft.endLine !== request.endLine) return reject('range-mismatch', 'draft range differs from the request');
  const blob = gitBlobHash(content);
  if (draft.sourceBlobHash !== blob || request.sourceBlobHash !== blob) return reject('blob-mismatch', 'source blob hash does not match the file');
  const lines = content.split('\n').map((line) => line.replace(/\r$/, ''));
  if (draft.endLine > lines.length) return reject('range-mismatch', 'range is past the end of the file');
  const actual = lines.slice(draft.startLine - 1, draft.endLine);
  if (draft.original.length !== actual.length || draft.original.some((line, index) => line !== actual[index])) {
    return reject('original-mismatch', 'original text does not match the file at the range');
  }

  const replacement = draft.replacement.join('\n');
  const original = draft.original.join('\n');
  if (Buffer.byteLength(replacement, 'utf8') > DRAFT_LIMITS.maxReplacementBytes) return reject('oversize', 'replacement over the byte cap');
  if (draft.replacement.length > DRAFT_LIMITS.maxReplacementLines) return reject('oversize', 'replacement over the line cap');
  if (draft.replacement.length > draft.original.length + DRAFT_LIMITS.maxExtraLines) return reject('oversize', 'replacement grows the range too much');
  if (draft.replacement.some((line) => line.length > DRAFT_LIMITS.maxLineLength)) return reject('oversize', 'replacement line too long');
  if (draft.replacement.some((line) => /[\n\r\u0000]/.test(line))) return reject('schema', 'replacement lines must not contain line breaks or null bytes');
  if (!replacement.trim()) return reject('empty-replacement', 'drafts may not delete the range');
  if (replacement === original) return reject('no-change', 'replacement equals the original');

  if (added(original, replacement, SUPPRESSION)) return reject('check-suppression', 'replacement adds a check suppression or hides content');
  if (added(original, replacement, EXECUTABLE)) return reject('executable-payload', 'replacement adds executable content');

  const required = requiredReviewFlags(original, replacement);
  const flags = new Set<HumanReviewFlag>([...draft.humanReview, ...required]);
  const humanReview = HUMAN_REVIEW_FLAGS.filter((flag) => flags.has(flag));
  return {
    ok: true,
    value: {
      draft,
      humanReview,
      needsHumanReview: true,
      requiresAcknowledgement: humanReview.includes('generated-accessible-name') || humanReview.includes('placeholder-accessible-name'),
    },
  };
}
