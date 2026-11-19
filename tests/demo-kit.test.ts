// A11Y-R68: the 10-minute demo kit. Runs `node scripts/demo.mjs --ci` against the local fixture app
// (127.0.0.1, ephemeral port; no other host) and checks the demo copy for claims and the disclaimer.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const read = (rel: string) => readFile(path.join(repoRoot, rel), 'utf8');
const BANNED_CLAIMS =
  /\bcomplian(?:t|ce)\b|\bcertified\b|\bguarantee|\bconformant\b|lawsuit-proof|fixes everything|accessibe|userway|audioeye|equalweb|level access|essential accessibility|max access/i;

type Summary = {
  ok: boolean;
  failures: string[];
  totalMs: number;
  steps: { name: string; command: string; exit: number; expected: number; ms: number }[];
  newFindings: { ruleId: string; impact: string; page: string; selector: string }[];
};

async function demoFiles(): Promise<string[]> {
  const fixtures = (await readdir(path.join(repoRoot, 'fixtures/demo-app'))).map((name) => `fixtures/demo-app/${name}`);
  return ['docs/pilot/demo-script.md', 'scripts/demo.mjs', ...fixtures];
}

describe('demo kit copy (A11Y-R68)', () => {
  it('(c) passes the banned-claims grep and names no vendors in the script, fixtures and talk track', async () => {
    for (const rel of await demoFiles()) {
      if (rel.endsWith('.svg')) continue;
      const text = await read(rel);
      expect(text.match(BANNED_CLAIMS)?.[0], rel).toBeUndefined();
    }
    expect(BANNED_CLAIMS.test('WCAG compliant')).toBe(true);
  });

  it('(c) shows the disclaimer on every demo page, in the talk track and in the script output', async () => {
    for (const page of ['index.html', 'products.html', 'checkout.html', 'about.html']) {
      expect(await read(`fixtures/demo-app/${page}`), page).toContain(AUTOMATED_TESTING_DISCLAIMER);
    }
    expect(await read('docs/pilot/demo-script.md')).toContain(AUTOMATED_TESTING_DISCLAIMER);
    expect(await read('scripts/demo.mjs')).toContain(AUTOMATED_TESTING_DISCLAIMER);
  });

  it('marks seeded debt with TODO and never ships fake alt or label text', async () => {
    for (const page of ['index.html', 'products.html', 'checkout.html', 'about.html']) {
      const html = await read(`fixtures/demo-app/${page}`);
      expect(html, page).toContain('TODO(demo debt)');
      expect(html, page).not.toMatch(/\balt="[^"]+"|aria-label(?:ledby)?="(?!Main")[^"]*"/);
    }
    const server = await read('fixtures/demo-app/server.mjs');
    expect(server).toContain('<!-- demo-regression-slot -->');
    expect(server).not.toMatch(/REGRESSION_SNIPPET =[^;]*(aria-label|title=|alt=)/);
  });

  it('(b) the talk track links the limits docs, the pitch and the docs index entry', async () => {
    const doc = await read('docs/pilot/demo-script.md');
    expect(doc).toContain('](../what-a11ygate-does-not-do.md)');
    expect(doc).toContain('](../known-limits.md)');
    expect(doc).toContain('CI gate with evidence, not an overlay');
    expect(doc).toMatch(/manual, not run in tests/i);
    expect(await read('docs/README.md')).toContain('](pilot/demo-script.md)');
  });
});

describe.skipIf(!existsSync(chromium.executablePath()))('scripted demo run (A11Y-R68)', () => {
  it('(a, d) runs offline on the local fixture: exit 1 -> 0 -> 0 -> 1, exactly one new finding, under 3 minutes', async () => {
    const { stdout, code } = await new Promise<{ stdout: string; code: number }>((resolve) => {
      execFile(process.execPath, [path.join(repoRoot, 'scripts/demo.mjs'), '--ci'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 170_000 },
        (error, out) => resolve({ stdout: out, code: error ? (typeof error.code === 'number' ? error.code : 2) : 0 }));
    });
    const line = stdout.split('\n').find((l) => l.startsWith('DEMO_SUMMARY '));
    expect(line, stdout).toBeDefined();
    const summary = JSON.parse((line as string).slice('DEMO_SUMMARY '.length)) as Summary;
    // Printed so the CI log records the runner's real timing.
    console.log(`demo kit total ${summary.totalMs} ms: ${summary.steps.map((s) => `${s.exit}@${s.ms}ms`).join(' ')}`);
    expect(summary.failures, stdout).toEqual([]);
    expect(code).toBe(0);
    expect(summary.ok).toBe(true);

    const exits = summary.steps.map((s) => [s.command.split(' ').slice(0, 2).join(' '), s.exit]);
    expect(exits).toEqual([
      ['a11ygate scan', 1], // existing debt, no baseline
      ['a11ygate baseline', 0],
      ['a11ygate scan', 0], // re-scan with baseline passes
      ['toggle fixtures/demo-app', 0],
      ['a11ygate scan', 1], // regression: gate fails
      ['a11ygate evidence', 0],
      ['a11ygate prospect', 0],
    ]);
    // Baseline and gate use the same URL, port and crawl scope.
    const scopes = summary.steps.filter((s) => s.command.startsWith('a11ygate scan')).map((s) => s.command.split(' --out-dir')[0]?.replace(' --baseline a11y-baseline.json', ''));
    expect(new Set(scopes).size).toBe(1);
    expect(scopes[0]).toMatch(/^a11ygate scan http:\/\/127\.0\.0\.1:\d+\/ --crawl 10 --delay-ms 0$/);

    expect(summary.newFindings).toEqual([{ ruleId: 'button-name', impact: 'critical', page: '/checkout.html', selector: '.remove-item' }]);
    expect(stdout).toContain('Baseline: 0 new; 4 existing');
    expect(stdout).toContain('Baseline: 1 new; 4 existing');
    expect(stdout.match(/^- \[new]/gm)).toHaveLength(1);
    expect(stdout).toContain(AUTOMATED_TESTING_DISCLAIMER);
    expect(summary.totalMs).toBeLessThan(180_000);
  }, 180_000);
});
