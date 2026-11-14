import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sha256 } from '@/lib/evidence/pack';
import { createZip, crc32, readZip, unsafeZipEntryName, ZipError } from '@/lib/evidence/zip';
import { parseFingerprintBaseline, parseScanReport } from '@/lib/scan/baseline';
import { parseInteractionStates } from '@/lib/scan/interactions';
import { buildTrend, renderTrendHtml } from '@/lib/trend';
import { parseSessionStorageState, parseStorageState, prepareAuth } from '@/packages/cli/src/auth';
import { configProblems } from '@/packages/cli/src/config-schema';
import { loadEffectiveConfig } from '@/packages/cli/src/effective-config';
import { debugDetail, debugRequested, formatFatal, setDebug, stripDebugFlag } from '@/packages/cli/src/fatal';
import { readJsonInput } from '@/packages/cli/src/input-file';
import { runReview } from '@/packages/cli/src/review';
import { parseManifest, readPack, runTrend } from '@/packages/cli/src/trend';

/**
 * A11Y-R61: malformed-input property tests for every file A11yGate reads.
 * Each parser gets RUNS generated cases. The seed is fixed so CI is reproducible;
 * set FC_SEED to explore other inputs locally. No network: everything is in memory or a temp dir.
 */
const RUNS = 250;
const SEED = Number(process.env.FC_SEED ?? 61);
const options = { numRuns: RUNS, seed: SEED };
const STACK_LINE = /\n\s+at /;

/** The parser either accepts or throws a plain Error with a non-empty, stack-free message (never TypeError/RangeError). */
function rejectsCleanly(fn: () => unknown): string | null {
  try { fn(); return null; } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).constructor.name, (error as Error).message).toBe('Error');
    expect((error as Error).message.length).toBeGreaterThan(0);
    expect((error as Error).message).not.toMatch(STACK_LINE);
    return (error as Error).message;
  }
}

/** Replace or delete one value at a random path inside a valid document. */
function mutated<T>(base: T): fc.Arbitrary<unknown> {
  const paths: (string | number)[][] = [];
  const walk = (value: unknown, at: (string | number)[]) => {
    paths.push(at);
    if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, [...at, Array.isArray(value) ? Number(k) : k]);
  };
  walk(base, []);
  const replacement = fc.oneof(fc.jsonValue({ maxDepth: 2 }), fc.constantFrom(null, '', 0, -1, 1e309, [], {}, '__proto__', '../x', 'x'.repeat(600)));
  return fc.tuple(fc.nat(paths.length - 1), replacement, fc.boolean()).map(([index, value, remove]) => {
    const copy = structuredClone(base) as unknown;
    const at = paths[index]!;
    if (at.length === 0) return value;
    let parent = copy as Record<string | number, unknown>;
    for (const key of at.slice(0, -1)) parent = parent[key] as Record<string | number, unknown>;
    const last = at[at.length - 1]!;
    if (remove && !Array.isArray(parent)) delete parent[last];
    else parent[last] = value;
    return copy;
  });
}

const anyJson = fc.oneof(fc.jsonValue({ maxDepth: 3 }), fc.anything({ maxDepth: 2 }));

describe('.a11ygate.yml', () => {
  const fragments = fc.oneof(
    fc.string({ maxLength: 40 }),
    fc.constantFrom('url: https://site.test/', 'maxPages: 3', 'concurrency: 99', 'scan:', '  - x', '-', '- a: b', '  key: [1, 2', 'formats: [sarif, junit]',
      '__proto__:', '  url: 3', '"quoted": "unterminated', "'single", '---', '...', '\t tab', '# comment', 'engines: [axe, nope]', 'auth:', '  storageState: x',
      'interactions:', '  - route: /a', '    name: n', '    steps: []', '&anchor x', 'key: *alias', 'k: !tag v', 'k: |', 'k: {a: 1}', ':', 'a::b'),
  );
  const yaml = fc.array(fragments.chain((line) => fc.nat(6).map((n) => ' '.repeat(n) + line)), { maxLength: 15 }).map((lines) => lines.join('\n'));

  it(`never throws, always returns plain-English problems (${RUNS} cases)`, () => {
    fc.assert(fc.property(yaml, (text) => {
      const problems = configProblems(text);
      expect(Array.isArray(problems)).toBe(true);
      for (const problem of problems) expect(typeof problem === 'string' && problem.length > 0 && !STACK_LINE.test(problem)).toBe(true);
      if (problems.length) {
        const message = rejectsCleanly(() => loadEffectiveConfig('scan', [], { repoConfig: text, env: {} }));
        expect(message).toMatch(/^Invalid \.a11ygate\.yml \((line \d+|field '[^']+'|line \d+, field '[^']+')\)\./);
      }
    }), options);
  });

  it('refuses a __proto__ key instead of silently changing the parsed object prototype (bug found by this suite)', () => {
    expect(configProblems('__proto__:\n  url: 3')).toEqual(["line 1: the key '__proto__' is not allowed."]);
    expect(configProblems('scan: 1\n"__proto__": 1')[0]).toContain("'__proto__' is not allowed");
    expect(() => loadEffectiveConfig('scan', [], { repoConfig: '__proto__:\n  concurrency: 99', env: {} })).toThrow("Invalid .a11ygate.yml (line 1, field '__proto__')");
  });

  it('names the field without echoing its value', () => {
    expect(() => loadEffectiveConfig('scan', [], { repoConfig: 'concurrency: 99', env: {} })).toThrow("Invalid .a11ygate.yml (field 'concurrency')");
    expect(() => loadEffectiveConfig('scan', [], { repoConfig: 'url: sensitive-value-1234', env: {} })).not.toThrow('sensitive-value-1234');
    expect(() => loadEffectiveConfig('scan', [], { repoConfig: 'maxPages: 3\nmaxPages: 4', env: {} })).toThrow("Invalid .a11ygate.yml (line 2, field 'maxPages')");
    expect(() => loadEffectiveConfig('scan', [], { repoConfig: 'engine: [axe]', env: {} })).toThrow("Invalid .a11ygate.yml (field 'engine')");
  });
});

const BASELINE = {
  kind: 'a11ygate-fingerprint-baseline', schemaVersion: 1, disclaimer: 'x', engines: ['axe'],
  findings: [{ fingerprint: 'f1', pageUrl: 'https://site.test/', ruleId: 'image-alt', selector: 'img' }],
  groupDecisions: [{ group: 'g', groupKey: 'k', ruleId: 'image-alt', normalizedSelector: 'img', decision: 'to-fix', by: 'A', at: '2026-11-01' }],
};

describe('fingerprint baseline / review decisions file', () => {
  it(`rejects arbitrary JSON with a plain Error (${RUNS} cases)`, () => {
    fc.assert(fc.property(anyJson, (value) => { rejectsCleanly(() => parseFingerprintBaseline(value)); }), options);
  });

  it(`rejects mutated baselines with a message naming the field (${RUNS} cases)`, () => {
    fc.assert(fc.property(mutated(BASELINE), (value) => {
      const message = rejectsCleanly(() => parseFingerprintBaseline(value));
      if (message) expect(message).toMatch(/field (\(top level\)|kind|schemaVersion|findings|engines|groupDecisions)(?!\w)/);
    }), options);
  });

  it('names the file and the field', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'a11ygate-r61-'));
    try {
      await writeFile(path.join(dir, 'b.json'), JSON.stringify({ ...BASELINE, findings: [{ ...BASELINE.findings[0], selector: 3 }] }));
      await expect(readJsonInput(dir, 'b.json', parseFingerprintBaseline)).rejects.toThrow('b.json: Invalid baseline field findings[0].selector: expected a string.');
      await writeFile(path.join(dir, 'k.json'), JSON.stringify({ ...BASELINE, schemaVersion: 2 }));
      await expect(readJsonInput(dir, 'k.json', parseFingerprintBaseline)).rejects.toThrow(/^k\.json: Expected an A11yGate fingerprint baseline .*invalid field schemaVersion\./);
      await writeFile(path.join(dir, 'd.json'), JSON.stringify({ ...BASELINE, groupDecisions: [{ ...BASELINE.groupDecisions[0], decision: 'maybe' }] }));
      await expect(readJsonInput(dir, 'd.json', parseFingerprintBaseline)).rejects.toThrow(/^d\.json: .*\(field groupDecisions\[0\]\)\.$/);
      await writeFile(path.join(dir, 'c.json'), '{"kind": ');
      await expect(readJsonInput(dir, 'c.json', parseFingerprintBaseline)).rejects.toThrow(/^c\.json: not valid JSON\.$/);
      await expect(readJsonInput(dir, 'missing.json', parseFingerprintBaseline)).rejects.toThrow('missing.json: file not found.');
      await expect(readJsonInput(dir, '.', parseFingerprintBaseline)).rejects.toThrow('.: is a directory, not a file.');
      await expect(readJsonInput(dir, 'b.json', parseFingerprintBaseline, 4)).rejects.toThrow('b.json: larger than');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('a11ygate review with a malformed baseline exits 2, names the file, prints no stack and leaves the file untouched', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'a11ygate-r61-'));
    try {
      await writeFile(path.join(dir, 'a11ygate-scan.json'), JSON.stringify(SCAN));
      const samples = fc.sample(mutated(BASELINE), { numRuns: 25, seed: SEED }).map((v) => JSON.stringify(v) ?? 'null');
      for (const text of [...samples, '{', '', '\uFEFF[]']) {
        await writeFile(path.join(dir, 'base.json'), text);
        let err = '';
        const code = await runReview(['a11ygate-scan.json', '--baseline', 'base.json', '--list'], { cwd: dir, stdout: () => {}, stderr: (s) => { err += s; } });
        expect(await readFile(path.join(dir, 'base.json'), 'utf8')).toBe(text);
        expect((await readdir(dir)).sort()).toEqual(['a11ygate-scan.json', 'base.json']);
        if (code !== 0) {
          expect(code).toBe(2);
          expect(err).toContain('base.json: ');
          expect(err).not.toMatch(STACK_LINE);
        }
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

const INTERACTIONS = [{ route: '/menu', name: 'open-menu', steps: [{ action: 'click', selector: 'button.menu' }, { action: 'press', selector: 'body', key: 'Escape' }] }];

describe('interactions file', () => {
  it(`rejects arbitrary JSON with a plain Error (${RUNS} cases)`, () => {
    fc.assert(fc.property(anyJson, (value) => { rejectsCleanly(() => parseInteractionStates(value)); }), options);
  });
  it(`rejects mutated states naming interactions[i] or steps[j] (${RUNS} cases)`, () => {
    fc.assert(fc.property(mutated(INTERACTIONS), (value) => {
      const message = rejectsCleanly(() => parseInteractionStates(value));
      if (message) expect(message).toMatch(/^interactions( \(top level\)|\[0\](\.(route|name|steps))?|\[0\]\.steps\[\d\](\.(action|selector|key))?): /);
    }), options);
  });
  it('names the file and the exact field', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'a11ygate-r61-'));
    try {
      const write = (value: unknown) => writeFile(path.join(dir, 'states.json'), JSON.stringify(value));
      const read = () => readJsonInput(dir, 'states.json', parseInteractionStates);
      await write([{ ...INTERACTIONS[0], route: 'menu' }]);
      await expect(read()).rejects.toThrow(/^states\.json: interactions\[0\]\.route: /);
      await write([{ ...INTERACTIONS[0], steps: [{ action: 'press', selector: 'body' }] }]);
      await expect(read()).rejects.toThrow('states.json: interactions[0].steps[0].key: press needs a key');
      await write({ states: [] });
      await expect(read()).rejects.toThrow('states.json: interactions (top level): must be a list');
      await write([{ ...INTERACTIONS[0], steps: [{ action: 'hover', selector: 'a' }] }]);
      expect(() => loadEffectiveConfig('scan', ['--interactions', 'states.json'], { cwd: dir, repoConfig: null, env: {} }))
        .toThrow('Invalid --interactions (states.json: interactions[0].steps[0].action: must be click, press or wait).');
      await writeFile(path.join(dir, 'states.json'), '[{"route": ');
      expect(() => loadEffectiveConfig('scan', ['--interactions', 'states.json'], { cwd: dir, repoConfig: null, env: {} })).toThrow('Invalid --interactions (states.json: not valid JSON)');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

const SESSION = { origins: [{ origin: 'https://site.test', sessionStorage: [{ name: 'k', value: 'v' }] }] };
const STORAGE = { cookies: [{ name: 'sid', value: 'secret', domain: 'site.test', path: '/' }], origins: [{ origin: 'https://site.test', localStorage: [{ name: 'k', value: 'v' }] }] };

describe('storage state and session storage files', () => {
  it(`session storage: arbitrary and mutated JSON rejected with a plain Error naming the field (${RUNS} cases each)`, () => {
    fc.assert(fc.property(anyJson, (value) => { const message = rejectsCleanly(() => parseSessionStorageState(value)); if (message) expect(message).toMatch(/^field (\(top level\)|origins)(?!\w)/); }), options);
    fc.assert(fc.property(mutated(SESSION), (value) => {
      const message = rejectsCleanly(() => parseSessionStorageState(value));
      if (message) expect(message).toMatch(/^field (\(top level\)|origins)(?!\w)/);
    }), options);
  });
  it(`storage state: arbitrary and mutated JSON rejected with a plain Error naming the field (${RUNS} cases each)`, () => {
    fc.assert(fc.property(anyJson, (value) => { const message = rejectsCleanly(() => parseStorageState(value)); if (message) expect(message).toMatch(/^field (\(top level\)|cookies|origins)(?!\w)/); }), options);
    fc.assert(fc.property(mutated(STORAGE), (value) => {
      const message = rejectsCleanly(() => parseStorageState(value));
      if (message) expect(message).toMatch(/^field (\(top level\)|cookies|origins)(?!\w)/);
    }), options);
  });
  it('storage state: rejects cookie fields Playwright would refuse, naming the field', () => {
    const cookie = { name: 'sid', value: 'secret', domain: 'site.test', path: '/' };
    const cases: [Record<string, unknown>, string][] = [
      [{ domain: 123 }, 'field cookies[0].domain must be a non-empty string.'],
      [{ sameSite: 'invalid' }, 'field cookies[0].sameSite must be one of Strict, Lax, None.'],
      [{ path: 7 }, 'field cookies[0].path must be a string starting with /.'],
      [{ path: undefined }, 'field cookies[0] needs url, or both domain and path.'],
      [{ domain: undefined, path: undefined, url: 'ftp://site.test' }, 'field cookies[0].url must be an http(s) URL.'],
      [{ expires: '2030' }, 'field cookies[0].expires must be -1 or a non-negative Unix time in seconds.'],
      [{ expires: -5 }, 'field cookies[0].expires must be -1 or a non-negative Unix time in seconds.'],
      [{ httpOnly: 'yes' }, 'field cookies[0].httpOnly must be true or false.'],
      [{ secure: 1 }, 'field cookies[0].secure must be true or false.'],
      [{ name: ' ' }, 'field cookies[0].name must not be empty.'],
    ];
    for (const [patch, message] of cases) expect(rejectsCleanly(() => parseStorageState({ cookies: [{ ...cookie, ...patch }] }))).toBe(message);
    expect(rejectsCleanly(() => parseStorageState({ cookies: [{ name: 'sid', value: 'v', url: 'https://site.test/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }] }))).toBeNull();
  });
  it(`storage state: every accepted cookie has the shape Playwright requires (${RUNS} cases)`, () => {
    const field = fc.oneof(fc.constant(undefined), anyJson, fc.constantFrom('Strict', 'Lax', 'None', '/', 'site.test', 'https://site.test/', -1, 0, true, false));
    const cookieArb = fc.record({ name: fc.oneof(fc.constant('sid'), anyJson), value: fc.oneof(fc.constant('v'), anyJson), domain: field, path: field, url: field, expires: field, httpOnly: field, secure: field, sameSite: field }, { requiredKeys: [] });
    fc.assert(fc.property(fc.array(cookieArb, { maxLength: 3 }), (cookies) => {
      if (rejectsCleanly(() => parseStorageState({ cookies })) !== null) return;
      for (const c of cookies as Record<string, unknown>[]) {
        expect(typeof c.name === 'string' && typeof c.value === 'string').toBe(true);
        expect(typeof c.url === 'string' || (typeof c.domain === 'string' && typeof c.path === 'string')).toBe(true);
        if (c.sameSite !== undefined) expect(['Strict', 'Lax', 'None']).toContain(c.sameSite);
        if (c.expires !== undefined) expect(typeof c.expires).toBe('number');
        for (const flag of ['httpOnly', 'secure']) if (c[flag] !== undefined) expect(typeof c[flag]).toBe('boolean');
      }
    }), options);
  });
  it('prepareAuth names the file and field and never echoes a stored value', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'a11ygate-r61-'));
    try {
      await writeFile(path.join(dir, 'state.json'), JSON.stringify({ cookies: [{ name: 'sid', value: 42 }], secret: 'do-not-echo-123' }));
      const error = await prepareAuth({ storageState: 'state.json' }, dir, 'https://site.test', { NODE_ENV: 'test' }).catch((e: Error) => e);
      expect((error as Error).message).toBe('Could not read --storage-state: expected a Playwright storageState JSON file (state.json: field cookies[0] needs string name and value).');
      await writeFile(path.join(dir, 'session.json'), '{"origins": [ do-not-echo-123');
      const syntax = await prepareAuth({ sessionStorage: 'session.json' }, dir, 'https://site.test', { NODE_ENV: 'test' }).catch((e: Error) => e);
      expect((syntax as Error).message).toContain('(session.json: not valid JSON)');
      expect((syntax as Error).message).not.toContain('do-not-echo');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

const SCAN = {
  tool: 'a11ygate', kind: 'site-scan', schemaVersion: 1, startUrl: 'https://site.test/', verdict: 'FAIL', reason: 'r', failOn: 'serious',
  counts: { pagesScanned: 1, pagesFailed: 0 }, options: {}, results: [],
  pages: [{ url: 'https://site.test/', finalUrl: 'https://site.test/', status: 200, scanStatus: 'complete' }],
  findings: [{ pageUrl: 'https://site.test/', ruleId: 'image-alt', impact: 'critical', selector: 'img', selectors: ['img'], wcag: [{ number: '1.1.1' }], fingerprint: 'x', html: '<img>' }],
};
const manifestFor = (scanText: string, scannedAt = '2026-11-01T00:00:00Z') => ({
  tool: 'a11ygate', kind: 'evidence-pack', schemaVersion: 1, commit: { sha: 'abc' },
  timestamps: { timezone: 'UTC', packedAt: scannedAt, scannedAt }, files: [{ path: 'scan/a11ygate-scan.json', bytes: scanText.length, sha256: sha256(Buffer.from(scanText)) }],
});
const packFiles = (manifest: unknown, scanText: string) => new Map<string, Uint8Array>([['manifest.json', Buffer.from(JSON.stringify(manifest) ?? 'null')], ['scan/a11ygate-scan.json', Buffer.from(scanText)]]);

describe('evidence pack manifest and scan report', () => {
  it('the unmodified fixture pack is accepted', () => {
    const text = JSON.stringify(SCAN);
    const pack = readPack('ok.zip', packFiles(manifestFor(text), text));
    expect(typeof pack).not.toBe('string');
  });
  it('names the manifest field (commit.sha, files[i], timestamps)', () => {
    const text = JSON.stringify(SCAN);
    const base = manifestFor(text);
    const cases: [unknown, string][] = [
      [{ ...base, commit: { sha: 5 } }, 'field commit.sha must be a string.'],
      [{ ...base, files: [null] }, 'field files[0] must be an object.'],
      [{ ...base, files: [{ path: 'scan/a11ygate-scan.json', sha256: 7 }] }, 'field files[0].sha256 must be a string.'],
      [{ ...base, timestamps: { scannedAt: 'yesterday' } }, 'field timestamps.scannedAt must be an ISO date.'],
      [{ ...base, kind: 'other' }, 'field kind must be "evidence-pack".'],
      [[], 'field (top level) must be a JSON object.'],
    ];
    for (const [manifest, field] of cases) expect(readPack('p.zip', packFiles(manifest, text))).toBe(`p.zip: manifest.json is not an A11yGate evidence-pack manifest: ${field}`);
    expect(parseManifest('{')).toBe('not valid JSON.');
    const scan = JSON.stringify({ ...SCAN, counts: { pagesScanned: '1' } });
    expect(readPack('q.zip', packFiles(manifestFor(scan), scan))).toBe('q.zip: scan/a11ygate-scan.json is not an A11yGate site-scan report (field counts.pagesScanned must be a number).');
    const finding = JSON.stringify({ ...SCAN, findings: [{ ...SCAN.findings[0], selectors: [1] }] });
    expect(readPack('f.zip', packFiles(manifestFor(finding), finding))).toBe('f.zip: scan/a11ygate-scan.json: Invalid scan finding (field findings[0].selectors).');
    // Bug found by this suite: a null wcag entry crashed fingerprinting with a TypeError.
    const wcag = JSON.stringify({ ...SCAN, findings: [{ ...SCAN.findings[0], wcag: [null] }] });
    expect(readPack('w.zip', packFiles(manifestFor(wcag), wcag))).toBe('w.zip: scan/a11ygate-scan.json: Invalid scan finding (field findings[0].wcag).');
  });
  it('names the field for malformed multi-engine findings (engines, fingerprint)', () => {
    const good = JSON.stringify(['https://example.test/', 'main > button', ['1.4.3'], '']);
    const multi = { ...SCAN.findings[0], engines: ['axe'], fingerprint: good };
    expect(() => parseScanReport({ ...SCAN, findings: [multi] })).not.toThrow();
    const cases: [Record<string, unknown>, string][] = [
      [{ ...multi, fingerprint: 'not-json' }, 'fingerprint'],
      [{ ...multi, fingerprint: 7 }, 'fingerprint'],
      [{ ...multi, fingerprint: JSON.stringify(['p', 'l']) }, 'fingerprint'],
      [{ ...multi, fingerprint: JSON.stringify(['p', 'l', 'sc', 'r']) }, 'fingerprint'],
      [{ ...multi, fingerprint: JSON.stringify({ a: 1 }) }, 'fingerprint'],
      [{ ...multi, engines: 'axe' }, 'engines'],
      [{ ...multi, engines: [1] }, 'engines'],
    ];
    for (const [finding, field] of cases) expect(() => parseScanReport({ ...SCAN, findings: [finding] })).toThrow(`Invalid scan finding (field findings[0].${field}).`);
  });
  it(`a mutated multi-engine finding is accepted or rejected with a named field, never a raw error (${RUNS} cases)`, () => {
    const multi = { ...SCAN, findings: [{ ...SCAN.findings[0], engines: ['axe'], fingerprint: JSON.stringify(['https://example.test/', 'main > button', ['1.4.3'], '']) }] };
    fc.assert(fc.property(mutated(multi), (report) => {
      try { parseScanReport(report); } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toMatch(/field (\(top level\)|[\w.[\]]+)/);
      }
    }), options);
  });
  it(`parseManifest never throws on arbitrary or mutated manifests (${RUNS} cases each)`, () => {
    fc.assert(fc.property(fc.oneof(fc.string(), anyJson.map((v) => JSON.stringify(v) ?? '')), (text) => { expect(() => parseManifest(text)).not.toThrow(); }), options);
    fc.assert(fc.property(mutated(manifestFor('{}')), (value) => { expect(() => parseManifest(JSON.stringify(value) ?? '')).not.toThrow(); }), options);
  });
  it(`a mutated manifest is either skipped with a named reason or trends without crashing (${RUNS} cases)`, () => {
    const text = JSON.stringify(SCAN);
    fc.assert(fc.property(mutated(manifestFor(text)), (manifest) => {
      const pack = readPack('m.zip', packFiles(manifest, text));
      if (typeof pack === 'string') expect(pack).toMatch(/^m\.zip: manifest\.json (is not an A11yGate evidence-pack manifest: (not valid JSON|field (\(top level\)|[\w.[\]]+) must)|field files has no entry)|^m\.zip: scan\/a11ygate-scan\.json does not match the SHA-256 in manifest\.json\.$/);
      else renderTrendHtml(buildTrend([pack, { ...pack, source: 'n.zip' }]));
    }), options);
  });
  it(`a mutated scan report is either skipped with a named reason or trends without crashing (${RUNS} cases)`, () => {
    fc.assert(fc.property(mutated(SCAN), (report) => {
      const text = JSON.stringify(report) ?? 'null';
      const pack = readPack('r.zip', packFiles(manifestFor(text), text));
      if (typeof pack === 'string') expect(pack).toMatch(/^r\.zip: scan\/a11ygate-scan\.json(: .*field (\(top level\)|[\w.[\]]+)| is not an A11yGate site-scan report \((not valid JSON|field (\(top level\)|[\w.[\]]+)))/);
      else renderTrendHtml(buildTrend([pack, { ...pack, source: 's.zip' }]));
    }), options);
  });
});

/** Hand-built single-entry archive, so tests can declare names and sizes createZip refuses to write. */
function rawZip(name: string, data: Buffer, opts: { declaredSize?: number; method?: 0 | 8 } = {}): Buffer {
  const method = opts.method ?? 8;
  const body = method === 8 ? deflateRawSync(data) : data;
  const nameBytes = Buffer.from(name, 'utf8');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8);
  local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(opts.declaredSize ?? data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(method, 10);
  central.writeUInt32LE(crc32(data), 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(opts.declaredSize ?? data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(0, 42);
  const centralAt = local.length + nameBytes.length + body.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + nameBytes.length, 12); end.writeUInt32LE(centralAt, 16);
  return Buffer.concat([local, nameBytes, body, central, nameBytes, end]);
}

describe('evidence pack zip', () => {
  const valid = createZip([{ path: 'manifest.json', data: Buffer.from('{"a":1}') }, { path: 'scan/a11ygate-scan.json', data: Buffer.from('hello hello hello hello') }, { path: 'shot.png', data: Buffer.from([1, 2, 3]) }]);

  it('reads its own archives', () => {
    expect(readZip(valid).map((e) => e.path)).toEqual(['manifest.json', 'scan/a11ygate-scan.json', 'shot.png']);
    expect(readZip(rawZip('dir/a.txt', Buffer.from('x'))).map((e) => e.path)).toEqual(['dir/a.txt']);
  });

  it(`random bytes are rejected with ZipError, never a RangeError (${RUNS} cases)`, () => {
    fc.assert(fc.property(fc.uint8Array({ maxLength: 400 }), (bytes) => {
      try { readZip(bytes); } catch (error) { expect(error, String(error)).toBeInstanceOf(ZipError); }
    }), options);
  });

  it(`byte-mutated archives are rejected with ZipError or read with safe names only (${RUNS} cases)`, () => {
    fc.assert(fc.property(fc.array(fc.tuple(fc.nat(valid.length - 1), fc.integer({ min: 0, max: 255 })), { minLength: 1, maxLength: 6 }), (edits) => {
      const bytes = Buffer.from(valid);
      for (const [at, value] of edits) bytes[at] = value;
      try {
        for (const entry of readZip(bytes)) expect(unsafeZipEntryName(entry.path)).toBe(false);
      } catch (error) { expect(error, String(error)).toBeInstanceOf(ZipError); }
    }), options);
  });

  it('rejects zip-slip entry names', () => {
    for (const name of ['../evil.txt', 'scan/../../evil.txt', '/etc/passwd', 'C:/Windows/evil', 'scan\\..\\evil.txt', './manifest.json', 'a//b', '..']) {
      expect(() => readZip(rawZip(name, Buffer.from('pwned'))), name).toThrow(/Unsafe zip entry name/);
    }
  });

  it('rejects an entry declaring 1 GB without inflating it', () => {
    // Real deflate stream of 4 MB zeros, labelled as 1 GB: rejected on the declared size, before any inflation.
    const bomb = rawZip('scan/a11ygate-scan.json', Buffer.alloc(4 * 1024 * 1024), { declaredSize: 1024 * 1024 * 1024 });
    expect(bomb.length).toBeLessThan(64 * 1024);
    expect(() => readZip(bomb)).toThrow('declares 1073741824 bytes; the limit is 67108864 bytes per entry');
    // An entry that lies low about its size cannot expand past the declared size either.
    const liar = rawZip('scan/a11ygate-scan.json', Buffer.alloc(4 * 1024 * 1024), { declaredSize: 10 });
    expect(() => readZip(liar)).toThrow(ZipError);
  });

  it('a11ygate trend skips zip-slip and oversize packs with a warning naming the file and writes nothing for them', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'a11ygate-r61-'));
    const packs = path.join(root, 'packs');
    try {
      await mkdir(packs);
      await writeFile(path.join(packs, 'slip.zip'), rawZip('../escaped.txt', Buffer.from('pwned')));
      await writeFile(path.join(packs, 'bomb.zip'), rawZip('manifest.json', Buffer.alloc(1024 * 1024), { declaredSize: 1024 * 1024 * 1024 }));
      await writeFile(path.join(packs, 'junk.zip'), Buffer.from('PK\u0005\u0006 not really'));
      let err = '';
      const code = await runTrend(['packs'], { cwd: root, stdout: () => {}, stderr: (s) => { err += s; } });
      expect(code).toBe(2);
      expect(err).toContain('Skipped slip.zip: Unsafe zip entry name "../escaped.txt"');
      expect(err).toContain('Skipped bomb.zip: Zip entry "manifest.json" declares 1073741824 bytes');
      expect(err).toContain('Skipped junk.zip: ');
      expect(err).not.toMatch(STACK_LINE);
      expect((await readdir(root)).sort()).toEqual(['packs']);
      expect((await readdir(packs)).sort()).toEqual(['bomb.zip', 'junk.zip', 'slip.zip']);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

describe('--debug', () => {
  it('prints only the message by default and the stack with --debug or A11YGATE_DEBUG=1', () => {
    const error = new Error('boom');
    expect(formatFatal(error, false)).toBe('boom\nRun again with --debug for details.\n');
    expect(formatFatal(error, true)).toMatch(/^Error: boom\n\s+at /);
    expect(debugRequested(['scan', '--debug'], {})).toBe(true);
    expect(debugRequested(['scan'], { A11YGATE_DEBUG: '1' })).toBe(true);
    expect(debugRequested(['scan'], {})).toBe(false);
    expect(stripDebugFlag(['scan', '--debug', 'https://site.test'])).toEqual(['scan', 'https://site.test']);
  });
  it('debugDetail is empty by default and shows the stack and cause chain with --debug', () => {
    const error = new Error('state.json: field cookies[0].domain must be a non-empty string.', { cause: new Error('inner cause') });
    try {
      expect(debugDetail(error)).toBe('');
      setDebug(true);
      const detail = debugDetail(error);
      expect(detail).toMatch(/^Error: state\.json: field cookies\[0\]\.domain[^\n]*\n\s+at /);
      expect(detail).toMatch(/\nCaused by: Error: inner cause\n\s+at /);
    } finally { setDebug(false); }
  });
  it('the built CLI hides the stack for a caught input error by default and shows it with --debug', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'a11ygate-r61-'));
    const cli = path.resolve('packages/cli/dist/cli.mjs');
    const runCli = async (args: string[]) => {
      const env = { ...process.env, A11YGATE_DEBUG: '' };
      try { await promisify(execFile)(process.execPath, [cli, ...args], { cwd: dir, env, timeout: 30_000 }); return { code: 0, stderr: '' }; }
      catch (error) { const e = error as { code: number; stderr: string }; return { code: e.code, stderr: e.stderr }; }
    };
    try {
      await writeFile(path.join(dir, 'state.json'), JSON.stringify({ cookies: [{ name: 'sid', value: 'do-not-echo-123', domain: 123, path: '/' }] }));
      const plain = await runCli(['scan', 'http://127.0.0.1:1/', '--storage-state', 'state.json']);
      expect(plain.code).toBe(2);
      expect(plain.stderr).toContain('state.json: field cookies[0].domain must be a non-empty string');
      expect(plain.stderr).not.toMatch(STACK_LINE);
      const debug = await runCli(['scan', 'http://127.0.0.1:1/', '--storage-state', 'state.json', '--debug']);
      expect(debug.code).toBe(2);
      expect(debug.stderr).toContain('state.json: field cookies[0].domain must be a non-empty string');
      expect(debug.stderr).toMatch(STACK_LINE);
      expect(debug.stderr).toContain('Caused by: ');
      for (const out of [plain.stderr, debug.stderr]) expect(out).not.toContain('do-not-echo-123');
      const missing = await runCli(['scan', 'http://127.0.0.1:1/', '--storage-state', 'nope.json', '--debug']);
      expect(missing.stderr).toContain('nope.json: file not found');
      expect(missing.stderr).toMatch(STACK_LINE);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 60_000);
});

let started = 0;
beforeAll(() => { started = Date.now(); });
afterAll(() => { expect(Date.now() - started).toBeLessThan(60_000); });
