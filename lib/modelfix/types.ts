import type { SkipReason } from '@/lib/fix/types';

/**
 * Types for the optional model-assisted fix path (design: docs/design/model-written-fix-prs.md).
 *
 * Phase 2 skeleton only: no live provider adapters, isolated apply, re-scan
 * verifier or draft publisher exist yet. Model output is never published.
 */

/** Exact repository config file name, read from the workspace root. */
export const REPO_CONFIG_FILE = '.a11ygate.yml';

/** Result of reading the repository's own opt-in. Anything but `opted-in` is a denial. */
export type RepoConsent = 'opted-in' | 'denied' | 'missing' | 'invalid';

export type ModelFixSwitch = 'on' | 'off';

export type ModelFixConfigReason =
  | 'enabled'
  /** Neither the flag nor the env asked for model fixes. */
  | 'default-off'
  /** The flag or env explicitly turned model fixes off. */
  | 'turned-off'
  /** Repository has no config file or no `modelFixes` key. */
  | 'repo-missing'
  /** Repository config says `modelFixes: false`. */
  | 'repo-denied'
  /** Repository config has an unreadable `modelFixes` value. Treated as a denial. */
  | 'repo-invalid';

export type ModelFixConfig = {
  enabled: boolean;
  reason: ModelFixConfigReason;
  repo: RepoConsent;
  /** Requested state from `--model-fixes` / `A11YGATE_MODEL_FIXES`, null when neither is set. */
  requested: ModelFixSwitch | null;
  /** `A11YGATE_MODEL_PROVIDERS` allowlist, lower-case, in the given order. */
  providers: string[];
  /** `A11YGATE_MODEL_MAX_REQUESTS`. 0 (the default) means no request budget. */
  maxRequests: number;
  /** `A11YGATE_MODEL_TIMEOUT_MS`. 0 (the default) means no deadline was set, so no request is made. */
  timeoutMs: number;
  /** Sanitized notes about ignored or invalid settings. Never contains secrets. */
  warnings: string[];
};

/** Rules a future model draft may address, and only when F1 has no adequate suggestion. */
export const MODEL_ELIGIBLE_RULES: ReadonlySet<string> = new Set([
  'color-contrast',
  'image-alt',
  // ARIA accessible-name rules.
  'aria-command-name',
  'aria-dialog-name',
  'aria-input-field-name',
  'aria-meter-name',
  'aria-progressbar-name',
  'aria-toggle-field-name',
  'aria-tooltip-name',
  'aria-treeitem-name',
]);

/**
 * How a finding is routed.
 * - `f1`: the rule-based planner produced a suggestion. It always wins.
 * - `model-eligible`: eligible rule, uniquely mapped, and F1 has no deterministic patch.
 * - `report-only`: stays in the ordinary report with no suggested change.
 */
export type ModelRoute = 'f1' | 'model-eligible' | 'report-only';

/** What happened on the model path for a `model-eligible` finding. */
export type ModelOutcome =
  | 'models-off'
  | 'no-provider'
  | 'no-budget'
  | 'over-budget'
  | 'adapters-failed'
  /** A draft came back but no verifier exists yet, so it was discarded unpublished. */
  | 'unverified-discarded';

export type RouteRecord = {
  fingerprint: string;
  ruleId: string;
  route: ModelRoute;
  /** Why F1 skipped this finding, when it did. */
  f1Skip: SkipReason | null;
  /** Commit the findings were scanned at, when known. */
  sourceCommit: string | null;
  /** Mapped source location (unique mapping only). */
  path: string | null;
  startLine: number | null;
  endLine: number | null;
  /** Set only for `model-eligible`. */
  model: { outcome: ModelOutcome; provider: string | null } | null;
};

export type ModelRunStatus =
  | 'disabled'
  | 'no-eligible-findings'
  | 'no-provider'
  | 'no-budget'
  | 'over-budget'
  | 'adapters-failed'
  | 'no-verified-candidate'
  | 'error';

/** Bounded request handed to an adapter. Contains no credentials and no full files. */
export type ModelDraftRequest = {
  findingId: string;
  ruleId: string;
  sourceCommit: string | null;
  path: string;
  startLine: number;
  endLine: number;
  /** Exact original lines of the mapped element. */
  original: string[];
};

/** Structured adapter output. Untrusted until validated, applied in isolation and re-scanned (later phases). */
export type ModelDraft = {
  findingId: string;
  path: string;
  startLine: number;
  endLine: number;
  original: string[];
  replacement: string[];
  rationale: string;
  humanReview: string[];
};

/** Provider adapter contract. Live adapters (Groq, Gemini, Cloudflare) are later tasks. */
export interface ModelAdapter {
  readonly id: string;
  /** True only when the adapter's own credentials/model settings are present. Must not make requests. */
  isConfigured(env: Readonly<Record<string, string | undefined>>): boolean;
  draft(request: ModelDraftRequest, signal: AbortSignal): Promise<ModelDraft>;
}

/** Placeholder contracts for later phases (R3–R6). Not implemented here. */
export interface CandidateVerifier {
  verify(draft: ModelDraft, sourceCommit: string): Promise<{ verified: boolean; reason: string }>;
}

export type ModelFixRun = {
  status: ModelRunStatus;
  routes: RouteRecord[];
  /** Adapter `draft` calls made in this run. */
  modelRequests: number;
  /** Sanitized one-line summary for logs. Contains no request or response content. */
  message: string;
};
