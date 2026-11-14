import { AXE_TAGS } from '@/lib/scan/report';
import { isImpact, type AxeResults, type AxeViolation } from '@/lib/types';
import type { Engine } from './types';
import { normalizeAxeResults } from './normalized';

export type AxeLike = {
  testEngine: { version: string };
  timestamp: string;
  testEnvironment?: unknown;
  violations: { id: string; impact?: string | null; tags: string[]; help: string; helpUrl: string; nodes: { target: unknown[]; html: string; impact?: string | null }[] }[];
};

function flattenTarget(target: readonly unknown[]): string[] {
  return target.map((part) => (Array.isArray(part) ? part.map(String).join(' ') : String(part))).filter((s) => s.trim().length > 0);
}

export function toAxeResults(url: string, axe: AxeLike, userAgent: string): AxeResults {
  const violations: AxeViolation[] = axe.violations
    .map((v) => ({
      id: v.id,
      impact: isImpact(v.impact) ? v.impact : null,
      tags: [...v.tags],
      help: v.help || v.id,
      helpUrl: v.helpUrl || `https://dequeuniversity.com/rules/axe/${v.id}`,
      nodes: v.nodes
        .map((n) => ({ target: flattenTarget(n.target), html: n.html, ...(n.impact !== undefined ? { impact: isImpact(n.impact) ? n.impact : null } : {}) }))
        .filter((n) => n.target.length > 0),
    }))
    .filter((v) => v.nodes.length > 0);
  return {
    url,
    timestamp: new Date(axe.timestamp).toISOString(),
    testEngine: { version: axe.testEngine.version },
    violations,
    toolOptions: { runOnly: { type: 'tag', values: [...AXE_TAGS] } },
    scanConfig: { source: 'a11ygate scan', readOnly: true, browser: 'chromium', userAgent },
    ...(axe.testEnvironment && typeof axe.testEnvironment === 'object' ? { testEnvironment: axe.testEnvironment as Record<string, unknown> } : {}),
    scanStatus: 'complete',
  };
}

/** Reuses the caller's browser page/session; does not navigate or launch browsers. */
export function createAxeEngine<Context>(analyze: (context: Context) => Promise<AxeLike>, userAgent: string): Engine<Context, AxeResults> {
  return {
    id: 'axe',
    displayName: 'axe-core',
    run: async (context, url) => toAxeResults(url, await analyze(context), userAgent),
    normalize: normalizeAxeResults,
  };
}
