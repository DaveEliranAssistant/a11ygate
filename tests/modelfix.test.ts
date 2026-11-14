import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { planSuggestions, type FixFinding, type SourceFile } from '@/lib/fix';
import {
  BUILTIN_ADAPTERS,
  failingAdapter,
  MODEL_FIXES_OFF,
  parseRepoConsent,
  planWithModelFixes,
  resolveModelFixConfig,
  staticAdapter,
  type ModelAdapter,
  type ModelDraftRequest,
} from '@/lib/modelfix';
import { blockNetwork } from './network-guard';

const PAGE = [
  '<!doctype html>',
  '<html>',
  '<body>',
  '  <img src="hero.jpg">',
  '  <p class="muted">Low contrast text</p>',
  '  <span role="progressbar" aria-valuenow="40"></span>',
  '  <div class="close" onclick="hide()" aria-label="Close">',
  '  </div>',
  '  <img src="old.png">',
  '  <button class="icon"></button>',
  '  <button class="icon"></button>',
  '</body>',
  '</html>',
  '',
].join('\n');

const ALL_LINES = new Set(PAGE.split('\n').map((_, index) => index + 1));
// Line 9 (old.png) is outside the diff.
const DIFF = new Set([...ALL_LINES].filter((line) => line !== 9));
const FILES: SourceFile[] = [{ path: 'site/index.html', content: PAGE, diffLines: DIFF }];

const FINDINGS: FixFinding[] = [
  { fingerprint: 'fp-img', ruleId: 'image-alt', html: '<img src="hero.jpg">', status: 'new' },
  { fingerprint: 'fp-contrast', ruleId: 'color-contrast', html: '<p class="muted">', status: 'new' },
  { fingerprint: 'fp-aria', ruleId: 'aria-progressbar-name', html: '<span role="progressbar" aria-valuenow="40"></span>', status: 'new' },
  { fingerprint: 'fp-div', ruleId: 'aria-prohibited-attr', html: '<div class="close" onclick="hide()" aria-label="Close">', status: 'new' },
  { fingerprint: 'fp-lang', ruleId: 'html-has-lang', html: '<html>', status: 'new' },
  { fingerprint: 'fp-old', ruleId: 'image-alt', html: '<img src="old.png">', status: 'new' },
  { fingerprint: 'fp-ambiguous', ruleId: 'color-contrast', html: '<button class="icon"></button>', status: 'new' },
  { fingerprint: 'fp-unmapped', ruleId: 'color-contrast', html: '<h2 class="nowhere">', status: 'new' },
  { fingerprint: 'fp-open', ruleId: 'color-contrast', html: '<p class="muted">', status: 'still-open' },
];

/** F1-only output, recorded independently of the orchestrator. */
const F1_ONLY = planSuggestions(FINDINGS, FILES, { lang: 'en' });

const OPTED_IN = 'modelFixes: true\n';
const BUDGET = { A11YGATE_MODEL_MAX_REQUESTS: '10', A11YGATE_MODEL_TIMEOUT_MS: '1000' };

/** Wraps an adapter so every `draft` call is counted. */
function counted(adapter: ModelAdapter) {
  const calls: ModelDraftRequest[] = [];
  const wrapped: ModelAdapter = {
    id: adapter.id,
    isConfigured: (env) => adapter.isConfigured(env),
    draft: (request, signal) => {
      calls.push(request);
      return adapter.draft(request, signal);
    },
  };
  return { adapter: wrapped, calls };
}

let net: ReturnType<typeof blockNetwork>;
beforeEach(() => {
  net = blockNetwork();
});
afterEach(() => {
  net.restore();
});

describe('F1 baseline fixture', () => {
  it('has F1 suggestions for alt, clickable div and lang, and none for contrast or ARIA name', () => {
    expect(F1_ONLY.suggestions.map((s) => s.fingerprint)).toEqual(['fp-img', 'fp-div', 'fp-lang']);
    expect(F1_ONLY.suggestions.find((s) => s.fingerprint === 'fp-img')?.replacement.join('\n')).toContain('TODO(a11ygate)');
    expect(F1_ONLY.skipped).toEqual(
      expect.arrayContaining([
        { fingerprint: 'fp-contrast', ruleId: 'color-contrast', reason: 'unsupported-rule' },
        { fingerprint: 'fp-old', ruleId: 'image-alt', reason: 'outside-diff' },
        { fingerprint: 'fp-ambiguous', ruleId: 'color-contrast', reason: 'ambiguous' },
      ]),
    );
  });

  it('the network guard blocks fetch', async () => {
    await expect(fetch('https://example.invalid/')).rejects.toThrow(/Blocked outbound network/);
    expect(net.attempts).toEqual(['fetch']);
    net.attempts.length = 0;
  });
});

describe('no-model fallback equals F1-only output', () => {
  it('(a) no provider configured: zero model calls, zero network, F1 output', async () => {
    const env = { ...BUDGET, A11YGATE_MODEL_PROVIDERS: 'groq,gemini,cloudflare' };
    const config = resolveModelFixConfig({ repoConfig: OPTED_IN, flag: 'on', env });
    expect(config.enabled).toBe(true);
    expect(BUILTIN_ADAPTERS).toHaveLength(0);
    const result = await planWithModelFixes({ findings: FINDINGS, files: FILES, options: { lang: 'en' }, config, env, sourceCommit: 'a'.repeat(40) });
    expect(result.plan).toEqual(F1_ONLY);
    expect(result.model.status).toBe('no-provider');
    expect(result.model.modelRequests).toBe(0);
    expect(net.attempts).toEqual([]);
  });

  it('(a) a configured-looking adapter that is not allowlisted is never called', async () => {
    const stub = counted(failingAdapter('groq'));
    const config = resolveModelFixConfig({ repoConfig: OPTED_IN, flag: 'on', env: BUDGET });
    const result = await planWithModelFixes({ findings: FINDINGS, files: FILES, options: { lang: 'en' }, config, adapters: [stub.adapter], env: BUDGET });
    expect(result.plan).toEqual(F1_ONLY);
    expect(result.model.status).toBe('no-provider');
    expect(stub.calls).toHaveLength(0);
    expect(net.attempts).toEqual([]);
  });

  it('(b) models explicitly off: adapters untouched, F1 output', async () => {
    const env = { ...BUDGET, A11YGATE_MODEL_PROVIDERS: 'groq', A11YGATE_MODEL_FIXES: 'off' };
    const stub = counted(failingAdapter('groq'));
    const config = resolveModelFixConfig({ repoConfig: OPTED_IN, flag: 'on', env });
    expect(config.enabled).toBe(false);
    const result = await planWithModelFixes({ findings: FINDINGS, files: FILES, options: { lang: 'en' }, config, adapters: [stub.adapter], env });
    expect(result.plan).toEqual(F1_ONLY);
    expect(result.model.status).toBe('disabled');
    expect(result.model.modelRequests).toBe(0);
    expect(stub.calls).toHaveLength(0);
    expect(net.attempts).toEqual([]);
  });

  it('(b) default config: F1 output, zero calls', async () => {
    const stub = counted(failingAdapter('groq'));
    const result = await planWithModelFixes({ findings: FINDINGS, files: FILES, options: { lang: 'en' }, config: MODEL_FIXES_OFF, adapters: [stub.adapter] });
    expect(result.plan).toEqual(F1_ONLY);
    expect(stub.calls).toHaveLength(0);
    expect(net.attempts).toEqual([]);
  });

  it('(b) every adapter fails: one attempt per adapter, then no further requests, F1 output', async () => {
    const env = { ...BUDGET, A11YGATE_MODEL_PROVIDERS: 'groq,gemini' };
    const groq = counted(failingAdapter('groq'));
    const gemini = counted(failingAdapter('gemini'));
    const config = resolveModelFixConfig({ repoConfig: OPTED_IN, flag: 'on', env });
    const result = await planWithModelFixes({
      findings: FINDINGS,
      files: FILES,
      options: { lang: 'en' },
      config,
      adapters: [groq.adapter, gemini.adapter],
      env,
    });
    expect(result.plan).toEqual(F1_ONLY);
    expect(result.model.status).toBe('adapters-failed');
    // Two eligible findings, but the circuit opens after each adapter's first failure.
    expect(groq.calls).toHaveLength(1);
    expect(gemini.calls).toHaveLength(1);
    expect(result.model.modelRequests).toBe(2);
    expect(result.model.routes.filter((r) => r.route === 'model-eligible').every((r) => r.model?.outcome === 'adapters-failed')).toBe(true);
    expect(net.attempts).toEqual([]);
  });

  it('a successful stub draft is discarded unpublished (no verifier yet)', async () => {
    const env = { ...BUDGET, A11YGATE_MODEL_PROVIDERS: 'groq' };
    const stub = counted(
      staticAdapter('groq', (findingId, request) => ({
        findingId,
        sourceBlobHash: request.sourceBlobHash,
        path: 'site/index.html',
        startLine: 5,
        endLine: 5,
        original: ['  <p class="muted">Low contrast text</p>'],
        replacement: ['  <p class="muted" style="color:#000">Low contrast text</p>'],
        rationale: 'stub',
        humanReview: ['model-drafted', 'visual-change'],
      })),
    );
    const config = resolveModelFixConfig({ repoConfig: OPTED_IN, flag: 'on', env });
    const result = await planWithModelFixes({ findings: FINDINGS, files: FILES, options: { lang: 'en' }, config, adapters: [stub.adapter], env });
    expect(result.plan).toEqual(F1_ONLY);
    expect(JSON.stringify(result)).not.toContain('color:#000');
    expect(result.model.status).toBe('no-verified-candidate');
    expect(result.model.routes.find((r) => r.fingerprint === 'fp-contrast')?.model).toEqual({ outcome: 'unverified-discarded', provider: 'groq' });
    expect(net.attempts).toEqual([]);
  });

  it('stops at the request budget', async () => {
    const env = { A11YGATE_MODEL_MAX_REQUESTS: '1', A11YGATE_MODEL_TIMEOUT_MS: '1000', A11YGATE_MODEL_PROVIDERS: 'groq,gemini' };
    const groq = counted(failingAdapter('groq'));
    const gemini = counted(failingAdapter('gemini'));
    const config = resolveModelFixConfig({ repoConfig: OPTED_IN, flag: 'on', env });
    const result = await planWithModelFixes({ findings: FINDINGS, files: FILES, options: { lang: 'en' }, config, adapters: [groq.adapter, gemini.adapter], env });
    expect(result.plan).toEqual(F1_ONLY);
    expect(result.model.modelRequests).toBe(1);
    expect(gemini.calls).toHaveLength(0);
    expect(result.model.status).toBe('over-budget');
  });

  it('makes no request without a budget and timeout', async () => {
    const env = { A11YGATE_MODEL_PROVIDERS: 'groq' };
    const stub = counted(failingAdapter('groq'));
    const config = resolveModelFixConfig({ repoConfig: OPTED_IN, flag: 'on', env });
    const result = await planWithModelFixes({ findings: FINDINGS, files: FILES, options: { lang: 'en' }, config, adapters: [stub.adapter], env });
    expect(result.plan).toEqual(F1_ONLY);
    expect(result.model.status).toBe('no-budget');
    expect(stub.calls).toHaveLength(0);
  });

  it('times out a hanging adapter and falls back', async () => {
    const env = { A11YGATE_MODEL_MAX_REQUESTS: '5', A11YGATE_MODEL_TIMEOUT_MS: '20', A11YGATE_MODEL_PROVIDERS: 'slow' };
    const slow: ModelAdapter = { id: 'slow', isConfigured: () => true, draft: () => new Promise(() => {}) };
    const config = resolveModelFixConfig({ repoConfig: OPTED_IN, flag: 'on', env });
    const result = await planWithModelFixes({ findings: FINDINGS, files: FILES, options: { lang: 'en' }, config, adapters: [slow], env });
    expect(result.plan).toEqual(F1_ONLY);
    expect(result.model.status).toBe('adapters-failed');
    expect(result.model.modelRequests).toBe(1);
  });
});

describe('model-fix config', () => {
  it('is off by default', () => {
    expect(MODEL_FIXES_OFF).toMatchObject({ enabled: false, reason: 'default-off', providers: [], maxRequests: 0 });
    expect(resolveModelFixConfig({ repoConfig: OPTED_IN }).enabled).toBe(false);
  });

  it('a repository denial beats a flag or env "on"', () => {
    for (const repoConfig of [null, '', 'modelFixes: false\n', 'other: true\n', 'modelFixes: yes\n', 'modelFixes: true\nmodelFixes: true\n', '  modelFixes: true\n']) {
      expect(resolveModelFixConfig({ repoConfig, flag: 'on' }).enabled).toBe(false);
      expect(resolveModelFixConfig({ repoConfig, env: { A11YGATE_MODEL_FIXES: 'on' } }).enabled).toBe(false);
      expect(resolveModelFixConfig({ repoConfig, flag: 'on', env: { A11YGATE_MODEL_FIXES: 'true' } }).enabled).toBe(false);
    }
    expect(resolveModelFixConfig({ repoConfig: null, flag: 'on' }).reason).toBe('repo-missing');
    expect(resolveModelFixConfig({ repoConfig: 'modelFixes: false', flag: 'on' }).reason).toBe('repo-denied');
    expect(resolveModelFixConfig({ repoConfig: 'modelFixes: maybe', flag: 'on' }).reason).toBe('repo-invalid');
  });

  it('flag or env off wins when the repository opted in', () => {
    expect(resolveModelFixConfig({ repoConfig: OPTED_IN, flag: 'off', env: { A11YGATE_MODEL_FIXES: 'on' } })).toMatchObject({ enabled: false, reason: 'turned-off' });
    expect(resolveModelFixConfig({ repoConfig: OPTED_IN, flag: 'on', env: { A11YGATE_MODEL_FIXES: 'off' } })).toMatchObject({ enabled: false, reason: 'turned-off' });
    const unknown = resolveModelFixConfig({ repoConfig: OPTED_IN, flag: 'sure' });
    expect(unknown.enabled).toBe(false);
    expect(unknown.warnings).toHaveLength(1);
  });

  it('turns on only with repository opt-in plus flag or env on', () => {
    expect(resolveModelFixConfig({ repoConfig: OPTED_IN, flag: 'on' }).enabled).toBe(true);
    expect(resolveModelFixConfig({ repoConfig: '# a11ygate\nmodelFixes: "true" # opt in\n', env: { A11YGATE_MODEL_FIXES: '1' } }).enabled).toBe(true);
  });

  it('parses repository consent strictly', () => {
    expect(parseRepoConsent(undefined)).toBe('missing');
    expect(parseRepoConsent('modelFixes: true')).toBe('opted-in');
    expect(parseRepoConsent('modelFixes: True')).toBe('invalid');
    expect(parseRepoConsent('modelFixes: false')).toBe('denied');
  });

  it('parses providers and caps', () => {
    const config = resolveModelFixConfig({
      env: { A11YGATE_MODEL_PROVIDERS: ' Groq, gemini ,groq,bad/name', A11YGATE_MODEL_MAX_REQUESTS: '1000', A11YGATE_MODEL_TIMEOUT_MS: '500' },
    });
    expect(config.providers).toEqual(['groq', 'gemini']);
    expect(config.maxRequests).toBe(0);
    expect(config.timeoutMs).toBe(500);
    expect(config.warnings.join(' ')).toContain('A11YGATE_MODEL_MAX_REQUESTS');
  });
});

describe('eligibility and F1 precedence', () => {
  async function routesWith(env: Record<string, string>, repoConfig: string | null, adapters: ModelAdapter[] = []) {
    const config = resolveModelFixConfig({ repoConfig, flag: 'on', env });
    const result = await planWithModelFixes({ findings: FINDINGS, files: FILES, options: { lang: 'en' }, config, adapters, env, sourceCommit: 'b'.repeat(40) });
    return { result, byId: new Map(result.model.routes.map((r) => [r.fingerprint, r])) };
  }

  it('routes F1-fixable findings to F1, never to the model path', async () => {
    const stub = counted(failingAdapter('groq'));
    const { byId } = await routesWith({ ...BUDGET, A11YGATE_MODEL_PROVIDERS: 'groq' }, OPTED_IN, [stub.adapter]);
    // image-alt is model-eligible by rule, but F1 has a placeholder suggestion: F1 wins.
    expect(byId.get('fp-img')).toMatchObject({ route: 'f1', model: null, path: 'site/index.html', startLine: 4 });
    expect(byId.get('fp-div')?.route).toBe('f1');
    expect(stub.calls.map((c) => c.findingId)).not.toContain('fp-img');
  });

  it('keeps unmapped, ambiguous, outside-diff and not-new findings report-only', async () => {
    const { byId } = await routesWith({ ...BUDGET, A11YGATE_MODEL_PROVIDERS: 'groq' }, OPTED_IN, [failingAdapter('groq')]);
    for (const id of ['fp-old', 'fp-ambiguous', 'fp-unmapped', 'fp-open']) expect(byId.get(id)).toMatchObject({ route: 'report-only', model: null });
  });

  it('a contrast finding without an F1 suggestion is eligible; requests only happen with models on and a provider', async () => {
    const stub = counted(failingAdapter('groq'));
    const on = await routesWith({ ...BUDGET, A11YGATE_MODEL_PROVIDERS: 'groq' }, OPTED_IN, [stub.adapter]);
    expect(on.byId.get('fp-contrast')).toMatchObject({
      route: 'model-eligible',
      f1Skip: 'unsupported-rule',
      sourceCommit: 'b'.repeat(40),
      path: 'site/index.html',
      startLine: 5,
    });
    expect(on.byId.get('fp-aria')?.route).toBe('model-eligible');
    expect(stub.calls[0]).toMatchObject({ findingId: 'fp-contrast', original: ['  <p class="muted">Low contrast text</p>'] });

    const noProvider = await routesWith(BUDGET, OPTED_IN);
    expect(noProvider.byId.get('fp-contrast')?.model).toEqual({ outcome: 'no-provider', provider: null });
    expect(noProvider.result.model.modelRequests).toBe(0);

    const denied = counted(failingAdapter('groq'));
    const repoDenied = await routesWith({ ...BUDGET, A11YGATE_MODEL_PROVIDERS: 'groq' }, 'modelFixes: false', [denied.adapter]);
    expect(repoDenied.byId.get('fp-contrast')?.model).toEqual({ outcome: 'models-off', provider: null });
    expect(denied.calls).toHaveLength(0);
    expect(net.attempts).toEqual([]);
  });

  it('never throws: an adapter whose isConfigured throws is skipped', async () => {
    const broken: ModelAdapter = { id: 'groq', isConfigured: () => { throw new Error('x'); }, draft: async () => { throw new Error('y'); } };
    const { result } = await routesWith({ ...BUDGET, A11YGATE_MODEL_PROVIDERS: 'groq' }, OPTED_IN, [broken]);
    expect(result.plan).toEqual(F1_ONLY);
    expect(result.model.status).toBe('no-provider');
  });
});
