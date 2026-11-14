import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG_SCHEMA, type JsonSchema } from '@/packages/cli/src/config';
import { CONFIG_WIRING, configEnvName, effectiveModelFixConfig, loadEffectiveConfig, printableConfig } from '@/packages/cli/src/effective-config';
import { parseScanArgs, runScan, type ScanEngineFactory } from '@/packages/cli/src/scan';
import { parseArgs } from '@/packages/cli/src/args';
import { run } from '@/packages/cli/src/run';
import { doctorChecks } from '@/packages/cli/src/doctor';
import { gateVerdict } from '@/lib/gate';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(cwd => rm(cwd, { recursive: true, force: true }))); });
async function workspace(yaml?: string) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'a11ygate-effective-')); dirs.push(cwd);
  if (yaml !== undefined) await writeFile(path.join(cwd, '.a11ygate.yml'), yaml);
  return cwd;
}
function leaves(node: JsonSchema, prefix = ''): string[] {
  return Object.entries(node.properties ?? {}).flatMap(([key, child]) => {
    const name = prefix ? `${prefix}.${key}` : key;
    return child.properties ? leaves(child, name) : [name];
  });
}
function yamlEntry(key: string, value: unknown): string {
  if (key.startsWith('auth.check.')) return `auth:\n  check:\n    ${key.slice(11)}: ${JSON.stringify(value)}\n`;
  return key.startsWith('auth.') ? `auth:\n  ${key.slice(5)}: ${JSON.stringify(value)}\n` : `${key}: ${JSON.stringify(value)}\n`;
}
// Explicit expected destination, independent of the production wiring registry.
const cases: [string, unknown, string, unknown][] = [
  ['keyboard', true, 'keyboard', true],
  ['keyboardBudget', 20, 'keyboardBudget', 20],
  ['interactions', [{ route: '/pricing', name: 'menu-open', steps: [{ action: 'click', selector: '#menu' }] }], 'interactions', [{ route: '/pricing', name: 'menu-open', steps: [{ action: 'click', selector: '#menu' }] }]],
  ['autoInteractions', true, 'autoInteractions', true],
  ['interactionBudget', 4, 'interactionBudget', 4],
  ['url', 'https://other.test/', 'url', 'https://other.test/'],
  ['crawl', 7, 'maxPages', 7], ['maxPages', 31, 'maxPages', 31],
  ['maxDepth', 4, 'maxDepth', 4], ['timeoutMs', 1234, 'timeoutMs', 1234],
  ['concurrency', 3, 'concurrency', 3], ['recycleEvery', 50, 'recycleEvery', 50], ['sitemap', '/map.xml', 'sitemap', 'https://site.test/map.xml'],
  ['include', ['/docs/**'], 'include', ['/docs/**']], ['exclude', ['/admin/**'], 'exclude', ['/admin/**']],
  ['ignoreRobots', true, 'ignoreRobots', true], ['failOn', 'minor', 'failOn', 'minor'],
  ['engines', ['axe', 'ibm'], 'engines', ['axe', 'ibm']],
  ['baseline', 'known.json', 'baseline', 'known.json'],
  ['formats', ['sarif', 'junit'], 'formats', ['sarif', 'junit']],
  ['outDir', 'custom-reports', 'outDir', 'custom-reports'], ['delayMs', 25, 'delayMs', 25],
  ['reportVersion', 1, 'reportVersion', 1],
  ['auth.check.url', '/probe', 'authCheck', { url: '/probe' }],
  ['auth.check.mustHaveSelector', '#member', 'authCheck', { mustHaveSelector: '#member' }],
  ['auth.check.mustNotHaveSelector', '#login', 'authCheck', { mustNotHaveSelector: '#login' }],
  ['auth.check.mustNotRedirectTo', '/login', 'authCheck', { mustNotRedirectTo: '/login' }],
  ['auth.storageState', 'state.json', 'storageState', 'state.json'],
  ['auth.loginScript', 'login.mjs', 'loginScript', 'login.mjs'],
  ['auth.loginTimeoutMs', 5678, 'loginTimeoutMs', 5678],
  ['auth.cookieEnv', ['session=SESSION'], 'cookieEnv', ['session=SESSION']],
  ['auth.headerEnv', ['Authorization=ACCESS'], 'headerEnv', ['Authorization=ACCESS']],
];

describe('every schema key reaches an effective command option', () => {
  it('fails on schema drift, including nested auth properties', () => {
    expect(Object.keys(CONFIG_WIRING).sort()).toEqual(leaves(CONFIG_SCHEMA).sort());
    expect([...new Set(Object.keys(CONFIG_WIRING).map(key => key.split('.')[0]))].sort()).toEqual(Object.keys(CONFIG_SCHEMA.properties!).sort());
    expect([...cases.map(([key]) => key), 'modelFixes'].sort()).toEqual(leaves(CONFIG_SCHEMA).sort());
    expect(CONFIG_SCHEMA.properties?.auth?.type).toBe('object'); // auth is the container for all five covered leaves.
    expect(Object.values(CONFIG_WIRING).every(w => w.commands.length > 0)).toBe(true);
  });
  it.each(cases)('%s in YAML changes the actual parsed option', async (key, value, destination, expected) => {
    const base = `${key === 'url' ? '' : 'url: https://site.test/\n'}${key === 'outDir' ? '' : 'outDir: reports\n'}`;
    const cwd = await workspace(base + yamlEntry(key, value));
    const config = loadEffectiveConfig('scan', [], { cwd, env: {} });
    expect(config.sources[key]).toBe('.a11ygate.yml');
    const parsed = parseScanArgs(config.argv);
    expect(parsed).toMatchObject({ ok: true, options: { [destination]: expected } });
    const defaults = parseScanArgs(['https://site.test/']);
    expect(defaults.ok && defaults.options[destination as keyof typeof defaults.options]).not.toEqual(expected);
  });
  it('modelFixes applies to doctor and Action suggestions and cannot override repository denial', async () => {
    const cwd = await workspace('modelFixes: true\nengines: [axe, ibm]\n');
    const config = loadEffectiveConfig('doctor', [], { cwd, env: {} });
    expect(config.values.modelFixes).toBe(true);
    expect(effectiveModelFixConfig(config, {}).enabled).toBe(true);
    const findings = await doctorChecks({}, { cwd, env: {}, head: () => 'head', hasPackage: () => false, chromium: () => false });
    expect(findings.find(f => f.check === 'provider')?.status).toBe('fail');
    expect(findings.find(f => f.check === 'engines')?.message).toContain('accessibility-checker-engine');
    for (const repoConfig of [null, 'modelFixes: false', '']) {
      const denied = loadEffectiveConfig('doctor', ['--model-fixes', 'on'], { repoConfig, env: {} });
      expect(denied.values.modelFixes).toBe(false);
      expect(effectiveModelFixConfig(denied, {}).enabled).toBe(false);
    }
  });
});

describe('precedence, validation and unchanged defaults', () => {
  it.each(cases)('%s: flag > env > YAML > default', async (key, yamlValue) => {
    const schema = key.split('.').reduce((node, part) => node.properties![part]!, CONFIG_SCHEMA);
    let envValue: unknown;
    if (key === 'interactions') envValue = [{ route: '/env', name: 'open', steps: [{ action: 'wait', selector: '#env' }] }];
    else if (schema.type === 'array') envValue = key === 'engines' ? ['axe'] : key === 'formats' ? ['json'] : key.startsWith('auth.') ? ['other=OTHER'] : ['/environment/**'];
    else if (schema.type === 'integer') envValue = key === 'reportVersion' ? 2 : key === 'concurrency' ? 2 : 2;
    else if (schema.type === 'boolean') envValue = false;
    else envValue = key === 'url' ? 'https://env.test/' : key === 'failOn' ? 'critical' : 'environment';
    const env = { [configEnvName(key)]: typeof envValue === 'object' ? JSON.stringify(envValue) : String(envValue) };
    const repoConfig = yamlEntry(key, yamlValue);
    expect(loadEffectiveConfig('scan', [], { repoConfig, env }).values[key]).toEqual(envValue);
    // Boolean CLI opts into true; lists replace rather than append to lower-precedence values.
    const flagValue = ['ignoreRobots', 'autoInteractions'].includes(key) ? true : yamlValue;
    const flag = CONFIG_WIRING[key]!.flag;
    const args = ['ignoreRobots', 'autoInteractions'].includes(key) ? [flag] : [flag, key === 'interactions' ? JSON.stringify(flagValue) : Array.isArray(flagValue) ? flagValue.join(',') : String(flagValue)];
    expect(loadEffectiveConfig('scan', args, { repoConfig, env }).values[key]).toEqual(flagValue);
    expect(loadEffectiveConfig('scan', args, { repoConfig, env }).sources[key]).toBe(`flag:${flag}`);
  });
  it('preserves exact parser defaults with no config, and legacy crawl clamping', () => {
    const options = { repoConfig: null, env: {} };
    const args = ['https://site.test/'];
    expect(parseScanArgs(loadEffectiveConfig('scan', args, options).argv)).toEqual(parseScanArgs(args));
    expect(parseArgs(loadEffectiveConfig('ci', ['--current', 'current.json'], options).argv)).toEqual(parseArgs(['--current', 'current.json']));
    expect(parseScanArgs(loadEffectiveConfig('scan', [...args, '--crawl=500'], options).argv)).toMatchObject({ ok: true, options: { maxPages: 20, warnings: [expect.stringContaining('hard maximum')] } });
  });
  it('handles crawl zero, sitemap defaults and maxPages overriding crawl', () => {
    for (const [yaml, pages] of [['crawl: 0', 1], ['crawl: 7', 7], ['sitemap: /map.xml', 20], ['crawl: 7\nmaxPages: 30', 30]] as const) {
      const config = loadEffectiveConfig('scan', [], { repoConfig: 'url: https://site.test/\n' + yaml, env: {} });
      expect(parseScanArgs(config.argv)).toMatchObject({ ok: true, options: { maxPages: pages } });
      expect(config.values.maxPages).toBe(pages);
    }
  });
  it('rejects invalid YAML or env before starting an engine and does not echo their values', async () => {
    const cwd = await workspace('concurrency: 99');
    let errors = '';
    const engine: ScanEngineFactory = async () => { throw Error('engine must not start'); };
    expect(await runScan([], { cwd, env: { NODE_ENV: 'test' }, engine, stderr: s => { errors += s; } })).toBe(2);
    expect(errors).toContain('Invalid .a11ygate.yml');
    expect(() => loadEffectiveConfig('scan', [], { repoConfig: null, env: { A11YGATE_CONCURRENCY: 'sensitive-invalid-value' } })).toThrow('Invalid A11YGATE_CONCURRENCY');
  });
  it('ci receives shared report settings and failOn none without hiding incomplete coverage', async () => {
    const cwd = await workspace('failOn: none\nformats: [junit]\noutDir: reports\n');
    const current = path.resolve('examples/github-action/fixtures/current.json');
    let out = '';
    expect(await run(['ci', '--current', current], { cwd, env: { NODE_ENV: 'test' }, stdout: s => { out += s; }, stderr: () => {} })).toBe(0);
    expect(out).toContain('impact threshold: none');
    expect(gateVerdict([], 'none', { status: 'incomplete', issues: [], pages: [], unassessedScope: [], unassessedFindings: 0 })).toBe('INCOMPLETE');
    expect(await readFile(path.join(cwd, 'reports/a11ygate.junit.xml'), 'utf8')).toContain('<testsuite ');
  });
});

describe('config print', () => {
  it('prints sources and references, never reads credential files or prints referenced values', async () => {
    const cwd = await workspace('url: https://site.test/?token=inline-secret\nauth:\n  storageState: missing-private-state.json\n  loginScript: missing-private-login.mjs\n  cookieEnv: [session=UNUSUAL]\n  headerEnv: [Authorization=HEADER]\n');
    const env = { NODE_ENV: 'test' as const, UNUSUAL: 'short', HEADER: 'Bearer header-credential', OTHER_TOKEN: 'other-credential', A11YGATE_DELAY_MS: '20' };
    let out = ''; let err = '';
    expect(await run(['config', 'print', '--delay-ms', '30'], { cwd, env, stdout: s => { out += s; }, stderr: s => { err += s; } })).toBe(0);
    expect(err).toBe('');
    const printed = JSON.parse(out);
    expect(printed.config.delayMs).toMatchObject({ value: 30, source: 'flag:--delay-ms' });
    expect(printed.config['auth.cookieEnv'].value).toEqual(['session=UNUSUAL']);
    expect(printed.disclaimer).toContain('Automated');
    for (const secret of ['short', 'header-credential', 'other-credential', 'inline-secret']) expect(out).not.toContain(secret);
    // Even a referenced env value copied into an otherwise innocent field is redacted.
    const config = loadEffectiveConfig('scan', ['--out-dir', 'short'], { cwd, env });
    expect(printableConfig(config, env).outDir.value).toBe('[REDACTED]');
  });
});

describe('resolved configuration reaches runtime consumers', () => {
  it('scans the YAML URL with YAML engines, auth, crawl controls and report outputs without a browser', async () => {
    const cwd = await workspace(`url: https://site.test/
crawl: 3
maxDepth: 1
timeoutMs: 4321
concurrency: 2
include: [/**]
exclude: [/excluded]
ignoreRobots: true
failOn: none
engines: [axe, ibm]
delayMs: 0
reportVersion: 1
formats: [sarif]
outDir: reports
auth:
  cookieEnv: [session=UNUSUAL]
  headerEnv: [Authorization=ACCESS]
  loginTimeoutMs: 4321
`);
    const visited: string[] = [];
    const engine: ScanEngineFactory = async options => {
      expect(options).toMatchObject({ engines: ['axe', 'ibm'], timeoutMs: 4321, auth: { timeout: 4321, cookies: [{ name: 'session', value: 'cookie-value' }], headers: { authorization: 'Bearer header-value' } } });
      return { close: async () => {}, visit: async url => {
        visited.push(url);
        return { status: 200, finalUrl: url, links: ['https://site.test/allowed', 'https://site.test/excluded'], result: { url, timestamp: '2026-11-14T00:00:00Z', testEngine: { version: '4.14.0' }, violations: [], scanStatus: 'complete', toolOptions: {}, scanConfig: {} } };
      } };
    };
    let output = '';
    let errors = '';
    const code = await runScan([], { cwd, env: { NODE_ENV: 'test', UNUSUAL: 'cookie-value', ACCESS: 'Bearer header-value' }, engine, stdout: s => { output += s; }, stderr: s => { errors += s; }, fetch: async () => { throw Error('robots must be skipped'); } });
    expect(code, errors).toBe(0);
    expect(visited).toEqual(['https://site.test/', 'https://site.test/allowed']);
    expect(await readFile(path.join(cwd, 'reports/a11ygate-scan.sarif'), 'utf8')).toContain('2.1.0');
    for (const secret of ['cookie-value', 'header-value']) expect(output + await readFile(path.join(cwd, 'reports/a11ygate-scan.json'), 'utf8')).not.toContain(secret);
  });
  it('keeps supported-engine guidance without echoing invalid input', async () => {
    const cwd = await workspace();
    let errors = '';
    expect(await runScan(['https://site.test/', '--engines', 'private-invalid-input'], { cwd, env: { NODE_ENV: 'test' }, stderr: s => { errors += s; } })).toBe(2);
    expect(errors).toContain('axe,htmlcs,ibm,lighthouse');
    expect(errors).not.toContain('private-invalid-input');
  });
  it('preserves repeatable flag behavior and replaces lower-precedence lists', () => {
    const config = loadEffectiveConfig('scan', ['https://site.test', '--engines', 'axe', '--engines', 'ibm', '--format', 'junit,junit', '--format', 'sarif', '--out-dir', 'reports', '--include', '/a,b', '--include', '/c'], { repoConfig: 'engines: [lighthouse]\nformats: [json]\ninclude: [/yaml]\n', env: {} });
    expect(config.values.engines).toEqual(['ibm']);
    expect(config.values.formats).toEqual(['junit', 'sarif']);
    expect(config.values.include).toEqual(['/a,b', '/c']);
    expect(parseScanArgs(config.argv)).toMatchObject({ ok: true, options: { engines: ['ibm'], formats: ['junit', 'sarif'], include: ['/a,b', '/c'] } });
  });
  it('applies model switch precedence with consent, including quoted YAML keys', () => {
    const repoConfig = '"modelFixes": true';
    expect(effectiveModelFixConfig(loadEffectiveConfig('doctor', [], { repoConfig, env: {} }), {}).enabled).toBe(true);
    const env = { A11YGATE_MODEL_FIXES: 'off' };
    expect(effectiveModelFixConfig(loadEffectiveConfig('doctor', [], { repoConfig, env }), env).enabled).toBe(false);
    const flagged = loadEffectiveConfig('doctor', ['--model-fixes', 'on'], { repoConfig, env });
    expect(effectiveModelFixConfig(flagged, env).enabled).toBe(true);
    expect(flagged.sources.modelFixes).toBe('flag:--model-fixes');
  });
  it('config print shows normalized URL/sitemap and CI baseline lists, and rejects unsupported flags', async () => {
    const cwd = await workspace('url: https://SITE.test/#hidden\nsitemap: /map.xml');
    const printed = async (args: string[]) => {
      let out = ''; let err = '';
      const code = await run(['config', 'print', ...args], { cwd, env: { NODE_ENV: 'test' }, stdout: s => { out += s; }, stderr: s => { err += s; } });
      return { code, out, err };
    };
    const scan = await printed([]);
    expect(scan.code).toBe(0);
    expect(JSON.parse(scan.out).config.url.value).toBe('https://site.test/');
    expect(JSON.parse(scan.out).config.sitemap.value).toBe('https://site.test/map.xml');
    const ci = await printed(['ci', '-b', 'one.json', '-b', 'two.json']);
    expect(JSON.parse(ci.out).config.baseline.value).toEqual(['one.json', 'two.json']);
    const invalid = await printed(['--unknown=private-value']);
    expect(invalid.code).toBe(2);
    expect(invalid.out + invalid.err).not.toContain('private-value');
  });
});
