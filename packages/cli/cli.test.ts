import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { run } from './src/run';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const current = path.join(repoRoot, 'fixtures/demo-shop-current.json');
const baseline = path.join(repoRoot, 'fixtures/demo-shop-baseline.json');
const cliBin = path.join(repoRoot, 'packages/cli/dist/cli.mjs');
const actionBin = path.join(repoRoot, 'action/dist/cli.mjs');

async function capture(args: string[], cwd = repoRoot) {
  let stdout = '';
  let stderr = '';
  const code = await run(args, {
    cwd,
    now: () => new Date('2026-10-31T12:00:00.000Z'),
    stdout: (chunk) => {
      stdout += chunk;
    },
    stderr: (chunk) => {
      stderr += chunk;
    },
  });
  return { code, stdout, stderr };
}

describe('a11ygate CLI', () => {
  beforeAll(() => {
    const built = spawnSync(process.execPath, [path.join(repoRoot, 'packages/cli/build.mjs')], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(built.status, built.stderr || built.stdout).toBe(0);
  }, 30_000);

  it('exits 1 on the demo fixtures with 2 new, 3 fixed, and 5 still open', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'a11ygate-'));
    try {
      const jsonPath = path.join(dir, 'result.json');
      const markdownPath = path.join(dir, 'summary.md');
      const result = await capture([
        '--current',
        current,
        '--baseline',
        baseline,
        '--json',
        jsonPath,
        '--markdown',
        markdownPath,
      ]);
      expect(result.code).toBe(1);
      expect(result.stdout).toContain('**Verdict: FAIL**');
      expect(result.stdout).toContain('| New | 2 |');
      expect(result.stdout).toContain('| Fixed | 3 |');
      expect(result.stdout).toContain('| Still open | 5 |');
      const report = JSON.parse(await readFile(jsonPath, 'utf8')) as {
        verdict: string;
        counts: { new: number; fixed: number; stillOpen: number };
      };
      expect(report.verdict).toBe('FAIL');
      expect(report.counts).toEqual({ new: 2, fixed: 3, stillOpen: 5 });
      expect(await readFile(markdownPath, 'utf8')).toContain('| Still open | 5 |');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('exits 0 when the demo threshold is critical', async () => {
    const result = await capture([
      '--current',
      current,
      '--baseline',
      baseline,
      '--threshold',
      'critical',
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('**Verdict: PASS**');
    expect(result.stdout).toContain('| New | 2 |');
  });

  it('exits 2 when the JSON cannot be read', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'a11ygate-bad-'));
    try {
      const bad = path.join(dir, 'bad.json');
      await writeFile(bad, '{');
      const invalid = await capture(['--current', bad]);
      expect(invalid.code).toBe(2);
      expect(invalid.stderr).toContain('Not valid JSON');

      const missing = await capture(['--current', path.join(dir, 'missing.json')]);
      expect(missing.code).toBe(2);
      expect(missing.stderr).toContain('file not found');

      const empty = await capture(['--help', '--current']);
      expect(empty.code).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('prints help and the version', async () => {
    const help = await capture(['--help']);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('--current');
    expect(help.stdout).toContain('--baseline');
    expect(help.stdout).toContain('Exit codes');

    const version = await capture(['--version']);
    expect(version.code).toBe(0);
    expect(version.stdout.trim()).toBe('0.1.0');

    const unknown = await capture(['--nope']);
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain('Unknown option');
  });

  it('writes a baseline that parses back to the current findings', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'a11ygate-base-'));
    try {
      const nextBaseline = path.join(dir, 'baseline.json');
      const result = await capture([
        '--current',
        current,
        '--baseline',
        baseline,
        '--update-baseline',
        nextBaseline,
      ]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('Wrote baseline');
      const again = await capture(['--current', current, '--baseline', nextBaseline]);
      expect(again.code).toBe(0);
      expect(again.stdout).toContain('| New | 0 |');
      expect(again.stdout).toContain('| Fixed | 0 |');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('the built binaries exit 1 on the demo fixtures', () => {
    for (const bin of [cliBin, actionBin]) {
      const result = spawnSync(process.execPath, [bin, '--current', current, '--baseline', baseline], {
        cwd: repoRoot,
        encoding: 'utf8',
      });
      expect(result.status, result.stderr).toBe(1);
      expect(result.stdout).toContain('| New | 2 |');
      expect(result.stdout).toContain('| Fixed | 3 |');
      expect(result.stdout).toContain('| Still open | 5 |');
      expect(result.stdout).toContain('**Verdict: FAIL**');
    }
  });
});
