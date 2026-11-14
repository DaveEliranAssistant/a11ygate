import { planSuggestions } from '@/lib/fix/index';
import { lineOf } from '@/lib/fix/element';
import { mapFinding } from '@/lib/fix/mapper';
import type { FixFinding, FixOptions, PlanResult, SkipReason, SourceFile } from '@/lib/fix/types';
import { BUILTIN_ADAPTERS } from '@/lib/modelfix/adapters';
import { gitBlobHash, validateDraft } from '@/lib/modelfix/validate';
import {
  MODEL_ELIGIBLE_RULES,
  type DraftRejectionCode,
  type ModelAdapter,
  type ModelDraftRequest,
  type ModelFixConfig,
  type ModelFixRun,
  type ModelOutcome,
  type ModelRunStatus,
  type RouteRecord,
} from '@/lib/modelfix/types';

/** F1 skip reasons that mean "no deterministic patch" for a uniquely mapped, new finding. */
const NO_F1_PATCH: ReadonlySet<SkipReason> = new Set(['unsupported-rule', 'no-safe-fix']);

type Env = Readonly<Record<string, string | undefined>>;

export type OrchestrateInput = {
  findings: readonly FixFinding[];
  files: readonly SourceFile[];
  options?: FixOptions;
  config: ModelFixConfig;
  /** The F1 plan already computed by the caller. Computed here when absent. */
  f1Plan?: PlanResult;
  /** Candidate adapters, in provider order. Defaults to the built-in list (empty in this phase). */
  adapters?: readonly ModelAdapter[];
  env?: Env;
  sourceCommit?: string | null;
  /** Repository root on disk. When set, the validator also rejects symlink escapes. */
  repoRoot?: string;
};

export type OrchestrateResult = {
  /** Always the F1 plan, unchanged. Model output is never merged into it. */
  plan: PlanResult;
  model: ModelFixRun;
};

/**
 * Routes findings between F1 and a future model draft. F1 always runs first
 * and its plan is returned untouched; this phase never publishes model output.
 */
export function routeFindings(
  findings: readonly FixFinding[],
  files: readonly SourceFile[],
  plan: PlanResult,
  sourceCommit: string | null,
): RouteRecord[] {
  const suggested = new Map(plan.suggestions.map((s) => [s.fingerprint, s]));
  const skipped = new Map(plan.skipped.map((s) => [s.fingerprint, s.reason]));
  return findings.map((finding) => {
    const base = { fingerprint: finding.fingerprint, ruleId: finding.ruleId, sourceCommit };
    const suggestion = suggested.get(finding.fingerprint);
    if (suggestion) {
      return { ...base, route: 'f1', f1Skip: null, path: suggestion.path, startLine: suggestion.startLine, endLine: suggestion.endLine, model: null };
    }
    const f1Skip = skipped.get(finding.fingerprint) ?? null;
    if (f1Skip && NO_F1_PATCH.has(f1Skip) && MODEL_ELIGIBLE_RULES.has(finding.ruleId)) {
      const mapped = mapFinding(finding.html, files);
      if (mapped.status === 'matched') {
        const { file, tag } = mapped.element;
        return {
          ...base,
          route: 'model-eligible',
          f1Skip,
          path: file.path,
          startLine: lineOf(file.content, tag.start),
          endLine: lineOf(file.content, tag.end),
          model: { outcome: 'models-off', provider: null },
        };
      }
    }
    return { ...base, route: 'report-only', f1Skip, path: null, startLine: null, endLine: null, model: null };
  });
}

function draftRequest(route: RouteRecord, files: readonly SourceFile[]): ModelDraftRequest | null {
  const file = files.find((item) => item.path === route.path);
  if (!file || route.startLine === null || route.endLine === null) return null;
  return {
    findingId: route.fingerprint,
    ruleId: route.ruleId,
    sourceCommit: route.sourceCommit,
    path: file.path,
    startLine: route.startLine,
    endLine: route.endLine,
    original: file.content.split('\n').slice(route.startLine - 1, route.endLine).map((line) => line.replace(/\r$/, '')),
    sourceBlobHash: gitBlobHash(file.content),
  };
}

async function withDeadline<T>(timeoutMs: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('timeout'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

const MESSAGES: Record<ModelRunStatus, string> = {
  disabled: 'Model drafting is off. Rule-based suggestions only.',
  'no-eligible-findings': 'Model drafting skipped: no eligible findings. Rule-based suggestions only.',
  'no-provider': 'Model drafting skipped: no provider configured. Rule-based suggestions only.',
  'no-budget': 'Model drafting skipped: no request budget or timeout configured. Rule-based suggestions only.',
  'over-budget': 'Model drafting stopped: request budget used up. Rule-based suggestions only.',
  'adapters-failed': 'Model drafting skipped: every provider failed. Rule-based suggestions only.',
  'no-verified-candidate': 'Model drafting produced no verified candidate. Rule-based suggestions only.',
  error: 'Model drafting skipped after an internal error. Rule-based suggestions only.',
};

function finish(status: ModelRunStatus, routes: RouteRecord[], modelRequests: number, outcome?: ModelOutcome): ModelFixRun {
  if (outcome) {
    for (const route of routes) if (route.model && route.model.provider === null && route.model.outcome !== 'draft-rejected') route.model.outcome = outcome;
  }
  return { status, routes, modelRequests, message: MESSAGES[status] };
}

async function runModelPath(input: OrchestrateInput, routes: RouteRecord[]): Promise<ModelFixRun> {
  const { config } = input;
  const eligible = routes.filter((route) => route.route === 'model-eligible');
  if (!config.enabled) return finish('disabled', routes, 0, 'models-off');
  if (eligible.length === 0) return finish('no-eligible-findings', routes, 0);

  const env = input.env ?? {};
  const allowed = new Set(config.providers);
  const adapters = (input.adapters ?? BUILTIN_ADAPTERS).filter((adapter) => {
    if (!allowed.has(adapter.id)) return false;
    try {
      return adapter.isConfigured(env) === true;
    } catch {
      return false;
    }
  });
  if (adapters.length === 0) return finish('no-provider', routes, 0, 'no-provider');
  if (config.maxRequests <= 0 || config.timeoutMs <= 0) return finish('no-budget', routes, 0, 'no-budget');

  const failed = new Set<string>();
  let requests = 0;
  let overBudget = false;
  for (const route of eligible) {
    const request = draftRequest(route, input.files);
    if (!request || !route.model) continue;
    const content = input.files.find((item) => item.path === request.path)?.content ?? '';
    const rejections: DraftRejectionCode[] = [];
    for (const adapter of adapters) {
      if (failed.has(adapter.id)) continue;
      if (requests >= config.maxRequests) {
        overBudget = true;
        break;
      }
      requests += 1;
      try {
        const draft: unknown = await withDeadline(config.timeoutMs, (signal) => adapter.draft({ ...request, original: [...request.original] }, signal));
        // Untrusted output: validate before anything else may look at it.
        const result = validateDraft(draft, { request, content, repoRoot: input.repoRoot });
        if (!result.ok) {
          // Never applied, published or logged; only the rejection code is kept. Try the next provider.
          rejections.push(result.rejection.code);
          continue;
        }
        // No isolated apply or re-scan exists yet: discard, never publish.
        route.model = { outcome: 'unverified-discarded', provider: adapter.id };
        break;
      } catch {
        // Circuit opens for the rest of the run; the error text is not logged.
        failed.add(adapter.id);
      }
    }
    if (route.model.provider === null) {
      if (rejections.length > 0) route.model = { outcome: 'draft-rejected', provider: null, rejections };
      else route.model.outcome = overBudget ? 'over-budget' : 'adapters-failed';
    }
  }
  if (failed.size === adapters.length) return finish('adapters-failed', routes, requests, 'adapters-failed');
  if (overBudget) return finish('over-budget', routes, requests, 'over-budget');
  return finish('no-verified-candidate', routes, requests);
}

/**
 * Plans suggestions with the optional model path. The returned `plan` is the
 * F1 plan, byte-for-byte; when models are off, unconfigured, failing or over
 * budget, no model output exists anywhere in the result. Never throws because
 * of the model path.
 */
export async function planWithModelFixes(input: OrchestrateInput): Promise<OrchestrateResult> {
  const plan = input.f1Plan ?? planSuggestions(input.findings, input.files, input.options ?? {});
  const sourceCommit = input.sourceCommit ?? null;
  let routes: RouteRecord[] = [];
  try {
    routes = routeFindings(input.findings, input.files, plan, sourceCommit);
    return { plan, model: await runModelPath(input, routes) };
  } catch {
    return { plan, model: finish('error', routes, 0) };
  }
}
