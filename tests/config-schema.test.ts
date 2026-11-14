import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import schema from '@/schema/a11ygate.schema.json';
import { CONFIG_SCHEMA, SCHEMA_COMMENT, SCHEMA_PATH, configProblems, parseConfigYaml, type JsonSchema } from '@/packages/cli/src/config';
import { doctorChecks } from '@/packages/cli/src/doctor';
import { run } from '@/packages/cli/src/run';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';

const yaml = createRequire(import.meta.url)('js-yaml') as { load: (text: string) => unknown };
const ajv = new Ajv({ allErrors: true, strict: true });
ajv.addKeyword({ keyword: 'x-cli', schemaType: 'array' });
const ajvValidate = ajv.compile(schema);

function capture(cwd: string) {
  let out = '';
  let err = '';
  return { io: { cwd, stdout: (s: string) => { out += s; }, stderr: (s: string) => { err += s; } }, out: () => out, err: () => err };
}

async function generatedConfigs(): Promise<string[]> {
  const configs: string[] = [];
  for (const args of [['--target', 'github'], ['--target', 'jenkins', '--crawl', '0', '--fail-on', 'none']]) {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'a11ygate-config-'));
    try {
      expect(await run(['init', '--yes', ...args], capture(cwd).io)).toBe(0);
      configs.push(await readFile(path.join(cwd, '.a11ygate.yml'), 'utf8'));
    } finally { await rm(cwd, { recursive: true, force: true }); }
  }
  return configs;
}

describe('config schema file', () => {
  it('is a valid draft-07 schema at the documented path', async () => {
    expect(ajv.validateSchema(schema)).toBe(true);
    expect(JSON.parse(await readFile(SCHEMA_PATH, 'utf8'))).toEqual(schema);
    expect(SCHEMA_COMMENT).toContain('/DaveEliranAssistant/a11ygate/main/schema/a11ygate.schema.json');
  });

  it('keeps the disclaimer and makes no compliance claim', () => {
    const description = JSON.stringify(schema);
    expect(schema.description).toContain('Not a WCAG audit, certification or legal advice.');
    expect(description).not.toMatch(/\b(compliant|guarantee|certified)\b/i);
  });
});

describe('(a) example configs validate', () => {
  it('validates every committed .a11ygate.yml and generated init output', async () => {
    const tracked = execFileSync('git', ['ls-files', '*.a11ygate.yml', '.a11ygate.yml'], { encoding: 'utf8' }).split('\n').filter(Boolean);
    expect(tracked.length).toBeGreaterThan(0);
    const texts = [...await Promise.all(tracked.map((file) => readFile(file, 'utf8'))), ...await generatedConfigs()];
    for (const text of texts) {
      expect(text.split('\n')[0]).toBe(SCHEMA_COMMENT);
      expect(text).toContain(AUTOMATED_TESTING_DISCLAIMER);
      expect(configProblems(text)).toEqual([]);
      const parsed = parseConfigYaml(text);
      // The subset parser agrees with a full YAML parser, and ajv agrees with the CLI validator.
      expect(parsed).toEqual({ ok: true, value: yaml.load(text) });
      expect(ajvValidate(yaml.load(text)), JSON.stringify(ajvValidate.errors)).toBe(true);
    }
  });

  it('validates a config using every key, including auth', () => {
    const text = `${SCHEMA_COMMENT}
url: https://example.test/app
crawl: 5
failOn: critical
engines:
  - axe
  - htmlcs
modelFixes: false
baseline: .a11ygate-baseline.json
formats: [sarif, junit, gitlab-codequality]
outDir: a11y-results
delayMs: 500
reportVersion: 2
auth:
  storageState: .auth/state.json
  loginScript: scripts/login.mjs
  loginTimeoutMs: 60000
  cookieEnv: [session=APP_SESSION]
  headerEnv:
    - Authorization=APP_TOKEN # an env var name, never the value
`;
    expect(configProblems(text)).toEqual([]);
    expect(parseConfigYaml(text)).toEqual({ ok: true, value: yaml.load(text) });
    expect(ajvValidate(yaml.load(text))).toBe(true);
  });
});

describe('(b) one plain-English error per class', () => {
  it('unknown key with a suggestion', () => {
    expect(configProblems('engine: [axe]\n')).toEqual(["unknown key 'engine' — did you mean 'engines'?"]);
    expect(configProblems('model-fixes: true\n')).toEqual(["unknown key 'model-fixes' — did you mean 'modelFixes'?"]);
    expect(configProblems('auth:\n  cookiesEnv: [a=B]\n')).toEqual(["unknown key 'auth.cookiesEnv' — did you mean 'auth.cookieEnv'?"]);
    expect(configProblems('colour: blue\n')[0]).toMatch(/^unknown key 'colour' — known keys: url, crawl/);
    expect(ajvValidate(yaml.load('engine: [axe]\n'))).toBe(false);
  });

  it('wrong type', () => {
    expect(configProblems('crawl: ten\n')).toEqual(["'crawl' must be a whole number, but got text 'ten'."]);
    expect(configProblems('modelFixes: "true"\n')).toEqual(["'modelFixes' must be true or false, but got text 'true' (remove the quotes: true)."]);
    expect(configProblems('engines: axe\n')).toEqual(["'engines' must be a list, e.g. [a, b], but got text 'axe'."]);
    expect(ajvValidate(yaml.load('crawl: ten\n'))).toBe(false);
  });

  it('invalid enum', () => {
    expect(configProblems('failOn: severe\n')).toEqual(["'failOn' has invalid value 'severe' — use one of: minor, moderate, serious, critical, none."]);
    expect(configProblems('engines: [axe, wave]\n')).toEqual(["'engines[1]' has invalid value 'wave' — use one of: axe, htmlcs, ibm, lighthouse."]);
    expect(ajvValidate(yaml.load('failOn: severe\n'))).toBe(false);
  });

  it('range, duplicate and YAML errors stay readable', () => {
    expect(configProblems('crawl: 50\n')).toEqual(["'crawl' must be at most 20, but got 50."]);
    expect(configProblems('engines: [axe, axe]\n')).toEqual(["'engines' lists 'axe' more than once."]);
    expect(configProblems('crawl: 1\ncrawl: 2\n')).toEqual(["line 2: duplicate key 'crawl'."]);
    expect(configProblems('url: &a x\n')[0]).toMatch(/^line 1: anchors/);
    expect(configProblems('auth:\n  cookieEnv: [session=abc123!]\n')[0]).toMatch(/^'auth.cookieEnv\[0\]' has an invalid format/);
  });
});

describe('(c) schema covers every CLI option', () => {
  // Options deliberately not config keys: per-run inputs/outputs, interactive switches and help.
  const EXCLUDED: Record<string, string> = {
    '--help': 'help', '-h': 'help', '--version': 'help',
    '--yes': 'init: interactive switch', '--force': 'init: per-run overwrite', '--target': 'init: chooses which CI file to generate',
    '--strict': 'doctor: exit-code policy for one run',
    '--current': 'ci gate: per-run input', '-c': 'ci gate: per-run input',
    '--threshold': 'ci gate: per-run threshold (scan uses failOn)', '-t': 'ci gate: per-run threshold',
    '--markdown': 'single-file output path', '-m': 'single-file output path',
    '--json': 'single-file output path', '-j': 'single-file output path', '--html': 'single-file output path',
    '--update-baseline': 'ci gate: one-off baseline write',
    '--manual-evidence': 'ci gate: per-run evidence input',
    '--from': 'baseline/evidence: per-run input', '--output': 'baseline create: per-run output', '--out': 'evidence pack: per-run output',
    '--commit': 'evidence pack: per-run commit SHA',
    '--verify': 'not a CLI option: argument to git rev-parse in evidence.ts',
  };

  function schemaFlags(node: JsonSchema, out = new Set<string>()): Set<string> {
    for (const flag of node['x-cli'] ?? []) out.add(flag);
    for (const child of Object.values(node.properties ?? {})) schemaFlags(child, out);
    return out;
  }

  it('every flag literal in the CLI source is in the schema or explicitly excluded', async () => {
    const dir = 'packages/cli/src';
    const flags = new Set<string>();
    for (const file of await readdir(dir)) {
      if (!file.endsWith('.ts')) continue;
      for (const match of (await readFile(path.join(dir, file), 'utf8')).matchAll(/'(--?[a-z][a-z-]*)'/g)) flags.add(match[1]!);
    }
    expect(flags.size).toBeGreaterThan(20);
    const documented = schemaFlags(CONFIG_SCHEMA);
    const missing = [...flags].filter((flag) => !documented.has(flag) && !Object.hasOwn(EXCLUDED, flag));
    expect(missing).toEqual([]);
    const overlap = [...documented].filter((flag) => Object.hasOwn(EXCLUDED, flag));
    expect(overlap).toEqual([]);
    // Every schema-documented flag still exists in the CLI (no stale keys).
    expect([...documented].filter((flag) => !flags.has(flag))).toEqual([]);
  });
});

describe('CLI and doctor wiring', () => {
  it('a11ygate config validate reports problems with exit 2 and passes valid files', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'a11ygate-config-'));
    try {
      await writeFile(path.join(cwd, '.a11ygate.yml'), 'engine: [axe]\nfailOn: severe\n');
      const bad = capture(cwd);
      expect(await run(['config', 'validate'], bad.io)).toBe(2);
      expect(bad.err()).toContain(".a11ygate.yml has 2 problems:\n  - unknown key 'engine' — did you mean 'engines'?");
      await writeFile(path.join(cwd, 'ok.yml'), 'engines: [axe]\n');
      const good = capture(cwd);
      expect(await run(['config', 'validate', 'ok.yml'], good.io)).toBe(0);
      expect(good.out()).toContain('ok.yml is valid');
      expect(await run(['config', 'validate', 'missing.yml'], capture(cwd).io)).toBe(2);
      expect(await run(['config'], capture(cwd).io)).toBe(2);
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });

  it('doctor surfaces config problems as a failed config check', async () => {
    const io = { env: {}, nodeVersion: '22.1.0', head: () => 'head', hasPackage: () => true, chromium: () => true };
    const find = async (repoConfig: string | null) => (await doctorChecks({}, { ...io, repoConfig })).find((f) => f.check === 'config')!;
    expect((await find(null)).status).toBe('skipped');
    expect((await find('engines: [axe]\n')).status).toBe('pass');
    const failed = await find('engine: [axe]\n');
    expect(failed.status).toBe('fail');
    expect(failed.message).toContain("unknown key 'engine' — did you mean 'engines'?");
    expect(failed.link).toMatch(/#doctor-config$/);
  });
});
