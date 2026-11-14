import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FixFinding, SourceFile } from '@/lib/fix';
import {
  applyDrafts,
  buildPublishStatus,
  gitBlobHash,
  MODEL_DRAFT_LABEL,
  modelDraftBranch,
  modelDraftMarker,
  planWithModelFixes,
  publishModelDrafts,
  resolveModelFixConfig,
  staticAdapter,
  validateDraft,
  type CandidateVerification,
  type CandidateVerifier,
  type GithubRequest,
  type ModelDraft,
  type ModelDraftRequest,
  type PublishableCandidate,
  type PublishInput,
} from '@/lib/modelfix';
import { postSuggestions } from '../action/suggestions.mjs';
import { blockNetwork } from './network-guard';

/**
 * Draft-only publisher (A11Y-R4). Every GitHub call goes to an in-memory fake
 * that implements the git data API with real git object ids, so tree hashes
 * are comparable to what the verifier records. Outbound network is blocked.
 */

const SHA = 'a'.repeat(40);
const FILE = 'index.html';
const OTHER = 'about.html';
const PAGE = [
  '<html lang="en">',
  '<body>',
  '  <p id="note" style="color: #aaaaaa; background: #ffffff">Shipping is free.</p>',
  '  <div id="upload" role="progressbar" aria-valuenow="40"></div>',
  '</body>',
  '</html>',
  '',
].join('\n');
const ABOUT = '<html lang="en"><body><p>About</p></body></html>\n';
const FIXED = '  <p id="note" style="color: #595959; background: #ffffff">Shipping is free.</p>';
const UPLOAD_FIX = '  <div id="upload" role="progressbar" aria-valuenow="40" aria-label="TODO(a11ygate): describe this progress bar"></div>';
/** Distinctive text that must never leave the process once a draft is rejected or a publish is denied. */
const SECRET_PATCH = 'REJECTED-PATCH-TEXT-7f3a';

// ---- git object ids, computed the way git does --------------------------------------------------

function treeHash(entries: Record<string, string>): string {
  const parts = Object.keys(entries)
    .sort()
    .map((name) => Buffer.concat([Buffer.from(`100644 ${name}\0`), Buffer.from(entries[name], 'hex')]));
  const body = Buffer.concat(parts);
  return createHash('sha1').update(`tree ${body.length}\0`).update(body).digest('hex');
}

const BASE_ENTRIES = { [FILE]: gitBlobHash(PAGE), [OTHER]: gitBlobHash(ABOUT) };
const BASE_TREE = treeHash(BASE_ENTRIES);
const verifiedTree = (content: string) => treeHash({ ...BASE_ENTRIES, [FILE]: gitBlobHash(content) });

// ---- fake GitHub --------------------------------------------------------------------------------

type Call = { method: string; pathname: string; body?: unknown };

class HttpError extends Error {
  constructor(readonly status: number, text: string) {
    super(`GitHub request failed (${status}). ${text}`);
  }
}

type FakeOptions = {
  /** Status to throw for matching `METHOD path-prefix` keys. */
  fail?: Record<string, number>;
  /** Commit the base branch points at (default: SHA). */
  baseHead?: string;
  /** Simulates a server that builds a different tree than requested. */
  treeOverride?: string;
};

function fakeGithub(options: FakeOptions = {}) {
  const calls: Call[] = [];
  const refs = new Map<string, string>([['feature', options.baseHead ?? SHA]]);
  const trees = new Map<string, Record<string, string>>([[BASE_TREE, BASE_ENTRIES]]);
  const commits = new Map<string, string>([[SHA, BASE_TREE]]);
  const pulls: { number: number; body: string; draft: boolean; head: string; state: string }[] = [];
  const comments: { id: number; body: string; path: string; line: number }[] = [];
  let next = 100;

  const github: GithubRequest = async (pathname, init = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ method, pathname, body: init.body });
    for (const [key, status] of Object.entries(options.fail ?? {})) {
      const [m, prefix] = key.split(' ');
      if (m === method && pathname === prefix) throw new HttpError(status, 'Resource not accessible by integration');
    }
    const body = (init.body ?? {}) as Record<string, unknown>;
    let match: RegExpExecArray | null;
    if (method === 'GET' && (match = /^\/repos\/o\/r\/git\/ref\/heads\/(.+)$/.exec(pathname))) {
      const name = decodeURIComponent(match[1]);
      if (!refs.has(name)) throw new HttpError(404, 'Not Found');
      return { object: { sha: refs.get(name) } };
    }
    if (method === 'GET' && (match = /^\/repos\/o\/r\/git\/commits\/([0-9a-f]{40})$/.exec(pathname))) {
      if (!commits.has(match[1])) throw new HttpError(404, 'Not Found');
      return { sha: match[1], tree: { sha: commits.get(match[1]) } };
    }
    if (method === 'POST' && pathname === '/repos/o/r/git/trees') {
      const entries = { ...trees.get(String(body.base_tree)) };
      for (const entry of body.tree as { path: string; content: string }[]) entries[entry.path] = gitBlobHash(entry.content);
      const sha = options.treeOverride ?? treeHash(entries);
      trees.set(sha, entries);
      return { sha };
    }
    if (method === 'POST' && pathname === '/repos/o/r/git/commits') {
      const sha = createHash('sha1').update(JSON.stringify(body)).digest('hex');
      commits.set(sha, String(body.tree));
      return { sha };
    }
    if (method === 'POST' && pathname === '/repos/o/r/git/refs') {
      const name = String(body.ref).replace(/^refs\/heads\//, '');
      if (refs.has(name)) throw new HttpError(422, 'Reference already exists');
      refs.set(name, String(body.sha));
      return { ref: body.ref };
    }
    if (method === 'DELETE' && (match = /^\/repos\/o\/r\/git\/refs\/heads\/(.+)$/.exec(pathname))) {
      refs.delete(decodeURIComponent(match[1]));
      return null;
    }
    if (method === 'GET' && pathname.startsWith('/repos/o/r/pulls?state=open')) {
      return pathname.includes('page=1') ? pulls.filter((pull) => pull.state === 'open') : [];
    }
    if (method === 'POST' && pathname === '/repos/o/r/pulls') {
      const pull = { number: next++, body: String(body.body), draft: body.draft === true, head: String(body.head), state: 'open' };
      pulls.push(pull);
      return pull;
    }
    if (method === 'PATCH' && (match = /^\/repos\/o\/r\/pulls\/(\d+)$/.exec(pathname))) {
      const pull = pulls.find((item) => item.number === Number(match![1]));
      if (pull && typeof body.body === 'string') pull.body = body.body;
      return pull;
    }
    if (method === 'GET' && /^\/repos\/o\/r\/pulls\/\d+\/comments/.test(pathname)) {
      return pathname.includes('page=1') ? comments : [];
    }
    if (method === 'GET' && /^\/repos\/o\/r\/pulls\/\d+\/files/.test(pathname)) {
      const patch = `@@ -0,0 +1,6 @@\n${PAGE.trimEnd().split('\n').map((line) => `+${line}`).join('\n')}`;
      return pathname.includes('page=1') ? [{ filename: FILE, status: 'modified', patch }] : [];
    }
    if (method === 'POST' && /^\/repos\/o\/r\/pulls\/\d+\/comments$/.test(pathname)) {
      const comment = { id: next++, body: String(body.body), path: String(body.path), line: Number(body.line) };
      comments.push(comment);
      return comment;
    }
    if (method === 'PATCH' && /^\/repos\/o\/r\/pulls\/comments\/\d+$/.test(pathname)) return {};
    return method === 'GET' ? [] : {};
  };
  return { github, calls, refs, pulls, comments };
}

/** Every call that would make a draft ready, approve, merge, request review, or un-draft. */
function forbiddenCalls(calls: readonly Call[]): Call[] {
  return calls.filter((call) => {
    const body = (call.body ?? {}) as Record<string, unknown>;
    const text = JSON.stringify(call.body ?? '');
    return (
      /\/merge$/.test(call.pathname) ||
      /\/reviews(\/|$)/.test(call.pathname) ||
      /\/requested_reviewers$/.test(call.pathname) ||
      /\/ready_for_review$/.test(call.pathname) ||
      /\/auto-merge|\/automerge/.test(call.pathname) ||
      call.pathname === '/graphql' ||
      /markPullRequestReadyForReview|enablePullRequestAutoMerge|mergePullRequest|addPullRequestReview/.test(text) ||
      ('draft' in body && body.draft !== true) ||
      ('state' in body && /^\/repos\/[^/]+\/[^/]+\/pulls\/\d+$/.test(call.pathname)) ||
      'event' in body
    );
  });
}

const writes = (calls: readonly Call[]) => calls.filter((call) => call.method !== 'GET');

// ---- candidates ---------------------------------------------------------------------------------

function request(line: number, findingId: string, ruleId: string): ModelDraftRequest {
  return { findingId, ruleId, sourceCommit: SHA, path: FILE, startLine: line, endLine: line, original: [PAGE.split('\n')[line - 1]], sourceBlobHash: gitBlobHash(PAGE) };
}

function makeDraft(req: ModelDraftRequest, replacement: string, flags: ModelDraft['humanReview']): ModelDraft {
  return { findingId: req.findingId, sourceBlobHash: req.sourceBlobHash, path: req.path, startLine: req.startLine, endLine: req.endLine, original: [...req.original], replacement: [replacement], rationale: 'Darken the text colour to raise contrast.', humanReview: flags };
}

function verifiedCandidate(line = 3, findingId = 'fp-contrast', ruleId = 'color-contrast', replacement = FIXED, overrides: Partial<CandidateVerification> = {}): PublishableCandidate {
  const req = request(line, findingId, ruleId);
  const flags: ModelDraft['humanReview'] = ruleId === 'color-contrast' ? ['model-drafted', 'visual-change'] : ['model-drafted'];
  const validation = validateDraft(makeDraft(req, replacement, flags), { request: req, content: PAGE });
  if (!validation.ok) throw new Error(`fixture draft rejected: ${validation.rejection.code}`);
  const patched = applyDrafts(PAGE, [validation.value.draft]);
  const verification: CandidateVerification = {
    verified: true,
    outcome: 'verified',
    reason: 'verified',
    detail: 'target cleared and no new findings in the tested routes',
    findingIds: [findingId],
    newFindings: 0,
    treeHash: verifiedTree(patched),
    patchedBlobs: [{ path: FILE, blobHash: gitBlobHash(patched) }],
    ...overrides,
  };
  return { candidate: { validated: validation.value, ruleId, targetHtml: PAGE.split('\n')[line - 1].trim(), sourceCommit: SHA }, verification, provider: 'stub' };
}

const FILES = [{ path: FILE, content: PAGE }];

async function publish(fake: ReturnType<typeof fakeGithub>, extra: Partial<PublishInput> = {}) {
  const warnings: string[] = [];
  const summary = await publishModelDrafts({
    github: fake.github,
    repo: 'o/r',
    candidates: [verifiedCandidate()],
    files: FILES,
    baseBranch: 'feature',
    pullNumber: 7,
    rescanRoutes: ['index.html'],
    warn: (message) => warnings.push(message),
    ...extra,
  });
  return { summary, warnings };
}

let net: ReturnType<typeof blockNetwork>;
beforeEach(() => {
  net = blockNetwork();
});
afterEach(() => {
  try {
    expect(net.attempts).toEqual([]);
  } finally {
    net.restore();
  }
});

describe('(a) draft-only: create as draft, never ready/approve/merge', () => {
  it('creates the pull request with draft: true and makes no ready, approve, merge or review-request call', async () => {
    const fake = fakeGithub();
    const { summary } = await publish(fake);
    expect(summary).toMatchObject({ created: 1, skipped: 0, permissionDenied: false });
    const creates = fake.calls.filter((call) => call.method === 'POST' && call.pathname === '/repos/o/r/pulls');
    expect(creates).toHaveLength(1);
    expect(creates[0].body).toMatchObject({ draft: true, head: modelDraftBranch(SHA, 'fp-contrast'), base: 'feature' });
    expect(fake.pulls[0].draft).toBe(true);
    expect(forbiddenCalls(fake.calls)).toEqual([]);
    expect(fake.calls.some((call) => JSON.stringify(call.body ?? '').includes('"draft":false'))).toBe(false);
    // Only these writes: one tree, one commit, one branch, one draft pull request.
    expect(writes(fake.calls).map((call) => `${call.method} ${call.pathname}`)).toEqual([
      'POST /repos/o/r/git/trees',
      'POST /repos/o/r/git/commits',
      'POST /repos/o/r/git/refs',
      'POST /repos/o/r/pulls',
    ]);
  });

  it('the recorder flags ready/approve/merge/review/un-draft calls if a publisher ever issued them', () => {
    const bad: Call[] = [
      { method: 'PUT', pathname: '/repos/o/r/pulls/100/merge' },
      { method: 'POST', pathname: '/repos/o/r/pulls/100/reviews', body: { event: 'APPROVE' } },
      { method: 'POST', pathname: '/repos/o/r/pulls/100/requested_reviewers', body: { reviewers: ['someone'] } },
      { method: 'PATCH', pathname: '/repos/o/r/pulls/100', body: { draft: false } },
      { method: 'POST', pathname: '/graphql', body: { query: 'mutation { markPullRequestReadyForReview(input: {}) { clientMutationId } }' } },
      { method: 'POST', pathname: '/repos/o/r/pulls', body: { draft: false } },
    ];
    for (const call of bad) expect(forbiddenCalls([call]), `${call.method} ${call.pathname}`).toHaveLength(1);
    // And the real publisher's recording passes the same check.
    expect(forbiddenCalls([{ method: 'POST', pathname: '/repos/o/r/pulls', body: { draft: true } }])).toEqual([]);
  });

  it('publishes nothing for unverified, rejected, stale or combined-failed candidates', async () => {
    const rejected = verifiedCandidate(3, 'fp-contrast', 'color-contrast', `  <p id="note" class="${SECRET_PATCH}">Shipping is free.</p>`, { verified: false, outcome: 'rejected', reason: 'target-persists', treeHash: undefined, patchedBlobs: undefined });
    const stale = verifiedCandidate(3, 'fp-contrast', 'color-contrast', FIXED, { verified: false, outcome: 'stale', reason: 'head-moved' });
    const noTree = verifiedCandidate(3, 'fp-contrast', 'color-contrast', FIXED, { treeHash: undefined });
    const wrongFinding = verifiedCandidate(3, 'fp-contrast', 'color-contrast', FIXED, { findingIds: ['fp-other'] });
    for (const candidate of [rejected, stale, noTree, wrongFinding]) {
      const fake = fakeGithub();
      const { summary, warnings } = await publish(fake, { candidates: [candidate] });
      expect(summary.records[0]).toMatchObject({ action: 'skipped', reason: 'not-verified' });
      expect(fake.calls).toEqual([]);
      expect(JSON.stringify([summary, warnings, buildPublishStatus(summary)])).not.toContain(SECRET_PATCH);
    }

    // Two verified alone, but the combined re-verify failed (or is missing): neither is published.
    const pair = [verifiedCandidate(), verifiedCandidate(4, 'fp-upload', 'aria-progressbar-name', UPLOAD_FIX)];
    for (const combined of [null, { verified: false, outcome: 'rejected', reason: 'new-finding', detail: '1 new finding(s) after the patch', findingIds: ['fp-contrast', 'fp-upload'], newFindings: 1 } as CandidateVerification]) {
      const fake = fakeGithub();
      const { summary } = await publish(fake, { candidates: pair, combined });
      expect(summary.records.map((record) => record.reason)).toEqual(['combined-not-verified', 'combined-not-verified']);
      expect(fake.calls).toEqual([]);
    }

    // With a passing combined re-verify both are published, each as its own draft.
    const fake = fakeGithub();
    const combined: CandidateVerification = { verified: true, outcome: 'verified', reason: 'verified', detail: 'ok', findingIds: ['fp-contrast', 'fp-upload'], newFindings: 0 };
    const { summary } = await publish(fake, { candidates: pair, combined });
    expect(summary.created).toBe(2);
    expect(fake.pulls.every((pull) => pull.draft)).toBe(true);
    expect(fake.pulls[0].body).toContain('Combined re-verify with other drafts: passed');
  });

  it('skips a stale candidate when the base branch has moved past the scanned commit', async () => {
    const fake = fakeGithub({ baseHead: 'b'.repeat(40) });
    const { summary } = await publish(fake);
    expect(summary.records[0]).toMatchObject({ action: 'skipped', reason: 'stale' });
    expect(writes(fake.calls)).toEqual([]);
  });
});

describe('(b) human-review wording and provenance', () => {
  it('draft PR body carries the label, provenance, re-scan evidence, checklist and disclaimer', async () => {
    const fake = fakeGithub();
    await publish(fake, { models: { stub: 'stub' } });
    const body = fake.pulls[0].body;
    const tree = verifiedTree(applyDrafts(PAGE, [verifiedCandidate().candidate.validated.draft]));
    for (const text of [
      modelDraftMarker(SHA, 'fp-contrast'),
      MODEL_DRAFT_LABEL,
      'Model-drafted, needs human review.',
      'A person must review',
      'never marks it ready, approves or merges it',
      'Provider: `stub`',
      'Model: `stub`',
      'Finding fingerprint: `fp-contrast`',
      `Source commit: \`${SHA}\``,
      'Rule: `color-contrast`',
      'Verified: yes',
      'Target finding cleared: yes',
      'New findings in tested routes: none',
      `Verified tree: \`${tree}\``,
      'Re-scan summary: target cleared and no new findings in the tested routes',
      'Tested routes: `index.html`',
      'Review checklist',
      'contrast in every relevant state and theme',
      'Automated testing only. Not a WCAG audit, certification or legal advice.',
    ]) {
      expect(body, text).toContain(text);
    }
    expect(String(fake.calls.find((call) => call.pathname === '/repos/o/r/pulls')?.body && (fake.calls.find((call) => call.pathname === '/repos/o/r/pulls')!.body as { title: string }).title)).toContain(MODEL_DRAFT_LABEL);
    expect(body).not.toMatch(/fixes everything|WCAG compliant|certified/i);
  });

  it('labelled review suggestion carries the same wording plus a suggestion block, on the review-suggestion channel', async () => {
    const fake = fakeGithub();
    const { summary } = await publish(fake, { mode: 'review-suggestion', models: { stub: 'stub' } });
    expect(summary.records[0]).toMatchObject({ channel: 'review-suggestion', action: 'created' });
    expect(fake.pulls).toEqual([]);
    const body = fake.comments[0].body;
    for (const text of [`**A11yGate: ${MODEL_DRAFT_LABEL}**`, '```suggestion', FIXED, 'Provider: `stub`', 'Model: `stub`', 'Finding fingerprint: `fp-contrast`', `Source commit: \`${SHA}\``, 'Verified: yes', 'Target finding cleared: yes', 'New findings in tested routes: none', 'Automated testing only. Not a WCAG audit, certification or legal advice.']) {
      expect(body, text).toContain(text);
    }
    expect(fake.comments[0]).toMatchObject({ path: FILE, line: 3 });
    expect(forbiddenCalls(fake.calls)).toEqual([]);
  });

  it('falls back to a labelled suggestion when draft pull requests are unavailable, removing its own branch', async () => {
    const fake = fakeGithub({ fail: { 'POST /repos/o/r/pulls': 422 } });
    const { summary } = await publish(fake);
    expect(summary.records[0]).toMatchObject({ channel: 'review-suggestion', action: 'created' });
    expect(fake.refs.has(modelDraftBranch(SHA, 'fp-contrast'))).toBe(false);
    expect(fake.comments[0].body).toContain(MODEL_DRAFT_LABEL);
  });

  it('neutralizes markdown, HTML and mentions in the model rationale', async () => {
    const item = verifiedCandidate();
    item.candidate.validated.draft.rationale = 'ping @org/team <img src=x onerror=alert(1)> `code`\n## heading';
    const fake = fakeGithub();
    await publish(fake, { candidates: [item] });
    const body = fake.pulls[0].body;
    expect(body).not.toContain('@org');
    expect(body).not.toContain('<img');
    expect(body).not.toContain('\n## heading');
  });
});

describe('(c) dedupe and permission-denied fallback', () => {
  it('a second run for the same commit + finding does not open a second draft', async () => {
    const fake = fakeGithub();
    await publish(fake);
    const again = await publish(fake);
    expect(again.summary).toMatchObject({ created: 0, unchanged: 1 });
    expect(fake.pulls).toHaveLength(1);
    expect(fake.calls.filter((call) => call.method === 'POST' && call.pathname === '/repos/o/r/pulls')).toHaveLength(1);

    // A changed body (for example a different model id) updates the existing draft in place, body only.
    const third = await publish(fake, { models: { stub: 'stub-v2' } });
    expect(third.summary).toMatchObject({ created: 0, updated: 1 });
    const patch = fake.calls.filter((call) => call.method === 'PATCH');
    expect(patch).toHaveLength(1);
    expect(Object.keys(patch[0].body as object)).toEqual(['body']);
    expect(fake.pulls).toHaveLength(1);
    expect(forbiddenCalls(fake.calls)).toEqual([]);
  });

  it('leaves a closed draft alone: the branch still exists, so no new pull request is opened', async () => {
    const fake = fakeGithub();
    await publish(fake);
    fake.pulls[0].state = 'closed';
    const again = await publish(fake);
    expect(again.summary.records[0]).toMatchObject({ action: 'skipped', reason: 'branch-exists' });
    expect(fake.pulls).toHaveLength(1);
  });

  it('dedupes labelled suggestions by commit + finding', async () => {
    const fake = fakeGithub();
    await publish(fake, { mode: 'review-suggestion' });
    const again = await publish(fake, { mode: 'review-suggestion' });
    expect(again.summary.unchanged).toBe(1);
    expect(fake.comments).toHaveLength(1);
  });

  it('permission denied (403) falls back to report-only: no throw, sanitized warning, no patch text', async () => {
    const replacement = `  <p id="note" style="color: #595959; background: #ffffff">${SECRET_PATCH}</p>`;
    const item = verifiedCandidate(3, 'fp-contrast', 'color-contrast', replacement);
    const second = verifiedCandidate(4, 'fp-upload', 'aria-progressbar-name', UPLOAD_FIX);
    const combined: CandidateVerification = { verified: true, outcome: 'verified', reason: 'verified', detail: 'ok', findingIds: ['fp-contrast', 'fp-upload'], newFindings: 0 };
    for (const [mode, fail] of [
      ['draft-pr', { 'POST /repos/o/r/git/trees': 403 }],
      ['draft-pr', { 'POST /repos/o/r/pulls': 403 }],
      ['review-suggestion', { 'POST /repos/o/r/pulls/7/comments': 403 }],
    ] as const) {
      const fake = fakeGithub({ fail });
      const { summary, warnings } = await publish(fake, { candidates: [item, second], combined, mode });
      expect(summary.permissionDenied).toBe(true);
      expect(summary.records.map((record) => record.reason)).toEqual(['permission-denied', 'permission-denied']);
      expect(summary.created).toBe(0);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/permission denied.*report only/i);
      const status = buildPublishStatus(summary);
      expect(status.join('\n')).toContain('not published: permission-denied');
      expect(JSON.stringify([summary, warnings, status])).not.toContain(SECRET_PATCH);
      expect(JSON.stringify([warnings, status])).not.toContain('Resource not accessible');
      // Publishing stopped after the first denial.
      expect(fake.calls.filter((call) => call.method !== 'GET' && call.method !== 'DELETE').length).toBeLessThanOrEqual(mode === 'draft-pr' && fail['POST /repos/o/r/pulls' as keyof typeof fail] ? 4 : 1);
    }
  });

  it('a rate limit stops publishing with a quota reason', async () => {
    const fake = fakeGithub({ fail: { 'POST /repos/o/r/git/trees': 429 } });
    const { summary } = await publish(fake);
    expect(summary.records[0]).toMatchObject({ reason: 'quota' });
    expect(summary.permissionDenied).toBe(false);
  });

  it('status lines for rejected drafts name the reason only, never the draft', async () => {
    const files: SourceFile[] = [{ path: FILE, content: PAGE, diffLines: new Set(PAGE.split('\n').map((_, i) => i + 1)) }];
    const findings: FixFinding[] = [{ fingerprint: 'fp-contrast', ruleId: 'color-contrast', html: '<p id="note" style="color: #aaaaaa; background: #ffffff">' }];
    const req = request(3, 'fp-contrast', 'color-contrast');
    const bad = { ...makeDraft(req, `  <p onclick="x()">${SECRET_PATCH}</p>`, ['model-drafted']) };
    const env = { A11YGATE_MODEL_PROVIDERS: 'stub', A11YGATE_MODEL_MAX_REQUESTS: '3', A11YGATE_MODEL_TIMEOUT_MS: '1000' };
    const config = resolveModelFixConfig({ repoConfig: 'modelFixes: true', flag: 'on', env });
    const verifier: CandidateVerifier = { verify: async () => { throw new Error('unused'); }, verifyCombined: async () => { throw new Error('unused'); } };
    const routed = await planWithModelFixes({ findings, files, config, adapters: [staticAdapter('stub', () => bad)], env, sourceCommit: SHA, verifier });
    expect(routed.verified).toEqual([]);
    const fake = fakeGithub();
    const summary = await publishModelDrafts({ github: fake.github, repo: 'o/r', candidates: routed.verified, files, baseBranch: 'feature' });
    const status = buildPublishStatus(summary, routed.model.routes);
    expect(status).toEqual(['Model draft for finding `fp-contrast` not published: draft rejected by the validator.']);
    expect(JSON.stringify([routed.model, status])).not.toContain(SECRET_PATCH);
    expect(fake.calls).toEqual([]);
  });
});

describe('(d) published tree equals the verified tree', () => {
  it('publishes when the tree GitHub builds equals the verified tree', async () => {
    const fake = fakeGithub();
    const item = verifiedCandidate();
    const { summary } = await publish(fake, { candidates: [item] });
    expect(summary.created).toBe(1);
    const commit = fake.calls.find((call) => call.method === 'POST' && call.pathname === '/repos/o/r/git/commits');
    expect(commit?.body).toMatchObject({ tree: item.verification.treeHash, parents: [SHA] });
  });

  it('refuses when the verifier re-scanned a different tree', async () => {
    const fake = fakeGithub();
    const item = verifiedCandidate(3, 'fp-contrast', 'color-contrast', FIXED, { treeHash: verifiedTree(PAGE.replace('#aaaaaa', '#000000')) });
    const { summary } = await publish(fake, { candidates: [item] });
    expect(summary.records[0]).toMatchObject({ action: 'skipped', reason: 'tree-mismatch' });
    expect(fake.calls.filter((call) => call.method === 'POST' && call.pathname !== '/repos/o/r/git/trees')).toEqual([]);
    expect(fake.pulls).toEqual([]);
  });

  it('refuses when the server-built tree differs, or the local content differs from the verified blob', async () => {
    const server = fakeGithub({ treeOverride: 'f'.repeat(40) });
    expect((await publish(server)).summary.records[0]).toMatchObject({ reason: 'tree-mismatch' });
    expect(server.pulls).toEqual([]);

    // Files on hand differ from the scanned source: nothing is built or published, on either channel.
    for (const mode of ['draft-pr', 'review-suggestion'] as const) {
      const local = fakeGithub();
      const { summary } = await publish(local, { mode, files: [{ path: FILE, content: PAGE.replace('Shipping', 'Delivery') }] });
      expect(summary.records[0]).toMatchObject({ reason: 'tree-mismatch' });
      expect(writes(local.calls)).toEqual([]);
    }
    // Verified blob does not match what the suggestion would apply.
    const blob = fakeGithub();
    const item = verifiedCandidate(3, 'fp-contrast', 'color-contrast', FIXED, { patchedBlobs: [{ path: FILE, blobHash: gitBlobHash('other') }] });
    expect((await publish(blob, { candidates: [item], mode: 'review-suggestion' })).summary.records[0]).toMatchObject({ reason: 'tree-mismatch' });
    expect(blob.comments).toEqual([]);
  });
});

describe('Action hook (default off, F1 unchanged)', () => {
  const REPORT = { findings: { new: [{ status: 'new', fingerprint: 'fp-contrast', ruleId: 'color-contrast', html: '<p id="note" style="color: #aaaaaa; background: #ffffff">' }] } };
  const env = { A11YGATE_MODEL_PROVIDERS: 'stub', A11YGATE_MODEL_MAX_REQUESTS: '3', A11YGATE_MODEL_TIMEOUT_MS: '1000' };
  const fakeVerifier: CandidateVerifier = {
    verify: async (candidate) => {
      const patched = applyDrafts(PAGE, [candidate.validated.draft]);
      return { verified: true, outcome: 'verified', reason: 'verified', detail: 'target cleared and no new findings in the tested routes', findingIds: [candidate.validated.draft.findingId], newFindings: 0, treeHash: verifiedTree(patched), patchedBlobs: [{ path: FILE, blobHash: gitBlobHash(patched) }] };
    },
    verifyCombined: async () => {
      throw new Error('single candidate');
    },
  };
  const adapter = () => staticAdapter('stub', () => makeDraft(request(3, 'fp-contrast', 'color-contrast'), FIXED, ['model-drafted', 'visual-change']));

  async function runAction(modelFixes: ReturnType<typeof resolveModelFixConfig>, withPublish = true) {
    const fake = fakeGithub();
    const info: string[] = [];
    const warnings: string[] = [];
    const summary = await postSuggestions({
      report: REPORT,
      github: fake.github,
      repo: 'o/r',
      pr: '7',
      headSha: SHA,
      warn: (message) => warnings.push(message),
      info: (message) => info.push(message),
      readFile: (relative) => (relative === FILE ? PAGE : null),
      modelFixes,
      modelAdapters: [adapter()],
      env,
      modelVerifier: fakeVerifier,
      modelPublish: withPublish ? { mode: 'draft-pr', baseBranch: 'feature' } : undefined,
    });
    return { fake, summary, info, warnings };
  }

  it('publishes a verified draft as a draft PR only when the repo opted in', async () => {
    const on = await runAction(resolveModelFixConfig({ repoConfig: 'modelFixes: true', flag: 'on', env }));
    expect(on.summary.published).toMatchObject({ created: 1 });
    expect(on.fake.pulls).toHaveLength(1);
    expect(on.fake.pulls[0].draft).toBe(true);
    expect(forbiddenCalls(on.fake.calls)).toEqual([]);
    expect(on.info.some((line) => line.includes('created as a draft pull request'))).toBe(true);

    for (const config of [resolveModelFixConfig({}), resolveModelFixConfig({ repoConfig: null, flag: 'on', env }), resolveModelFixConfig({ repoConfig: 'modelFixes: false', flag: 'on', env })]) {
      const off = await runAction(config);
      expect(off.summary.published).toBeUndefined();
      expect(off.fake.pulls).toEqual([]);
      expect(off.fake.calls.some((call) => call.pathname.includes('/git/'))).toBe(false);
    }
    const noPublish = await runAction(resolveModelFixConfig({ repoConfig: 'modelFixes: true', flag: 'on', env }), false);
    expect(noPublish.summary.published).toBeUndefined();
    expect(noPublish.fake.pulls).toEqual([]);
  });

  it('a denied publish keeps the run going and does not relabel F1 suggestions', async () => {
    const fake = fakeGithub({ fail: { 'POST /repos/o/r/git/trees': 403 } });
    const warnings: string[] = [];
    const summary = await postSuggestions({
      report: { findings: { new: [...REPORT.findings.new, { status: 'new', fingerprint: 'fp-lang', ruleId: 'html-has-lang', html: '<html lang="en">' }] } },
      github: fake.github,
      repo: 'o/r',
      pr: '7',
      headSha: SHA,
      warn: (message) => warnings.push(message),
      readFile: (relative) => (relative === FILE ? PAGE : null),
      modelFixes: resolveModelFixConfig({ repoConfig: 'modelFixes: true', flag: 'on', env }),
      modelAdapters: [adapter()],
      env,
      modelVerifier: fakeVerifier,
      modelPublish: { mode: 'draft-pr', baseBranch: 'feature' },
    });
    expect(summary.published?.permissionDenied).toBe(true);
    expect(warnings.join('\n')).not.toContain('#595959');
    for (const comment of fake.comments) expect(comment.body).not.toContain(MODEL_DRAFT_LABEL);
  });
});
