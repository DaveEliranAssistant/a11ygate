import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import manifest from '@/packages/cli/package.json';
import { blockNetwork } from './network-guard';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.join(root, 'pilot-bundle');

it('packs and installs a reproducible offline pilot CLI without changing committed builds', async () => {
  await mkdir(output, { recursive: true });
  const project = await mkdtemp(path.join(output, '.install-test-'));
  const guard = blockNetwork();
  const env = {
    ...process.env,
    A11YGATE_RELEASE_BUILD: '',
    npm_config_offline: 'true',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
    npm_config_cache: path.join(project, '.npm-cache'),
  };
  const run = (file: string, args: string[], cwd = root, extraEnv: Record<string, string> = {}) =>
    execFileSync(file, args, { cwd, env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 20_000 });
  const distStatus = () => run('git', ['status', '--porcelain', '--', 'packages/cli/dist', 'action/dist']);

  try {
    const before = distStatus();
    const sha = run('git', ['rev-parse', '--short=7', 'HEAD']).trim();
    const archive = `qe-atlas-a11ygate-${manifest.version}-${sha}.tgz`;
    const tarball = path.join(output, archive);
    run('npm', ['run', 'pilot:bundle']);
    expect(distStatus()).toBe(before);

    const entries = run('tar', ['-tzf', tarball]).trim().split('\n').sort();
    expect(entries).toEqual(['package.json', ...manifest.files].map((file) => `package/${file}`).sort());
    expect(run('shasum', ['-a', '256', '-c', 'SHA256SUMS'], output).trim()).toBe(`${archive}: OK`);
    const original = await readFile(tarball);
    run('npm', ['run', 'pilot:bundle']);
    expect((await readFile(tarball)).equals(original)).toBe(true);
    expect(distStatus()).toBe(before);

    const lockfile = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
    const playwright = lockfile.packages['node_modules/playwright'].version;
    const install = await readFile(path.join(output, 'INSTALL.md'), 'utf8');
    expect(install).toContain(`npm install --save-dev ./${archive} playwright@${playwright} @axe-core/playwright`);
    expect(install).toContain('npx --no-install a11ygate doctor');
    expect(install).toContain('shasum -a 256 -c SHA256SUMS');
    expect(install).toContain('directly from Eliran');
    expect(install).toContain(AUTOMATED_TESTING_DISCLAIMER);

    await writeFile(path.join(project, 'package.json'), '{"name":"pilot-test","private":true}\n');
    await copyFile(tarball, path.join(project, archive));
    run('npm', ['install', '--offline', '--no-save', '--ignore-scripts', '--legacy-peer-deps', `./${archive}`], project);
    const help = run('npx', ['--no-install', 'a11ygate', '--help'], project);
    for (const command of ['init', 'scan', 'prospect', 'pilot']) expect(help).toMatch(new RegExp(`^ +a11ygate ${command}\\b`, 'm'));
    expect(run('npx', ['--no-install', 'a11ygate', '--version'], project)).toBe(`${manifest.version} (source ${sha})\n`);

    const normalBin = path.join(root, 'packages/cli/dist/cli.mjs');
    expect(run(process.execPath, [normalBin, '--version'])).toBe(`${manifest.version}\n`);

    const release = path.join(project, 'release');
    await mkdir(release);
    await copyFile(path.join(root, 'packages/cli/package.json'), path.join(release, 'package.json'));
    run(process.execPath, ['packages/cli/build.mjs'], root, {
      A11YGATE_PILOT_STAGE: release,
      A11YGATE_PILOT_SOURCE_SHA: sha,
      A11YGATE_RELEASE_BUILD: '1',
    });
    const releaseBin = path.join(release, 'dist/cli.mjs');
    expect(run(process.execPath, [releaseBin, '--version'])).toBe(`${manifest.version}\n`);
    expect((await readFile(releaseBin)).equals(await readFile(normalBin))).toBe(true);
    expect(distStatus()).toBe(before);
    expect(guard.attempts).toEqual([]);
  } finally {
    guard.restore();
    await rm(project, { recursive: true, force: true });
  }
}, 60_000);
