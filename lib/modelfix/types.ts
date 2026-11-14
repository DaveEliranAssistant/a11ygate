import type { SkipReason } from '@/lib/fix/types';

/**
 * Types for the optional model-assisted fix path (design: docs/design/model-written-fix-prs.md).
 *
 * No live provider adapters or draft publisher exist yet. A validated draft
 * may be applied in an isolated worktree and re-scanned by an injected
 * `CandidateVerifier` (lib/modelfix-verify). Model output is never published.
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
  /** Every draft returned for this finding failed validation. Nothing was applied or published. */
  | 'draft-rejected'
  /** A draft came back but no verifier was configured, so it was discarded unpublished. */
  | 'unverified-discarded'
  /** Applied in isolation at the scanned commit and re-scanned: target cleared, no new findings. Still unpublished. */
  | 'verified'
  /** Applied and re-scanned, but the target persisted, a new finding appeared or the scan failed. Discarded. */
  | 'verify-rejected'
  /** The scanned commit, blob or original text no longer matches. Discarded without re-scan. */
  | 'stale-discarded';

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
  model: {
    outcome: ModelOutcome;
    provider: string | null;
    rejections?: DraftRejectionCode[];
    /** Sanitized verifier reason, set when a verifier ran. */
    verification?: VerifyReason;
  } | null;
};

export type ModelRunStatus =
  | 'disabled'
  | 'no-eligible-findings'
  | 'no-provider'
  | 'no-budget'
  | 'over-budget'
  | 'adapters-failed'
  | 'no-verified-candidate'
  /** At least one candidate verified in isolation. Nothing was published or merged into the F1 plan. */
  | 'verified-unpublished'
  | 'error';

/** Bounded request handed to an adapter. Contains no credentials and no full files. */
export type ModelDraftRequest = {
  findingId: string;
  ruleId: string;
  sourceCommit: string | null;
  /** The only file a draft may touch (repository-relative, `/`-separated). */
  path: string;
  /** 1-based inclusive line range; the only range a draft may replace. */
  startLine: number;
  endLine: number;
  /** Exact original lines of the mapped element. */
  original: string[];
  /** Git blob SHA-1 of the whole file at `path` (see `gitBlobHash`). */
  sourceBlobHash: string;
};

/**
 * Human-review flags. Every model draft carries `model-drafted`; the validator
 * adds the others when it detects the matching change, whatever the adapter
 * claimed. No flag ever means "safe to merge without review".
 */
export const HUMAN_REVIEW_FLAGS = [
  /** Always set: the change was written by a model. */
  'model-drafted',
  /** Alt / accessible-name text was set to something other than a TODO(a11ygate) placeholder (design §7). */
  'generated-accessible-name',
  /** Alt / accessible-name text is a TODO(a11ygate) placeholder; a person must write the final wording. */
  'placeholder-accessible-name',
  /** Visible text content changed. */
  'visible-text-changed',
  /** Colours or other presentation changed; a person must confirm the design intent. */
  'visual-change',
] as const;

export type HumanReviewFlag = (typeof HUMAN_REVIEW_FLAGS)[number];

/**
 * Structured adapter output (schema v1). Untrusted until validated by
 * `validateDraft`, applied in isolation and re-scanned (later phases).
 *
 * Exactly one file and one line range: the ones in the request.
 */
export type ModelDraft = {
  /** Finding fingerprint from the request. */
  findingId: string;
  /** Git blob SHA-1 of the whole file the draft was written against (40 lower-case hex). */
  sourceBlobHash: string;
  /** Allowed file: must equal the request path. */
  path: string;
  /** Allowed range: must equal the request range. */
  startLine: number;
  endLine: number;
  /** Exact original lines at the range. */
  original: string[];
  /** Replacement lines for the whole range. */
  replacement: string[];
  /** Short plain-text reason for the change. */
  rationale: string;
  /** Review flags the adapter declares. The validator adds any it requires. */
  humanReview: HumanReviewFlag[];
};

/** Size caps for a draft (documented in docs/design/model-written-fix-prs.md §2). */
export const DRAFT_LIMITS = {
  /** Max UTF-8 bytes of the joined replacement. */
  maxReplacementBytes: 4096,
  /** Max replacement lines beyond the original range length. */
  maxExtraLines: 5,
  /** Max replacement lines in total. */
  maxReplacementLines: 40,
  /** Max characters in one replacement line. */
  maxLineLength: 1000,
  /** Max characters in the rationale. */
  maxRationaleLength: 1000,
} as const;

export type DraftRejectionCode =
  /** Not an object, missing/extra/mistyped fields, unknown review flag. */
  | 'schema'
  /** `findingId` is not the requested finding. */
  | 'finding-mismatch'
  /** The draft names a file other than the request path, or carries extra file entries. */
  | 'extra-file'
  /** `..`, absolute, backslash, null byte, drive letter or other unsafe path. */
  | 'path-traversal'
  /** The path resolves through a symlink outside the repository root. */
  | 'symlink-escape'
  /** The path does not exist under the repository root. */
  | 'missing-file'
  /** The draft targets scanner, CI or gate configuration. */
  | 'scanner-config'
  /** The draft tries to suppress or hide a check (ignore comments, hiding content, test files). */
  | 'check-suppression'
  /** Script, event handler or other executable content added. */
  | 'executable-payload'
  /** Range differs from the request. */
  | 'range-mismatch'
  /** `original` is not the exact text at the range. */
  | 'original-mismatch'
  /** `sourceBlobHash` does not match the file. */
  | 'blob-mismatch'
  /** Over a `DRAFT_LIMITS` cap. */
  | 'oversize'
  /** Empty or whitespace-only replacement (deletion). */
  | 'empty-replacement'
  /** Replacement equals the original. */
  | 'no-change';

export type DraftRejection = { code: DraftRejectionCode; detail: string };

/** A draft that passed validation. Still unverified: it has not been applied or re-scanned. */
export type ValidatedDraft = {
  draft: ModelDraft;
  /** Declared flags plus every flag the validator requires, in `HUMAN_REVIEW_FLAGS` order. */
  humanReview: HumanReviewFlag[];
  /** Always true for model output. */
  needsHumanReview: true;
  /** True when a person must explicitly acknowledge generated wording before the change is ready (design §7). */
  requiresAcknowledgement: boolean;
};

export type DraftValidation = { ok: true; value: ValidatedDraft } | { ok: false; rejection: DraftRejection };

/** Provider adapter contract. Live adapters (Groq, Gemini, Cloudflare) are later tasks. */
export interface ModelAdapter {
  readonly id: string;
  /** True only when the adapter's own credentials/model settings are present. Must not make requests. */
  isConfigured(env: Readonly<Record<string, string | undefined>>): boolean;
  draft(request: ModelDraftRequest, signal: AbortSignal): Promise<ModelDraft>;
}

/** One validated draft plus the finding it must clear, at the commit that was scanned. */
export type VerifyCandidate = {
  validated: ValidatedDraft;
  ruleId: string;
  /** Element HTML from the original finding; used to find the target in the pre-patch scan. */
  targetHtml: string;
  /** Optional axe selector of the target. Preferred over `targetHtml` when set. */
  targetSelector?: string;
  /** Full 40-hex SHA of the scanned commit. */
  sourceCommit: string;
};

export type VerifyOutcome = 'verified' | 'rejected' | 'stale';

export type VerifyReason =
  | 'verified'
  /** The expected head no longer points at the scanned commit. */
  | 'head-moved'
  /** The scanned commit is missing or not a full SHA. */
  | 'commit-missing'
  /** The file's blob at the scanned commit differs from the draft's `sourceBlobHash`. */
  | 'blob-mismatch'
  /** The original text at the range no longer matches exactly. */
  | 'original-mismatch'
  /** The draft failed re-validation against the pinned file. */
  | 'invalid-draft'
  /** Two candidates touch overlapping ranges of one file. */
  | 'overlapping-candidates'
  /** No candidates, or candidates pinned to different commits. */
  | 'bad-input'
  /** The local build/render or a scan failed. */
  | 'render-failed'
  /** The target finding was not in the pre-patch scan, so a fix cannot be shown. */
  | 'target-not-reproduced'
  /** The target finding is still reported after the patch. */
  | 'target-persists'
  /** The target check was inconclusive (axe "incomplete") after the patch. */
  | 'target-inconclusive'
  /** The target element no longer renders visibly after the patch. */
  | 'target-missing'
  /** A finding not in the pre-patch scan appeared after the patch. */
  | 'new-finding'
  /** Unexpected verifier error (sanitized). */
  | 'error';

export type CandidateVerification = {
  verified: boolean;
  outcome: VerifyOutcome;
  reason: VerifyReason;
  /** Sanitized one-line detail. Never contains draft text. */
  detail: string;
  /** Fingerprints covered by this verification. */
  findingIds: string[];
  /** Count of findings that appeared after the patch. */
  newFindings: number;
};

/**
 * Applies candidates in a disposable checkout pinned to the scanned commit and
 * re-scans a local render with the same axe rules. Implemented in
 * lib/modelfix-verify (kept out of this directory so drafting stays shell-free).
 */
export interface CandidateVerifier {
  verify(candidate: VerifyCandidate): Promise<CandidateVerification>;
  /** Applies every candidate together and re-scans once. */
  verifyCombined(candidates: readonly VerifyCandidate[]): Promise<CandidateVerification>;
}

export type ModelFixRun = {
  status: ModelRunStatus;
  routes: RouteRecord[];
  /** Adapter `draft` calls made in this run. */
  modelRequests: number;
  /** Combined re-verification of every individually verified candidate, when two or more verified. */
  combined?: CandidateVerification | null;
  /** Sanitized one-line summary for logs. Contains no request or response content. */
  message: string;
};
