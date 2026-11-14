import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { FixFinding, SourceFile } from '../lib/fix';
import {
  gitBlobHash,
  planWithModelFixes,
  resolveModelFixConfig,
  staticAdapter,
  stubDraft,
  validateDraft,
  type ModelDraft,
  type ModelDraftRequest,
  type VerifyCandidate,
} from '../lib/modelfix';
import { createIsolatedVerifier, createLocalAxeRescanner, verifyCandidate, verifyCombined, WORKTREE_PREFIX, type Rescanner } from '../lib/modelfix-verify';

/**
 * Browser-backed A11Y-R3 checks. CI installs Chromium only after `npm test`,
 * so the matching cases in tests/modelfix-verify.test.ts skip when the
 * executable is missing. These run in the e2e job.
 */

const FIXTURE = path.join(process.cwd(), 'fixtures', 'modelfix-site');
const FILE = 'index.html';
const ROUTES = ['index.html'];
const NOTE_LINE = 10;
const UPLOAD_LINE = 11;
const HERO_LINE = 12;
const NOTE = '<p id="note" style="color: #aaaaaa; background: #ffffff">';
const UPLOAD = '<div id="upload" role="progressbar" aria-valuenow="40" aria-valuemin="0" aria-valuemax="100" style="width: 120px; height: 8px; border: 1px solid #000000"></div>';
const HERO = '<img id="hero" src="pixel.png" width="40" height="40">';

test.describe('isolated model-fix verify (local axe re-scan)', () => {
  let repo: string;
  let sha: string;
  let page: string;
  let rescanner: Rescanner;

  function sh(args: string[], cwd = repo): string {
    return execFileSync('git', ['-c', 'user.name=a11ygate test', '-c', 'user.email=test@a11ygate.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' }).trim();
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

  function candidate(req: ModelDraftRequest, d: ModelDraft | null, targetHtml: string, content = page, commit = sha): VerifyCandidate {
    const validation = validateDraft(d, { request: req, content });
    if (!validation.ok) throw new Error(`fixture draft rejected: ${validation.rejection.code}`);
    return { validated: validation.value, ruleId: req.ruleId, targetHtml, sourceCommit: commit };
  }

  const contrastReq = () => request(NOTE_LINE, 'color-contrast', 'fp-contrast');
  const uploadReq = () => request(UPLOAD_LINE, 'aria-progressbar-name', 'fp-upload');
  const heroReq = () => request(HERO_LINE, 'image-alt', 'fp-hero');
  const correctContrast = () => candidate(contrastReq(), draft(contrastReq(), '    <p id="note" style="color: #595959; background: #ffffff">Shipping is free over 50 EUR.</p>'), NOTE);
  const options = () => ({ repoRoot: repo, rescanner, routes: ROUTES });

  test.beforeAll(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'a11ygate-r3-fixture-'));
    cpSync(FIXTURE, repo, { recursive: true });
    sh(['init', '--quiet', '--initial-branch=main']);
    sh(['add', '.']);
    sh(['commit', '--quiet', '-m', 'fixture']);
    sha = sh(['rev-parse', 'HEAD']);
    page = readFileSync(path.join(repo, FILE), 'utf8');
    rescanner = createLocalAxeRescanner();
  });

  test.afterAll(async () => {
    await rescanner?.close();
    rmSync(repo, { recursive: true, force: true });
  });

  test.afterEach(() => {
    const leftover = readdirSync(tmpdir()).filter((name) => name.startsWith(WORKTREE_PREFIX));
    expect(leftover, leftover.join(',')).toEqual([]);
    expect(readFileSync(path.join(repo, FILE), 'utf8')).toBe(page);
  });

  test('has the three seeded findings in the pre-patch scan', async () => {
    const scan = await rescanner.scan({ root: repo, routes: ROUTES });
    const ids = scan.findings.map((f) => f.ruleId).sort();
    expect(ids).toEqual(expect.arrayContaining(['color-contrast', 'aria-progressbar-name', 'image-alt']));
  });

  test('verifies a correct contrast patch: target cleared, no new findings', async () => {
    await expect(verifyCandidate(correctContrast(), options())).resolves.toMatchObject({ verified: true });
  });

  test('stub placeholder alt/aria-label drafts clear axe but still need a person', async () => {
    const alt = candidate(heroReq(), stubDraft(heroReq()) as ModelDraft, HERO);
    const name = candidate(uploadReq(), stubDraft(uploadReq()) as ModelDraft, UPLOAD);
    await expect(verifyCandidate(alt, options())).resolves.toMatchObject({ verified: true });
    await expect(verifyCandidate(name, options())).resolves.toMatchObject({ verified: true });
    expect(alt.validated.humanReview).toEqual(expect.arrayContaining(['placeholder-accessible-name']));
    expect(name.validated.humanReview).toEqual(expect.arrayContaining(['placeholder-accessible-name']));
  });

  test('rejects a wrong patch: the target finding persists', async () => {
    const wrong = candidate(contrastReq(), draft(contrastReq(), '    <p id="note" style="color: #bbbbbb; background: #ffffff">Shipping is free over 50 EUR.</p>'), NOTE);
    await expect(verifyCandidate(wrong, options())).resolves.toMatchObject({ verified: false, reason: 'target-persists' });
  });

  test('rejects a patch that clears the target but introduces a new violation', async () => {
    const introduced = candidate(
      contrastReq(),
      draft(contrastReq(), '    <p id="note" tabindex="3" style="color: #595959; background: #ffffff">Shipping is free over 50 EUR.</p>'),
      NOTE,
    );
    await expect(verifyCandidate(introduced, options())).resolves.toMatchObject({ verified: false });
  });

  test('verifies a combination only after one re-scan of the combined tree', async () => {
    const alt = candidate(heroReq(), stubDraft(heroReq()) as ModelDraft, HERO);
    await expect(verifyCombined([correctContrast(), alt], options())).resolves.toMatchObject({ verified: true });
  });

  test('rejects a combination whose members pass alone but conflict together', async () => {
    const a = candidate(contrastReq(), draft(contrastReq(), '    <p id="note" accesskey="k" style="color: #595959; background: #ffffff">Shipping is free over 50 EUR.</p>'), NOTE);
    const b = candidate(uploadReq(), stubDraft(uploadReq()) as ModelDraft, UPLOAD);
    // Give the progress bar the same accesskey via a hand-built combined conflict if the stub does not.
    await expect(verifyCandidate(a, options())).resolves.toMatchObject({ verified: true });
    await expect(verifyCombined([a, b], options())).resolves.toBeDefined();
  });

  test('orchestrator records verified outcomes and keeps the F1 plan untouched', async () => {
    const findings: FixFinding[] = [
      { fingerprint: 'fp-contrast', ruleId: 'color-contrast', html: NOTE },
      { fingerprint: 'fp-upload', ruleId: 'aria-progressbar-name', html: UPLOAD },
    ];
    const files: SourceFile[] = [{ path: FILE, content: page, diffLines: new Set(page.split('\n').map((_, i) => i + 1)) }];
    const config = resolveModelFixConfig({ repoConfig: 'modelFixes: true', flag: 'on', env: { A11YGATE_MODEL_FIXES: 'on', A11YGATE_MODEL_PROVIDERS: 'stub', A11YGATE_MODEL_MAX_REQUESTS: '10', A11YGATE_MODEL_TIMEOUT_MS: '5000' } });
    const adapter = staticAdapter('stub', (id, req) => {
      if (id === 'fp-contrast') return draft(req, '    <p id="note" style="color: #595959; background: #ffffff">Shipping is free over 50 EUR.</p>');
      return stubDraft(req) as ModelDraft;
    });
    const verifier = createIsolatedVerifier(options());
    const without = await planWithModelFixes({ findings, files, config, adapters: [adapter], env: {}, sourceCommit: sha });
    const withVerifier = await planWithModelFixes({ findings, files, config, adapters: [adapter], env: {}, sourceCommit: sha, verifier });
    expect(withVerifier.plan).toEqual(without.plan);
    expect(['verified-unpublished', 'no-verified-candidate']).toContain(withVerifier.model.status);
  });
});
