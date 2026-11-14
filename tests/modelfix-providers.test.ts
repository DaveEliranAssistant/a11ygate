import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { planSuggestions, type FixFinding, type SourceFile } from '@/lib/fix';
import {
  BUILTIN_ADAPTERS,
  cloudflareAdapter,
  freeTierAdapters,
  geminiAdapter,
  groqAdapter,
  isSendable,
  parseDuration,
  parseRetryAfter,
  planWithModelFixes,
  resolveModelFixConfig,
  RETRY_POLICY,
  stubAdapter,
  untilNextUtcMidnight,
  type FetchLike,
  type ModelAdapter,
  type ModelClock,
  type ModelDraftRequest,
} from '@/lib/modelfix';
import { blockNetwork } from './network-guard';

/* Fixture: two model-eligible findings with no F1 suggestion. */
const PAGE = [
  '<!doctype html>',
  '<html lang="en">',
  '<body>',
  '  <p class="muted" style="color:#aaa">Low contrast text</p>',
  '  <span role="progressbar" aria-valuenow="40"></span>',
  '</body>',
  '</html>',
  '',
].join('\n');
const FILES: SourceFile[] = [{ path: 'site/index.html', content: PAGE, diffLines: new Set(PAGE.split('\n').map((_, i) => i + 1)) }];
const FINDINGS: FixFinding[] = [
  { fingerprint: 'fp-contrast', ruleId: 'color-contrast', html: '<p class="muted" style="color:#aaa">', status: 'new' },
  { fingerprint: 'fp-aria', ruleId: 'aria-progressbar-name', html: '<span role="progressbar" aria-valuenow="40"></span>', status: 'new' },
];
const F1_ONLY = planSuggestions(FINDINGS, FILES, { lang: 'en' });
const OPTED_IN = 'modelFixes: true\n';

/* Obviously fake credentials. Never real keys. */
const CREDS = {
  GROQ_API_KEY: 'test-groq-key-not-real',
  A11YGATE_MODEL_GROQ_MODEL: 'test-groq-model',
  GEMINI_API_KEY: 'test-gemini-key-not-real',
  A11YGATE_MODEL_GEMINI_MODEL: 'test-gemini-model',
  CLOUDFLARE_API_TOKEN: 'test-cloudflare-token-not-real',
  CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  A11YGATE_MODEL_CLOUDFLARE_MODEL: '@cf/test/test-model',
};
const ALL = 'groq,gemini,cloudflare';
function envWith(extra: Record<string, string> = {}): Record<string, string> {
  return { ...CREDS, A11YGATE_MODEL_PROVIDERS: ALL, A11YGATE_MODEL_MAX_REQUESTS: '10', A11YGATE_MODEL_TIMEOUT_MS: '1000', ...extra };
}

type Call = { host: string; url: string; init: RequestInit };
type Handler = (call: Call) => Response | Promise<Response>;

/** Recorded-response fake fetch. Unknown hosts fail the test; nothing touches the network. */
function fakeFetch(handlers: Record<string, Handler | Handler[]>) {
  const calls: Call[] = [];
  const queues = new Map(Object.entries(handlers).map(([host, h]) => [host, Array.isArray(h) ? [...h] : h]));
  const fetchImpl: FetchLike = async (url, init) => {
    const host = new URL(url).host;
    const call = { host, url, init };
    calls.push(call);
    const entry = queues.get(host);
    if (!entry) throw new Error(`unexpected host ${host}`);
    const handler = Array.isArray(entry) ? (entry.length > 1 ? entry.shift() : entry[0]) : entry;
    if (!handler) throw new Error(`no handler for ${host}`);
    return handler(call);
  };
  return { fetchImpl, calls, hosts: () => calls.map((c) => c.host) };
}

const GROQ = 'api.groq.com';
const GEMINI = 'generativelanguage.googleapis.com';
const CF = 'api.cloudflare.com';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function reply(request: ModelDraftRequest, replacement: string[]): string {
  void request;
  return JSON.stringify({ replacement, rationale: 'Raises the text colour contrast.' });
}

const FIXTURE_LINE = '  <p class="muted" style="color:#aaa">Low contrast text</p>';
const CONTRAST_FIX = ['  <p class="muted" style="color:#333">Low contrast text</p>'];
const ARIA_PLACEHOLDER = ['  <span role="progressbar" aria-label="TODO(a11ygate): name this progress bar" aria-valuenow="40"></span>'];

function bodyOf(call: Call): string {
  return String(call.init.body);
}
function replacementFor(call: Call): string[] {
  return bodyOf(call).includes('progressbar') ? ARIA_PLACEHOLDER : CONTRAST_FIX;
}

const groqOk: Handler = (call) => json(200, { choices: [{ message: { content: reply({} as ModelDraftRequest, replacementFor(call)) } }] });
const geminiOk: Handler = (call) => json(200, { candidates: [{ content: { parts: [{ text: reply({} as ModelDraftRequest, replacementFor(call)) }] } }] });
const cloudflareOk: Handler = (call) => json(200, { success: true, result: { response: reply({} as ModelDraftRequest, replacementFor(call)) } });

const groq429: Handler = () => json(429, { error: { message: 'Rate limit reached' } }, { 'retry-after': '30', 'x-ratelimit-reset-requests': '2m0s' });
const gemini429: Handler = () =>
  json(429, {
    error: {
      code: 429,
      status: 'RESOURCE_EXHAUSTED',
      message: 'You exceeded your current quota.',
      details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '45s' }],
    },
  });
const cloudflareNeurons: Handler = () =>
  json(429, { success: false, errors: [{ code: 4006, message: 'you have used up your daily free allocation of 10,000 neurons' }] });

/** Manual clock: time only moves when the test says so; `sleep` records and advances. */
function manualClock(start = Date.UTC(2026, 10, 14, 12, 0, 0)) {
  let now = start;
  const sleeps: number[] = [];
  const clock: ModelClock = {
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    random: () => 0.5,
  };
  return { clock, sleeps, advance: (ms: number) => (now += ms) };
}

async function run(env: Record<string, string>, fake: ReturnType<typeof fakeFetch>, extra: { adapters?: ModelAdapter[]; clock?: ModelClock; repoConfig?: string | null; flag?: string } = {}) {
  const config = resolveModelFixConfig({ repoConfig: extra.repoConfig === undefined ? OPTED_IN : extra.repoConfig, flag: extra.flag ?? 'on', env });
  const adapters = extra.adapters ?? freeTierAdapters({ fetch: fake.fetchImpl, env, now: extra.clock?.now });
  return planWithModelFixes({ findings: FINDINGS, files: FILES, options: { lang: 'en' }, config, adapters, env, clock: extra.clock ?? manualClock().clock });
}

let net: ReturnType<typeof blockNetwork>;
beforeEach(() => {
  net = blockNetwork();
});
afterEach(() => {
  // Every test uses an injected fake fetch; the real network must never be touched.
  expect(net.attempts).toEqual([]);
  net.restore();
});

describe('provider order and fallback', () => {
  it('429 → cooldown → next provider → … → F1 fallback, with zero waiting', async () => {
    const fake = fakeFetch({ [GROQ]: groq429, [GEMINI]: gemini429, [CF]: cloudflareNeurons });
    const { clock, sleeps } = manualClock();
    const result = await run(envWith(), fake, { clock });

    // Groq first, then Gemini, then Cloudflare; one call each. The second finding finds every provider cooling: no calls.
    expect(fake.hosts()).toEqual([GROQ, GEMINI, CF]);
    expect(result.model.modelRequests).toBe(3);
    expect(sleeps).toEqual([]);
    expect(result.plan).toEqual(F1_ONLY);
    expect(result.model.status).toBe('adapters-failed');
    expect(result.model.routes.map((r) => r.model?.outcome)).toEqual(['adapters-failed', 'adapters-failed']);

    const now = clock.now();
    const byId = new Map(result.model.providers?.map((p) => [p.id, p]));
    // Retry-After wins over the reset header for Groq; Gemini's RetryInfo; Cloudflare's daily reset at 00:00 UTC.
    expect(byId.get('groq')).toMatchObject({ state: 'cooldown', cooldownUntil: now + 30_000, requests: 1 });
    expect(byId.get('gemini')).toMatchObject({ state: 'cooldown', cooldownUntil: now + 45_000, requests: 1 });
    expect(byId.get('cloudflare')).toMatchObject({ state: 'cooldown', cooldownUntil: Date.UTC(2026, 10, 15), requests: 1 });
    expect(JSON.stringify(result)).not.toMatch(/quota|neurons|Rate limit/i);
  });

  it('429 on Groq moves to Gemini, whose draft is validated and discarded unpublished', async () => {
    const fake = fakeFetch({ [GROQ]: groq429, [GEMINI]: geminiOk, [CF]: cloudflareOk });
    const result = await run(envWith(), fake);
    expect(fake.hosts()).toEqual([GROQ, GEMINI, GEMINI]);
    expect(result.model.routes.map((r) => r.model)).toEqual([
      { outcome: 'unverified-discarded', provider: 'gemini' },
      { outcome: 'unverified-discarded', provider: 'gemini' },
    ]);
    expect(result.model.status).toBe('no-verified-candidate');
    expect(result.plan).toEqual(F1_ONLY);
    expect(JSON.stringify(result)).not.toContain('color:#333');
  });

  it('uses a provider again once its Retry-After has passed, never before', async () => {
    const { clock, advance } = manualClock();
    let groqCalls = 0;
    const fake = fakeFetch({
      [GROQ]: (call) => {
        groqCalls += 1;
        return groqCalls === 1 ? groq429(call) : groqOk(call);
      },
      [GEMINI]: (call) => {
        advance(31_000); // The Gemini call takes long enough for Groq's 30 s cooldown to expire.
        return geminiOk(call);
      },
      [CF]: cloudflareOk,
    });
    const result = await run(envWith(), fake, { clock });
    expect(fake.hosts()).toEqual([GROQ, GEMINI, GROQ]);
    expect(result.model.routes.map((r) => r.model?.provider)).toEqual(['gemini', 'groq']);
  });

  it('retries transient 5xx with bounded jitter inside the budget, then opens the circuit', async () => {
    const fake = fakeFetch({ [GROQ]: () => json(503, { error: 'busy' }), [GEMINI]: geminiOk, [CF]: cloudflareOk });
    const { clock, sleeps } = manualClock();
    const result = await run(envWith(), fake, { clock });
    // 1 attempt + maxRetries retries on Groq, then Gemini; Groq is not tried for the second finding.
    expect(fake.hosts()).toEqual([...Array(1 + RETRY_POLICY.maxRetries).fill(GROQ), GEMINI, GEMINI]);
    expect(sleeps).toHaveLength(RETRY_POLICY.maxRetries);
    for (const ms of sleeps) expect(ms).toBeLessThanOrEqual(RETRY_POLICY.maxDelayMs);
    expect(result.model.providers?.find((p) => p.id === 'groq')?.state).toBe('circuit-open');
    expect(result.model.modelRequests).toBe(RETRY_POLICY.maxRetries + 3);
  });

  it('does not retry 429s and does not retry auth, region or missing-model errors', async () => {
    const fake = fakeFetch({
      [GROQ]: () => json(401, { error: { message: 'Invalid API Key test-groq-key-not-real' } }),
      [GEMINI]: () => json(400, { error: { status: 'FAILED_PRECONDITION', message: 'User location is not supported for the API use.' } }),
      [CF]: () => json(404, { success: false, errors: [{ code: 5007, message: 'No such model' }] }),
    });
    const { clock, sleeps } = manualClock();
    const result = await run(envWith(), fake, { clock });
    expect(fake.hosts()).toEqual([GROQ, GEMINI, CF]);
    expect(sleeps).toEqual([]);
    expect(result.model.providers?.map((p) => p.state)).toEqual(['circuit-open', 'circuit-open', 'circuit-open']);
    expect(result.plan).toEqual(F1_ONLY);
    expect(JSON.stringify(result)).not.toContain('test-groq-key-not-real');
  });

  it('skips providers with missing credentials, unsupported model IDs or a bad account ID', async () => {
    const fake = fakeFetch({ [GROQ]: groqOk, [GEMINI]: geminiOk, [CF]: cloudflareOk });
    const env = envWith({ GROQ_API_KEY: '', A11YGATE_MODEL_GEMINI_MODEL: 'models/../../evil', CLOUDFLARE_ACCOUNT_ID: 'not-an-account' });
    const result = await run(env, fake);
    expect(result.model.status).toBe('no-provider');
    expect(fake.calls).toEqual([]);

    expect(groqAdapter().isConfigured({ GROQ_API_KEY: 'k' })).toBe(false); // no explicit model: no silent default
    expect(cloudflareAdapter().isConfigured({ ...CREDS, A11YGATE_MODEL_CLOUDFLARE_MODEL: 'https://evil.invalid/x' })).toBe(false);
    expect(geminiAdapter().isConfigured(CREDS)).toBe(true);
  });
});

describe('budget', () => {
  it('budget exhausted → zero further model calls', async () => {
    const fake = fakeFetch({ [GROQ]: groq429, [GEMINI]: gemini429, [CF]: cloudflareOk });
    const result = await run(envWith({ A11YGATE_MODEL_MAX_REQUESTS: '2' }), fake);
    expect(fake.hosts()).toEqual([GROQ, GEMINI]);
    expect(result.model.modelRequests).toBe(2);
    expect(result.model.status).toBe('over-budget');
    expect(result.model.routes.map((r) => r.model?.outcome)).toEqual(['over-budget', 'over-budget']);
    expect(result.plan).toEqual(F1_ONLY);
  });

  it('retries stop at the budget too', async () => {
    const fake = fakeFetch({ [GROQ]: () => json(500, {}), [GEMINI]: geminiOk, [CF]: cloudflareOk });
    const result = await run(envWith({ A11YGATE_MODEL_MAX_REQUESTS: '1' }), fake);
    expect(fake.hosts()).toEqual([GROQ]);
    expect(result.model.modelRequests).toBe(1);
  });

  it('no budget or no timeout → zero calls', async () => {
    const extras: Record<string, string>[] = [{ A11YGATE_MODEL_MAX_REQUESTS: '0' }, { A11YGATE_MODEL_TIMEOUT_MS: '' }];
    for (const extra of extras) {
      const fake = fakeFetch({ [GROQ]: groqOk, [GEMINI]: geminiOk, [CF]: cloudflareOk });
      const result = await run(envWith(extra), fake);
      expect(result.model.status).toBe('no-budget');
      expect(fake.calls).toEqual([]);
    }
  });
});

describe('opt-in and inert defaults', () => {
  it('BUILTIN_ADAPTERS lists the three free-tier adapters in design order, all inert without credentials', async () => {
    expect(BUILTIN_ADAPTERS.map((a) => [a.id, a.billing])).toEqual([
      ['groq', 'free-tier'],
      ['gemini', 'free-tier'],
      ['cloudflare', 'free-tier'],
    ]);
    expect(BUILTIN_ADAPTERS.some((a) => a.isConfigured({}))).toBe(false);
    const env = { A11YGATE_MODEL_PROVIDERS: ALL, A11YGATE_MODEL_MAX_REQUESTS: '5', A11YGATE_MODEL_TIMEOUT_MS: '1000' };
    const config = resolveModelFixConfig({ repoConfig: OPTED_IN, flag: 'on', env });
    const result = await planWithModelFixes({ findings: FINDINGS, files: FILES, config, env });
    expect(result.model.status).toBe('no-provider');
  });

  it('credentials present but models off, default, or repo denied → zero calls (a flag cannot override a denial)', async () => {
    const cases: { repoConfig: string | null; flag?: string; env: Record<string, string> }[] = [
      { repoConfig: OPTED_IN, flag: '', env: {} },
      { repoConfig: OPTED_IN, flag: 'off', env: { A11YGATE_MODEL_FIXES: 'on' } },
      { repoConfig: null, flag: 'on', env: { A11YGATE_MODEL_FIXES: 'on' } },
      { repoConfig: 'modelFixes: false\n', flag: 'on', env: { A11YGATE_MODEL_FIXES: 'on' } },
    ];
    for (const item of cases) {
      const fake = fakeFetch({ [GROQ]: groqOk, [GEMINI]: geminiOk, [CF]: cloudflareOk });
      const result = await run(envWith(item.env), fake, item);
      expect(result.model.status).toBe('disabled');
      expect(fake.calls).toEqual([]);
    }
  });

  it('a provider not on the allowlist is never called', async () => {
    const fake = fakeFetch({ [GROQ]: groqOk, [GEMINI]: geminiOk, [CF]: cloudflareOk });
    await run(envWith({ A11YGATE_MODEL_PROVIDERS: 'cloudflare' }), fake);
    expect(new Set(fake.hosts())).toEqual(new Set([CF]));
  });
});

describe('paid fallback stays off', () => {
  function paid() {
    const calls: string[] = [];
    const adapter: ModelAdapter = { ...stubAdapter('paid-llm'), billing: 'paid', draft: async (req, signal) => (calls.push(req.findingId), stubAdapter().draft(req, signal)) };
    return { adapter, calls };
  }

  it('is unused by default even when allowlisted and configured, after every free provider is cooling', async () => {
    const fake = fakeFetch({ [GROQ]: groq429, [GEMINI]: gemini429, [CF]: cloudflareNeurons });
    const env = envWith({ A11YGATE_MODEL_PROVIDERS: `${ALL},paid-llm` });
    const { adapter, calls } = paid();
    const result = await run(env, fake, { adapters: [...freeTierAdapters({ fetch: fake.fetchImpl, env }), adapter] });
    expect(calls).toEqual([]);
    expect(result.model.status).toBe('adapters-failed');
    expect(result.plan).toEqual(F1_ONLY);
  });

  it('needs both A11YGATE_MODEL_ALLOW_PAID and a positive A11YGATE_MODEL_MAX_COST_USD', async () => {
    const config = resolveModelFixConfig({ repoConfig: OPTED_IN, flag: 'on', env: {} });
    expect(config).toMatchObject({ allowPaid: false, maxCostUsd: 0 });
    const extras: Record<string, string>[] = [{ A11YGATE_MODEL_ALLOW_PAID: 'true' }, { A11YGATE_MODEL_MAX_COST_USD: '1' }, { A11YGATE_MODEL_ALLOW_PAID: 'true', A11YGATE_MODEL_MAX_COST_USD: '0' }];
    for (const extra of extras) {
      const fake = fakeFetch({});
      const { adapter, calls } = paid();
      const result = await run(envWith({ A11YGATE_MODEL_PROVIDERS: 'paid-llm', ...extra }), fake, { adapters: [adapter] });
      expect(result.model.status).toBe('no-provider');
      expect(calls).toEqual([]);
    }
    const { adapter, calls } = paid();
    await run(envWith({ A11YGATE_MODEL_PROVIDERS: 'paid-llm', A11YGATE_MODEL_ALLOW_PAID: 'true', A11YGATE_MODEL_MAX_COST_USD: '0.5' }), fakeFetch({}), { adapters: [adapter] });
    expect(calls.length).toBeGreaterThan(0);
  });
});

describe('untrusted output and placeholder policy', () => {
  it('rejects invented alt / label text and accepts a TODO(a11ygate) placeholder', async () => {
    const invented = ['  <span role="progressbar" aria-label="Upload progress" aria-valuenow="40"></span>'];
    const fake = fakeFetch({
      [GROQ]: (call) => json(200, { choices: [{ message: { content: reply({} as ModelDraftRequest, bodyOf(call).includes('progressbar') ? invented : CONTRAST_FIX) } }] }),
      [GEMINI]: geminiOk,
      [CF]: cloudflareOk,
    });
    const result = await run(envWith(), fake);
    const aria = result.model.routes.find((r) => r.fingerprint === 'fp-aria');
    // Groq's invented name is rejected; Gemini's placeholder draft passes validation.
    expect(aria?.model).toEqual({ outcome: 'unverified-discarded', provider: 'gemini' });
    expect(JSON.stringify(result)).not.toContain('Upload progress');

    const onlyGroq = await run(envWith({ A11YGATE_MODEL_PROVIDERS: 'groq' }), fake);
    expect(onlyGroq.model.routes.find((r) => r.fingerprint === 'fp-aria')?.model).toEqual({ outcome: 'draft-rejected', provider: null, rejections: ['generated-name'] });
  });

  it('runs model replies through validateDraft (out-of-scope or executable output is rejected)', async () => {
    const fake = fakeFetch({
      [GROQ]: () => json(200, { choices: [{ message: { content: JSON.stringify({ replacement: ['  <p class="muted" style="color:#333">Low contrast text</p><script src="https://evil.invalid/x.js"></script>'], rationale: 'x' }) } }] }),
      [GEMINI]: () => json(200, { candidates: [{ content: { parts: [{ text: 'not json' }] } }] }),
      [CF]: () => json(200, { success: true, result: { response: JSON.stringify({ replacement: [FIXTURE_LINE], rationale: 'x' }) } }),
    });
    const result = await run(envWith(), fake);
    expect(result.model.routes[0].model).toEqual({ outcome: 'draft-rejected', provider: null, rejections: ['executable-payload', 'schema', 'no-change'] });
    expect(JSON.stringify(result)).not.toContain('evil.invalid');
  });

  it('sends only a sanitized snippet: no path, finding ID, commit or credentials in the body; fixed endpoints; no redirects', async () => {
    const fake = fakeFetch({ [GROQ]: groqOk, [GEMINI]: geminiOk, [CF]: cloudflareOk });
    const env = envWith();
    for (const provider of ['groq', 'gemini', 'cloudflare']) {
      await run({ ...env, A11YGATE_MODEL_PROVIDERS: provider }, fake);
    }
    expect(fake.calls.map((c) => c.url)).toEqual([
      'https://api.groq.com/openai/v1/chat/completions',
      'https://api.groq.com/openai/v1/chat/completions',
      'https://generativelanguage.googleapis.com/v1beta/models/test-gemini-model:generateContent',
      'https://generativelanguage.googleapis.com/v1beta/models/test-gemini-model:generateContent',
      'https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/run/@cf/test/test-model',
      'https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/run/@cf/test/test-model',
    ]);
    for (const call of fake.calls) {
      const body = bodyOf(call);
      expect(call.init.redirect).toBe('error');
      for (const secret of ['not-real', 'site/index.html', 'fp-contrast', 'fp-aria', PAGE]) expect(body).not.toContain(secret);
      expect(body).toMatch(/color-contrast|aria-progressbar-name/);
      expect(call.url).not.toContain('key');
    }
    expect((fake.calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer test-groq-key-not-real');
    expect((fake.calls[2].init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-gemini-key-not-real');
  });

  it('never sends snippets that look sensitive; those findings stay F1-only with zero calls', async () => {
    const base: ModelDraftRequest = { findingId: 'f', ruleId: 'color-contrast', sourceCommit: null, path: 'a.html', startLine: 1, endLine: 1, original: ['<p class="x">Hi</p>'], sourceBlobHash: 'a'.repeat(40) };
    expect(isSendable(base)).toBe(true);
    for (const original of [
      ['<input type="hidden" name="csrf" value="abc">'],
      ['<a href="https://example.com/x?session=1">x</a>'],
      ['<p>Contact jane@example.com</p>'],
      ['<p data-k="sk-abcdefghijklmnopqrstuvwxyz">x</p>'],
      ['<img src="http://10.0.0.5/a.png">'],
      ['<script>alert(1)</script>'],
      ['<button onclick="x()">Go</button>'],
    ]) {
      expect(isSendable({ ...base, original }), original[0]).toBe(false);
    }
    expect(isSendable({ ...base, path: '.env.local' })).toBe(false);
    expect(isSendable({ ...base, ruleId: 'html-has-lang' })).toBe(false);

    const secretPage = PAGE.replace('Low contrast text', 'Call +1 555 010 9999');
    const files: SourceFile[] = [{ ...FILES[0], content: secretPage }];
    const fake = fakeFetch({ [GROQ]: groqOk, [GEMINI]: geminiOk, [CF]: cloudflareOk });
    const env = envWith();
    const config = resolveModelFixConfig({ repoConfig: OPTED_IN, flag: 'on', env });
    const result = await planWithModelFixes({ findings: FINDINGS.slice(0, 1), files, config, env, adapters: freeTierAdapters({ fetch: fake.fetchImpl, env }) });
    expect(fake.calls).toEqual([]);
    expect(result.model.modelRequests).toBe(0);
  });
});

describe('reset-signal parsing', () => {
  it('parses Retry-After, Groq durations and the Cloudflare UTC reset', () => {
    const now = Date.UTC(2026, 10, 14, 23, 59, 0);
    expect(parseRetryAfter('7', now)).toBe(7000);
    expect(parseRetryAfter(new Date(now + 5000).toUTCString(), now)).toBe(5000);
    expect(parseRetryAfter('soon', now)).toBeNull();
    expect(parseDuration('2m59.56s')).toBe(179_560);
    expect(parseDuration('500ms')).toBe(500);
    expect(parseDuration('1h')).toBe(3_600_000);
    expect(parseDuration('9999h')).toBe(24 * 3_600_000);
    expect(parseDuration('later')).toBeNull();
    expect(untilNextUtcMidnight(now)).toBe(60_000);
  });
});

describe('live smoke script', () => {
  const root = process.cwd();
  it('exists, is not wired into npm scripts or CI, and contains no credentials', () => {
    const script = readFileSync(path.join(root, 'scripts', 'modelfix-live-smoke.mjs'), 'utf8');
    const pkg = readFileSync(path.join(root, 'package.json'), 'utf8');
    expect(pkg).not.toContain('modelfix-live-smoke');
    expect(readFileSync(path.join(root, 'playwright.config.ts'), 'utf8')).not.toContain('modelfix-live-smoke');
    expect(script).toContain('A11YGATE_LIVE_SMOKE');
    expect(script).not.toMatch(/\b(gsk|sk)[-_][A-Za-z0-9]{12,}|AIza[0-9A-Za-z_-]{20,}/);
  });
});
