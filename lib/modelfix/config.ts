import type { ModelFixConfig, ModelFixSwitch, RepoConsent } from '@/lib/modelfix/types';

type Env = Readonly<Record<string, string | undefined>>;

const ON = new Set(['on', 'true', '1', 'yes']);
const OFF = new Set(['off', 'false', '0', 'no']);
const MAX_REQUEST_CAP = 100;
const MAX_TIMEOUT_MS = 120_000;
const MAX_COST_USD = 100;

/** Parses a flag/env switch. Empty means unset; anything unknown counts as an explicit off. */
export function parseSwitch(value: string | undefined | null): { value: ModelFixSwitch | null; invalid: boolean } {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return { value: null, invalid: false };
  if (ON.has(text)) return { value: 'on', invalid: false };
  if (OFF.has(text)) return { value: 'off', invalid: false };
  return { value: 'off', invalid: true };
}

/**
 * Reads the repository opt-in from `.a11ygate.yml` text. Only a top-level
 * `modelFixes: true` line opts in. A missing file or key, `false`, a repeated
 * key, or any other value is a denial.
 */
export function parseRepoConsent(text: string | null | undefined): RepoConsent {
  if (typeof text !== 'string') return 'missing';
  const values: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const match = /^modelFixes\s*:(.*)$/.exec(raw);
    if (!match) continue;
    values.push(match[1].replace(/\s+#.*$/, '').trim());
  }
  if (values.length === 0) return 'missing';
  if (values.length > 1) return 'invalid';
  const value = values[0].replace(/^(['"])(.*)\1$/, '$2');
  if (value === 'true') return 'opted-in';
  if (value === 'false') return 'denied';
  return 'invalid';
}

function boundedInt(value: string | undefined, max: number): number | null {
  const text = String(value ?? '').trim();
  if (!text) return 0;
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  return parsed <= max ? parsed : null;
}

/**
 * Resolves the model-fix switch. Default off. The repository must opt in;
 * neither `--model-fixes` nor `A11YGATE_MODEL_FIXES` can override a repository
 * denial. Any explicit off (flag or env) wins over an on.
 */
export function resolveModelFixConfig(input: { repoConfig?: string | null; flag?: string | null; env?: Env }): ModelFixConfig {
  const env = input.env ?? {};
  const warnings: string[] = [];
  const flag = parseSwitch(input.flag);
  const fromEnv = parseSwitch(env.A11YGATE_MODEL_FIXES);
  if (flag.invalid) warnings.push('Unknown --model-fixes value; treated as off.');
  if (fromEnv.invalid) warnings.push('Unknown A11YGATE_MODEL_FIXES value; treated as off.');
  const requested: ModelFixSwitch | null =
    flag.value === 'off' || fromEnv.value === 'off' ? 'off' : (flag.value ?? fromEnv.value);

  const repo = parseRepoConsent(input.repoConfig);
  const providers = String(env.A11YGATE_MODEL_PROVIDERS ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item, index, list) => /^[a-z0-9-]+$/.test(item) && list.indexOf(item) === index);
  const maxRequests = boundedInt(env.A11YGATE_MODEL_MAX_REQUESTS, MAX_REQUEST_CAP);
  const timeoutMs = boundedInt(env.A11YGATE_MODEL_TIMEOUT_MS, MAX_TIMEOUT_MS);
  if (maxRequests === null) warnings.push(`A11YGATE_MODEL_MAX_REQUESTS must be an integer from 0 to ${MAX_REQUEST_CAP}; using 0.`);
  if (timeoutMs === null) warnings.push(`A11YGATE_MODEL_TIMEOUT_MS must be an integer from 0 to ${MAX_TIMEOUT_MS}; using 0.`);

  const allowPaid = parseSwitch(env.A11YGATE_MODEL_ALLOW_PAID).value === 'on';
  const costText = String(env.A11YGATE_MODEL_MAX_COST_USD ?? '').trim();
  let maxCostUsd = 0;
  if (costText) {
    if (/^\d+(\.\d+)?$/.test(costText) && Number(costText) <= MAX_COST_USD) maxCostUsd = Number(costText);
    else warnings.push(`A11YGATE_MODEL_MAX_COST_USD must be a number from 0 to ${MAX_COST_USD}; using 0.`);
  }

  const base = { repo, requested, providers, maxRequests: maxRequests ?? 0, timeoutMs: timeoutMs ?? 0, allowPaid, maxCostUsd, warnings };
  if (requested === null) return { ...base, enabled: false, reason: 'default-off' };
  if (requested === 'off') return { ...base, enabled: false, reason: 'turned-off' };
  if (repo === 'missing') return { ...base, enabled: false, reason: 'repo-missing' };
  if (repo === 'denied') return { ...base, enabled: false, reason: 'repo-denied' };
  if (repo === 'invalid') return { ...base, enabled: false, reason: 'repo-invalid' };
  return { ...base, enabled: true, reason: 'enabled' };
}

/** The resolved default: off, no providers, no budget. */
export const MODEL_FIXES_OFF: ModelFixConfig = resolveModelFixConfig({});
