#!/usr/bin/env node
// A11Y-R68: the 10-minute demo, scripted end to end on the local fixture app (fixtures/demo-app).
//
//   node scripts/demo.mjs           # presenter mode: full CLI output, keeps the outputs and prints where
//   node scripts/demo.mjs --pause   # presenter mode, waits for Enter before each step (interactive terminals)
//   node scripts/demo.mjs --ci      # short output, asserts exit codes and the single new finding, cleans up
//
// Steps: start fixture server (127.0.0.1, ephemeral port) -> scan -> baseline create -> re-scan with the
// baseline (exit 0) -> apply the regression -> gate scan (exit 1, exactly one new finding) -> evidence pack
// -> prospect --from <gate scan> --offer. Only the local fixture server is scanned. All outputs go to a
// temporary directory under os.tmpdir(), never into the repository.
import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { REGRESSION_PAGE, REGRESSION_SNIPPET, startDemoApp } from '../fixtures/demo-app/server.mjs';

const DISCLAIMER = 'Automated testing only. Not a WCAG audit, certification or legal advice.';
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const CLI = path.join(repoRoot, 'packages/cli/dist/cli.mjs');
const args = new Set(process.argv.slice(2));
const ci = args.has('--ci');
const pause = args.has('--pause') && !ci && process.stdin.isTTY;
if (args.has('--help') || args.has('-h')) {
  process.stdout.write('Usage: node scripts/demo.mjs [--ci] [--pause]\nRuns the A11yGate gate demo on the local fixture app.\n' + DISCLAIMER + '\n');
  process.exit(0);
}

const out = (text) => process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
const started = Date.now();
const steps = [];
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

/** Run the built CLI asynchronously (the fixture server shares this event loop). */
function cli(cliArgs, cwd) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    execFile(process.execPath, [CLI, ...cliArgs], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : 2) : 0;
        resolve({ code, stdout, stderr, ms: Date.now() - t0 });
      });
  });
}

/** Short view for --ci: verdict, reason and baseline lines plus any new findings. */
function brief(stdout) {
  const lines = stdout.split('\n');
  const keep = lines.filter((line) => /^\*\*Verdict|^\d+ (new )?findings? at or above|^Baseline:|^Wrote |^- \[new]/.test(line));
  return [...new Set(keep)].join('\n');
}

const shown = (cliArgs) => `a11ygate ${cliArgs.map((a) => (/\s/.test(a) ? `'${a}'` : a)).join(' ')}`;

async function step(name, cliArgs, cwd, expectCode) {
  if (pause) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    await rl.question(`\n[Enter] ${name}`);
    rl.close();
  }
  out(`\n=== ${steps.length + 1}. ${name}`);
  out(`$ ${shown(cliArgs)}`);
  const result = await cli(cliArgs, cwd);
  out(ci ? brief(result.stdout) : result.stdout.trimEnd());
  if (result.stderr.trim() && (!ci || result.code !== expectCode)) out(result.stderr.trimEnd());
  out(`-> exit ${result.code} (expected ${expectCode}) in ${(result.ms / 1000).toFixed(1)}s`);
  steps.push({ name, command: shown(cliArgs), exit: result.code, expected: expectCode, ms: result.ms });
  check(result.code === expectCode, `${name}: exit ${result.code}, expected ${expectCode}`);
  return result;
}

if (!existsSync(CLI)) {
  out(`Built CLI not found at ${CLI}. Run npm run cli:build first.`);
  process.exit(2);
}

const work = await mkdtemp(path.join(os.tmpdir(), 'a11ygate-demo-'));
const app = await startDemoApp();
let commit;
try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { commit = undefined; }

// One URL, one port, one crawl scope for every scan, so the baseline and the gate compare like with like.
const scope = [app.url, '--crawl', '10', '--delay-ms', '0'];
let newFindings = [];
try {
  out('A11yGate demo: CI gate with evidence, not an overlay.');
  out(DISCLAIMER);
  out(`Fixture app: ${app.url} (fixtures/demo-app, local only). Work dir: ${work}`);

  await step('Scan the existing site (no baseline: existing debt fails a naive gate)', ['scan', ...scope, '--out-dir', 'scan-1-debt'], work, 1);
  await step('Accept today\'s debt as the baseline', ['baseline', 'create', 'scan-1-debt', '--output', 'a11y-baseline.json'], work, 0);
  await step('Re-scan with the baseline (nothing new: the gate passes)', ['scan', ...scope, '--baseline', 'a11y-baseline.json', '--out-dir', 'scan-2-pass'], work, 0);

  app.setRegression(true);
  out(`\n=== ${steps.length + 1}. Apply the regression (a developer ships an icon-only button on ${REGRESSION_PAGE})`);
  out(`+ ${REGRESSION_SNIPPET}`);
  steps.push({ name: 'Apply the regression', command: `toggle fixtures/demo-app regression on ${REGRESSION_PAGE}`, exit: 0, expected: 0, ms: 0 });

  await step('Gate the change (same scope, same baseline)', ['scan', ...scope, '--baseline', 'a11y-baseline.json', '--out-dir', 'scan-3-gate'], work, 1);
  const gate = JSON.parse(await readFile(path.join(work, 'scan-3-gate', 'a11ygate-scan.json'), 'utf8'));
  newFindings = (gate.findings ?? []).filter((f) => f.baselineStatus === 'new').map((f) => ({ ruleId: f.ruleId, impact: f.impact, page: new URL(f.pageUrl).pathname, selector: f.selector }));
  check(gate.baseline?.new === 1, `gate baseline.new is ${gate.baseline?.new}, expected 1`);
  check(newFindings.length === 1 && newFindings[0].ruleId === 'button-name' && newFindings[0].page === REGRESSION_PAGE,
    `expected exactly one new button-name finding on ${REGRESSION_PAGE}, got ${JSON.stringify(newFindings)}`);
  out(`New findings in the gate run: ${newFindings.length} -> ${newFindings.map((f) => `${f.ruleId} (${f.impact}) on ${f.page} ${f.selector}`).join('; ')}`);

  await step('Bundle the evidence', ['evidence', 'pack', '--from', 'scan-3-gate', '--out', 'a11ygate-evidence.zip', ...(commit ? ['--commit', commit] : [])], work, 0);
  check(existsSync(path.join(work, 'a11ygate-evidence.zip')), 'evidence zip missing');

  await step('One-page summary for the buyer, with the pilot offer', ['prospect', '--from', 'scan-3-gate', '--company', 'Northwind Outdoor (demo)', '--out-dir', 'prospect-out', '--offer'], work, 0);
  for (const file of ['prospect-summary.html', 'prospect-summary.pdf', 'prospect-manifest.json']) check(existsSync(path.join(work, 'prospect-out', file)), `prospect output ${file} missing`);
} finally {
  await app.close();
}

const totalMs = Date.now() - started;
const offHost = app.hits.filter((hit) => !/^(GET|HEAD) \//.test(hit));
check(offHost.length === 0, `unexpected requests: ${offHost.join(', ')}`);
out(`\n=== Done in ${(totalMs / 1000).toFixed(1)}s`);
for (const s of steps) out(`  ${s.exit === s.expected ? 'ok  ' : 'FAIL'} exit ${s.exit}  ${(s.ms / 1000).toFixed(1).padStart(5)}s  ${s.name}`);
out(DISCLAIMER);
if (ci) {
  out(`DEMO_SUMMARY ${JSON.stringify({ ok: failures.length === 0, failures, totalMs, steps, newFindings, node: process.version, platform: `${process.platform}-${process.arch}` })}`);
  await rm(work, { recursive: true, force: true });
} else {
  out(`Outputs kept in ${work} (open scan-3-gate/a11ygate-scan.html and prospect-out/prospect-summary.pdf).`);
}
if (failures.length) {
  out(`Demo assertions failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
