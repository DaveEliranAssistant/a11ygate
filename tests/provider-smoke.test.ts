import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as modelfix from '@/lib/modelfix';
import { missingSecrets, PROVIDER_SECRETS, redactSecrets, runProviderSmoke, smokeArtifact, smokeSummary, tokenUsage } from '../scripts/provider-smoke-lib.mjs';
import { blockNetwork } from './network-guard';

const root = process.cwd();
const workflowPath = path.join(root, '.github', 'workflows', 'provider-smoke.yml');
const yaml = createRequire(import.meta.url)('js-yaml') as { load: (text: string) => unknown };

const ALL_SECRET_NAMES = [
  'GROQ_API_KEY',
  'A11YGATE_MODEL_GROQ_MODEL',
  'GEMINI_API_KEY',
  'A11YGATE_MODEL_GEMINI_MODEL',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'A11YGATE_MODEL_CLOUDFLARE_MODEL',
];

// Obviously fake values used only to prove they never reach logs or artifacts.
const FAKE = {
  GROQ_API_KEY: 'fake-groq-key-DO-NOT-PRINT-1234567890',
  A11YGATE_MODEL_GROQ_MODEL: 'fake-groq-model',
  GEMINI_API_KEY: 'fake-gemini-key-DO-NOT-PRINT-0987654321',
  A11YGATE_MODEL_GEMINI_MODEL: 'fake-gemini-model',
  CLOUDFLARE_API_TOKEN: 'fake-cf-token-DO-NOT-PRINT-abcdefabcdef',
  CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  A11YGATE_MODEL_CLOUDFLARE_MODEL: '@cf/fake/fake-model',
};
const CREDENTIALS = [FAKE.GROQ_API_KEY, FAKE.GEMINI_API_KEY, FAKE.CLOUDFLARE_API_TOKEN, FAKE.CLOUDFLARE_ACCOUNT_ID];

const DRAFT = JSON.stringify({ replacement: ['  <p class="muted" style="color:#595959">Sample text</p>'], rationale: 'Raise contrast.' });

/** Fake provider fetch: echoes the credential back in the reply to prove replies are never printed. */
function fakeFetch(calls: string[]) {
  return async (url: string, init?: RequestInit) => {
    calls.push(new URL(url).hostname);
    const headers = new Headers(init?.headers);
    const leaked = headers.get('authorization') ?? headers.get('x-goog-api-key') ?? '';
    const host = new URL(url).hostname;
    const body = host.includes('groq')
      ? { choices: [{ message: { content: DRAFT } }], usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 }, echo: leaked }
      : host.includes('google')
        ? { candidates: [{ content: { parts: [{ text: DRAFT }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 120 }, echo: leaked }
        : { result: { response: DRAFT, usage: { prompt_tokens: 90, completion_tokens: 10, total_tokens: 100 } }, success: true, echo: leaked };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

let guard: ReturnType<typeof blockNetwork>;
beforeEach(() => {
  guard = blockNetwork();
});
afterEach(() => {
  guard.restore();
  expect(guard.attempts).toEqual([]);
});

describe('provider-smoke workflow file', () => {
  const text = readFileSync(workflowPath, 'utf8');
  const doc = yaml.load(text) as Record<string, unknown>;

  it('parses as YAML and triggers on workflow_dispatch only', () => {
    expect(doc && typeof doc).toBe('object');
    const on = doc.on as Record<string, unknown>;
    expect(on && typeof on).toBe('object');
    expect(Object.keys(on)).toEqual(['workflow_dispatch']);
    for (const trigger of ['pull_request', 'pull_request_target', 'push', 'schedule', 'workflow_run']) {
      expect(on).not.toHaveProperty(trigger);
    }
    expect(text).not.toMatch(/^\s*(pull_request|pull_request_target|push|schedule):/m);
  });

  it('has read-only permissions, opts in explicitly and calls the live smoke script', () => {
    expect(doc.permissions).toEqual({ contents: 'read' });
    const steps = (doc.jobs as Record<string, { steps: { run?: string; env?: Record<string, string> }[] }>).smoke.steps;
    const smoke = steps.find((step) => step.run?.includes('scripts/modelfix-live-smoke.mjs'));
    expect(smoke).toBeDefined();
    expect(smoke!.env!.A11YGATE_LIVE_SMOKE).toBe('1');
    expect(smoke!.run).toContain('--json-out');
  });

  it('maps each secret straight into env and never echoes, masks-by-printing or writes secrets to files', () => {
    const steps = (doc.jobs as Record<string, { steps: { run?: string; env?: Record<string, string> }[] }>).smoke.steps;
    const smoke = steps.find((step) => step.run?.includes('modelfix-live-smoke'))!;
    for (const name of ALL_SECRET_NAMES) expect(smoke.env![name]).toBe(`\${{ secrets.${name} }}`);
    // Secrets appear only in env mappings, never in a `run:` command.
    for (const step of steps) expect(step.run ?? '').not.toContain('secrets.');
    expect(text).not.toMatch(/\.env\b|GITHUB_ENV|add-mask|set-output|::debug::/);
    expect(text).not.toMatch(/echo\s+.*\$\{\{\s*secrets/);
  });

  it('is not referenced by any other workflow or npm script', () => {
    expect(readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8')).not.toContain('modelfix-live-smoke');
    expect(readFileSync(path.join(root, 'package.json'), 'utf8')).not.toContain('modelfix-live-smoke');
  });
});

describe('provider smoke runner (offline)', () => {
  it('skips every provider as not configured and exits 0 when no secrets exist', async () => {
    const lines: string[] = [];
    const calls: string[] = [];
    const run = await runProviderSmoke({ env: {}, modelfix, fetch: fakeFetch(calls), log: (line) => lines.push(line) });
    expect(run.exitCode).toBe(0);
    expect(calls).toEqual([]);
    expect(run.results.map((r) => [r.provider, r.status, r.reason, r.requests])).toEqual([
      ['groq', 'skipped', 'not-configured', 0],
      ['gemini', 'skipped', 'not-configured', 0],
      ['cloudflare', 'skipped', 'not-configured', 0],
    ]);
    expect(lines).toHaveLength(3);
  });

  it('skips a provider when a companion secret is missing and reports names only', async () => {
    const env = { GROQ_API_KEY: FAKE.GROQ_API_KEY, CLOUDFLARE_API_TOKEN: FAKE.CLOUDFLARE_API_TOKEN, A11YGATE_MODEL_CLOUDFLARE_MODEL: FAKE.A11YGATE_MODEL_CLOUDFLARE_MODEL };
    expect(missingSecrets('groq', env)).toEqual(['A11YGATE_MODEL_GROQ_MODEL']);
    expect(missingSecrets('cloudflare', env)).toEqual(['CLOUDFLARE_ACCOUNT_ID']);
    const lines: string[] = [];
    const calls: string[] = [];
    const run = await runProviderSmoke({ env, modelfix, fetch: fakeFetch(calls), log: (line) => lines.push(line) });
    expect(run.exitCode).toBe(0);
    expect(calls).toEqual([]);
    expect(run.results.every((r) => r.status === 'skipped')).toBe(true);
    const output = lines.join('\n') + JSON.stringify(smokeArtifact(run.results));
    for (const value of CREDENTIALS) expect(output).not.toContain(value);
  });

  it('sends exactly one request per configured provider and records model, latency, result and tokens', async () => {
    const calls: string[] = [];
    let clock = 0;
    const run = await runProviderSmoke({ env: { ...FAKE }, modelfix, fetch: fakeFetch(calls), now: () => (clock += 25), log: () => undefined });
    expect(calls).toEqual(['api.groq.com', 'generativelanguage.googleapis.com', 'api.cloudflare.com']);
    expect(run.exitCode).toBe(0);
    expect(run.results.map((r) => ({ provider: r.provider, model: r.model, status: r.status, requests: r.requests, latencyMs: r.latencyMs, tokens: r.tokens }))).toEqual([
      { provider: 'groq', model: 'fake-groq-model', status: 'pass', requests: 1, latencyMs: 25, tokens: { input: 120, output: 30, total: 150 } },
      { provider: 'gemini', model: 'fake-gemini-model', status: 'pass', requests: 1, latencyMs: 25, tokens: { input: 100, output: 20, total: 120 } },
      { provider: 'cloudflare', model: '@cf/fake/fake-model', status: 'pass', requests: 1, latencyMs: 25, tokens: { input: 90, output: 10, total: 100 } },
    ]);
  });

  it('never prints a credential value, prompt or reply even when a fake key is set and echoed back', async () => {
    const lines: string[] = [];
    const run = await runProviderSmoke({ env: { ...FAKE }, modelfix, fetch: fakeFetch([]), log: (line) => lines.push(line) });
    const captured = [lines.join('\n'), JSON.stringify(smokeArtifact(run.results)), smokeSummary(run.results)].join('\n');
    for (const value of CREDENTIALS) expect(captured).not.toContain(value);
    expect(captured).not.toContain('Sample text');
    expect(captured).not.toContain('Raise contrast');
    expect(captured).not.toContain('color:#595959');
  });

  it('fails (exit 1) on a provider error without leaking the key, and never exceeds one request', async () => {
    const calls: string[] = [];
    const failing = async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ error: { message: `bad key ${FAKE.GROQ_API_KEY}` } }), { status: 401 });
    };
    const lines: string[] = [];
    const run = await runProviderSmoke({ env: { ...FAKE }, providers: ['groq'], modelfix, fetch: failing, log: (line) => lines.push(line) });
    expect(run.exitCode).toBe(1);
    expect(calls).toHaveLength(1);
    expect(run.results[0]).toMatchObject({ provider: 'groq', status: 'fail', requests: 1, httpStatus: 401 });
    expect(lines.join('\n')).not.toContain(FAKE.GROQ_API_KEY);
  });

  it('redacts credential values from any log line as a backstop', () => {
    const line = `token=${FAKE.CLOUDFLARE_API_TOKEN} account=${FAKE.CLOUDFLARE_ACCOUNT_ID}`;
    expect(redactSecrets(line, FAKE)).toBe('token=*** account=***');
    expect(redactSecrets('nothing here', {})).toBe('nothing here');
  });

  it('reads only token counts from provider usage blocks', () => {
    expect(tokenUsage({ usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }, choices: ['x'] })).toEqual({ input: 1, output: 2, total: 3 });
    expect(tokenUsage({ usageMetadata: { totalTokenCount: 7 } })).toEqual({ input: null, output: null, total: 7 });
    expect(tokenUsage({ nothing: true })).toBeNull();
    expect(Object.keys(PROVIDER_SECRETS)).toEqual(['groq', 'gemini', 'cloudflare']);
  });
});

describe('live smoke script (subprocess, no secrets)', () => {
  // Child processes get an env with every provider secret removed, so no request can be made.
  const cleanEnv = () => {
    const env = {} as NodeJS.ProcessEnv;
    for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !ALL_SECRET_NAMES.includes(key)) env[key] = value;
    return env;
  };
  const script = path.join(root, 'scripts', 'modelfix-live-smoke.mjs');

  it('refuses to run without the explicit A11YGATE_LIVE_SMOKE=1 opt-in', () => {
    const env = cleanEnv();
    delete env.A11YGATE_LIVE_SMOKE;
    const child = spawnSync(process.execPath, [script], { env, encoding: 'utf8' });
    expect(child.status).toBe(2);
    expect(child.stderr).toContain('A11YGATE_LIVE_SMOKE=1');
  });

  it('with all secrets missing: every provider skipped, artifact written, exit 0', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'a11ygate-smoke-test-'));
    try {
      const out = path.join(dir, 'provider-smoke.json');
      const summary = path.join(dir, 'summary.md');
      const child = spawnSync(process.execPath, [script, '--json-out', out, '--summary', summary], {
        env: { ...cleanEnv(), A11YGATE_LIVE_SMOKE: '1' },
        encoding: 'utf8',
      });
      expect(child.status).toBe(0);
      const artifact = JSON.parse(readFileSync(out, 'utf8'));
      expect(artifact.results.map((r: { provider: string; status: string }) => `${r.provider}:${r.status}`)).toEqual(['groq:skipped', 'gemini:skipped', 'cloudflare:skipped']);
      expect(readFileSync(summary, 'utf8')).toContain('skipped (not configured)');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('with only a fake key (model missing) set: skipped, exit 0, key never printed', () => {
    const child = spawnSync(process.execPath, [script, 'groq'], {
      env: { ...cleanEnv(), A11YGATE_LIVE_SMOKE: '1', GROQ_API_KEY: FAKE.GROQ_API_KEY },
      encoding: 'utf8',
    });
    expect(child.status).toBe(0);
    expect(child.stdout).toContain('"status":"skipped"');
    expect(child.stdout + child.stderr).not.toContain(FAKE.GROQ_API_KEY);
  });
});
