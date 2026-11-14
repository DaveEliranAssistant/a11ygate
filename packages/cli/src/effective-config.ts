import { parseInteractionStates } from '@/lib/scan/interactions';
import { resolveModelFixConfig } from '@/lib/modelfix/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CONFIG_FILE, CONFIG_SCHEMA, parseConfigYaml, validateConfig, type JsonSchema } from './config-schema';
import { AuthRedactor } from '@/lib/scan/redact';
import { secretEnvValues } from '@/lib/evidence/secrets';

export type ConfigCommand = 'scan' | 'ci' | 'doctor';
type Env = Readonly<Record<string, string | undefined>>;
type Wiring = { flag: string; aliases?: string[]; commands: ConfigCommand[]; default: unknown; env?: string[]; reason?: string };
const scan: ConfigCommand[] = ['scan'];
const reports: ConfigCommand[] = ['scan', 'ci'];
/** Explicit registry: adding a schema property requires a wiring decision and a drift-test update. */
export const CONFIG_WIRING: Record<string, Wiring> = {
  keyboard: { flag: '--keyboard', commands: scan, default: false },
  keyboardBudget: { flag: '--keyboard-budget', commands: scan, default: 100 },
  interactions: { flag: '--interactions', commands: scan, default: [] },
  autoInteractions: { flag: '--auto-interactions', commands: scan, default: false },
  interactionBudget: { flag: '--interaction-budget', commands: scan, default: 10 },
  url: { flag: '--url', commands: scan, default: '' },
  crawl: { flag: '--crawl', commands: scan, default: 0 },
  maxPages: { flag: '--max-pages', commands: scan, default: 1 },
  maxDepth: { flag: '--max-depth', commands: scan, default: null },
  timeoutMs: { flag: '--timeout-ms', commands: scan, default: 30000 },
  concurrency: { flag: '--concurrency', commands: scan, default: 1 },
  recycleEvery: { flag: '--recycle-every', commands: scan, default: null },
  sitemap: { flag: '--sitemap', commands: scan, default: null },
  include: { flag: '--include', commands: scan, default: [] },
  exclude: { flag: '--exclude', commands: scan, default: [] },
  ignoreRobots: { flag: '--ignore-robots', commands: scan, default: false },
  failOn: { flag: '--fail-on', commands: reports, aliases: ['--threshold', '-t'], default: 'serious', env: ['A11Y_THRESHOLD'] },
  engines: { flag: '--engines', commands: ['scan', 'doctor'], default: ['axe'] },
  modelFixes: { flag: '--model-fixes', commands: ['doctor'], default: false, env: ['A11Y_MODEL_FIXES'], reason: 'Repository consent is mandatory; scan/ci do not generate model fixes. The Action uses this switch for suggestions.' },
  baseline: { flag: '--baseline', aliases: ['-b'], commands: reports, default: null, env: ['A11Y_BASELINE'] },
  formats: { flag: '--format', commands: reports, default: [] },
  outDir: { flag: '--out-dir', commands: reports, default: null },
  delayMs: { flag: '--delay-ms', commands: scan, default: 1000 },
  reportVersion: { flag: '--report-version', commands: scan, default: 2 },
  'auth.check.url': { flag: '--auth-check-url', commands: scan, default: null },
  'auth.check.mustHaveSelector': { flag: '--auth-check-must-have-selector', commands: scan, default: null },
  'auth.check.mustNotHaveSelector': { flag: '--auth-check-must-not-have-selector', commands: scan, default: null },
  'auth.check.mustNotRedirectTo': { flag: '--auth-check-must-not-redirect-to', commands: scan, default: null },
  'auth.storageState': { flag: '--storage-state', commands: scan, default: null },
  'auth.loginScript': { flag: '--login-script', commands: scan, default: null },
  'auth.loginTimeoutMs': { flag: '--login-timeout-ms', commands: scan, default: 30000 },
  'auth.cookieEnv': { flag: '--cookie-env', commands: scan, default: [] },
  'auth.headerEnv': { flag: '--header-env', commands: scan, default: [] },
};

export function configEnvName(key: string): string {
  return 'A11YGATE_' + key.replace(/([a-z])([A-Z])/g, '$1_$2').replace(/\./g, '_').toUpperCase();
}
function schemaAt(key: string): JsonSchema {
  return key.split('.').reduce((node, part) => node.properties![part]!, CONFIG_SCHEMA);
}
function get(object: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined, object);
}
function decode(text: string, schema: JsonSchema): unknown {
  if (schema.type === 'array') {
    if (text.trim().startsWith('[')) { try { return JSON.parse(text); } catch { return text; } }
    return text.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
  }
  if (schema.type === 'integer') return /^\d+$/.test(text) ? Number(text) : text;
  if (schema.type === 'boolean') {
    if (/^(true|on|1|yes)$/i.test(text)) return true;
    if (/^(false|off|0|no)$/i.test(text)) return false;
  }
  return text;
}
export type EffectiveConfig = {
  values: Record<string, unknown>;
  sources: Record<string, string>;
  argv: string[];
  repoConfig: string | null;
};

/** One resolver for CLI commands and the Action. No credential files or referenced env values are loaded. */
export function loadEffectiveConfig(command: ConfigCommand, argv: readonly string[] = [], io: { cwd?: string; env?: Env; repoConfig?: string | null } = {}): EffectiveConfig {
  const env = io.env ?? process.env;
  let repoConfig = io.repoConfig;
  if (repoConfig === undefined) {
    try { repoConfig = readFileSync(path.join(io.cwd ?? process.cwd(), CONFIG_FILE), 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Could not read .a11ygate.yml.');
      repoConfig = null;
    }
  }
  const parsed = parseConfigYaml(repoConfig ?? '');
  const problems = parsed.ok ? validateConfig(parsed.value) : parsed.errors;
  if (problems.length) {
    // Name where the problem is (field or line) without echoing the value.
    const first = problems[0]!;
    const line = /^line \d+/.exec(first)?.[0];
    const key = /'([^']+)'/.exec(first)?.[1];
    const at = [line, key && `field '${key}'`].filter(Boolean).join(', ');
    throw new Error(`Invalid .a11ygate.yml${at ? ` (${at})` : ''}. Run a11ygate config validate to check its schema.`);
  }
  const yaml = parsed.ok ? parsed.value : {};
  const values: Record<string, unknown> = {};
  const sources: Record<string, string> = {};
  for (const [key, wiring] of Object.entries(CONFIG_WIRING)) {
    values[key] = structuredClone(wiring.default);
    sources[key] = 'default';
    const value = get(yaml, key);
    if (value !== undefined) { values[key] = value; sources[key] = CONFIG_FILE; }
    for (const name of [...(wiring.env ?? []), configEnvName(key)]) {
      const text = env[name];
      if (text === undefined || text === '') continue;
      const value = decode(text.trim(), schemaAt(key));
      if (validateConfig(value, schemaAt(key)).length) throw new Error(`Invalid ${name}; see the config schema for the expected type/range.`);
      values[key] = value; sources[key] = `env:${name}`;
    }
  }
  try { parseInteractionStates(values.interactions); }
  catch (error) { throw new Error(`${sources.interactions ?? CONFIG_FILE}: ${(error as Error).message}`, { cause: error }); }
  // Parse only registered options here; command-specific parsing and validation stays in the command parser.
  const remaining: string[] = [];
  const supplied = new Set<string>();
  let hasPositionalUrl = false;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    const [name] = token.split('=');
    const entry = Object.entries(CONFIG_WIRING).find(([, w]) => w.commands.includes(command) && [w.flag, ...(w.aliases ?? [])].includes(name!));
    if (!entry) {
      if (command === 'scan' && !token.startsWith('-')) {
        if (supplied.has('url')) throw new Error('Pass one scan URL.');
        values.url = token; sources.url = 'flag:positional'; supplied.add('url'); hasPositionalUrl = true; remaining.push(token);
      } else {
        remaining.push(token);
        // Unknown value flags belong to the existing parser, not to the positional URL.
        if (token.startsWith('-') && !token.includes('=') && !['--help', '-h', '--version', '--strict'].includes(token) && argv[i + 1] && (!argv[i + 1]!.startsWith('-') || argv[i + 1] === '-')) remaining.push(argv[++i]!);
      }
      continue;
    }
    const [key, wiring] = entry;
    if (key === 'url' && supplied.has('url')) throw new Error('Pass one scan URL.');
    const schema = schemaAt(key);
    let text = token.includes('=') ? token.slice(token.indexOf('=') + 1) : undefined;
    if (key === 'crawl' && text === undefined && !/^\d+$/.test(argv[i + 1] ?? '')) text = '20';
    else if (schema.type === 'boolean' && key !== 'modelFixes') text ??= 'true';
    else if (text === undefined) text = argv[++i];
    if (text === undefined) throw new Error(`${name} needs a value.`);
    if (['ignoreRobots', 'autoInteractions', 'keyboard'].includes(key) && token.includes('=')) throw new Error(`${name} takes no value.`);
    let value = key === 'interactions' ? (() => {
      const inline = text.trim().startsWith('[');
      const source = inline ? '--interactions' : text;
      let raw: string;
      if (inline) raw = text;
      else {
        try { raw = readFileSync(path.resolve(io.cwd ?? process.cwd(), text), 'utf8'); }
        catch (error) { throw new Error(`Invalid --interactions (${source}: ${(error as NodeJS.ErrnoException).code === 'ENOENT' ? 'file not found' : 'could not read the file'}); provide a readable local JSON file containing route states.`, { cause: error }); }
      }
      let json: unknown;
      // No cause: JSON syntax messages can quote file content.
      try { json = JSON.parse(raw.replace(/^\uFEFF/, '')); } catch { throw new Error(`Invalid --interactions (${source}: not valid JSON); provide a readable local JSON file containing route states.`); }
      try { return parseInteractionStates(json); }
      catch (error) { throw new Error(`Invalid --interactions (${source}: ${(error as Error).message.replace(/\.$/, '')}).`, { cause: error }); }
    })() : schema.type === 'array' && !['engines', 'formats'].includes(key) ? [text] : decode(text, schema);
    if (key === 'formats' && Array.isArray(value)) value = [...new Set(value)];
    // Keep legacy --crawl >20 clamping in the scan parser.
    if (!(key === 'crawl' && typeof value === 'number' && value > 20) && validateConfig(value, schema).length) {
      if (key === 'engines') throw new Error('Invalid --engines. Use a comma-separated list of axe,htmlcs,ibm,lighthouse.');
      throw new Error(`Invalid ${name}; see the config schema for the expected type/range.`);
    }
    if (schema.type === 'array' && !['engines', 'interactions'].includes(key) && supplied.has(key)) {
      const items = [...values[key] as unknown[], ...value as unknown[]];
      values[key] = key === 'formats' ? [...new Set(items)] : items;
    }
    else values[key] = value;
    sources[key] = `flag:${name}`; supplied.add(key);
    if (key === 'url') continue;
    remaining.push(command === 'ci' && key === 'failOn' ? '--threshold' : wiring.flag);
    if (schema.type !== 'boolean' || key === 'modelFixes') remaining.push(text);
  }
  // Repository consent is a security boundary, not an overridable option.
  if (values.modelFixes && get(yaml, 'modelFixes') !== true) {
    values.modelFixes = false;
    sources.modelFixes = 'repository-consent:denied';
  }
  const prefix: string[] = [];
  for (const [key, wiring] of Object.entries(CONFIG_WIRING)) {
    if (!wiring.commands.includes(command) || supplied.has(key) || sources[key] === 'default') continue;
    const value = values[key];
    if (key === 'url') continue;
    if (key === 'crawl' && value === 0) { prefix.push('--crawl', '1'); continue; }
    const flag = command === 'ci' && key === 'failOn' ? '--threshold' : wiring.flag;
    if (schemaAt(key).type === 'boolean') {
      if (key === 'modelFixes') prefix.push(flag, value ? 'on' : 'off');
      else if (value) prefix.push(flag);
    } else if (key === 'interactions') prefix.push(flag, JSON.stringify(value));
    else if (Array.isArray(value)) {
      if (['engines', 'formats'].includes(key)) { if (value.length) prefix.push(flag, value.join(',')); }
      else for (const item of value) prefix.push(flag, String(item));
    } else prefix.push(flag, String(value));
  }
  if (command === 'scan' && !hasPositionalUrl) {
    if (values.url) prefix.push(String(values.url));
  }
  // Report the derived page budget, without injecting a default that would change sitemap behavior.
  if (sources.maxPages === 'default') {
    if (sources.crawl !== 'default') { values.maxPages = Math.max(1, Math.min(20, Number(values.crawl))); sources.maxPages = `${sources.crawl} (crawl)`; }
    else if (values.sitemap) { values.maxPages = 20; sources.maxPages = `${sources.sitemap} (sitemap)`; }
  }
  if (typeof values.crawl === 'number') values.crawl = Math.min(20, values.crawl);
  return { values, sources, argv: [...prefix, ...remaining], repoConfig };
}

export function printableConfig(config: EffectiveConfig, env: Env = process.env) {
  const redactor = new AuthRedactor();
  for (const value of secretEnvValues(env, 1)) redactor.add(value);
  for (const key of ['auth.cookieEnv', 'auth.headerEnv']) {
    for (const mapping of config.values[key] as string[]) redactor.add(env[mapping.slice(mapping.indexOf('=') + 1)]);
  }
  const values = { ...config.values };
  for (const key of ['url', 'sitemap']) {
    if (typeof values[key] !== 'string' || !values[key]) continue;
    const url = new URL(values[key] as string, typeof values.url === 'string' && values.url ? values.url : 'https://config-print.invalid');
    for (const parameter of [...url.searchParams.keys()]) url.searchParams.set(parameter, '[REDACTED]');
    if (url.hash) url.hash = '[REDACTED]';
    values[key] = url.href;
  }
  return redactor.object(Object.fromEntries(Object.keys(CONFIG_WIRING).map(key => [key, { value: values[key], source: config.sources[key], appliesTo: CONFIG_WIRING[key]!.commands, ...(CONFIG_WIRING[key]!.reason ? { note: CONFIG_WIRING[key]!.reason } : {}) }])));
}

/** Provider budgets remain in the model subsystem; its switch comes only from this resolver. */
export function effectiveModelFixConfig(config: EffectiveConfig, env: Env = process.env) {
  const parsed = parseConfigYaml(config.repoConfig ?? '');
  const consent = parsed.ok && get(parsed.value, 'modelFixes') === true;
  return resolveModelFixConfig({ repoConfig: consent ? 'modelFixes: true' : null, flag: config.values.modelFixes ? 'on' : 'off', env: { ...env, A11YGATE_MODEL_FIXES: undefined } });
}
