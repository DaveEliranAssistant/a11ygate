import { freeTierAdapters } from '@/lib/modelfix/providers';
import type { ModelAdapter, ModelDraft, ModelDraftRequest } from '@/lib/modelfix/types';

/**
 * Built-in adapters, in design order: Groq → Gemini → Cloudflare Workers AI.
 * All free-tier; no paid adapter ships. Each is inert (`isConfigured` false,
 * no request) unless its credentials and an explicit model ID are set, and the
 * orchestrator only calls them with the repository opt-in, the provider
 * allowlist and a request budget. `stubAdapter` is for tests, never a default.
 */
export const BUILTIN_ADAPTERS: readonly ModelAdapter[] = freeTierAdapters();

/** Stub adapter that is configured but always fails. For fallback tests; makes no network request. */
export function failingAdapter(id: string, message = 'stub provider unavailable'): ModelAdapter {
  return {
    id,
    isConfigured: () => true,
    draft: async () => {
      throw new Error(message);
    },
  };
}

/** Stub adapter that returns a fixed draft. Its output is still validated and then discarded: there is no verifier yet. */
export function staticAdapter(id: string, make: (findingId: string, request: ModelDraftRequest) => ModelDraft): ModelAdapter {
  return {
    id,
    isConfigured: () => true,
    draft: async (request) => make(request.findingId, request),
  };
}

const NAME_RULES = new Set([
  'aria-command-name',
  'aria-dialog-name',
  'aria-input-field-name',
  'aria-meter-name',
  'aria-progressbar-name',
  'aria-toggle-field-name',
  'aria-tooltip-name',
  'aria-treeitem-name',
]);

/** Inserts ` name="value"` right after the first opening tag name in `lines`. */
function addAttribute(lines: readonly string[], name: string, value: string): string[] | null {
  for (let index = 0; index < lines.length; index += 1) {
    const match = /<([a-zA-Z][\w.:-]*)/.exec(lines[index]);
    if (!match) continue;
    const at = match.index + match[0].length;
    const next = [...lines];
    next[index] = `${lines[index].slice(0, at)} ${name}="${value}"${lines[index].slice(at)}`;
    return next;
  }
  return null;
}

/** Review comment placed on its own line above the range, in the file's comment syntax. */
function reviewComment(path: string, indent: string, text: string): string {
  return /\.(jsx|tsx)$/i.test(path) ? `${indent}{/* ${text} */}` : `${indent}<!-- ${text} -->`;
}

/**
 * Deterministic draft for a request, or null when the stub has nothing to offer.
 *
 * Never invents alt, label or accessible-name text: name rules get a
 * `TODO(a11ygate)` placeholder only, and contrast findings get a review
 * comment instead of guessed colours.
 */
export function stubDraft(request: ModelDraftRequest): ModelDraft | null {
  const base = {
    findingId: request.findingId,
    sourceBlobHash: request.sourceBlobHash,
    path: request.path,
    startLine: request.startLine,
    endLine: request.endLine,
    original: [...request.original],
  };
  if (request.ruleId === 'image-alt' || NAME_RULES.has(request.ruleId)) {
    const image = request.ruleId === 'image-alt';
    const replacement = image
      ? addAttribute(request.original, 'alt', 'TODO(a11ygate): describe this image or confirm it is decorative')
      : addAttribute(request.original, 'aria-label', 'TODO(a11ygate): name this control');
    if (!replacement) return null;
    return {
      ...base,
      replacement,
      rationale: `Stub draft: adds a ${image ? 'alt' : 'aria-label'} placeholder. A person must write the final text.`,
      humanReview: ['model-drafted', 'placeholder-accessible-name'],
    };
  }
  if (request.ruleId === 'color-contrast') {
    const indent = /^\s*/.exec(request.original[0] ?? '')?.[0] ?? '';
    return {
      ...base,
      replacement: [reviewComment(request.path, indent, 'TODO(a11ygate): raise text/background contrast; a person must pick the colours'), ...request.original],
      rationale: 'Stub draft: marks the element for a contrast fix. It does not choose colours.',
      humanReview: ['model-drafted'],
    };
  }
  return null;
}

/**
 * Offline stub provider. Returns a schema-valid draft for eligible fixture
 * findings, makes no network request and never runs a shell command. Only used
 * when a caller passes it explicitly; it is not a built-in adapter.
 */
export function stubAdapter(id = 'stub'): ModelAdapter {
  return {
    id,
    isConfigured: () => true,
    draft: async (request) => {
      const draft = stubDraft(request);
      if (!draft) throw new Error('stub adapter has no draft for this finding');
      return draft;
    },
  };
}
