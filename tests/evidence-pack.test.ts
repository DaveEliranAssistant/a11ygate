import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AUTOMATED_LIMITS, buildEvidencePack, COMMIT_UNAVAILABLE_NOTE, EVIDENCE_DISCLAIMER, frontPageHtml, frontPageMarkdown, sha256, type EvidenceManifest } from '@/lib/evidence/pack';
import { createZip, readZip } from '@/lib/evidence/zip';
import type { VisitOutcome } from '@/lib/scan/crawl';
import type { AxeResults } from '@/lib/types';
import { parseEvidenceArgs, runEvidence } from '@/packages/cli/src/evidence';
import { run } from '@/packages/cli/src/run';
import { runScan, type ScanEngineFactory } from '@/packages/cli/src/scan';

const ORIGIN = 'https://site.test';
const SCANNED_AT = new Date('2026-11-12T10:00:00+02:00'); // non-UTC input; must be recorded as UTC
const SHA = 'a958d7d0123456789abcdef0123456789abcdef0';
const CONTRAST = { id: 'color-contrast', impact: 'serious' as const, tags: ['wcag2aa', 'wcag143'], help: 'Contrast', helpUrl: 'https://dequeuniversity.com/rules/axe/4.14/color-contrast', nodes: [{ target: ['p.faint'], html: '<p class="faint">x</p>' }] };
const IMAGE_ALT = { id: 'image-alt', impact: 'critical' as const, tags: ['wcag2a', 'wcag111'], help: 'Images must have alternative text', helpUrl: 'https://dequeuniversity.com/rules/axe/4.14/image-alt', nodes: [{ target: ['img'], html: '<img src="a.png">' }] };
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a2f40000000049454e44ae426082', 'hex');

function axeResult(url: string, violations: AxeResults['violations']): AxeResults {
  return { url, timestamp: '2026-11-12T08:00:00.000Z', testEngine: { version: '4.14.0' }, violations, toolOptions: {}, scanConfig: {}, scanStatus: 'complete' };
}

/** Local fake site; no browser, no network. */
const engine: ScanEngineFactory = async () => ({
  axeVersion: '4.14.0',
  visit: async (url: string): Promise<VisitOutcome> => {
    const { pathname } = new URL(url);
    if (pathname === '/') return { status: 200, finalUrl: url, links: [`${ORIGIN}/about`], result: axeResult(url, [CONTRAST]) };
    if (pathname === '/about') return { status: 200, finalUrl: url, links: [], result: axeResult(url, [IMAGE_ALT]) };
    return { status: 404, finalUrl: url, links: [], error: 'HTTP 404' };
  },
  close: async () => undefined,
});

const quiet = { stdout: () => undefined, stderr: () => undefined };
let dir: string;

async function scanFixture(formats = 'sarif,junit'): Promise<string> {
  const code = await runScan([ORIGIN, '--crawl', '2', '--out-dir', 'out', '--format', formats, '--fail-on', 'none'], {
    ...quiet, cwd: dir, version: '0.1.0', now: () => SCANNED_AT, engine, sleep: async () => undefined,
    fetch: async () => ({ ok: false, status: 404, text: async () => '' }),
  });
  expect(code).toBe(0);
  const out = path.join(dir, 'out');
  await mkdir(path.join(out, 'screenshots'), { recursive: true });
  await writeFile(path.join(out, 'screenshots', 'home.png'), PNG);
  return out;
}

async function pack(args: string[], now = new Date('2026-11-14T09:30:00Z'), env: Record<string, string> = {}) {
  let err = '';
  const code = await runEvidence(['pack', '--from', 'out', ...args], {
    cwd: dir, stdout: () => undefined, stderr: (c) => { err += c; }, now: () => now, version: '0.1.0', gitHead: async () => null, env,
  });
  return { code, err };
}

async function entries(file = 'out/a11ygate-evidence.zip') {
  const zip = readZip(await readFile(path.join(dir, file)));
  return new Map(zip.map((e) => [e.path, Buffer.from(e.data)]));
}

function manifestOf(map: Map<string, Buffer>): EvidenceManifest {
  return JSON.parse(map.get('manifest.json')!.toString('utf8')) as EvidenceManifest;
}

beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'a11ygate-evidence-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('zip writer', () => {
  it('round-trips stored and deflated entries', () => {
    const zip = createZip([{ path: 'a.txt', data: Buffer.from('hello hello hello') }, { path: 'img/x.png', data: PNG }]);
    expect(readZip(zip).map((e) => [e.path, Buffer.from(e.data).toString('hex')])).toEqual([
      ['a.txt', Buffer.from('hello hello hello').toString('hex')], ['img/x.png', PNG.toString('hex')],
    ]);
    expect(() => createZip([{ path: '../evil', data: Buffer.alloc(0) }])).toThrow(/Unsafe/);
  });
});

describe('a11ygate evidence pack', () => {
  it('writes the required layout from a local scan output directory', async () => {
    await scanFixture();
    expect((await pack(['--commit', SHA])).code).toBe(0);
    const map = await entries();
    expect([...map.keys()]).toEqual([
      'manifest.json', 'report.md', 'report.html',
      'engines/axe.json', 'scan/a11ygate-scan.html', 'scan/a11ygate-scan.json', 'scan/a11ygate-scan.junit.xml',
      'scan/a11ygate-scan.md', 'scan/a11ygate-scan.sarif', 'screenshots/home.png',
    ]);
    const manifest = manifestOf(map);
    expect(manifest).toMatchObject({
      tool: 'a11ygate', kind: 'evidence-pack', toolVersion: '0.1.0', commit: { sha: SHA, source: 'flag' },
      timestamps: { timezone: 'UTC', packedAt: '2026-11-14T09:30:00.000Z', scannedAt: '2026-11-12T08:00:00.000Z' },
      scope: { startUrl: `${ORIGIN}/`, pagesScanned: 2 },
      engines: [{ id: 'axe', version: '4.14.0', ruleSet: { version: '4.14.0', tags: expect.arrayContaining(['wcag2aa']) } }],
      disclaimer: EVIDENCE_DISCLAIMER,
    });
    for (const stamp of Object.values(manifest.timestamps)) if (stamp !== 'UTC' && stamp) expect(stamp).toMatch(/Z$/);
    // Copied files keep their original bytes.
    expect(map.get('scan/a11ygate-scan.sarif')!.equals(await readFile(path.join(dir, 'out/a11ygate-scan.sarif')))).toBe(true);
    expect(map.get('screenshots/home.png')!.equals(PNG)).toBe(true);
  });

  it('(a) manifest SHA-256 hashes match every file in the pack', async () => {
    await scanFixture();
    expect((await pack([])).code).toBe(0);
    const map = await entries();
    const manifest = manifestOf(map);
    const listed = manifest.files.map((f) => f.path).sort();
    expect(listed).toEqual([...map.keys()].filter((p) => p !== 'manifest.json').sort());
    for (const file of manifest.files) {
      const data = map.get(file.path)!;
      expect(file.sha256).toBe(sha256(data));
      expect(file.bytes).toBe(data.length);
    }
    // Tampering is detectable.
    expect(sha256(Buffer.concat([map.get('report.md')!, Buffer.from(' ')]))).not.toBe(manifest.files.find((f) => f.path === 'report.md')!.sha256);
  });

  it('(b) re-packing the same inputs is deterministic except timestamps', async () => {
    await scanFixture();
    expect((await pack(['--out', 'one.zip', '--commit', SHA], new Date('2026-11-14T09:30:00Z'))).code).toBe(0);
    expect((await pack(['--out', 'two.zip', '--commit', SHA], new Date('2026-12-01T23:59:59Z'))).code).toBe(0);
    const [one, two] = [await entries('one.zip'), await entries('two.zip')];
    expect([...one.keys()]).toEqual([...two.keys()]);
    for (const [name, data] of one) if (name !== 'manifest.json') expect(data.equals(two.get(name)!), name).toBe(true);
    const strip = (m: EvidenceManifest) => ({ ...m, timestamps: { ...m.timestamps, packedAt: '<packedAt>' } });
    expect(manifestOf(one).timestamps.packedAt).not.toBe(manifestOf(two).timestamps.packedAt);
    expect(strip(manifestOf(one))).toEqual(strip(manifestOf(two)));
    // Same timestamp => byte-identical archive.
    expect((await pack(['--out', 'three.zip', '--commit', SHA], new Date('2026-11-14T09:30:00Z'))).code).toBe(0);
    expect((await readFile(path.join(dir, 'one.zip'))).equals(await readFile(path.join(dir, 'three.zip')))).toBe(true);
  });

  it('(c) front page always has scope, the automated-testing limits section and the disclaimer', async () => {
    await scanFixture('json');
    expect((await pack([])).code).toBe(0);
    const map = await entries();
    const md = map.get('report.md')!.toString('utf8');
    const html = map.get('report.html')!.toString('utf8');
    for (const text of [md, html]) {
      expect(text).toContain('Scope scanned');
      expect(text).toContain('What automated testing cannot cover');
      expect(text).toContain('Automated testing only. Not a WCAG audit, certification or legal advice.');
      for (const item of AUTOMATED_LIMITS) expect(text).toContain(item.replace(/&/g, '&amp;'));
      expect(text).not.toMatch(/\bcertified\b|WCAG compliant|EAA compliant|guarantee|fixes everything/i);
    }
    // SARIF and JUnit are generated from the scan JSON when the scan did not write them.
    expect(map.has('scan/a11ygate-scan.sarif') && map.has('scan/a11ygate-scan.junit.xml')).toBe(true);
    expect(manifestOf(map).files.find((f) => f.path === 'scan/a11ygate-scan.sarif')!.source).toBe('generated');
    expect(md).toMatchSnapshot('report.md');
    expect(html).toMatchSnapshot('report.html');
  });

  it('(c) the limits section and disclaimer survive an empty scan', () => {
    const report = { tool: 'a11ygate', kind: 'site-scan', schemaVersion: 1, version: '0.1.0', axeVersion: null, scannedAt: '', startUrl: 'https://x.test/', origin: 'https://x.test', verdict: 'PASS', failOn: 'none', reason: '', options: { maxPages: 1, delayMs: 0, tags: [], userAgent: '', robots: '' }, counts: { pagesScanned: 0, pagesFailed: 0, skippedLinks: 0, findings: 0, byImpact: { critical: 0, serious: 0, moderate: 0, minor: 0, unknown: 0 } }, pages: [], skipped: [], findings: [], boundaries: [], results: [] } as const;
    const input = { report: report as never, engines: [], commit: { sha: null, source: 'unavailable' as const, note: COMMIT_UNAVAILABLE_NOTE }, contents: [] };
    for (const text of [frontPageMarkdown(input), frontPageHtml(input)]) {
      expect(text).toContain('What automated testing cannot cover');
      expect(text).toContain(EVIDENCE_DISCLAIMER);
      expect(text).toContain('unavailable');
    }
  });

  it('(d) never includes .env files, credentials, tokens or environment values', async () => {
    const out = await scanFixture();
    const secretValue = 'zz-super-secret-value-123456';
    await writeFile(path.join(out, '.env'), `API_TOKEN=${secretValue}\n`);
    await writeFile(path.join(out, '.env.local'), `SECRET=${secretValue}\n`);
    await writeFile(path.join(out, 'credentials.json'), JSON.stringify({ token: secretValue }));
    await writeFile(path.join(out, 'token.txt'), secretValue);
    await writeFile(path.join(out, 'engines', 'env.json'), JSON.stringify({ env: { API_TOKEN: secretValue } }));
    await writeFile(path.join(out, 'screenshots', '.env.png'), secretValue);
    await writeFile(path.join(out, 'screenshots', 'fake.png'), secretValue); // not an image: skipped
    const env = { A11YGATE_TEST_API_TOKEN: 'env-only-token-value-987654', HOME: '/home/someone', PATH: '/usr/bin' };
    expect((await pack([], undefined, env)).code).toBe(0);
    const zip = await readFile(path.join(dir, 'out/a11ygate-evidence.zip'));
    const map = await entries();
    const haystacks = [zip.toString('latin1'), ...[...map.values()].map((d) => d.toString('utf8'))];
    for (const text of haystacks) {
      for (const needle of [secretValue, env.A11YGATE_TEST_API_TOKEN, 'API_TOKEN', '.env', 'credentials.json', 'token.txt', '/home/someone', 'A11YGATE_TEST']) {
        expect(text).not.toContain(needle);
      }
      expect(text).not.toMatch(/ghp_[A-Za-z0-9]{30,}|github_pat_|AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY/);
    }
    expect([...map.keys()].every((p) => /^(manifest\.json|report\.(md|html)|scan\/a11ygate-scan\.[a-z.]+|engines\/(axe|htmlcs|ibm|lighthouse)\.json|screenshots\/[A-Za-z0-9][\w.-]*\.(png|jpe?g|webp))$/.test(p))).toBe(true);
  });

  it('(d) refuses to pack when an included file holds a credential or a secret env value', async () => {
    const out = await scanFixture();
    const axe = path.join(out, 'engines', 'axe.json');
    const original = await readFile(axe, 'utf8');
    await writeFile(axe, JSON.stringify({ leaked: 'ghp_' + 'a'.repeat(36) }));
    let result = await pack([]);
    expect(result.code).toBe(2);
    expect(result.err).toContain('engines/axe.json: GitHub token');
    expect(result.err).not.toContain('a'.repeat(36));
    await writeFile(axe, original.replace('Contrast', 'Contrast env-only-token-value-987654'));
    result = await pack([], undefined, { MY_API_TOKEN: 'env-only-token-value-987654' });
    expect(result.code).toBe(2);
    expect(result.err).toContain('secret environment variable');
    expect(result.err).not.toContain('env-only-token-value-987654');
  });

  it('records an unavailable commit SHA instead of inventing one', async () => {
    await scanFixture();
    const { code, err } = await pack([]);
    expect(code).toBe(0);
    expect(err).toContain('commit SHA unavailable');
    const map = await entries();
    expect(manifestOf(map).commit).toEqual({ sha: null, source: 'unavailable', note: COMMIT_UNAVAILABLE_NOTE });
    expect(map.get('report.md')!.toString('utf8')).toContain('Commit: unavailable');
  });

  it('uses git HEAD when available', async () => {
    await scanFixture();
    expect(await runEvidence(['pack', '--from', 'out'], { ...quiet, cwd: dir, version: '0.1.0', gitHead: async () => SHA, env: {} })).toBe(0);
    expect(manifestOf(await entries()).commit).toEqual({ sha: SHA, source: 'git' });
  });

  it('validates arguments and missing scan output', async () => {
    expect(parseEvidenceArgs([])).toMatchObject({ ok: false });
    expect(parseEvidenceArgs(['pack'])).toMatchObject({ ok: false, error: expect.stringContaining('--from') });
    expect(parseEvidenceArgs(['pack', '--from', 'o', '--commit', 'not-a-sha'])).toMatchObject({ ok: false });
    expect(parseEvidenceArgs(['pack', '--from', 'o', '--out', 'x.tar'])).toMatchObject({ ok: false });
    expect(parseEvidenceArgs(['pack', '--from=o', '--out=x.zip'])).toMatchObject({ ok: true, options: { from: 'o', out: 'x.zip' } });
    expect((await pack([])).code).toBe(2);
    expect(buildEvidencePack({ scanJson: '{}', files: [], toolVersion: '0.1.0', commit: { sha: SHA, source: 'flag' }, packedAt: new Date() })).toMatchObject({ ok: false });
  });

  it('is reachable as the evidence subcommand', async () => {
    let out = '';
    expect(await run(['evidence', '--help'], { stdout: (c) => { out += c; } })).toBe(0);
    expect(out).toContain('a11ygate evidence pack --from');
    expect(out).toContain(EVIDENCE_DISCLAIMER);
  });
});
