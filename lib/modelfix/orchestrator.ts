import { planSuggestions } from '@/lib/fix/index';
import { lineOf } from '@/lib/fix/element';
import { mapFinding } from '@/lib/fix/mapper';
import type { FixFinding, FixOptions, PlanResult, SkipReason, SourceFile } from '@/lib/fix/types';
import { BUILTIN_ADAPTERS } from '@/lib/modelfix/adapters';
import { isProviderError } from '@/lib/modelfix/providers';
import { gitBlobHash, validateDraft } from '@/lib/modelfix/validate';
import {
  MODEL_ELIGIBLE_RULES,
  type CandidateVerification,
  type CandidateVerifier,
  type DraftRejectionCode,
  type ModelAdapter,
  type ModelDraftRequest,
  type ModelFixConfig,
  type ModelFixRun,
  type ModelOutcome,
  type ModelRunStatus,
  type PublishableCandidate,
  type ProviderRunState,
  type RouteRecord,
  type VerifyCandidate,
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
  /**
   * Isolated apply + re-scan verifier (lib/modelfix-verify). Without one, valid
   * drafts are discarded as `unverified-discarded`. Verified drafts are only
   * recorded; they are never merged into the F1 plan or published here.
   */
  verifier?: CandidateVerifier;
  /** Clock and randomness for cooldowns and jittered retries. Injected by tests. */
  clock?: ModelClock;
};

export type ModelClock = {
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Uniform [0, 1). */
  random(): number;
};

const SYSTEM_CLOCK: ModelClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: () => Math.random(),
};

/** Bounded retry policy for transient provider errors (5xx, network). Every attempt counts against the request budget. */
export const RETRY_POLICY = {
  /** Retries after the first attempt. */
  maxRetries: 2,
  baseDelayMs: 250,
  maxDelayMs: 2000,
} as const;

export type OrchestrateResult = {
  /** Always the F1 plan, unchanged. Model output is never merged into it. */
  plan: PlanResult;
  model: ModelFixRun;
  /**
   * Candidates the verifier marked verified, with their verification. Kept out
   * of `model` (which is logged). Input for the draft publisher only, which
   * still checks the combined verification and the tree hash before publishing.
   */
  verified: PublishableCandidate[];
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
  'verified-unpublished': 'Model drafting verified candidates in isolation; nothing was published. Rule-based suggestions only.',
  error: 'Model drafting skipped after an internal error. Rule-based suggestions only.',
};

function finish(
  status: ModelRunStatus,
  routes: RouteRecord[],
  modelRequests: number,
  outcome?: ModelOutcome,
  combined?: CandidateVerification | null,
  providers?: ProviderRunState[],
): ModelFixRun {
  if (outcome) {
    for (const route of routes) if (route.model && route.model.provider === null && route.model.outcome !== 'draft-rejected') route.model.outcome = outcome;
  }
  const run: ModelFixRun = { status, routes, modelRequests, message: MESSAGES[status] };
  if (combined !== undefined) run.combined = combined;
  if (providers) run.providers = providers;
  return run;
}

/**
 * Paid adapters need the separate paid opt-in and a positive cost budget.
 * Free-tier and offline adapters do not. No paid adapter ships today.
 */
function billingAllowed(adapter: ModelAdapter, config: ModelFixConfig): boolean {
  if (adapter.billing === 'paid') return config.allowPaid === true && config.maxCostUsd > 0;
  return adapter.billing === undefined || adapter.billing === 'free-tier';
}

const VERIFY_OUTCOME: Record<CandidateVerification['outcome'], ModelOutcome> = {
  verified: 'verified',
  rejected: 'verify-rejected',
  stale: 'stale-discarded',
};

async function safeVerify(run: () => Promise<CandidateVerification>, findingIds: string[]): Promise<CandidateVerification> {
  try {
    return await run();
  } catch {
    return { verified: false, outcome: 'rejected', reason: 'error', detail: 'verifier failed', findingIds, newFindings: 0 };
  }
}

async function runModelPath(input: OrchestrateInput, routes: RouteRecord[], publishable: PublishableCandidate[]): Promise<ModelFixRun> {
  const { config } = input;
  const eligible = routes.filter((route) => route.route === 'model-eligible');
  if (!config.enabled) return finish('disabled', routes, 0, 'models-off');
  if (eligible.length === 0) return finish('no-eligible-findings', routes, 0);

  const env = input.env ?? {};
  const clock = input.clock ?? SYSTEM_CLOCK;
  const allowed = new Set(config.providers);
  const adapters = (input.adapters ?? BUILTIN_ADAPTERS).filter((adapter) => {
    if (!allowed.has(adapter.id)) return false;
    if (!billingAllowed(adapter, config)) return false;
    try {
      return adapter.isConfigured(env) === true;
    } catch {
      return false;
    }
  });
  if (adapters.length === 0) return finish('no-provider', routes, 0, 'no-provider');
  if (config.maxRequests <= 0 || config.timeoutMs <= 0) return finish('no-budget', routes, 0, 'no-budget');

  const state = new Map<string, ProviderRunState>(adapters.map((adapter) => [adapter.id, { id: adapter.id, state: 'ready', cooldownUntil: null, requests: 0 }]));
  const providerStates = () => [...state.values()].map((item) => ({ ...item }));
  /** Ready now? A cooldown that has expired is cleared; an open circuit stays open for the run. */
  const usable = (id: string): boolean => {
    const item = state.get(id);
    if (!item || item.state === 'circuit-open') return false;
    if (item.state === 'cooldown') {
      if (item.cooldownUntil !== null && clock.now() >= item.cooldownUntil) {
        item.state = 'ready';
        item.cooldownUntil = null;
        return true;
      }
      return false;
    }
    return true;
  };
  const openCircuit = (id: string) => {
    const item = state.get(id);
    if (item) item.state = 'circuit-open';
  };
  const coolDown = (id: string, retryAfterMs: number | null) => {
    const item = state.get(id);
    if (!item) return;
    item.state = 'cooldown';
    // Without a reset signal the provider stays cooled for the rest of the run: never assume capacity came back.
    item.cooldownUntil = retryAfterMs === null ? Number.POSITIVE_INFINITY : clock.now() + retryAfterMs;
  };

  const verified: VerifyCandidate[] = [];
  let requests = 0;
  let overBudget = false;
  for (const route of eligible) {
    const request = draftRequest(route, input.files);
    if (!request || !route.model) continue;
    const content = input.files.find((item) => item.path === request.path)?.content ?? '';
    const rejections: DraftRejectionCode[] = [];
    providers: for (const adapter of adapters) {
      if (overBudget) break;
      if (!usable(adapter.id)) continue;
      try {
        // Sanitization pre-flight: a snippet that may not leave the machine is never sent or counted.
        if (adapter.accepts && adapter.accepts({ ...request, original: [...request.original] }) !== true) continue;
      } catch {
        continue;
      }
      for (let attempt = 0; ; attempt += 1) {
        if (requests >= config.maxRequests) {
          overBudget = true;
          break providers;
        }
        requests += 1;
        const tracked = state.get(adapter.id);
        if (tracked) tracked.requests += 1;
        let draft: unknown;
        try {
          draft = await withDeadline(config.timeoutMs, (signal) => adapter.draft({ ...request, original: [...request.original] }, signal));
        } catch (error) {
          if (isProviderError(error)) {
            if (error.kind === 'rate-limited' || error.kind === 'quota-exhausted') {
              // Respect the provider's reset signal and move to the next approved provider. Never wait here.
              coolDown(adapter.id, error.retryAfterMs);
              continue providers;
            }
            if (error.kind === 'invalid-output') {
              rejections.push(error.rejection ?? 'schema');
              continue providers;
            }
            if (error.kind === 'transient' && attempt < RETRY_POLICY.maxRetries && requests < config.maxRequests) {
              const ceiling = Math.min(RETRY_POLICY.maxDelayMs, RETRY_POLICY.baseDelayMs * 2 ** attempt);
              const delay = Math.floor(clock.random() * ceiling);
              // A provider-requested delay longer than the cap means: stop retrying, open the circuit.
              if (error.retryAfterMs === null || error.retryAfterMs <= RETRY_POLICY.maxDelayMs) {
                await clock.sleep(Math.max(delay, error.retryAfterMs ?? 0));
                continue;
              }
            }
          }
          // Timeouts, auth, unavailable model/region, exhausted retries and unknown errors open the circuit for
          // the rest of the run. A timed-out request already counted against the budget. Error text is not logged.
          openCircuit(adapter.id);
          continue providers;
        }
        // Untrusted output: validate before anything else may look at it.
        const result = validateDraft(draft, { request, content, repoRoot: input.repoRoot });
        if (!result.ok) {
          // Never applied, published or logged; only the rejection code is kept. Try the next provider.
          rejections.push(result.rejection.code);
          continue providers;
        }
        if (!input.verifier) {
          // No verifier configured: discard, never publish.
          route.model = { outcome: 'unverified-discarded', provider: adapter.id };
          break providers;
        }
        const candidate: VerifyCandidate = { validated: result.value, ruleId: route.ruleId, targetHtml: findingHtml(input, route), sourceCommit: route.sourceCommit ?? '' };
        const verifier = input.verifier;
        const check = await safeVerify(() => verifier.verify(candidate), [route.fingerprint]);
        route.model = { outcome: VERIFY_OUTCOME[check.outcome], provider: adapter.id, verification: check.reason };
        if (check.verified) {
          verified.push(candidate);
          publishable.push({ candidate, verification: check, provider: adapter.id });
        }
        break providers;
      }
    }
    if (route.model.provider === null) {
      if (rejections.length > 0) route.model = { outcome: 'draft-rejected', provider: null, rejections };
      else route.model.outcome = overBudget ? 'over-budget' : 'adapters-failed';
    }
  }
  const providers = providerStates();
  if (providers.every((item) => item.state !== 'ready')) return finish('adapters-failed', routes, requests, 'adapters-failed', undefined, providers);
  if (overBudget) return finish('over-budget', routes, requests, 'over-budget', undefined, providers);
  if (verified.length === 0) return finish('no-verified-candidate', routes, requests, undefined, undefined, providers);
  // Candidates that pass alone must also pass together before any later publisher may use them.
  let combined: CandidateVerification | null = null;
  if (verified.length > 1 && input.verifier) {
    const verifier = input.verifier;
    combined = await safeVerify(() => verifier.verifyCombined(verified), verified.map((item) => item.validated.draft.findingId));
  }
  return finish('verified-unpublished', routes, requests, undefined, combined, providers);
}

function findingHtml(input: OrchestrateInput, route: RouteRecord): string {
  return input.findings.find((finding) => finding.fingerprint === route.fingerprint)?.html ?? '';
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
  const verified: PublishableCandidate[] = [];
  try {
    routes = routeFindings(input.findings, input.files, plan, sourceCommit);
    return { plan, model: await runModelPath(input, routes, verified), verified };
  } catch {
    return { plan, model: finish('error', routes, 0), verified: [] };
  }
}
