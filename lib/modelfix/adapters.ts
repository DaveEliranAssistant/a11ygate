import type { ModelAdapter, ModelDraft } from '@/lib/modelfix/types';

/**
 * Built-in adapters. Empty in this phase: no live provider (Groq, Gemini,
 * Cloudflare Workers AI, paid fallbacks) is implemented, so a run with models
 * on always reports "no provider" and falls back to F1 with zero requests.
 */
export const BUILTIN_ADAPTERS: readonly ModelAdapter[] = [];

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

/** Stub adapter that returns a fixed draft. Its output is still discarded: there is no verifier yet. */
export function staticAdapter(id: string, make: (findingId: string) => ModelDraft): ModelAdapter {
  return {
    id,
    isConfigured: () => true,
    draft: async (request) => make(request.findingId),
  };
}
