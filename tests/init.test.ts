import { mkdtemp, readFile, writeFile, rm, mkdir, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { run } from '@/packages/cli/src/run';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { buildScanReport } from '@/lib/scan/report';

async function temporary(work: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'a11ygate-init-'));
  try { await work(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}
function capture(cwd: string) {
  let stdout = '', stderr = '';
  return { io: { cwd, stdout: (s: string) => { stdout += s; }, stderr: (s: string) => { stderr += s; } }, out: () => stdout, err: () => stderr };
}
const ciPath = (target: string) => target === 'github' ? '.github/workflows/a11ygate.yml' : 'Jenkinsfile';
const read = (cwd: string, file: string) => readFile(path.join(cwd, file), 'utf8');

function report() {
  return buildScanReport({ crawl: { pages: [{ url: 'http://127.0.0.1:4173/', finalUrl: 'http://127.0.0.1:4173/', status: 200, scanStatus: 'complete', result: { url: 'http://127.0.0.1:4173/', testEngine: { version: '4.11.1' }, timestamp: '2026-11-14T00:00:00Z', violations: [] } }], skipped: [] }, version: '0.1.0', scannedAt: '2026-11-14T00:00:00Z', startUrl: 'http://127.0.0.1:4173/', failOn: 'serious', maxPages: 1, delayMs: 0, userAgent: 'fixture', robotsNote: 'fixture' });
}

describe('a11ygate init', () => {
  for (const target of ['github', 'jenkins']) {
    it(`snapshots the ${target} starter files`, async () => temporary(async (cwd) => {
      const { io, out } = capture(cwd);
      expect(await run(['init', '--yes', '--target', target], io)).toBe(0);
      await expect(await read(cwd, '.a11ygate.yml')).toMatchFileSnapshot(`fixtures/init/${target}/.a11ygate.yml`);
      await expect(await read(cwd, ciPath(target))).toMatchFileSnapshot(`fixtures/init/${target}/${target === 'github' ? 'a11ygate.yml' : 'Jenkinsfile'}`);
      expect(out()).toContain(AUTOMATED_TESTING_DISCLAIMER);
    }));

    it(`preserves existing ${target} files and timestamps on rerun, replaces only with --force`, async () => temporary(async (cwd) => {
      const { io, out } = capture(cwd);
      const argv = ['init', '--yes', '--target', target];
      expect(await run(argv, io)).toBe(0);
      const files = ['.a11ygate.yml', ciPath(target)];
      await writeFile(path.join(cwd, files[0]!), '# custom configuration\n');
      await writeFile(path.join(cwd, files[1]!), '# custom CI\n');
      const before = await Promise.all(files.map(async (file) => ({ text: await read(cwd, file), mtime: (await stat(path.join(cwd, file))).mtimeMs })));
      expect(await run([...argv, '--url', 'http://127.0.0.1:9999/'], io)).toBe(0);
      for (const [i, file] of files.entries()) {
        expect(await read(cwd, file)).toBe(before[i]!.text);
        expect((await stat(path.join(cwd, file))).mtimeMs).toBe(before[i]!.mtime);
      }
      expect(out()).toContain('Skipped existing');
      expect(await run([...argv, '--force', '--url', 'http://127.0.0.1:9999/', '--crawl', '0', '--fail-on', 'critical'], io)).toBe(0);
      expect(await read(cwd, files[0]!)).toContain('failOn: critical');
      expect(await read(cwd, files[1]!)).toContain('http://127.0.0.1:9999/');
      expect(await read(cwd, files[1]!)).not.toContain('--crawl');
    }));

    it(`applies flags and safe URL data for ${target}`, async () => temporary(async (cwd) => {
      const { io } = capture(cwd);
      const url = 'http://127.0.0.1:5000/path?q=a%27b&x=1#fragment';
      expect(await run(['init', '--yes', '--target', target, '--url', url, '--crawl', '3', '--fail-on', 'none'], io)).toBe(0);
      const config = await read(cwd, '.a11ygate.yml');
      const ci = await read(cwd, ciPath(target));
      expect(config).toContain(`url: ${JSON.stringify(url)}`);
      expect(config).toContain('crawl: 3');
      expect(config).toContain('failOn: none');
      expect(ci).toContain(url);
      expect(ci).toContain(target === 'github' ? '--crawl 3 --fail-on none' : 'crawl: 3,');
      if (target === 'jenkins') expect(ci).toContain("choices: ['none', 'serious'");
    }));
  }

  it('keeps default Jenkins output identical to the canonical example', async () => temporary(async (cwd) => {
    expect(await run(['init', '--yes', '--target', 'jenkins'], capture(cwd).io)).toBe(0);
    expect(await read(cwd, 'Jenkinsfile')).toBe(await readFile('examples/jenkins/Jenkinsfile', 'utf8'));
  }));

  it('enforces R13 checkout, permissions, event and authorized-target invariants', async () => temporary(async (cwd) => {
    expect(await run(['init', '--yes'], capture(cwd).io)).toBe(0);
    const ci = await read(cwd, ciPath('github'));
    expect(ci).toMatch(/uses: actions\/checkout@v4\n\s+with:\n\s+ref: \$\{\{ github.event.pull_request.head.sha \}\}/);
    const permissions = /^permissions:\n((?: {2}.+\n)+)/m.exec(ci)?.[1];
    const canonical = await readFile('examples/github-action/a11ygate.yml', 'utf8');
    const scopes = (text: string) => [...text.matchAll(/^ {2}([\w-]+): (read|write)/gm)].map((match) => `${match[1]}:${match[2]}`);
    expect(scopes(permissions!)).toEqual(scopes(canonical));
    expect(ci).toContain('on:\n  pull_request:');
    expect(ci).not.toContain('pull_request_target');
    expect(ci).not.toMatch(/example\.(com|org|net)/);
    expect([...ci.matchAll(/https?:\/\/([^/\s:]+)/g)].map((match) => match[1])).toEqual(['127.0.0.1']);
    expect(ci).toContain('"$A11YGATE_URL"');
    expect(ci).toContain(AUTOMATED_TESTING_DISCLAIMER);
    expect(ci).not.toMatch(/\bcertified\b|WCAG compliant|fixes everything/i);
    expect(ci).toContain('a11ygate-scan.sarif');
  }));

  it('creates an opted-in baseline offline and passes it to each target', async () => temporary(async (cwd) => {
    await writeFile(path.join(cwd, 'scan.json'), JSON.stringify(report()));
    const { io, out } = capture(cwd);
    expect(await run(['init', '--yes', '--baseline', 'scan.json'], io)).toBe(0);
    const baseline = await read(cwd, '.a11ygate-baseline.json');
    expect(JSON.parse(baseline)).toMatchObject({ kind: 'a11ygate-fingerprint-baseline', findings: [] });
    expect(await read(cwd, ciPath('github'))).toContain('--baseline .a11ygate-baseline.json');
    // Re-running with an opted-in baseline keeps accepted evidence, even with --force.
    expect(await run(['init', '--yes', '--force', '--target', 'jenkins', '--baseline', 'scan.json'], io)).toBe(0);
    expect(await read(cwd, 'Jenkinsfile')).toContain("baseline: '.a11ygate-baseline.json'");
    await expect(await read(cwd, 'Jenkinsfile')).toMatchFileSnapshot('fixtures/init/jenkins/Jenkinsfile.baseline');
    expect(await read(cwd, '.a11ygate-baseline.json')).toBe(baseline);
    expect(out()).toContain('Skipped existing .a11ygate-baseline.json');
  }));

  it('does not create a baseline without opt-in', async () => temporary(async (cwd) => {
    expect(await run(['init', '--yes'], capture(cwd).io)).toBe(0);
    await expect(read(cwd, '.a11ygate-baseline.json')).rejects.toMatchObject({ code: 'ENOENT' });
  }));

  it('fails baseline creation before writing starters if the saved report is missing or incomplete', async () => temporary(async (cwd) => {
    const { io } = capture(cwd);
    expect(await run(['init', '--yes', '--baseline', 'missing.json'], io)).toBe(2);
    const incomplete = report(); incomplete.counts.pagesFailed = 1;
    await writeFile(path.join(cwd, 'scan.json'), JSON.stringify(incomplete));
    expect(await run(['init', '--yes', '--baseline', 'scan.json'], io)).toBe(2);
    await expect(read(cwd, '.a11ygate.yml')).rejects.toMatchObject({ code: 'ENOENT' });
  }));

  for (const args of [
    ['--target', 'other'], ['--url', 'file:///etc/passwd'], ['--url', 'http://user:pass@127.0.0.1/'],
    ['--url', "http://127.0.0.1/';touch%20bad"], ['--url', 'http://127.0.0.1/${bad}'],
    ['--url', 'http://127.0.0.1/\ninvalid'], ['--crawl', '21'], ['--crawl', '1.5'],
    ['--crawl', 'NaN'], ['--fail-on', 'high'], ['--url'], ['--unknown'],
  ]) it(`rejects invalid arguments ${JSON.stringify(args)} without writing`, async () => temporary(async (cwd) => {
    expect(await run(['init', '--yes', ...args], capture(cwd).io)).toBe(2);
    await expect(read(cwd, '.a11ygate.yml')).rejects.toMatchObject({ code: 'ENOENT' });
  }));

  it('refuses symlinked workflow directories and --force symlink destinations', async () => temporary(async (cwd) => {
    const outside = await mkdtemp(path.join(tmpdir(), 'a11ygate-outside-'));
    try {
      await symlink(outside, path.join(cwd, '.github'));
      expect(await run(['init', '--yes'], capture(cwd).io)).toBe(2);
      await expect(read(outside, 'workflows/a11ygate.yml')).rejects.toMatchObject({ code: 'ENOENT' });
      await writeFile(path.join(outside, 'untouched'), 'keep me');
      await symlink(path.join(outside, 'untouched'), path.join(cwd, 'Jenkinsfile'));
      expect(await run(['init', '--yes', '--target', 'jenkins', '--force'], capture(cwd).io)).toBe(2);
      expect(await read(outside, 'untouched')).toBe('keep me');
    } finally { await rm(outside, { recursive: true, force: true }); }
  }));

  it('fills in missing CI while preserving an existing config', async () => temporary(async (cwd) => {
    await writeFile(path.join(cwd, '.a11ygate.yml'), 'engines: [axe, ibm]\n');
    await mkdir(path.join(cwd, '.github/workflows'), { recursive: true });
    expect(await run(['init', '--yes'], capture(cwd).io)).toBe(0);
    expect(await read(cwd, '.a11ygate.yml')).toBe('engines: [axe, ibm]\n');
    expect(await read(cwd, ciPath('github'))).toContain('name: A11yGate');
  }));

  it('shows dedicated and top-level help', async () => temporary(async (cwd) => {
    const { io, out } = capture(cwd);
    expect(await run(['init', '--help'], io)).toBe(0);
    expect(await run(['--help'], io)).toBe(0);
    expect(out()).toContain('a11ygate init [--yes]');
    await expect(read(cwd, '.a11ygate.yml')).rejects.toMatchObject({ code: 'ENOENT' });
  }));

  it('runs the bundled CLI with --yes through pipes, and refuses to prompt without a TTY', async () => temporary(async (cwd) => {
    const bin = path.resolve('packages/cli/dist/cli.mjs');
    const yes = spawnSync(process.execPath, [bin, 'init', '--yes'], { cwd, encoding: 'utf8', stdio: 'pipe', timeout: 10000 });
    expect(yes.status, yes.stderr).toBe(0);
    expect(yes.stdout).toContain('Wrote .a11ygate.yml');
    const interactive = spawnSync(process.execPath, [bin, 'init'], { cwd, encoding: 'utf8', stdio: 'pipe', timeout: 10000 });
    expect(interactive.status).toBe(2);
    expect(interactive.stderr).toContain('Use --yes');
  }));
});
