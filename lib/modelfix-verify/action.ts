import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CandidateVerifier } from '@/lib/modelfix/types';
import { resolveCommit } from './git';
import { createLocalAxeRescanner, type RescanModules, type Rescanner } from './rescan';
import { createIsolatedVerifier } from './verify';

/**
 * GitHub Action wiring for the isolated verifier (A11Y-R6). Bundled separately
 * as `action/dist/modelfix-verify.mjs` and only loaded when model fixes are on
 * and the repository opted in. Playwright and @axe-core/playwright are optional
 * peers resolved from the consumer's checkout; when they or Chromium are
 * missing, verification fails closed (nothing verifies, nothing is published).
 */

const MAX_ROUTES = 20;
const SAFE_ROUTE = /^[A-Za-z0-9._~/-]*$/;
const SAFE_TAG = /^[a-z0-9-]+$/;

type AxeInput = { url?: unknown; toolOptions?: { runOnly?: { type?: unknown; values?: unknown } } };

function asList(value: unknown): AxeInput[] {
  if (Array.isArray(value)) return value.filter((item) => item && typeof item === 'object') as AxeInput[];
  return value && typeof value === 'object' ? [value as AxeInput] : [];
}

/** Local route for a scanned page URL: its path without the leading slash. Null for unsafe or non-http(s) URLs. */
export function routeFromUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  let route: string;
  try {
    route = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
  } catch {
    return null;
  }
  if (!SAFE_ROUTE.test(route) || route.split('/').includes('..')) return null;
  return route === '' || route.endsWith('/') ? `${route}index.html` : route;
}

/**
 * Re-scan routes and axe tags from the current axe JSON inputs (the pages that
 * were scanned). Routes are served from the local checkout, never fetched from
 * the original URL. Tags come from `toolOptions.runOnly` when every input
 * agrees, so the re-scan uses the same rules as the original scan.
 */
export function rescanPlanFromAxeInputs(inputs: readonly unknown[]): { routes: string[]; tags: string[] | null } {
  const routes: string[] = [];
  const tagSets = new Set<string>();
  let tags: string[] | null = null;
  for (const input of inputs) {
    for (const item of asList(input)) {
      const route = routeFromUrl(item.url);
      if (route !== null && !routes.includes(route) && routes.length < MAX_ROUTES) routes.push(route);
      const runOnly = item.toolOptions?.runOnly;
      const values = Array.isArray(runOnly?.values) ? runOnly.values.filter((value): value is string => typeof value === 'string' && SAFE_TAG.test(value)) : [];
      if (runOnly?.type === 'tag' && values.length > 0) {
        const keyed = [...values].sort().join(',');
        tagSets.add(keyed);
        tags = [...values];
      } else {
        tagSets.add('');
      }
    }
  }
  return { routes, tags: tagSets.size === 1 && tags ? tags : null };
}

/** Loads Playwright and @axe-core/playwright from the consumer's checkout first, then from the Action's own install. */
export function workspaceLoader(workspace: string): () => Promise<RescanModules> {
  return async () => {
    const fromWorkspace = async (name: string) => {
      const require = createRequire(path.join(workspace, 'package.json'));
      return import(pathToFileURL(require.resolve(name)).href);
    };
    const load = async (name: string) => {
      try {
        return await fromWorkspace(name);
      } catch {
        return import(name);
      }
    };
    const playwright = await load('playwright');
    const axe = await load('@axe-core/playwright');
    return { playwright: (playwright.default?.chromium ? playwright.default : playwright) as RescanModules['playwright'], axe: axe as RescanModules['axe'] };
  };
}

export type ActionVerifierInput = {
  /** The checked-out repository (GITHUB_WORKSPACE). */
  workspace: string;
  /** Pull request head commit; the checkout must be at this commit. */
  headSha: string;
  routes: readonly string[];
  tags?: readonly string[] | null;
  warn: (message: string) => void;
  /** Test seam; defaults to `workspaceLoader(workspace)`. */
  load?: () => Promise<RescanModules>;
};

export type ActionVerifier = { verifier: CandidateVerifier; routes: string[]; close: () => Promise<void> };

/**
 * Builds the isolated verifier for the Action, or null (with a sanitized
 * warning) when it cannot run. Null means drafts are discarded unverified.
 * A browser that fails to launch makes every verification fail closed.
 */
export async function createActionVerifier(input: ActionVerifierInput): Promise<ActionVerifier | null> {
  const routes = [...input.routes];
  if (routes.length === 0) {
    input.warn('A11yGate model verifier skipped: no local routes could be derived from the scanned pages. Drafts are discarded.');
    return null;
  }
  if (!input.workspace || !existsSync(path.join(input.workspace, '.git'))) {
    input.warn('A11yGate model verifier skipped: the workspace is not a git checkout. Drafts are discarded.');
    return null;
  }
  if (!/^[0-9a-f]{40}$/.test(input.headSha) || (await resolveCommit(input.workspace, 'HEAD')) !== input.headSha) {
    input.warn(
      'A11yGate model verifier skipped: the checkout is not the pull request head commit (use actions/checkout with ref: ${{ github.event.pull_request.head.sha }}). Drafts are discarded.',
    );
    return null;
  }
  const load = input.load ?? workspaceLoader(input.workspace);
  let warned = false;
  const guardedLoad = async () => {
    try {
      return await load();
    } catch (error) {
      if (!warned) {
        warned = true;
        input.warn('A11yGate model verifier could not load Playwright or @axe-core/playwright. Verification fails closed; nothing is published.');
      }
      throw error;
    }
  };
  const inner: Rescanner = createLocalAxeRescanner({ tags: input.tags ?? undefined, load: guardedLoad });
  const rescanner: Rescanner = {
    tags: inner.tags,
    async scan(request) {
      try {
        return await inner.scan(request);
      } catch (error) {
        if (!warned) {
          warned = true;
          input.warn('A11yGate model verifier could not start a local Chromium re-scan (is Playwright Chromium installed?). Verification fails closed; nothing is published.');
        }
        throw error;
      }
    },
    close: () => inner.close().catch(() => undefined),
  };
  const verifier = createIsolatedVerifier({ repoRoot: input.workspace, rescanner, routes, headRef: 'HEAD' });
  return { verifier, routes, close: () => rescanner.close() };
}
