import { createHash } from 'node:crypto';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { applyDrafts } from '@/lib/modelfix/apply';
import { gitBlobHash } from '@/lib/modelfix/validate';
import type { CandidateVerification, HumanReviewFlag, PublishableCandidate, RouteRecord } from '@/lib/modelfix/types';

/**
 * Draft-only publisher for verified model drafts (design:
 * docs/design/model-written-fix-prs.md §6).
 *
 * - Publishes only candidates the isolated verifier marked verified, and only
 *   when the combined re-verify also passed when there is more than one.
 * - Preferred channel: a pull request created with `draft: true`. Fallback or
 *   selected channel: a review comment on an existing pull request, labelled
 *   "model-drafted, needs human review".
 * - The published tree must equal the verified (re-scanned) tree.
 * - Never marks ready, approves, merges or requests reviews. The only pull
 *   request write besides creation is a body-only update of its own draft.
 * - Dedupes by source commit + finding fingerprint.
 * - Never throws. Status notes carry reason codes only, never draft text.
 *
 * Pure apart from the injected `github` function: no shell, no git, no network
 * of its own.
 */

export type GithubRequest = (pathname: string, init?: { method?: string; body?: unknown }) => Promise<unknown>;

export type PublishMode = 'draft-pr' | 'review-suggestion';

export type PublishSkipReason =
  /** The candidate's verification is missing, failed, or not for this finding. */
  | 'not-verified'
  /** More than one candidate verified, but the combined re-verify did not pass. */
  | 'combined-not-verified'
  /** The base branch no longer points at the scanned commit. */
  | 'stale'
  /** The tree (or patched blob) that would be published differs from the verified tree. */
  | 'tree-mismatch'
  /** Token lacks `pull-requests: write` / `contents: write` (401/403). Publishing stopped; report only. */
  | 'permission-denied'
  /** GitHub rate limit or quota hit (429, or 403 with a rate-limit message). */
  | 'quota'
  /** A draft branch for this commit + finding already exists without an open draft; left alone. */
  | 'branch-exists'
  /** Draft pull requests are unavailable and no pull request is open for a review suggestion. */
  | 'draft-unavailable'
  /** Review-suggestion mode without a pull request number. */
  | 'no-pull-request'
  /** Base branch for a draft pull request is unknown. */
  | 'no-base-branch'
  /** Unexpected API failure (status code only is kept). */
  | 'error';

export type PublishRecord = {
  fingerprint: string;
  sourceCommit: string;
  channel: PublishMode | null;
  action: 'created' | 'updated' | 'unchanged' | 'skipped';
  reason: PublishSkipReason | null;
  /** Pull request number or review comment id, when published. */
  id: number | null;
};

export type PublishSummary = {
  records: PublishRecord[];
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  /** True once a 401/403 stopped publishing; the run falls back to report-only. */
  permissionDenied: boolean;
};

export type PublishInput = {
  github: GithubRequest;
  /** `owner/name`. */
  repo: string;
  candidates: readonly PublishableCandidate[];
  /** Combined re-verify result from the orchestrator. Required (and must pass) when more than one candidate verified. */
  combined?: CandidateVerification | null;
  /** Original file contents at the scanned commit (the same files the drafts were validated against). */
  files: readonly { path: string; content: string }[];
  mode?: PublishMode;
  /** Branch the scanned commit is on; the draft PR targets it. */
  baseBranch?: string | null;
  /** Existing pull request, used for review suggestions and the draft-unavailable fallback. */
  pullNumber?: string | number | null;
  /** Model id per provider id. Missing entries show `stub` for the stub adapter and `unspecified` otherwise. */
  models?: Readonly<Record<string, string>>;
  /** Routes that were re-scanned locally, for the evidence section. */
  rescanRoutes?: readonly string[];
  warn?: (message: string) => void;
};

export const MODEL_DRAFT_LABEL = 'model-drafted, needs human review';
export const MODEL_DRAFT_MARKER_PREFIX = '<!-- a11ygate-model-draft:';
const BRANCH_PREFIX = 'a11ygate/model-draft/';
const FULL_SHA = /^[0-9a-f]{40}$/;
const MAX_PAGES = 10;

/** Dedupe marker: one per source commit + finding fingerprint. */
export function modelDraftMarker(sourceCommit: string, fingerprint: string): string {
  const safe = (value: string) => String(value ?? '').replace(/[^\w:.@/+=-]/g, '_').slice(0, 200);
  return `${MODEL_DRAFT_MARKER_PREFIX}${safe(sourceCommit)}:${safe(fingerprint)} -->`;
}

/** Deterministic branch name for a commit + finding. */
export function modelDraftBranch(sourceCommit: string, fingerprint: string): string {
  const id = createHash('sha1').update(`${sourceCommit}\0${fingerprint}`).digest('hex').slice(0, 16);
  return `${BRANCH_PREFIX}${sourceCommit.slice(0, 12)}-${id}`;
}

function statusOf(error: unknown): number | null {
  if (error && typeof error === 'object' && 'status' in error && typeof (error as { status: unknown }).status === 'number') {
    return (error as { status: number }).status;
  }
  const match = /\((\d{3})\)/.exec(error instanceof Error ? error.message : '');
  return match ? Number(match[1]) : null;
}

function classify(error: unknown): PublishSkipReason {
  const status = statusOf(error);
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (status === 429 || (status === 403 && message.includes('rate limit'))) return 'quota';
  if (status === 401 || status === 403) return 'permission-denied';
  return 'error';
}

/** Neutralizes markdown/HTML and mentions in untrusted one-line text. */
function plain(text: string, max = 1000): string {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] ?? c)
    .replace(/@/g, '@​')
    .replace(/`/g, "'");
}

function code(text: string): string {
  return `\`${String(text ?? '').replace(/[`\r\n]/g, '')}\``;
}

const CHECKLIST: Partial<Record<HumanReviewFlag, string>> = {
  'generated-accessible-name': 'The model wrote alt / accessible-name text. Confirm the image or control purpose and write the final wording yourself; do not accept it as is.',
  'placeholder-accessible-name': 'Replace every `TODO(a11ygate)` placeholder with wording a person has written.',
  'visible-text-changed': 'Visible text changed. Confirm the wording and that nothing else on the page depends on it.',
  'visual-change': 'Presentation changed. Confirm brand constraints and contrast in every relevant state and theme.',
};

function modelOf(provider: string, models: PublishInput['models']): string {
  return models?.[provider] ?? (provider === 'stub' ? 'stub' : 'unspecified');
}

type BodyContext = {
  item: PublishableCandidate;
  combined: CandidateVerification | null;
  model: string;
  routes: readonly string[];
};

/** Provenance, re-scan evidence and review checklist shared by both channels. */
function provenance({ item, combined, model, routes }: BodyContext): string[] {
  const { candidate, verification, provider } = item;
  const draft = candidate.validated.draft;
  const flags = candidate.validated.humanReview;
  const lines = [
    `> **${MODEL_DRAFT_LABEL[0].toUpperCase()}${MODEL_DRAFT_LABEL.slice(1)}.** A language model wrote this change. A11yGate only checked it with an automated re-scan. A person must review, edit if needed, and decide whether to merge. A11yGate never marks it ready, approves or merges it.`,
    '',
    '**Finding**',
    `- Rule: ${code(candidate.ruleId)}`,
    `- Finding fingerprint: ${code(draft.findingId)}`,
    `- File: ${code(draft.path)} lines ${draft.startLine}-${draft.endLine}`,
    `- Source commit: ${code(candidate.sourceCommit)}`,
    '',
    '**Provenance**',
    `- Provider: ${code(provider)}`,
    `- Model: ${code(model)}`,
    `- Review flags: ${flags.map(code).join(', ')}`,
    '',
    '**Re-scan evidence** (local render of an isolated checkout of the source commit, same axe rules before and after)',
    `- Verified: ${verification.verified ? 'yes' : 'no'}`,
    `- Target finding cleared: ${verification.reason === 'verified' ? 'yes' : 'no'}`,
    `- New findings in tested routes: ${verification.newFindings === 0 ? 'none' : verification.newFindings}`,
    `- Combined re-verify with other drafts: ${combined ? (combined.verified ? 'passed' : 'failed') : 'not needed (single draft)'}`,
    `- Verified tree: ${code(verification.treeHash ?? '')}`,
    `- Re-scan summary: ${plain(verification.detail, 200)}`,
  ];
  if (routes.length > 0) lines.push(`- Tested routes: ${routes.slice(0, 20).map(code).join(', ')}`);
  lines.push('', '**Rationale (model-written, unverified)**', `> ${plain(draft.rationale) || 'none given'}`, '', '**Review checklist**');
  lines.push('- [ ] The change does what the rationale says and nothing else.');
  for (const flag of flags) if (CHECKLIST[flag]) lines.push(`- [ ] ${CHECKLIST[flag]}`);
  lines.push('- [ ] Checked interaction behavior manually; clearing axe alone does not settle it.', '- [ ] Re-ran checks after any edit or base change.');
  lines.push('', `_${AUTOMATED_TESTING_DISCLAIMER}_`);
  return lines;
}

/** Body of the draft pull request. Contains the dedupe marker. */
export function buildDraftPullBody(context: BodyContext): string {
  const { candidate } = context.item;
  return [modelDraftMarker(candidate.sourceCommit, candidate.validated.draft.findingId), `## A11yGate: ${MODEL_DRAFT_LABEL}`, '', ...provenance(context), ''].join('\n');
}

function fence(lines: readonly string[]): string {
  let ticks = '```';
  while (lines.some((line) => line.includes(ticks))) ticks += '`';
  return ticks;
}

/** Body of the labelled review suggestion. Contains the dedupe marker. */
export function buildModelSuggestionBody(context: BodyContext): string {
  const { candidate } = context.item;
  const replacement = candidate.validated.draft.replacement;
  const ticks = fence(replacement);
  return [
    modelDraftMarker(candidate.sourceCommit, candidate.validated.draft.findingId),
    `**A11yGate: ${MODEL_DRAFT_LABEL}** for axe ${code(candidate.ruleId)}`,
    '',
    `${ticks}suggestion`,
    ...replacement,
    ticks,
    '',
    ...provenance(context),
    '',
  ].join('\n');
}

function eligibility(item: PublishableCandidate, combined: CandidateVerification | null, total: number): PublishSkipReason | null {
  const { verification, candidate } = item;
  const fingerprint = candidate.validated.draft.findingId;
  if (
    !verification ||
    verification.verified !== true ||
    verification.outcome !== 'verified' ||
    verification.reason !== 'verified' ||
    verification.newFindings !== 0 ||
    !verification.findingIds.includes(fingerprint) ||
    !FULL_SHA.test(verification.treeHash ?? '') ||
    !FULL_SHA.test(candidate.sourceCommit) ||
    candidate.validated.needsHumanReview !== true
  ) {
    return 'not-verified';
  }
  if (total > 1 && (!combined || combined.verified !== true || combined.reason !== 'verified' || !combined.findingIds.includes(fingerprint))) {
    return 'combined-not-verified';
  }
  return null;
}

async function paginate(github: GithubRequest, pathname: string): Promise<unknown[]> {
  const items: unknown[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const sep = pathname.includes('?') ? '&' : '?';
    const batch = await github(`${pathname}${sep}per_page=100&page=${page}`);
    if (!Array.isArray(batch) || batch.length === 0) break;
    items.push(...batch);
    if (batch.length < 100) break;
  }
  return items;
}

function withMarker(items: readonly unknown[], marker: string): { id?: unknown; number?: unknown; body: string; draft?: unknown } | null {
  for (const item of items) {
    if (item && typeof item === 'object' && typeof (item as { body?: unknown }).body === 'string' && (item as { body: string }).body.includes(marker)) {
      return item as { body: string };
    }
  }
  return null;
}

function shaField(value: unknown, ...keys: string[]): string {
  let current = value;
  for (const key of keys) current = current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined;
  return typeof current === 'string' && FULL_SHA.test(current) ? current : '';
}

/** Rebuilds the verified file content and checks it against the verifier's blob ids. */
function patchedFile(item: PublishableCandidate, files: PublishInput['files']): { path: string; content: string } | null {
  const draft = item.candidate.validated.draft;
  const original = files.find((file) => file.path === draft.path);
  if (!original || gitBlobHash(original.content) !== draft.sourceBlobHash) return null;
  const content = applyDrafts(original.content, [draft]);
  const expected = item.verification.patchedBlobs?.find((blob) => blob.path === draft.path)?.blobHash;
  if (!expected || item.verification.patchedBlobs?.length !== 1 || gitBlobHash(content) !== expected) return null;
  return { path: draft.path, content };
}

async function refSha(github: GithubRequest, repo: string, branch: string): Promise<string | null> {
  try {
    return shaField(await github(`/repos/${repo}/git/ref/heads/${encodeBranch(branch)}`), 'object', 'sha') || null;
  } catch (error) {
    if (statusOf(error) === 404) return null;
    throw error;
  }
}

function encodeBranch(branch: string): string {
  return branch.split('/').map(encodeURIComponent).join('/');
}

type Ctx = Required<Pick<PublishInput, 'github' | 'repo' | 'files'>> & { combined: CandidateVerification | null; models: PublishInput['models']; routes: readonly string[] };

async function publishDraftPull(ctx: Ctx, item: PublishableCandidate, baseBranch: string, openPulls: () => Promise<unknown[]>): Promise<Omit<PublishRecord, 'fingerprint' | 'sourceCommit'>> {
  const { github, repo } = ctx;
  const { candidate, verification } = item;
  const fingerprint = candidate.validated.draft.findingId;
  const body = buildDraftPullBody({ item, combined: ctx.combined, model: modelOf(item.provider, ctx.models), routes: ctx.routes });

  // Dedupe: an open pull request already carries this commit + finding marker.
  const existing = withMarker(await openPulls(), modelDraftMarker(candidate.sourceCommit, fingerprint));
  if (existing) {
    const number = typeof existing.number === 'number' ? existing.number : null;
    // Leave it alone once a person has marked it ready, or when nothing changed.
    if (existing.draft !== true || existing.body === body || number === null) return { channel: 'draft-pr', action: 'unchanged', reason: null, id: number };
    // Body-only update. Never sends `draft`, `state` or any review/merge field.
    await github(`/repos/${repo}/pulls/${number}`, { method: 'PATCH', body: { body } });
    return { channel: 'draft-pr', action: 'updated', reason: null, id: number };
  }

  const branch = modelDraftBranch(candidate.sourceCommit, fingerprint);
  if ((await refSha(github, repo, branch)) !== null) return { channel: 'draft-pr', action: 'skipped', reason: 'branch-exists', id: null };
  if ((await refSha(github, repo, baseBranch)) !== candidate.sourceCommit) return { channel: 'draft-pr', action: 'skipped', reason: 'stale', id: null };

  const file = patchedFile(item, ctx.files);
  if (!file) return { channel: 'draft-pr', action: 'skipped', reason: 'tree-mismatch', id: null };
  const baseTree = shaField(await github(`/repos/${repo}/git/commits/${candidate.sourceCommit}`), 'tree', 'sha');
  if (!baseTree) return { channel: 'draft-pr', action: 'skipped', reason: 'error', id: null };
  const tree = shaField(
    await github(`/repos/${repo}/git/trees`, {
      method: 'POST',
      body: { base_tree: baseTree, tree: [{ path: file.path, mode: '100644', type: 'blob', content: file.content }] },
    }),
    'sha',
  );
  // The published tree must be the tree that was re-scanned. An unreferenced tree object is harmless.
  if (!tree || tree !== verification.treeHash) return { channel: 'draft-pr', action: 'skipped', reason: 'tree-mismatch', id: null };
  const commit = shaField(
    await github(`/repos/${repo}/git/commits`, {
      method: 'POST',
      body: { message: `a11ygate: model-drafted fix for ${candidate.ruleId} (needs human review)\n\nFinding: ${fingerprint}\nSource commit: ${candidate.sourceCommit}`, tree, parents: [candidate.sourceCommit] },
    }),
    'sha',
  );
  if (!commit) return { channel: 'draft-pr', action: 'skipped', reason: 'error', id: null };
  await github(`/repos/${repo}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${branch}`, sha: commit } });
  try {
    const pull = await github(`/repos/${repo}/pulls`, {
      method: 'POST',
      body: { title: `[A11yGate draft] ${candidate.ruleId}: ${MODEL_DRAFT_LABEL}`, head: branch, base: baseBranch, body, draft: true, maintainer_can_modify: false },
    });
    const number = pull && typeof (pull as { number?: unknown }).number === 'number' ? (pull as { number: number }).number : null;
    return { channel: 'draft-pr', action: 'created', reason: null, id: number };
  } catch (error) {
    // Remove only the branch this run just created.
    await github(`/repos/${repo}/git/refs/heads/${encodeBranch(branch)}`, { method: 'DELETE' }).catch(() => undefined);
    if (statusOf(error) === 422) return { channel: 'draft-pr', action: 'skipped', reason: 'draft-unavailable', id: null };
    throw error;
  }
}

async function publishSuggestion(ctx: Ctx, item: PublishableCandidate, pull: string, comments: () => Promise<unknown[]>): Promise<Omit<PublishRecord, 'fingerprint' | 'sourceCommit'>> {
  const { github, repo } = ctx;
  const { candidate } = item;
  const draft = candidate.validated.draft;
  // A suggestion publishes one file's content: it must be the verified blob.
  if (!patchedFile(item, ctx.files)) return { channel: 'review-suggestion', action: 'skipped', reason: 'tree-mismatch', id: null };
  const body = buildModelSuggestionBody({ item, combined: ctx.combined, model: modelOf(item.provider, ctx.models), routes: ctx.routes });
  const existing = withMarker(await comments(), modelDraftMarker(candidate.sourceCommit, draft.findingId));
  if (existing) {
    const id = typeof existing.id === 'number' ? existing.id : null;
    if (existing.body === body || id === null) return { channel: 'review-suggestion', action: 'unchanged', reason: null, id };
    await github(`/repos/${repo}/pulls/comments/${id}`, { method: 'PATCH', body: { body } });
    return { channel: 'review-suggestion', action: 'updated', reason: null, id };
  }
  const payload: Record<string, unknown> = { body, commit_id: candidate.sourceCommit, path: draft.path, line: draft.endLine, side: 'RIGHT' };
  if (draft.startLine < draft.endLine) Object.assign(payload, { start_line: draft.startLine, start_side: 'RIGHT' });
  const created = await github(`/repos/${repo}/pulls/${pull}/comments`, { method: 'POST', body: payload });
  const id = created && typeof (created as { id?: unknown }).id === 'number' ? (created as { id: number }).id : null;
  return { channel: 'review-suggestion', action: 'created', reason: null, id };
}

function lazy<T>(load: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | null = null;
  return () => (cached ??= load());
}

/**
 * Publishes verified model drafts as draft pull requests or labelled review
 * suggestions. Never throws; on 401/403 it stops and reports `permission-denied`
 * so the caller keeps the gate's exit code and the ordinary report.
 */
export async function publishModelDrafts(input: PublishInput): Promise<PublishSummary> {
  const summary: PublishSummary = { records: [], created: 0, updated: 0, unchanged: 0, skipped: 0, permissionDenied: false };
  const warn = input.warn ?? (() => {});
  const candidates = input.candidates ?? [];
  const combined = input.combined ?? null;
  const mode: PublishMode = input.mode === 'review-suggestion' ? 'review-suggestion' : 'draft-pr';
  const pull = input.pullNumber !== undefined && input.pullNumber !== null && /^\d+$/.test(String(input.pullNumber)) ? String(input.pullNumber) : null;
  const ctx: Ctx = { github: input.github, repo: input.repo, files: input.files ?? [], combined, models: input.models, routes: input.rescanRoutes ?? [] };
  const openPulls = lazy(() => paginate(input.github, `/repos/${input.repo}/pulls?state=open`));
  const comments = lazy(() => (pull ? paginate(input.github, `/repos/${input.repo}/pulls/${pull}/comments`) : Promise.resolve([])));
  let stopped: PublishSkipReason | null = null;

  for (const item of candidates) {
    const fingerprint = String(item?.candidate?.validated?.draft?.findingId ?? '');
    const sourceCommit = String(item?.candidate?.sourceCommit ?? '');
    const record = (rest: Omit<PublishRecord, 'fingerprint' | 'sourceCommit'>) => {
      summary.records.push({ fingerprint, sourceCommit, ...rest });
      if (rest.action === 'skipped') summary.skipped += 1;
      else summary[rest.action] += 1;
    };
    if (stopped) {
      record({ channel: null, action: 'skipped', reason: stopped, id: null });
      continue;
    }
    const blocked = eligibility(item, combined, candidates.length);
    if (blocked) {
      record({ channel: null, action: 'skipped', reason: blocked, id: null });
      continue;
    }
    try {
      let outcome: Omit<PublishRecord, 'fingerprint' | 'sourceCommit'>;
      if (mode === 'draft-pr' && input.baseBranch) {
        outcome = await publishDraftPull(ctx, item, input.baseBranch, openPulls);
        if (outcome.reason === 'draft-unavailable' && pull) outcome = await publishSuggestion(ctx, item, pull, comments);
      } else if (mode === 'draft-pr') {
        outcome = pull ? await publishSuggestion(ctx, item, pull, comments) : { channel: null, action: 'skipped', reason: 'no-base-branch', id: null };
      } else {
        outcome = pull ? await publishSuggestion(ctx, item, pull, comments) : { channel: null, action: 'skipped', reason: 'no-pull-request', id: null };
      }
      record(outcome);
    } catch (error) {
      const reason = classify(error);
      record({ channel: null, action: 'skipped', reason, id: null });
      if (reason === 'permission-denied' || reason === 'quota') {
        stopped = reason;
        summary.permissionDenied = reason === 'permission-denied';
        warn(
          reason === 'permission-denied'
            ? 'A11yGate could not publish model drafts: permission denied (needs pull-requests: write and contents: write). Falling back to report only.'
            : 'A11yGate stopped publishing model drafts: GitHub rate limit reached. Falling back to report only.',
        );
      } else {
        const status = statusOf(error);
        warn(`A11yGate could not publish a model draft${status ? ` (GitHub status ${status})` : ''}. Report only for this finding.`);
      }
    }
  }
  return summary;
}

const ROUTE_NOTES: Partial<Record<string, string>> = {
  'draft-rejected': 'draft rejected by the validator',
  'unverified-discarded': 'no verifier configured',
  'verify-rejected': 'rejected by the re-scan',
  'stale-discarded': 'stale (source changed)',
  'over-budget': 'request budget used up',
  'adapters-failed': 'provider failed',
  'no-provider': 'no provider configured',
  'no-budget': 'no request budget configured',
};

/**
 * Sanitized status lines for logs or a status comment. Reason codes and
 * fingerprints only: never model patch, replacement or rationale text.
 */
export function buildPublishStatus(summary: PublishSummary | null, routes: readonly RouteRecord[] = []): string[] {
  const lines: string[] = [];
  for (const route of routes) {
    const outcome = route.model?.outcome;
    const note = outcome ? ROUTE_NOTES[outcome] : undefined;
    if (note) lines.push(`Model draft for finding ${code(route.fingerprint)} not published: ${note}.`);
  }
  for (const record of summary?.records ?? []) {
    if (record.action === 'skipped') lines.push(`Model draft for finding ${code(record.fingerprint)} not published: ${record.reason ?? 'error'}.`);
    else lines.push(`Model draft for finding ${code(record.fingerprint)} ${record.action} as ${record.channel === 'draft-pr' ? 'a draft pull request' : 'a labelled review suggestion'} (${MODEL_DRAFT_LABEL}).`);
  }
  return lines;
}
