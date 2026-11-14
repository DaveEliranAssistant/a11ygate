import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gitBlobHash, validateDraft } from '@/lib/modelfix/validate';
import type { CandidateVerification, CandidateVerifier, VerifyCandidate, VerifyReason } from '@/lib/modelfix/types';
import { blobAt, createWorktree, isFullSha, resolveCommit } from './git';
import type { RescanFinding, RescanResult, Rescanner } from './rescan';

/**
 * Isolated apply + re-scan verifier (design: docs/design/model-written-fix-prs.md §5).
 *
 * For each run: check the expected head still points at the scanned commit,
 * create a disposable worktree pinned to that commit, check every draft's
 * blob hash and exact original text, scan the local render, apply the drafts
 * (exact replacement only, no fuzzy matching), scan again with the same
 * rules, and compare findings. The worktree is always removed. Nothing is
 * published and the caller's working tree is never written.
 */

export type IsolatedVerifierOptions = {
  /** The caller's git repository. Only read from and used to register/remove a temporary worktree. */
  repoRoot: string;
  /** Local re-scanner. Takes a directory, never a URL. Use the same instance (same rules) as the original scan. */
  rescanner: Rescanner;
  /** Routes to scan, relative to the rendered directory (for example `index.html`). */
  routes: readonly string[];
  /** Ref that must still resolve to the scanned commit (default `HEAD`). A moved head means a stale candidate. */
  headRef?: string;
  /** Directory inside the worktree to serve after the build (default: the worktree root). */
  renderDir?: string;
  /** Optional local build step, run in the worktree before each scan. No default build command is run. */
  build?: (worktree: string) => Promise<void>;
};

type Prepared = { candidate: VerifyCandidate; route: string; selector: string };

function result(candidates: readonly VerifyCandidate[], reason: VerifyReason, detail: string, newFindings = 0): CandidateVerification {
  const outcome = reason === 'verified' ? 'verified' : STALE.has(reason) ? 'stale' : 'rejected';
  return { verified: reason === 'verified', outcome, reason, detail, findingIds: candidates.map((item) => item.validated.draft.findingId), newFindings };
}

const STALE: ReadonlySet<VerifyReason> = new Set(['head-moved', 'commit-missing', 'blob-mismatch', 'original-mismatch']);

const key = (finding: Pick<RescanFinding, 'route' | 'ruleId' | 'selector'>) => `${finding.route}\u0000${finding.ruleId}\u0000${finding.selector}`;

function lines(content: string): string[] {
  return content.split('\n');
}

function sameHtml(a: string, b: string): boolean {
  const norm = (text: string) => text.replace(/\s+/g, ' ').trim();
  const x = norm(a);
  const y = norm(b);
  return Boolean(x && y) && (x === y || x.startsWith(y) || y.startsWith(x));
}

/** Finds each candidate's target among pre-patch violations. Exactly one match is required. */
function locateTargets(candidates: readonly VerifyCandidate[], pre: RescanResult): Prepared[] | null {
  const prepared: Prepared[] = [];
  for (const candidate of candidates) {
    const matches = pre.findings.filter(
      (finding) =>
        finding.kind === 'violation' &&
        finding.ruleId === candidate.ruleId &&
        (candidate.targetSelector ? finding.selector === candidate.targetSelector : sameHtml(finding.html, candidate.targetHtml)),
    );
    if (matches.length !== 1) return null;
    prepared.push({ candidate, route: matches[0].route, selector: matches[0].selector });
  }
  return prepared;
}

function overlapping(candidates: readonly VerifyCandidate[]): boolean {
  const drafts = candidates.map((item) => item.validated.draft);
  return drafts.some((a, i) => drafts.some((b, j) => i < j && a.path === b.path && a.startLine <= b.endLine && b.startLine <= a.endLine));
}

function renderFailed(scan: RescanResult, routes: readonly string[]): boolean {
  return routes.some((route) => scan.status[route] !== 200);
}

async function run(candidates: readonly VerifyCandidate[], options: IsolatedVerifierOptions): Promise<CandidateVerification> {
  if (candidates.length === 0 || options.routes.length === 0) return result(candidates, 'bad-input', 'no candidates or no routes');
  const commit = candidates[0].sourceCommit;
  if (candidates.some((item) => item.sourceCommit !== commit)) return result(candidates, 'bad-input', 'candidates are pinned to different commits');
  if (!isFullSha(commit)) return result(candidates, 'commit-missing', 'scanned commit is not a full SHA');
  if ((await resolveCommit(options.repoRoot, commit)) !== commit) return result(candidates, 'commit-missing', 'scanned commit not found');
  if ((await resolveCommit(options.repoRoot, options.headRef ?? 'HEAD')) !== commit) return result(candidates, 'head-moved', 'head no longer points at the scanned commit');
  if (overlapping(candidates)) return result(candidates, 'overlapping-candidates', 'candidates overlap in one file');

  // Blob ids at the pinned commit, read from the object store before any checkout.
  for (const { validated } of candidates) {
    if ((await blobAt(options.repoRoot, commit, validated.draft.path)) !== validated.draft.sourceBlobHash) {
      return result(candidates, 'blob-mismatch', 'file at the scanned commit differs from the draft source');
    }
  }

  const worktree = await createWorktree(options.repoRoot, commit);
  try {
    const root = await realpath(worktree.tree);
    const resolve = (file: string) => {
      const full = path.resolve(root, ...file.split('/'));
      if (!full.startsWith(root + path.sep)) throw new Error('path outside worktree');
      return full;
    };
    const renderRoot = options.renderDir ? resolve(options.renderDir) : root;

    // Exact checks on the checked-out files, then a re-validation of each draft against them.
    const contents = new Map<string, string>();
    for (const { validated } of candidates) {
      const { draft } = validated;
      const file = resolve(draft.path);
      if (!(await realpath(file).catch(() => '')).startsWith(root + path.sep)) {
        return result(candidates, 'invalid-draft', 'path does not resolve inside the worktree');
      }
      const content = contents.get(draft.path) ?? (await readFile(file, 'utf8'));
      contents.set(draft.path, content);
      if (gitBlobHash(content) !== draft.sourceBlobHash) return result(candidates, 'blob-mismatch', 'checked-out file differs from the draft source');
      const actual = lines(content).slice(draft.startLine - 1, draft.endLine).map((line) => line.replace(/\r$/, ''));
      if (actual.length !== draft.original.length || actual.some((line, index) => line !== draft.original[index])) {
        return result(candidates, 'original-mismatch', 'original text no longer matches at the range');
      }
      const request = { findingId: draft.findingId, ruleId: '', sourceCommit: commit, path: draft.path, startLine: draft.startLine, endLine: draft.endLine, original: draft.original, sourceBlobHash: draft.sourceBlobHash };
      if (!validateDraft(draft, { request, content, repoRoot: root }).ok) return result(candidates, 'invalid-draft', 'draft failed re-validation at the scanned commit');
    }

    // Pre-patch reference scan of the pinned commit, same rescanner as the post-patch scan.
    if (options.build) await options.build(root);
    const pre = await options.rescanner.scan({ root: renderRoot, routes: options.routes });
    if (renderFailed(pre, options.routes)) return result(candidates, 'render-failed', 'pre-patch render failed');
    const targets = locateTargets(candidates, pre);
    if (!targets) return result(candidates, 'target-not-reproduced', 'target finding not found exactly once in the pre-patch scan');

    // Exact replacement, bottom-up per file so earlier ranges keep their line numbers.
    for (const [file, content] of contents) {
      const drafts = candidates.map((item) => item.validated.draft).filter((draft) => draft.path === file).sort((a, b) => b.startLine - a.startLine);
      const next = lines(content);
      for (const draft of drafts) next.splice(draft.startLine - 1, draft.endLine - draft.startLine + 1, ...draft.replacement);
      await writeFile(resolve(file), next.join('\n'), 'utf8');
    }

    if (options.build) await options.build(root);
    const post = await options.rescanner.scan({ root: renderRoot, routes: options.routes, probes: targets.map(({ route, selector }) => ({ route, selector })) });
    if (renderFailed(post, options.routes) || (pre.engineVersion && post.engineVersion !== pre.engineVersion)) {
      return result(candidates, 'render-failed', 'post-patch render or scan failed');
    }

    const preKeys = new Set(pre.findings.filter((finding) => finding.kind === 'violation').map(key));
    const fresh = post.findings.filter((finding) => finding.kind === 'violation' && !preKeys.has(key(finding)));
    for (const target of targets) {
      const same = post.findings.filter((finding) => finding.route === target.route && finding.ruleId === target.candidate.ruleId && finding.selector === target.selector);
      if (same.some((finding) => finding.kind === 'violation')) return result(candidates, 'target-persists', 'target finding still reported after the patch', fresh.length);
      if (same.length > 0) return result(candidates, 'target-inconclusive', 'target check inconclusive after the patch', fresh.length);
      if (post.missing.some((probe) => probe.route === target.route && probe.selector === target.selector)) {
        return result(candidates, 'target-missing', 'target element no longer renders visibly', fresh.length);
      }
    }
    if (fresh.length > 0) return result(candidates, 'new-finding', `${fresh.length} new finding(s) after the patch`, fresh.length);
    return result(candidates, 'verified', 'target cleared and no new findings in the tested routes');
  } finally {
    await worktree.remove();
  }
}

async function guarded(candidates: readonly VerifyCandidate[], options: IsolatedVerifierOptions): Promise<CandidateVerification> {
  try {
    return await run(candidates, options);
  } catch {
    return result(candidates, 'error', 'verifier failed');
  }
}

/** Verifies one candidate in its own disposable worktree. Never throws. */
export function verifyCandidate(candidate: VerifyCandidate, options: IsolatedVerifierOptions): Promise<CandidateVerification> {
  return guarded([candidate], options);
}

/** Applies every candidate together in one worktree and re-scans once. Never throws. */
export function verifyCombined(candidates: readonly VerifyCandidate[], options: IsolatedVerifierOptions): Promise<CandidateVerification> {
  return guarded(candidates, options);
}

/** `CandidateVerifier` for `planWithModelFixes`. */
export function createIsolatedVerifier(options: IsolatedVerifierOptions): CandidateVerifier {
  return {
    verify: (candidate) => verifyCandidate(candidate, options),
    verifyCombined: (candidates) => verifyCombined(candidates, options),
  };
}
