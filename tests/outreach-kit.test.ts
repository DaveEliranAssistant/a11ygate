import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import pricing from '@/config/pricing.json';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { esc } from '@/lib/scan/report-html-v2';
import type { AxeResults } from '@/lib/types';
import { CI_FILES, type CiTarget } from '@/packages/cli/src/ci-targets';
import { runOutreach } from '@/packages/cli/src/outreach';
import { runProspect } from '@/packages/cli/src/prospect';
import { run } from '@/packages/cli/src/run';
import { blockNetwork } from './network-guard';

vi.mock('@/packages/cli/src/report-pdf', async (load) => ({
  ...await load<typeof import('@/packages/cli/src/report-pdf')>(),
  printProspectPdf: vi.fn(async () => Buffer.from(AUTOMATED_TESTING_DISCLAIMER)),
}));

const fixturePath = path.resolve('tests/fixtures/outreach/prospect.example.yml');
const draftDir = path.resolve('docs/pilot/outreach');
const resultFiles = ['manifest.json', 'one-pager.html', 'one-pager.pdf', 'sample-results.html'];
const execute = promisify(execFile);
const stdout = vi.fn();
const stderr = vi.fn();
let cwd: string;
let home: string;
let fixture: string;
let io: { cwd: string; stdout: typeof stdout; stderr: typeof stderr };
let network: ReturnType<typeof blockNetwork>;

beforeEach(async () => {
  cwd = await mkdtemp(path.join(os.tmpdir(), 'a11ygate-outreach-'));
  home = path.join(cwd, 'home');
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
  vi.spyOn(os, 'homedir').mockReturnValue(home);
  fixture = await readFile(fixturePath, 'utf8');
  stdout.mockClear();
  stderr.mockClear();
  io = { cwd, stdout, stderr };
  network = blockNetwork();
});

afterEach(async () => {
  network.restore();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(cwd, { recursive: true, force: true });
  expect(network.attempts).toEqual([]);
});

const kit = (...args: string[]) => run(['outreach', 'kit', ...args], io);

it('(a, g) generates every draft and output at the default location without network attempts', async () => {
  expect(await kit('--prospect', fixturePath), JSON.stringify(stderr.mock.calls)).toBe(0);
  const output = path.join(home, 'a11ygate-prospects', 'example-widgets-ltd');
  const drafts = (await readdir(draftDir)).filter(name => name !== 'README.md');
  expect((await readdir(output)).sort()).toEqual([...drafts, ...resultFiles].sort());
  for (const name of [...drafts, ...resultFiles]) {
    const content = await readFile(path.join(output, name), 'utf8');
    expect(content, name).toContain(AUTOMATED_TESTING_DISCLAIMER);
    expect(content, name).not.toContain('{{');
    if (drafts.includes(name)) {
      expect(content).toContain('Eliran sends this himself. Review before sending.');
      expect(content).toContain('[[HE: Eliran to write]]');
    }
    if (name.endsWith('.html')) expect(content).not.toMatch(/<(?:link|script|img)\b/i);
  }
  expect(await readFile(path.join(output, 'warm-intro-request.md'), 'utf8')).toContain('Ask the fictional platform team');
  expect(await readFile(path.join(output, 'sample-results.html'), 'utf8')).toContain('Sample from our demo app, not your site');
  expect(await readFile(path.join(output, 'one-pager.html'), 'utf8')).toContain(`USD ${pricing.priceUsdPerYear} per year`);
  expect(JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'))).toMatchObject({
    config: pricing, realSiteData: false, authorizedBy: null, inputsHash: expect.stringMatching(/^[a-f0-9]{64}$/),
  });

  const changed = { ...pricing, priceUsdPerYear: 1345, pilot: { ...pricing.pilot, lengthDays: 29 } };
  expect(await runOutreach(['kit', '--prospect', fixturePath, '--out-dir', 'changed'], io, changed)).toBe(0);
  const changedHtml = await readFile(path.join(cwd, 'changed/one-pager.html'), 'utf8');
  expect(changedHtml).toContain('USD 1345 per year');
  expect(changedHtml).toContain('free 29-day pilot');
  const proposal = await readFile(path.join(cwd, 'changed/pilot-proposal.md'), 'utf8');
  expect(proposal).toContain('USD 1345 per year');
  expect(proposal).toContain('Dates: 29 days');
});

it.each([
  ['missing source', ''],
  ['non-HTTP source', 'why_now_source: ftp://example.com/source'],
  ['invalid HTTP source', 'why_now_source: https://:123'],
])('(b) rejects a %s', async (_, source) => {
  const profile = path.join(cwd, 'bad.yml');
  await writeFile(profile, fixture.replace(/^why_now_source: .*$/m, source));
  expect(await kit('--prospect', profile)).toBe(2);
  expect(stderr).toHaveBeenCalledWith(expect.stringContaining('why_now_source'));
  expect(await readdir(cwd)).toEqual(['bad.yml']);
});

it('(c) refuses git work tree paths including symlink aliases and defaults inside a checkout', async () => {
  const repo = path.join(cwd, 'repo');
  await mkdir(repo);
  await execute('git', ['init', '--quiet', repo]);
  const alias = path.join(cwd, 'alias');
  await symlink(repo, alias, 'dir');
  for (const output of ['repo/nested/kit', 'alias/nested/kit']) {
    expect(await kit('--prospect', fixturePath, '--out-dir', output)).toBe(2);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('inside a git work tree'));
  }
  vi.stubEnv('HOME', repo);
  vi.mocked(os.homedir).mockReturnValue(repo);
  expect(await kit('--prospect', fixturePath)).toBe(2);
  expect(await readdir(repo)).toEqual(['.git']);

  expect(await kit('--prospect', fixturePath, '--out-dir', 'alias/nested/kit', '--allow-in-repo')).toBe(0);
  expect(await readFile(path.join(repo, 'nested/kit/.gitignore'), 'utf8')).toBe('*\n');
  await expect(execute('git', ['-C', repo, 'check-ignore', 'nested/kit/manifest.json'])).resolves.toMatchObject({
    stdout: 'nested/kit/manifest.json\n',
  });
  await execute('git', ['-C', repo, 'add', '-f', 'nested/kit/manifest.json']);
  expect(await kit('--prospect', fixturePath, '--out-dir', 'repo/nested/kit', '--allow-in-repo')).toBe(2);
  expect(stderr).toHaveBeenCalledWith(expect.stringContaining('overwrite a tracked file'));
});

describe('saved scan evidence', () => {
  const site = 'https://example.org/';
  const stamp = '2026-11-12T12:00:00.000Z';
  const result: AxeResults = {
    url: site, timestamp: stamp, testEngine: { version: '4.14.0' },
    violations: [{
      id: 'image-alt', impact: 'serious', tags: ['wcag111'], help: 'Images need text alternatives', helpUrl: '',
      nodes: [{ target: ['img'], html: '<img>' }],
    }],
  };

  it('(d) rejects a non-own host without both manifest approval fields before writing anything', async () => {
    const scanDir = path.join(cwd, 'scan');
    await mkdir(scanDir);
    await writeFile(path.join(scanDir, 'prospect-manifest.json'), JSON.stringify({
      schemaVersion: 1, source: 'url', startUrl: site, scannedAt: stamp, authorizedBy: null, authorizationNote: 'Fictional note only',
    }));
    const profile = path.join(cwd, 'with-approval.yml');
    await writeFile(profile, fixture + 'authorized_by: Example site owner\nauthorization_note: Fictional profile approval\n');
    expect(await kit('--prospect', profile, '--scan-dir', scanDir, '--out-dir', 'kit')).toBe(2);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('both authorizedBy and authorizationNote'));
    expect((await readdir(cwd)).sort()).toEqual(['scan', 'with-approval.yml']);
  });

  it('accepts an own-host export without an approval record', async () => {
    const ownSite = 'http://localhost/';
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    const visit = vi.fn().mockResolvedValue({ status: 200, finalUrl: ownSite, links: [], result: { ...result, url: ownSite } });
    expect(await runProspect([ownSite, '--out-dir', 'scan', '--outreach-data'], {
      ...io, fetch, now: () => new Date(stamp), engine: async () => ({ visit, close: async () => {} }),
    }), JSON.stringify(stderr.mock.calls)).toBe(0);
    expect(await kit('--prospect', fixturePath, '--scan-dir', 'scan', '--out-dir', 'kit')).toBe(0);
    expect(JSON.parse(await readFile(path.join(cwd, 'kit/manifest.json'), 'utf8'))).toMatchObject({
      realSiteData: true, authorizedBy: null, authorizationNote: null,
    });
  });

  it('uses the opt-in export from an approved prospect run and rejects a changed scan', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    const visit = vi.fn().mockResolvedValue({ status: 200, finalUrl: site, links: [], result });
    expect(await runProspect([site, '--authorized-by', 'Example site owner', '--authorization-note', 'Fictional scope',
      '--out-dir', 'scan', '--outreach-data'], {
      ...io, fetch, now: () => new Date(stamp), engine: async () => ({ visit, close: async () => {} }),
    }), JSON.stringify(stderr.mock.calls)).toBe(0);
    expect(await kit('--prospect', fixturePath, '--scan-dir', 'scan', '--out-dir', 'kit')).toBe(0);
    const sample = await readFile(path.join(cwd, 'kit/sample-results.html'), 'utf8');
    expect(sample).toContain('https://example.org/');
    expect(sample).toContain('image-alt');
    expect(sample).not.toContain('Sample from our demo app');
    expect(JSON.parse(await readFile(path.join(cwd, 'kit/manifest.json'), 'utf8'))).toMatchObject({
      realSiteData: true, authorizedBy: 'Example site owner', authorizationNote: 'Fictional scope',
      inputs: { scanSha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
    });
    const scan = path.join(cwd, 'scan/a11ygate-scan.json');
    await writeFile(scan, (await readFile(scan, 'utf8')) + '\n');
    expect(await kit('--prospect', fixturePath, '--scan-dir', 'scan', '--out-dir', 'changed')).toBe(2);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('does not match the digest'));
  });
});

it.each(Object.keys(CI_FILES) as CiTarget[])('(e) embeds the exact default %s init starter', async target => {
  const profile = path.join(cwd, 'profile.yml');
  await writeFile(profile, fixture.replace('ci_system: github', `ci_system: ${target}`));
  expect(await run(['init', '--yes', '--target', target], io)).toBe(0);
  expect(await kit('--prospect', profile, '--out-dir', 'kit')).toBe(0);
  const html = await readFile(path.join(cwd, 'kit/one-pager.html'), 'utf8');
  const starter = await readFile(path.join(cwd, CI_FILES[target]), 'utf8');
  expect(html).toContain(`<pre><code>${esc(starter).replaceAll('{', '&#123;')}</code></pre>`);
});

it('links to integration guides for other CI systems', async () => {
  const profile = path.join(cwd, 'profile.yml');
  await writeFile(profile, fixture.replace('ci_system: github', 'ci_system: other'));
  expect(await kit('--prospect', profile, '--out-dir', 'kit')).toBe(0);
  const html = await readFile(path.join(cwd, 'kit/one-pager.html'), 'utf8');
  expect(html).toContain('docs/integrations');
  expect(html).not.toContain('<pre>');
});
