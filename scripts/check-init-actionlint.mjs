// Offline check: install actionlint 1.7.7 (or newer) separately, then run this script.
// GOBIN=/your/bin go install github.com/rhysd/actionlint/cmd/actionlint@v1.7.7
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), 'a11ygate-actionlint-'));
function checked(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`${command}: ${result.error?.message ?? result.stderr + result.stdout}`);
}
try {
  const baselineReport = { kind: 'site-scan', schemaVersion: 1, findings: [], pages: [], results: [], counts: { pagesFailed: 0 }, verdict: 'PASS' };
  await writeFile(path.join(directory, 'scan.json'), JSON.stringify(baselineReport));
  const cases = [
    [],
    ['--url', 'http://127.0.0.1:8080/path?q=a%27b&b=2', '--crawl', '0', '--fail-on', 'none'],
    ['--baseline', 'scan.json', '--crawl', '20', '--fail-on', 'critical'],
  ];
  for (const flags of cases) {
    checked(process.execPath, [path.join(root, 'packages/cli/dist/cli.mjs'), 'init', '--yes', '--force', ...flags], directory);
    checked(process.env.ACTIONLINT ?? 'actionlint', [path.join(directory, '.github/workflows/a11ygate.yml')], directory);
  }
  console.log(`actionlint: ${cases.length} generated workflows passed (default, custom flags, fingerprint baseline).`);
} finally { await rm(directory, { recursive: true, force: true }); }
