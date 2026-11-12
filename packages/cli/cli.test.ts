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
const actionRun = path.join(repoRoot, 'action/run.mjs');

async function runAction(dir: string, env: Record<string, string>) {
  const outputFile = path.join(dir, 'github-output');
  await writeFile(outputFile, '');
  const child = spawnSync(process.execPath, [actionRun], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      RUNNER_TEMP: dir,
      GITHUB_OUTPUT: outputFile,
      A11Y_CURRENT: current,
      A11Y_BASELINE: baseline,
      NODE_ENV: 'test',
      ...env,
    },
  });
  return { status: child.status, stderr: child.stderr, outputs: await readFile(outputFile, 'utf8') };
}

async function capture(args: string[], cwd = repoRoot, env: Record<string, string | undefined> = {}) {
  let stdout = '';
  let stderr = '';
  const code = await run(args, {
    cwd,
    now: () => new Date('2026-10-31T12:00:00.000Z'),
    env,
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
    expect(help.stdout).toContain('npx @qe-atlas/a11ygate');

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

  describe('report', () => {
    it('writes a self-contained HTML evidence report and exits 0 even when the gate fails', async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'a11ygate-report-'));
      try {
        const out = path.join(dir, 'evidence.html');
        const result = await capture(['report', '--current', current, '--baseline', baseline, '--out', out], repoRoot, {
          GITHUB_SHA: 'abc1234',
          GITHUB_HEAD_REF: '',
          GITHUB_REF_NAME: 'main',
        });
        expect(result.code, result.stderr).toBe(0);
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain('Wrote evidence report');
        const html = await readFile(out, 'utf8');
        expect(html).toContain('<html lang="en">');
        expect(html).toContain('<time datetime="2026-10-31T12:00:00.000Z">');
        expect(html).toContain('<code>abc1234</code>');
        expect(html).toContain('<code>main</code>');
        expect(html).toContain('FAIL at threshold serious');
        expect(html).not.toMatch(/<script|<link|<[a-z][^>]*\ssrc=/i);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('infers the format from --out, honours --format, and prints with --out -', async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'a11ygate-report-'));
      try {
        const md = path.join(dir, 'evidence.md');
        expect((await capture(['report', '-c', current, '-b', baseline, '-o', md])).code).toBe(0);
        expect(await readFile(md, 'utf8')).toMatch(/^# Accessibility evidence report — demo\.shop/);

        const printed = await capture(['report', '-c', current, '-b', baseline, '--format', 'json', '--out', '-']);
        expect(printed.code).toBe(0);
        const report = JSON.parse(printed.stdout) as { summary: { new: number; baselined: number; fixed: number } };
        expect(report.summary).toMatchObject({ new: 2, baselined: 5, fixed: 3 });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('gives byte-identical output for the same input and --generated-at', async () => {
      const args = ['report', '-c', current, '-b', baseline, '--generated-at', '2026-11-10T09:00:00Z', '--commit', 'abc', '--branch', 'main'];
      const first = await capture(args, repoRoot, { GITHUB_SHA: 'ignored-by-flag' });
      const second = await capture(args);
      expect(first.code).toBe(0);
      expect(first.stdout).toBe(second.stdout);
      expect(first.stdout).toContain('2026-11-10T09:00:00.000Z');
      expect(first.stdout).not.toContain('2026-10-31T12:00:00.000Z');
    });

    it('rejects bad report arguments and output paths that alias inputs', async () => {
      const bad = await capture(['report', '-c', current, '--format', 'pdf']);
      expect(bad.code).toBe(2);
      expect(bad.stderr).toContain('Unknown report format');

      const badDate = await capture(['report', '-c', current, '--generated-at', 'yesterday']);
      expect(badDate.code).toBe(2);
      expect(badDate.stderr).toContain('--generated-at');

      const gateOnly = await capture(['report', '-c', current, '--markdown', 'x.md']);
      expect(gateOnly.code).toBe(2);
      expect(gateOnly.stderr).toContain('not available with a11ygate report');

      const reportOnly = await capture(['-c', current, '--out', 'x.html']);
      expect(reportOnly.code).toBe(2);
      expect(reportOnly.stderr).toContain('only available with a11ygate report');

      const alias = await capture(['report', '-c', current, '--out', current]);
      expect(alias.code).toBe(2);
      expect(alias.stderr).toContain('must not overwrite input evidence');

      const help = await capture(['report', '--help']);
      expect(help.code).toBe(0);
      expect(help.stdout).toContain('a11ygate report');
    });

    it('builds the report from a11ygate scan JSON, compared with a previous scan', async () => {
      const scan = path.join(repoRoot, 'fixtures/scan-report/current.json');
      const previous = path.join(repoRoot, 'fixtures/scan-report/previous.json');
      const result = await capture(['report', '--scan', scan, '--previous-scan', previous, '--format', 'json']);
      expect(result.code, result.stderr).toBe(0);
      const report = JSON.parse(result.stdout) as {
        input: string;
        scope: { startUrl: string; scannedAt: string };
        trend: { totals: { new: number; fixed: number; stillOpen: number } };
      };
      expect(report.input).toBe('site-scan');
      expect(report.scope).toMatchObject({ startUrl: 'https://shop.example/', scannedAt: '2026-11-12T09:00:00.000Z' });
      expect(report.trend.totals).toMatchObject({ new: 4, fixed: 1, stillOpen: 2 });

      const md = await capture(['report', '--scan', scan, '--format', 'md']);
      expect(md.code).toBe(0);
      expect(md.stdout).toContain('No previous scan was supplied');

      const axeAsScan = await capture(['report', '--scan', current]);
      expect(axeAsScan.code).toBe(2);
      expect(axeAsScan.stderr).toContain('not an a11ygate scan report');

      const both = await capture(['report', '--scan', scan, '--current', current]);
      expect(both.code).toBe(2);

      const alias = await capture(['report', '--scan', scan, '--out', scan]);
      expect(alias.code).toBe(2);
      expect(alias.stderr).toContain('must not overwrite input evidence');
    });

    it('the built binaries write the report', () => {
      for (const bin of [cliBin, actionBin]) {
        const result = spawnSync(process.execPath, [bin, 'report', '--current', current, '--baseline', baseline, '--format', 'md'], {
          cwd: repoRoot,
          encoding: 'utf8',
        });
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain('Automated testing only. Not a WCAG audit, certification or legal advice.');
        expect(result.stdout).toContain('| Baselined (still open) | 5 |');
      }
    });
  });

  describe('action report inputs', () => {
    it('writes the report and sets the report output without changing the gate exit code', async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'a11ygate-action-'));
      try {
        const report = path.join(dir, 'evidence.md');
        const result = await runAction(dir, { A11Y_REPORT: report, GITHUB_SHA: 'abc1234', GITHUB_HEAD_REF: 'feat/x' });
        expect(result.status, result.stderr).toBe(1);
        expect(result.outputs).toContain(`report=${report}\n`);
        expect(result.outputs).toContain('verdict=FAIL');
        const markdown = await readFile(report, 'utf8');
        expect(markdown).toContain('| Commit | `abc1234` |');
        expect(markdown).toContain('| Branch | `feat/x` |');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('fails a passing gate when the report cannot be written', async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'a11ygate-action-'));
      try {
        const result = await runAction(dir, {
          A11Y_THRESHOLD: 'critical',
          A11Y_REPORT: path.join(dir, 'missing-dir', 'evidence.html'),
        });
        expect(result.status).toBe(2);
        expect(result.outputs).toContain('verdict=PASS');
        expect(result.outputs).not.toContain('report=');
        expect(result.stderr).toContain('the directory does not exist');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });
});
