// A11Y-R68: the scripted demo run on a runner with Chromium installed. `npm test` runs before CI
// installs Chromium, so tests/demo-kit.test.ts skips there; this spec is the CI proof of acceptance
// items (a) and (d). It runs `node scripts/demo.mjs --ci` against the local fixture app only
// (127.0.0.1, ephemeral port). It does not use the Next server that playwright.config.ts starts.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const repoRoot = path.resolve(__dirname, '..');
const DISCLAIMER = 'Automated testing only. Not a WCAG audit, certification or legal advice.';

type Summary = {
  ok: boolean;
  failures: string[];
  totalMs: number;
  steps: { name: string; command: string; exit: number; expected: number; ms: number }[];
  newFindings: { ruleId: string; impact: string; page: string; selector: string }[];
};

test('demo kit: exit 1 -> 0 -> 0 -> 1, exactly one new finding, under 3 minutes (A11Y-R68)', async () => {
  test.setTimeout(180_000);
  const started = Date.now();
  const { stdout, code } = await new Promise<{ stdout: string; code: number }>((resolve) => {
    execFile(process.execPath, [path.join(repoRoot, 'scripts/demo.mjs'), '--ci'],
      { cwd: repoRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 175_000 },
      (error, out) => resolve({ stdout: out, code: error ? (typeof error.code === 'number' ? error.code : 2) : 0 }));
  });
  const wallMs = Date.now() - started;
  const line = stdout.split('\n').find((l) => l.startsWith('DEMO_SUMMARY '));
  expect(line, stdout).toBeDefined();
  const summary = JSON.parse((line as string).slice('DEMO_SUMMARY '.length)) as Summary;
  // Printed so the CI log records the runner's real timing.
  console.log(`demo kit total ${summary.totalMs} ms (wall ${wallMs} ms, node ${process.version}, ${process.platform}-${process.arch}): ${summary.steps.map((s) => `${s.exit}@${s.ms}ms`).join(' ')}`);

  expect(summary.failures, stdout).toEqual([]);
  expect(code).toBe(0);
  expect(summary.ok).toBe(true);
  expect(summary.steps.map((s) => [s.command.split(' ').slice(0, 2).join(' '), s.exit])).toEqual([
    ['a11ygate scan', 1], // existing debt, no baseline
    ['a11ygate baseline', 0],
    ['a11ygate scan', 0], // re-scan with baseline passes
    ['toggle fixtures/demo-app', 0],
    ['a11ygate scan', 1], // regression: gate fails
    ['a11ygate evidence', 0],
    ['a11ygate prospect', 0],
  ]);
  expect(summary.newFindings).toEqual([{ ruleId: 'button-name', impact: 'critical', page: '/checkout.html', selector: '.remove-item' }]);
  expect(stdout).toContain('Baseline: 0 new; 4 existing');
  expect(stdout).toContain('Baseline: 1 new; 4 existing');
  expect(stdout.match(/^- \[new]/gm)).toHaveLength(1);
  expect(stdout).toContain(DISCLAIMER);
  expect(summary.totalMs).toBeLessThan(180_000);
  expect(wallMs).toBeLessThan(180_000);
});
