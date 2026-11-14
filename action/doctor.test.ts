import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { blockNetwork } from '../tests/network-guard';
it('warns before the Action gate and preserves both passing and failing exit codes', () => {
  const network = blockNetwork();
  const temp = mkdtempSync(path.join(tmpdir(), 'a11ygate-doctor-action-'));
  try {
    // The parent network guard cannot intercept a child. Deny all networking there too.
    const preload = path.join(temp, 'deny-network.mjs');
    writeFileSync(preload, `
   import http from 'node:http'; import https from 'node:https';
   import net from 'node:net'; import tls from 'node:tls';
   const deny = () => { process.stderr.write('NETWORK_ATTEMPT'); throw Error('network forbidden'); };
   globalThis.fetch = deny;
   http.request = http.get = https.request = https.get = deny;
   net.connect = net.createConnection = net.Socket.prototype.connect = tls.connect = deny;
  `);
    for (const baseline of ['examples/github-action/fixtures/baseline.json', '']) {
      const result = spawnSync(process.execPath, ['--import', preload, 'action/run.mjs'], {
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH, NODE_ENV: 'test',
          A11Y_CURRENT: 'examples/github-action/fixtures/current.json',
          A11Y_BASELINE: baseline,
          A11Y_MARKDOWN: path.join(temp, 'summary.md'), A11Y_JSON: path.join(temp, 'result.json'),
          GITHUB_WORKSPACE: process.cwd(), A11Y_HEAD_SHA: 'different-from-checkout',
        },
      });
      expect(result.status, result.stderr).toBe(baseline ? 0 : 1);
      expect(result.stderr).toContain('::warning::A11yGate doctor: The checkout differs');
      expect(result.stdout).toContain('A11yGate doctor');
      expect(result.stdout).toContain('Reading axe JSON needs no browser');
      expect(result.stdout + result.stderr).not.toContain('NETWORK_ATTEMPT');
    }
    expect(network.attempts).toEqual([]);
  }
  finally {
    network.restore();
    rmSync(temp, { recursive: true, force: true });
  }
});
