import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import type { FixFinding, SourceFile } from '@/lib/fix';
import {
  applyDrafts,
  gitBlobHash,
  planWithModelFixes,
  resolveModelFixConfig,
  staticAdapter,
  stubDraft,
  validateDraft,
  type ModelDraft,
  type ModelDraftRequest,
  type VerifyCandidate,
} from '@/lib/modelfix';
import { createIsolatedVerifier, createLocalAxeRescanner, verifyCandidate, verifyCombined, WORKTREE_PREFIX, type Rescanner } from '@/lib/modelfix-verify';
import { blockNetwork } from './network-guard';

/**
 * Isolated apply + re-scan (A11Y-R3). A fixture site is committed to a temp
 * git repository; drafts are applied in a disposable worktree pinned to that
 * commit and re-scanned with axe in local headless Chromium. No public URL is
 * ever scanned and outbound network is blocked.
 */

const FIXTURE = path.join(process.cwd(), 'fixtures', 'modelfix-site');
const FILE = 'index.html';
const ROUTES = ['index.html'];
const TIMEOUT = 90_000;
// CI runs `npm test` before `npx playwright install`. Browser-backed cases
// also run in e2e/modelfix-verify.spec.ts after Chromium is available.
const hasChromium = existsSync(chromium.executablePath());

const NOTE_LINE = 10;
const UPLOAD_LINE = 11;
const HERO_LINE = 12;

let repo: string;
let sha: string;
let page: string;
let rescanner: Rescanner;
let net: ReturnType<typeof blockNetwork>;
let leftoversBefore: Set<string>;

function sh(args: string[], cwd = repo): string {
  return execFileSync('git', ['-c', 'user.name=a11ygate test', '-c', 'user.email=test@a11ygate.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' }).trim();
}

/** Independent tree id: the scanned commit's tree with `file` replaced, built with plumbing in the object store only. */
function expectedTree(file: string, content: string): string {
  const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: repo, input: content, encoding: 'utf8' }).trim();
  const listing = sh(['ls-tree', sha]).split('\n').map((line) => (line.endsWith(`\t${file}`) ? line.replace(/blob [0-9a-f]{40}/, `blob ${blob}`) : line));
  return execFileSync('git', ['mktree'], { cwd: repo, input: `${listing.join('\n')}\n`, encoding: 'utf8' }).trim();
}

function verifierDirs(): string[] {
  return readdirSync(tmpdir()).filter((name) => name.startsWith(WORKTREE_PREFIX));
}

function request(line: number, ruleId: string, findingId: string, content = page): ModelDraftRequest {
  return {
    findingId,
    ruleId,
    sourceCommit: sha,
    path: FILE,
    startLine: line,
    endLine: line,
    original: [content.split('\n')[line - 1]],
    sourceBlobHash: gitBlobHash(content),
  };
}

function draft(req: ModelDraftRequest, replacement: string, flags: ModelDraft['humanReview'] = ['model-drafted', 'visual-change']): ModelDraft {
  return { findingId: req.findingId, sourceBlobHash: req.sourceBlobHash, path: req.path, startLine: req.startLine, endLine: req.endLine, original: [...req.original], replacement: [replacement], rationale: 'test draft', humanReview: flags };
}

/** Only schema-valid drafts become candidates (R2). */
function candidate(req: ModelDraftRequest, d: ModelDraft | null, targetHtml: string, content = page, commit = sha): VerifyCandidate {
  const validation = validateDraft(d, { request: req, content });
  if (!validation.ok) throw new Error(`fixture draft rejected: ${validation.rejection.code}`);
  return { validated: validation.value, ruleId: req.ruleId, targetHtml, sourceCommit: commit };
}

const NOTE = '<p id="note" style="color: #aaaaaa; background: #ffffff">';
const UPLOAD = '<div id="upload" role="progressbar" aria-valuenow="40" aria-valuemin="0" aria-valuemax="100" style="width: 120px; height: 8px; border: 1px solid #000000"></div>';
const HERO = '<img id="hero" src="pixel.png" width="40" height="40">';

const contrastReq = () => request(NOTE_LINE, 'color-contrast', 'fp-contrast');
const uploadReq = () => request(UPLOAD_LINE, 'aria-progressbar-name', 'fp-upload');
const heroReq = () => request(HERO_LINE, 'image-alt', 'fp-hero');

/** Deterministic colour fix chosen by the test (not by the stub adapter): #595959 on white is about 7:1. */
const correctContrast = () => candidate(contrastReq(), draft(contrastReq(), '    <p id="note" style="color: #595959; background: #ffffff">Shipping is free over 50 EUR.</p>'), NOTE);
const options = () => ({ repoRoot: repo, rescanner, routes: ROUTES });

beforeAll(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'a11ygate-r3-fixture-'));
  cpSync(FIXTURE, repo, { recursive: true });
  sh(['init', '--quiet', '--initial-branch=main']);
  sh(['add', '.']);
  sh(['commit', '--quiet', '-m', 'fixture']);
  sha = sh(['rev-parse', 'HEAD']);
  page = readFileSync(path.join(repo, FILE), 'utf8');
  rescanner = createLocalAxeRescanner();
});

afterAll(async () => {
  await rescanner?.close();
  rmSync(repo, { recursive: true, force: true });
});

beforeEach(() => {
  net = blockNetwork();
  leftoversBefore = new Set(verifierDirs());
});

afterEach(() => {
  try {
    expect(net.attempts).toEqual([]);
  } finally {
    net.restore();
    // (d) No disposable worktree survives a run, pass or fail, and none stays registered.
    expect(verifierDirs().filter((name) => !leftoversBefore.has(name))).toEqual([]);
    expect(sh(['worktree', 'list', '--porcelain']).split('\n').filter((line) => line.startsWith('worktree '))).toHaveLength(1);
    // The caller's working tree is never written.
    expect(readFileSync(path.join(repo, FILE), 'utf8')).toBe(page);
    expect(sh(['status', '--porcelain'])).toBe('');
  }
});

describe.skipIf(!hasChromium)('fixture baseline', () => {
  it('has the three seeded findings in the pre-patch scan', { timeout: TIMEOUT }, async () => {
    const scan = await rescanner.scan({ root: repo, routes: ROUTES });
    expect(scan.status[FILE]).toBe(200);
    const violations = scan.findings.filter((f) => f.kind === 'violation').map((f) => `${f.ruleId} ${f.selector}`);
    expect(violations).toEqual(expect.arrayContaining(['color-contrast #note', 'aria-progressbar-name #upload', 'image-alt #hero']));
  });
});

describe.skipIf(!hasChromium)('(a) apply in isolation and re-scan', () => {
  it('verifies a correct contrast patch: target cleared, no new findings', { timeout: TIMEOUT }, async () => {
    const result = await verifyCandidate(correctContrast(), options());
    expect(result).toMatchObject({ verified: true, outcome: 'verified', reason: 'verified', newFindings: 0, findingIds: ['fp-contrast'] });
    // The verified tree is exactly the scanned tree plus the patched file (what a publisher must reproduce).
    const patched = applyDrafts(page, [correctContrast().validated.draft]);
    expect(result.treeHash).toBe(expectedTree(FILE, patched));
    expect(result.patchedBlobs).toEqual([{ path: FILE, blobHash: gitBlobHash(patched) }]);
  });

  it('stub placeholder alt/aria-label drafts: axe accepts any non-empty name, so they clear, but still need a person', { timeout: TIMEOUT }, async () => {
    for (const [req, html] of [[heroReq(), HERO], [uploadReq(), UPLOAD]] as const) {
      const stub = stubDraft(req);
      expect(stub?.replacement.join('\n')).toContain('TODO(a11ygate)');
      const c = candidate(req, stub, html);
      // Honest result: the placeholder is a non-empty name, so axe no longer reports the rule.
      // It is not real alt text; publishing must still require a human to write the wording.
      expect(c.validated.humanReview).toContain('placeholder-accessible-name');
      expect(c.validated.requiresAcknowledgement).toBe(true);
      expect(await verifyCandidate(c, options())).toMatchObject({ verified: true, reason: 'verified' });
    }
  });

  it('rejects a wrong patch: the target finding persists', { timeout: TIMEOUT }, async () => {
    // Still too light (#999999 on white is about 2.8:1).
    const wrong = candidate(contrastReq(), draft(contrastReq(), '    <p id="note" style="color: #999999; background: #ffffff">Shipping is free over 50 EUR.</p>'), NOTE);
    expect(await verifyCandidate(wrong, options())).toMatchObject({ verified: false, outcome: 'rejected', reason: 'target-persists' });
    // The stub adapter only adds a review comment for contrast; it does not pick colours, so it cannot verify.
    const stub = candidate(contrastReq(), stubDraft(contrastReq()), NOTE);
    expect(await verifyCandidate(stub, options())).toMatchObject({ verified: false, reason: 'target-persists' });
  });

  it('rejects a patch that clears the target but introduces a new violation', { timeout: TIMEOUT }, async () => {
    const regress = candidate(contrastReq(), draft(contrastReq(), '    <p id="note" tabindex="3" style="color: #595959; background: #ffffff">Shipping is free over 50 EUR.</p>'), NOTE);
    const result = await verifyCandidate(regress, options());
    expect(result).toMatchObject({ verified: false, outcome: 'rejected', reason: 'new-finding' });
    expect(result.newFindings).toBeGreaterThan(0);
  });

  it('cleans up even when the re-scan throws', { timeout: TIMEOUT }, async () => {
    const broken: Rescanner = { tags: rescanner.tags, scan: async () => { throw new Error('boom'); }, close: async () => undefined };
    const result = await verifyCandidate(correctContrast(), { ...options(), rescanner: broken });
    expect(result).toMatchObject({ verified: false, reason: 'error' });
  });
});

describe('(b) stale head or source', () => {
  it('discards the candidate when the head moved past the scanned commit', { timeout: TIMEOUT }, async () => {
    const c = correctContrast();
    sh(['commit', '--quiet', '--allow-empty', '-m', 'later commit']);
    try {
      expect(await verifyCandidate(c, options())).toMatchObject({ verified: false, outcome: 'stale', reason: 'head-moved' });
    } finally {
      sh(['reset', '--quiet', '--hard', sha]);
    }
  });

  it('discards the candidate when the file at the scanned commit differs from the draft source', { timeout: TIMEOUT }, async () => {
    // The draft was validated against an uncommitted edit, not the scanned commit.
    const edited = page.replace('Order status</h1>', 'Your order</h1>');
    const req = request(NOTE_LINE, 'color-contrast', 'fp-contrast', edited);
    const c = candidate(req, draft(req, '    <p id="note" style="color: #595959; background: #ffffff">Shipping is free over 50 EUR.</p>'), NOTE, edited);
    expect(await verifyCandidate(c, options())).toMatchObject({ verified: false, outcome: 'stale', reason: 'blob-mismatch' });
  });

  it('discards the candidate when the scanned commit is unknown', { timeout: TIMEOUT }, async () => {
    const c = { ...correctContrast(), sourceCommit: 'f'.repeat(40) };
    expect(await verifyCandidate(c, options())).toMatchObject({ verified: false, outcome: 'stale', reason: 'commit-missing' });
  });
});

describe.skipIf(!hasChromium)('(c) combined candidates are re-verified together', () => {
  const placeholderUpload = () => candidate(uploadReq(), stubDraft(uploadReq()), UPLOAD);
  const withAccessKey = (c: 'note' | 'upload') =>
    c === 'note'
      ? candidate(contrastReq(), draft(contrastReq(), '    <p id="note" accesskey="s" style="color: #595959; background: #ffffff">Shipping is free over 50 EUR.</p>'), NOTE)
      : candidate(uploadReq(), draft(uploadReq(), '    <div id="upload" accesskey="s" aria-label="TODO(a11ygate): name this progress bar" role="progressbar" aria-valuenow="40" aria-valuemin="0" aria-valuemax="100" style="width: 120px; height: 8px; border: 1px solid #000000"></div>', ['model-drafted', 'placeholder-accessible-name']), UPLOAD);

  it('verifies a combination only after one re-scan of the combined tree', { timeout: TIMEOUT }, async () => {
    const result = await verifyCombined([correctContrast(), placeholderUpload()], options());
    expect(result).toMatchObject({ verified: true, reason: 'verified', findingIds: ['fp-contrast', 'fp-upload'] });
  });

  it('rejects a combination whose members pass alone but conflict together', { timeout: TIMEOUT }, async () => {
    const note = withAccessKey('note');
    const upload = withAccessKey('upload');
    expect(await verifyCandidate(note, options())).toMatchObject({ verified: true });
    expect(await verifyCandidate(upload, options())).toMatchObject({ verified: true });
    // Two elements now share accesskey="s": a finding neither patch caused alone.
    expect(await verifyCombined([note, upload], options())).toMatchObject({ verified: false, reason: 'new-finding' });
  });

  it('rejects a combination that contains a failing member', { timeout: TIMEOUT }, async () => {
    const wrong = candidate(contrastReq(), stubDraft(contrastReq()), NOTE);
    expect(await verifyCombined([wrong, placeholderUpload()], options())).toMatchObject({ verified: false, reason: 'target-persists' });
  });

  it('orchestrator records verified/rejected outcomes and the combined check, and keeps the F1 plan untouched', { timeout: TIMEOUT }, async () => {
    const files: SourceFile[] = [{ path: FILE, content: page, diffLines: new Set(page.split('\n').map((_, i) => i + 1)) }];
    const findings: FixFinding[] = [
      { fingerprint: 'fp-contrast', ruleId: 'color-contrast', html: NOTE, status: 'new' },
      { fingerprint: 'fp-upload', ruleId: 'aria-progressbar-name', html: UPLOAD, status: 'new' },
    ];
    const env = { A11YGATE_MODEL_PROVIDERS: 'stub', A11YGATE_MODEL_MAX_REQUESTS: '5', A11YGATE_MODEL_TIMEOUT_MS: '5000' };
    const config = resolveModelFixConfig({ repoConfig: 'modelFixes: true\n', flag: 'on', env });
    const adapter = staticAdapter('stub', (findingId, req) =>
      findingId === 'fp-contrast'
        ? draft(req, '    <p id="note" style="color: #595959; background: #ffffff">Shipping is free over 50 EUR.</p>')
        : (stubDraft(req) as ModelDraft),
    );
    const verifier = createIsolatedVerifier(options());
    const withVerifier = await planWithModelFixes({ findings, files, config, adapters: [adapter], env, sourceCommit: sha, verifier });
    const without = await planWithModelFixes({ findings, files, config, adapters: [adapter], env, sourceCommit: sha });
    expect(withVerifier.plan).toEqual(without.plan);
    expect(withVerifier.model.status).toBe('verified-unpublished');
    expect(withVerifier.model.routes.map((r) => r.model)).toEqual([
      { outcome: 'verified', provider: 'stub', verification: 'verified' },
      { outcome: 'verified', provider: 'stub', verification: 'verified' },
    ]);
    expect(withVerifier.model.combined).toMatchObject({ verified: true, findingIds: ['fp-contrast', 'fp-upload'] });

    // Wrong patch through the orchestrator: recorded as rejected, nothing combined.
    const stubOnly = staticAdapter('stub', (_id, req) => stubDraft(req) as ModelDraft);
    const rejected = await planWithModelFixes({ findings: findings.slice(0, 1), files, config, adapters: [stubOnly], env, sourceCommit: sha, verifier });
    expect(rejected.model.status).toBe('no-verified-candidate');
    expect(rejected.model.routes[0].model).toEqual({ outcome: 'verify-rejected', provider: 'stub', verification: 'target-persists' });
    expect(rejected.model.combined).toBeUndefined();

    // Moved head through the orchestrator: discarded as stale.
    sh(['commit', '--quiet', '--allow-empty', '-m', 'later commit']);
    try {
      const stale = await planWithModelFixes({ findings: findings.slice(0, 1), files, config, adapters: [adapter], env, sourceCommit: sha, verifier });
      expect(stale.model.routes[0].model).toEqual({ outcome: 'stale-discarded', provider: 'stub', verification: 'head-moved' });
    } finally {
      sh(['reset', '--quiet', '--hard', sha]);
    }
  });
});

describe('local-only re-scan', () => {
  it('the rescanner takes a directory, serves it on 127.0.0.1 and never accepts a URL', () => {
    const source = readFileSync(path.join(process.cwd(), 'lib', 'modelfix-verify', 'rescan.ts'), 'utf8');
    expect(source).toContain("server.listen(0, '127.0.0.1'");
    expect(source).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)[a-z]/i);
  });
});
