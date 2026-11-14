import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';

it('the bundled Action resolves input > env > YAML and writes configured formats in the checkout', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'a11ygate-action-config-'));
  try {
    const preload = path.join(cwd, 'deny-network.mjs');
    writeFileSync(preload, `import http from 'node:http'; import https from 'node:https'; import net from 'node:net'; import tls from 'node:tls';
const deny = () => { process.stderr.write('NETWORK_ATTEMPT'); throw Error('network forbidden'); };
globalThis.fetch = deny; http.request = http.get = https.request = https.get = deny;
net.connect = net.createConnection = net.Socket.prototype.connect = tls.connect = deny;`);
    const baseline = path.resolve('examples/github-action/fixtures/baseline.json');
    writeFileSync(path.join(cwd, '.a11ygate.yml'), `failOn: none\nbaseline: ${JSON.stringify(baseline)}\nformats: [sarif]\noutDir: reports\n`);
    for (const [extra, threshold] of [
      [{}, 'none'],
      [{ A11YGATE_FAIL_ON: 'critical' }, 'critical'],
      [{ A11YGATE_FAIL_ON: 'critical', A11Y_THRESHOLD: 'serious' }, 'serious'],
    ] as const) {
      const result = spawnSync(process.execPath, ['--import', preload, path.resolve('action/run.mjs')], { encoding: 'utf8', env: {
        PATH: process.env.PATH, NODE_ENV: 'test',
        GITHUB_WORKSPACE: cwd, RUNNER_TEMP: cwd,
        A11Y_CURRENT: path.resolve('examples/github-action/fixtures/current.json'),
        ...extra,
      } });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout + result.stderr).not.toContain('NETWORK_ATTEMPT');
      const report = JSON.parse(readFileSync(path.join(cwd, 'a11ygate-result.json'), 'utf8'));
      expect(report.threshold).toBe(threshold);
      expect(report.counts.new).toBe(1);
      expect(report.counts.stillOpen).toBe(1); // The baseline was loaded from YAML, not an Action input.
      expect(readFileSync(path.join(cwd, 'reports/a11ygate.sarif'), 'utf8')).toContain('2.1.0');
    }
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
