/**
 * Testable core of the live provider smoke check (A11Y-R17).
 *
 * Used by `scripts/modelfix-live-smoke.mjs` and the manual
 * `.github/workflows/provider-smoke.yml` workflow. Nothing here reads a
 * credential's value for output: configuration is detected by checking
 * whether the named variables are present, results carry only sanitized
 * metadata (provider, model, latency, outcome, token counts), and every
 * line written to a log passes through `redactSecrets` as a second line of
 * defence on top of GitHub's own secret masking.
 */

/** Provider id → env var names that must all be present. Names only, never values. */
export const PROVIDER_SECRETS = Object.freeze({
  groq: Object.freeze(['GROQ_API_KEY', 'A11YGATE_MODEL_GROQ_MODEL']),
  gemini: Object.freeze(['GEMINI_API_KEY', 'A11YGATE_MODEL_GEMINI_MODEL']),
  cloudflare: Object.freeze(['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'A11YGATE_MODEL_CLOUDFLARE_MODEL']),
});

export const KNOWN_PROVIDERS = Object.freeze(Object.keys(PROVIDER_SECRETS));

const MODEL_VAR = {
  groq: 'A11YGATE_MODEL_GROQ_MODEL',
  gemini: 'A11YGATE_MODEL_GEMINI_MODEL',
  cloudflare: 'A11YGATE_MODEL_CLOUDFLARE_MODEL',
};

/** Credential variables whose values must never appear in output. */
export const CREDENTIAL_VARS = Object.freeze(['GROQ_API_KEY', 'GEMINI_API_KEY', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']);

/** A valid draft came back (no verifier runs in the smoke, so `unverified-discarded` is the normal pass). */
const PASS_OUTCOMES = new Set(['unverified-discarded', 'verified']);

/** Hard per-provider request budget for one smoke run (R5). */
export const REQUESTS_PER_PROVIDER = 1;

function present(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Names of the required variables that are missing for `id`. Reports names only. */
export function missingSecrets(id, env) {
  return PROVIDER_SECRETS[id].filter((name) => !present(env[name]));
}

/** Replaces any credential value (and any other listed value) found in `text` with `***`. */
export function redactSecrets(text, env, extra = []) {
  let out = String(text);
  const values = [...CREDENTIAL_VARS.map((name) => env[name]), ...extra]
    .filter(present)
    .map((value) => value.trim())
    .filter((value) => value.length >= 4)
    .sort((a, b) => b.length - a.length);
  for (const value of values) out = out.split(value).join('***');
  return out;
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Extracts provider-reported token counts only. Never returns content. */
export function tokenUsage(body) {
  if (!body || typeof body !== 'object') return null;
  const usage = body.usage ?? body.result?.usage;
  if (usage && typeof usage === 'object') {
    const input = numberOrNull(usage.prompt_tokens);
    const output = numberOrNull(usage.completion_tokens);
    const total = numberOrNull(usage.total_tokens);
    if (input !== null || output !== null || total !== null) return { input, output, total };
  }
  const meta = body.usageMetadata;
  if (meta && typeof meta === 'object') {
    const input = numberOrNull(meta.promptTokenCount);
    const output = numberOrNull(meta.candidatesTokenCount);
    const total = numberOrNull(meta.totalTokenCount);
    if (input !== null || output !== null || total !== null) return { input, output, total };
  }
  return null;
}

/**
 * Wraps `fetch` to time the request, read token usage from a clone of the
 * response, and refuse any request beyond the per-provider budget.
 */
function meteredFetch(baseFetch, now, meter) {
  return async (url, init) => {
    if (meter.requests >= REQUESTS_PER_PROVIDER) {
      throw new Error('provider smoke: request budget exhausted');
    }
    meter.requests += 1;
    const started = now();
    try {
      const response = await baseFetch(url, init);
      meter.latencyMs = Math.max(0, Math.round(now() - started));
      meter.httpStatus = typeof response.status === 'number' ? response.status : null;
      try {
        meter.tokens = tokenUsage(JSON.parse(await response.clone().text()));
      } catch {
        meter.tokens = null;
      }
      return response;
    } catch (error) {
      meter.latencyMs = Math.max(0, Math.round(now() - started));
      throw error;
    }
  };
}

/** Synthetic fixture only: no repository content, no third-party pages. */
export function smokeFixture() {
  const page = ['<!doctype html>', '<html lang="en">', '<body>', '  <p class="muted" style="color:#aaa">Sample text</p>', '</body>', '</html>', ''].join('\n');
  return {
    files: [{ path: 'fixture/index.html', content: page, diffLines: new Set(page.split('\n').map((_, i) => i + 1)) }],
    findings: [{ fingerprint: 'smoke-contrast', ruleId: 'color-contrast', html: '<p class="muted" style="color:#aaa">', status: 'new' }],
  };
}

/**
 * Runs the smoke check for each selected provider. Providers whose secrets
 * are missing are reported as `skipped` / `not-configured` without making a
 * request. Returns `{ results, exitCode }`; exit code is 0 unless a
 * configured provider failed (or `failOnError` is false, then always 0).
 *
 * @param {object} options
 * @param {Record<string, string | undefined>} options.env
 * @param {object} options.modelfix  `{ resolveModelFixConfig, freeTierAdapters, planWithModelFixes }`
 * @param {string[]} [options.providers]
 * @param {(url: string, init?: object) => Promise<Response>} [options.fetch]
 * @param {() => number} [options.now]
 * @param {(line: string) => void} [options.log]
 */
export async function runProviderSmoke(options) {
  const env = options.env;
  const providers = options.providers?.length ? options.providers : KNOWN_PROVIDERS;
  const unknown = providers.filter((id) => !KNOWN_PROVIDERS.includes(id));
  if (unknown.length) throw new Error(`Unknown provider. Choose from: ${KNOWN_PROVIDERS.join(', ')}`);
  const now = options.now ?? (() => performance.now());
  const baseFetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const rawLog = options.log ?? ((line) => console.log(line));
  const log = (line) => rawLog(redactSecrets(line, env));
  const { modelfix } = options;
  const { files, findings } = smokeFixture();

  const results = [];
  for (const id of providers) {
    const missing = missingSecrets(id, env);
    if (missing.length) {
      const result = { provider: id, model: null, status: 'skipped', reason: 'not-configured', missing, latencyMs: null, requests: 0, tokens: null };
      results.push(result);
      log(JSON.stringify(result));
      continue;
    }
    const model = env[MODEL_VAR[id]].trim();
    const meter = { requests: 0, latencyMs: null, httpStatus: null, tokens: null };
    // Only this provider's credentials, the opt-in and the budget reach the adapter.
    const scoped = { A11YGATE_MODEL_PROVIDERS: id, A11YGATE_MODEL_MAX_REQUESTS: String(REQUESTS_PER_PROVIDER), A11YGATE_MODEL_TIMEOUT_MS: env.A11YGATE_MODEL_TIMEOUT_MS || '20000' };
    for (const name of PROVIDER_SECRETS[id]) scoped[name] = env[name];
    let result;
    try {
      const config = modelfix.resolveModelFixConfig({ repoConfig: 'modelFixes: true\n', flag: 'on', env: scoped });
      const adapters = modelfix.freeTierAdapters({ env: scoped, fetch: meteredFetch(baseFetch, now, meter) });
      const run = await modelfix.planWithModelFixes({ findings, files, config, env: scoped, adapters });
      const route = run.model.routes[0]?.model ?? null;
      const providerState = run.model.providers?.find((p) => p.id === id)?.state ?? null;
      const outcome = route?.outcome ?? null;
      // Secrets present but rejected by the adapter's format checks (e.g. a malformed model ID).
      const configured = providerState !== null;
      const passed = PASS_OUTCOMES.has(outcome);
      result = {
        provider: id,
        model,
        status: passed ? 'pass' : 'fail',
        reason: !configured ? 'invalid-config' : passed ? null : `outcome:${outcome ?? 'none'}`,
        latencyMs: meter.latencyMs,
        requests: meter.requests,
        httpStatus: meter.httpStatus,
        tokens: meter.tokens,
        rejections: Array.isArray(route?.rejections) ? route.rejections.map(String) : [],
        providerState,
      };
    } catch (error) {
      result = {
        provider: id,
        model,
        status: 'fail',
        reason: 'error',
        error: error && typeof error.name === 'string' ? error.name : 'Error',
        latencyMs: meter.latencyMs,
        requests: meter.requests,
        httpStatus: meter.httpStatus,
        tokens: meter.tokens,
      };
    }
    results.push(result);
    log(JSON.stringify(result));
  }
  const failed = results.some((r) => r.status === 'fail');
  return { results, exitCode: failed && options.failOnError !== false ? 1 : 0 };
}

/** Sanitized artifact document. */
export function smokeArtifact(results, generatedAt = new Date().toISOString()) {
  return {
    schema: 'a11ygate.provider-smoke/v1',
    generatedAt,
    budget: { requestsPerProvider: REQUESTS_PER_PROVIDER },
    results,
    note: 'Synthetic fixture only. Automated testing only. Not a WCAG audit, certification or legal advice.',
  };
}

/** Markdown table for `$GITHUB_STEP_SUMMARY`. Sanitized fields only. */
export function smokeSummary(results) {
  const rows = results.map((r) => {
    const tokens = r.tokens ? String(r.tokens.total ?? [r.tokens.input, r.tokens.output].filter((n) => n !== null).join('+')) : '—';
    const status = r.status === 'skipped' ? 'skipped (not configured)' : r.status;
    return `| ${r.provider} | ${r.model ?? '—'} | ${status} | ${r.latencyMs ?? '—'} | ${tokens} |`;
  });
  return ['## Provider smoke', '', '| Provider | Model | Result | Latency (ms) | Tokens |', '| --- | --- | --- | --- | --- |', ...rows, ''].join('\n');
}
