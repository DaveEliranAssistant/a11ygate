import { mkdtemp, readFile, writeFile, rm, mkdir, symlink, stat, unlink, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import Ajv from 'ajv';
import { doctorChecks } from '@/packages/cli/src/doctor';
import pricing from '@/config/pricing.json';
import pilotSchema from '@/schema/pilot-success.schema.json';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { run } from '@/packages/cli/src/run';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { buildScanReport } from '@/lib/scan/report';

async function temporary(work: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'a11ygate-init-'));
  try {
    const root = await realpath(cwd);
    expect(path.dirname(root)).toBe(await realpath(tmpdir()));
    expect(root).not.toBe(await realpath(process.cwd()));
    await work(cwd);
  } finally { await rm(cwd, { recursive: true, force: true }); }
}
function capture(cwd: string) {
  let stdout = '', stderr = '';
  return { io: { cwd, stdout: (s: string) => { stdout += s; }, stderr: (s: string) => { stderr += s; } }, out: () => stdout, err: () => stderr };
}
const ciPath = (target: string) => target === 'github' ? '.github/workflows/a11ygate.yml' : 'Jenkinsfile';
const yaml = createRequire(import.meta.url)('js-yaml') as { load: (text: string) => unknown };
const validatePilot = new Ajv({ strict: true }).compile(pilotSchema);
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

  for (const [target, file] of [
    ['github', '.github/workflows/a11ygate.yml'],
    ['jenkins', 'Jenkinsfile'],
    ['gitlab', '.gitlab-ci.a11ygate.yml'],
    ['azure-devops', 'azure-pipelines.a11ygate.yml'],
  ] as const) {
    it(`writes valid ${target} pilot files and checks the configured CI starter`, async () => temporary(async (cwd) => {
      const { io, out } = capture(cwd);
      const args = ['init', '--yes', '--target', target, '--pilot'];
      const criteriaPath = 'a11ygate-pilot/success-criteria.yml';
      const kickoffPath = 'a11ygate-pilot/KICKOFF.md';
      expect(await run(args, io)).toBe(0);
      const criteriaText = await read(cwd, criteriaPath);
      const criteria = yaml.load(criteriaText);
      expect(validatePilot(criteria), JSON.stringify(validatePilot.errors)).toBe(true);
      expect(criteria).toMatchObject({ pilot: { ciProvider: target, customer: '[[MISSING]]', lengthDays: pricing.pilot.lengthDays } });
      expect(criteriaText).toContain(AUTOMATED_TESTING_DISCLAIMER);
      expect(await read(cwd, kickoffPath)).toContain('https://github.com/DaveEliranAssistant/a11ygate/blob/main/docs/pilot/kickoff-checklist.md');
      expect(await read(cwd, kickoffPath)).toContain(AUTOMATED_TESTING_DISCLAIMER);
      expect(out()).toMatch(/1\. a11ygate doctor[\s\S]*2\. a11ygate scan[\s\S]*3\. a11ygate baseline create[\s\S]*4\. (gh pr create|glab mr create|az repos pr create|git push)[\s\S]*5\. a11ygate evidence pack/);
      const doctor = async () => (await doctorChecks({ browser: false }, { cwd, env: {}, head: () => null })).find(finding => finding.check === 'ci-file');
      expect(await doctor()).toMatchObject({ status: 'pass', message: expect.stringContaining(file) });
      await unlink(path.join(cwd, file));
      expect(await doctor()).toMatchObject({ status: 'fail', message: expect.stringContaining(file) });
      await writeFile(path.join(cwd, criteriaPath), '# confirmed pilot criteria');
      // A11Y-R72: the first GitLab run created the root .gitlab-ci.yml, so a re-run leaves it alone and exits 2.
      expect(await run(args, io)).toBe(target === 'gitlab' ? 2 : 0);
      expect(await read(cwd, criteriaPath)).toBe('# confirmed pilot criteria');
    }));

    it(`refuses a symlink at the ${target} CI destination`, async () => temporary(async (cwd) => {
      const { io } = capture(cwd);
      await mkdir(path.dirname(path.join(cwd, file)), { recursive: true });
      await writeFile(path.join(cwd, 'untouched'), 'keep me');
      await symlink(path.join(cwd, 'untouched'), path.join(cwd, file));
      for (const flags of [[], ['--force']]) {
        expect(await run(['init', '--yes', '--target', target, ...flags], io)).toBe(2);
        expect(await read(cwd, 'untouched')).toBe('keep me');
      }
    }));
  }

  for (const [target, file] of [
    ['gitlab', '.gitlab-ci.a11ygate.yml'],
    ['azure-devops', 'azure-pipelines.a11ygate.yml'],
  ] as const) {
    it(`writes and preserves the ${target} starter and passes the baseline to the scan`, async () => temporary(async (cwd) => {
      const { io, out, err } = capture(cwd);
      // A11Y-R72: an existing root .gitlab-ci.yml is never edited; GitLab init exits 2 and prints the snippet.
      const code = target === 'gitlab' ? 2 : 0;
      const args = ['init', '--yes', '--target', target, '--url', 'http://127.0.0.1:9999/path?q=a%27b&x=1#fragment', '--crawl', '0', '--fail-on', 'critical'];
      await writeFile(path.join(cwd, '.gitlab-ci.yml'), '# project pipeline');
      await writeFile(path.join(cwd, 'scan.json'), JSON.stringify(report()));
      expect(await run([...args, '--baseline', 'scan.json'], io)).toBe(code);
      const ci = await read(cwd, file);
      expect(ci).toContain('http://127.0.0.1:9999/path?q=a%27b&x=1#fragment');
      expect(ci).toContain('critical');
      expect(ci).toContain('--baseline .a11ygate-baseline.json');
      expect(await read(cwd, '.gitlab-ci.yml')).toBe('# project pipeline');
      expect(await read(cwd, '.a11ygate.yml')).toContain(`ciTarget: ${target}`);
      if (target === 'gitlab') {
        expect(ci).toContain('--crawl 1');
        expect(err()).toContain(`include:\n  - local: '.gitlab-ci.a11ygate.yml'\n\nworkflow:\n  rules:\n    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'`);
        expect(out()).not.toContain('Add this entry');
      } else {
        const parsed = yaml.load(ci) as { trigger: string; pr: string[]; parameters: { name: string; default: unknown }[]; steps: Record<string, unknown>[] };
        const template = yaml.load(await readFile('integrations/azure-devops/a11ygate.yml', 'utf8')) as typeof parsed;
        expect(parsed).toMatchObject({ trigger: 'none', pr: ['main'] });
        expect(parsed.parameters).toEqual(template.parameters.map(parameter => ({
          ...parameter,
          default: ({ url: 'http://127.0.0.1:9999/path?q=a%27b&x=1#fragment', crawl: 1, failOn: 'critical' } as Record<string, unknown>)[parameter.name] ?? parameter.default,
        })));
        expect(parsed.steps).toEqual(template.steps.map(step => step.name === 'a11ygateScan'
          ? { ...step, script: (step.script as string).replace(' --format', ' --baseline .a11ygate-baseline.json --format') }
          : step));
      }
      await writeFile(path.join(cwd, file), '# project starter');
      expect(await run(args, io)).toBe(code);
      expect(await read(cwd, file)).toBe('# project starter');
      expect(await run([...args, '--force'], io)).toBe(code);
      expect(await read(cwd, file)).toContain(AUTOMATED_TESTING_DISCLAIMER);
      expect(await read(cwd, '.gitlab-ci.yml')).toBe('# project pipeline');
    }));
  }

  it('refuses a symlink at the pilot directory', async () => temporary(async (cwd) => {
    await symlink(cwd, path.join(cwd, 'a11ygate-pilot'));
    expect(await run(['init', '--yes', '--target', 'gitlab', '--pilot', '--force'], capture(cwd).io)).toBe(2);
    await expect(read(cwd, 'success-criteria.yml')).rejects.toMatchObject({ code: 'ENOENT' });
  }));

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

  it.each([
    ['gitlab', '.gitlab-ci.a11ygate.yml'],
    ['azure-devops', 'azure-pipelines.a11ygate.yml'],
  ])('ships the %s pilot starter in the standalone bundle', async (target, file) => temporary(async (cwd) => {
    const bin = path.resolve('packages/cli/dist/cli.mjs');
    const result = spawnSync(process.execPath, [bin, 'init', '--yes', '--target', target, '--pilot'], { cwd, encoding: 'utf8', timeout: 10000 });
    expect(result.status, result.stderr).toBe(0);
    expect(yaml.load(await read(cwd, file))).toBeTypeOf('object');
    expect(validatePilot(yaml.load(await read(cwd, 'a11ygate-pilot/success-criteria.yml')))).toBe(true);
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
