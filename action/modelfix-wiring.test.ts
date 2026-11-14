import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  adaptersForEnv,
  BUILTIN_ADAPTERS,
  gitBlobHash,
  resolveModelFixConfig,
  stubDraft,
  validateDraft,
  type CandidateVerifier,
} from '@/lib/modelfix';
import { createActionVerifier, rescanPlanFromAxeInputs, routeFromUrl } from '@/lib/modelfix-verify';
import { blockNetwork } from '../tests/network-guard';
import { postSuggestions, type GithubRequest } from './suggestions.mjs';

/**
 * A11Y-R6 Action wiring: stub opt-in, verifier construction and fail-closed
 * behaviour. No browser is launched and outbound network is blocked.
 */

const SHA = 'c'.repeat(40);
const PAGE = '<html lang="en">\n<body>\n  <img src="hero.jpg">\n  <div role="progressbar" aria-valuenow="40" aria-valuemin="0" aria-valuemax="100"></div>\n</body>\n</html>\n';
const PATCH = '@@ -0,0 +1,6 @@\n+<html lang="en">\n+<body>\n+  <img src="hero.jpg">\n+  <div role="progressbar" aria-valuenow="40" aria-valuemin="0" aria-valuemax="100"></div>\n+</body>\n+</html>';
const REPORT = {
  findings: {
    new: [
      { status: 'new', fingerprint: 'fp-img', ruleId: 'image-alt', html: '<img src="hero.jpg">' },
      { status: 'new', fingerprint: 'fp-progress', ruleId: 'aria-progressbar-name', html: '<div role="progressbar" aria-valuenow="40" aria-valuemin="0" aria-valuemax="100"></div>' },
    ],
  },
};
const STUB_ENV = { A11YGATE_MODEL_PROVIDERS: 'stub', A11YGATE_MODEL_MAX_REQUESTS: '3', A11YGATE_MODEL_TIMEOUT_MS: '5000' };

function fakeGithub() {
  const calls: { pathname: string; method: string; body?: unknown }[] = [];
  const github: GithubRequest = async (pathname, init = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ pathname, method, body: init.body });
    if (method === 'GET' && pathname.startsWith('/repos/o/r/pulls/7/files')) {
      return pathname.includes('page=1') ? [{ filename: 'index.html', status: 'modified', patch: PATCH }] : [];
    }
    return method === 'GET' ? [] : {};
  };
  return { github, calls };
}

async function run(extra: Partial<Parameters<typeof postSuggestions>[0]> = {}) {
  const { github, calls } = fakeGithub();
  const summary = await postSuggestions({
    report: REPORT,
    github,
    repo: 'o/r',
    pr: '7',
    headSha: SHA,
    lang: 'en',
    warn: () => {},
    readFile: (relative) => (relative === 'index.html' ? PAGE : null),
    ...extra,
  });
  return { summary, calls };
}

let net: ReturnType<typeof blockNetwork>;
beforeEach(() => {
  net = blockNetwork();
});
afterEach(() => {
  net.restore();
});

describe('stub adapter opt-in', () => {
  it('is never a default: only listed when A11YGATE_MODEL_PROVIDERS names stub', () => {
    expect(BUILTIN_ADAPTERS.map((item) => item.id)).toEqual(['groq', 'gemini', 'cloudflare']);
    expect(adaptersForEnv({})).toBe(BUILTIN_ADAPTERS);
    expect(adaptersForEnv({ A11YGATE_MODEL_PROVIDERS: 'groq,gemini' })).toBe(BUILTIN_ADAPTERS);
    expect(adaptersForEnv({ A11YGATE_MODEL_PROVIDERS: 'groq, STUB' }).map((item) => item.id)).toEqual(['groq', 'gemini', 'cloudflare', 'stub']);
  });

  it('the stub drafts a TODO placeholder for aria-progressbar-name, never real name text', () => {
    const original = ['  <div role="progressbar" aria-valuenow="40"></div>'];
    const draft = stubDraft({ findingId: 'f', ruleId: 'aria-progressbar-name', sourceCommit: SHA, path: 'index.html', startLine: 1, endLine: 1, original, sourceBlobHash: gitBlobHash(original[0]) });
    expect(draft?.replacement).toEqual(['  <div aria-label="TODO(a11ygate): name this control" role="progressbar" aria-valuenow="40"></div>']);
  });
});

describe('F1 behaviour is unchanged unless a verified draft exists (acceptance b)', () => {
  it('off, denied, no stub, no verifier and a fail-closed verifier all make the same GitHub calls as F1', async () => {
    const baseline = await run();
    expect(baseline.summary.created).toBe(1);
    const failClosed: CandidateVerifier = {
      verify: async (candidate) => ({ verified: false, outcome: 'rejected', reason: 'error', detail: 'verifier failed', findingIds: [candidate.validated.draft.findingId], newFindings: 0 }),
      verifyCombined: async () => {
        throw new Error('unused');
      },
    };
    const publish = { mode: 'draft-pr' as const, baseBranch: 'feature', routes: ['index.html'] };
    const variants = [
      { modelFixes: resolveModelFixConfig({ repoConfig: 'modelFixes: true', flag: 'off', env: STUB_ENV }), env: STUB_ENV, modelAdapters: adaptersForEnv(STUB_ENV), modelVerifier: failClosed, modelPublish: publish },
      { modelFixes: resolveModelFixConfig({ repoConfig: 'modelFixes: false', flag: 'on', env: STUB_ENV }), env: STUB_ENV, modelAdapters: adaptersForEnv(STUB_ENV), modelVerifier: failClosed, modelPublish: publish },
      { modelFixes: resolveModelFixConfig({ repoConfig: 'modelFixes: true', flag: 'on', env: {} }), env: {}, modelAdapters: adaptersForEnv({}), modelPublish: publish },
      { modelFixes: resolveModelFixConfig({ repoConfig: 'modelFixes: true', flag: 'on', env: STUB_ENV }), env: STUB_ENV, modelAdapters: adaptersForEnv(STUB_ENV), modelPublish: publish },
      { modelFixes: resolveModelFixConfig({ repoConfig: 'modelFixes: true', flag: 'on', env: STUB_ENV }), env: STUB_ENV, modelAdapters: adaptersForEnv(STUB_ENV), modelVerifier: failClosed, modelPublish: publish },
    ];
    const outcomes: string[] = [];
    for (const variant of variants) {
      const result = await run(variant);
      expect(result.calls).toEqual(baseline.calls);
      const { model, published, ...rest } = result.summary;
      expect(rest).toEqual(baseline.summary);
      expect(published).toBeUndefined();
      outcomes.push(`${model?.status}:${model?.routes.find((route) => route.fingerprint === 'fp-progress')?.model?.outcome ?? '-'}`);
    }
    expect(outcomes[0]).toMatch(/^disabled/);
    expect(outcomes[1]).toMatch(/^disabled/);
    expect(outcomes[2]).toMatch(/^no-provider/);
    expect(outcomes[3]).toBe('no-verified-candidate:unverified-discarded');
    expect(outcomes[4]).toBe('no-verified-candidate:verify-rejected');
    expect(net.attempts).toEqual([]);
  });
});

describe('re-scan plan from the current axe inputs', () => {
  it('derives local routes and the original axe tags from the scanned pages', () => {
    const runOnly = { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };
    const inputs = ['index', 'signup', 'cart'].map((name) => ({ url: `http://127.0.0.1:4173/${name}.html`, toolOptions: { runOnly } }));
    expect(rescanPlanFromAxeInputs(inputs)).toEqual({ routes: ['index.html', 'signup.html', 'cart.html'], tags: runOnly.values });
    expect(rescanPlanFromAxeInputs([[{ url: 'http://localhost:3000/' }], { url: 'https://example.test/docs/' }])).toEqual({ routes: ['index.html', 'docs/index.html'], tags: null });
    expect(routeFromUrl('file:///etc/passwd')).toBeNull();
    expect(routeFromUrl('http://x.test/%2e%2e/secret')).toBe('secret'); // URL parsing normalizes dot segments
    expect(routeFromUrl('http://x.test/a b.html')).toBeNull();
    expect(routeFromUrl(42)).toBeNull();
  });
});

describe('createActionVerifier', () => {
  let repo: string;
  let head: string;
  const git = (args: string[]) =>
    execFileSync('git', ['-c', 'user.name=a11ygate test', '-c', 'user.email=test@a11ygate.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: repo, encoding: 'utf8' }).trim();

  beforeEach(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'a11ygate-r6-'));
    writeFileSync(path.join(repo, 'index.html'), PAGE);
    git(['init', '-q']);
    git(['add', 'index.html']);
    git(['commit', '-q', '-m', 'fixture']);
    head = git(['rev-parse', 'HEAD']);
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('skips with a sanitized warning when routes, git checkout or head commit are missing', async () => {
    const warnings: string[] = [];
    const warn = (message: string) => warnings.push(message);
    expect(await createActionVerifier({ workspace: repo, headSha: head, routes: [], warn })).toBeNull();
    expect(await createActionVerifier({ workspace: tmpdir(), headSha: head, routes: ['index.html'], warn })).toBeNull();
    expect(await createActionVerifier({ workspace: repo, headSha: 'd'.repeat(40), routes: ['index.html'], warn })).toBeNull();
    expect(warnings).toHaveLength(3);
    for (const message of warnings) expect(message).toMatch(/Drafts are discarded/);
  });

  it('fails closed with one warning when Playwright/Chromium cannot load', async () => {
    const warnings: string[] = [];
    const built = await createActionVerifier({
      workspace: repo,
      headSha: head,
      routes: ['index.html'],
      warn: (message) => warnings.push(message),
      load: async () => {
        throw new Error('Executable doesn\'t exist at /secret/path/chromium');
      },
    });
    expect(built).not.toBeNull();
    const original = ['  <div role="progressbar" aria-valuenow="40" aria-valuemin="0" aria-valuemax="100"></div>'];
    const request = { findingId: 'fp-progress', ruleId: 'aria-progressbar-name', sourceCommit: head, path: 'index.html', startLine: 4, endLine: 4, original, sourceBlobHash: gitBlobHash(PAGE) };
    const draft = stubDraft(request);
    const validated = validateDraft(draft, { request, content: PAGE, repoRoot: repo });
    expect(validated.ok).toBe(true);
    if (!validated.ok || !built) return;
    const candidate = { validated: validated.value, ruleId: 'aria-progressbar-name', targetHtml: REPORT.findings.new[1].html, sourceCommit: head };
    const first = await built.verifier.verify(candidate);
    const second = await built.verifier.verify(candidate);
    await built.close();
    expect(first).toMatchObject({ verified: false, reason: 'error' });
    expect(second).toMatchObject({ verified: false, reason: 'error' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).not.toContain('/secret/path');
    expect(git(['worktree', 'list']).split('\n')).toHaveLength(1);
    expect(net.attempts).toEqual([]);
  });
});
