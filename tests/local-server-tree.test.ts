import { describe, expect, it } from 'vitest';
import { createServer } from 'node:net';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { transform } from 'esbuild';
import { runScan, type ScanEngineFactory } from '@/packages/cli/src/scan';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function bind(port = 0) {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}
async function close(server: ReturnType<typeof createServer>) {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
async function eventually(check: () => Promise<void>) {
  let error: unknown;
  for (let i = 0; i < 100; i++) {
    try { await check(); return; } catch (caught) { error = caught; await delay(50); }
  }
  throw error;
}
const engine: ScanEngineFactory = async () => ({
  async visit(url) {
    const response = await fetch(url);
    await response.body?.cancel();
    return { status: 200, finalUrl: url, links: [], result: { url, timestamp: '2026-01-01T00:00:00Z', testEngine: { version: 'stand-in' }, toolOptions: {}, scanConfig: {}, scanStatus: 'complete', violations: [] } };
  },
  async close() {},
});

describe('real --start parent/child cleanup (no browser)', () => {
  for (const outcome of ['success', 'failure', 'timeout', 'SIGINT', 'SIGTERM']) {
    it(`reaps both PIDs and releases the port after ${outcome}`, async () => {
      const cwd = await mkdtemp(path.join(tmpdir(), 'a11ygate-tree-'));
      const reservation = await bind();
      const port = (reservation.address() as { port: number }).port;
      await close(reservation);
      const url = `http://127.0.0.1:${port}/`;
      const start = `"${process.execPath}" parent.cjs`;
      const pids: number[] = [];
      let harness: ReturnType<typeof spawn> | undefined;
      try {
        await writeFile(path.join(cwd, 'parent.cjs'), `
const { spawn } = require('node:child_process');
require('node:fs').writeFileSync('parent.pid', String(process.pid));
const child = spawn(process.execPath, ['child.cjs'], { stdio: 'ignore' });
child.on('exit', () => process.exit(0));
// Survive the graceful POSIX signal so escalation must reach the child too.
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
`);
        await writeFile(path.join(cwd, 'child.cjs'), `
require('node:fs').writeFileSync('child.pid', String(process.pid));
process.on('SIGTERM', () => {});
require('node:http').createServer((q,s) => { s.statusCode = ${outcome === 'timeout' ? 503 : 200}; s.end('ready'); }).listen(${port}, '127.0.0.1');
`);
        if (outcome === 'SIGINT' || outcome === 'SIGTERM') {
          // Isolate signal delivery from Vitest. Windows cannot deliver Unix signals
          // with kill(), so emit the Node signal event in the isolated harness.
          const source = await readFile(path.join(process.cwd(), 'packages/cli/src/local-server.ts'), 'utf8');
          await writeFile(path.join(cwd, 'local-server.mjs'), (await transform(source, { loader: 'ts', format: 'esm', target: 'node22' })).code);
          await writeFile(path.join(cwd, 'harness.mjs'), `
import { withLocalServer } from './local-server.mjs';
await withLocalServer({ start: ${JSON.stringify(start)}, waitOn: ${JSON.stringify(url)} }, process.cwd(), process.env, async () => {
  ${process.platform === 'win32' ? `process.emit('${outcome}');` : `process.kill(process.pid, '${outcome}');`}
  await new Promise(() => {});
});
`);
          harness = spawn(process.execPath, ['harness.mjs'], { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
          let stderr = '';
          harness.stderr!.on('data', (chunk) => { stderr += String(chunk); });
          const code = await new Promise<number | null>((resolve, reject) => { harness!.once('error', reject); harness!.once('exit', resolve); });
          expect(stderr).toBe('');
          expect(code).toBe(outcome === 'SIGINT' ? 130 : 143);
        } else {
          const failingEngine: ScanEngineFactory = async () => { throw new Error('intentional engine failure'); };
          const code = await runScan([url, '--start', start, '--wait-on', url, '--timeout-ms', outcome === 'timeout' ? '2000' : '10000', '--delay-ms', '0'], {
            cwd, engine: outcome === 'failure' ? failingEngine : engine, stdout() {}, stderr() {},
          });
          expect(code).toBe(outcome === 'success' ? 0 : 2);
        }
        for (const name of ['parent', 'child']) pids.push(Number(await readFile(path.join(cwd, `${name}.pid`), 'utf8')));
        await eventually(async () => {
          for (const pid of pids) expect(() => process.kill(pid, 0), `PID ${pid} survived ${outcome}`).toThrow();
        });
        // Binding proves the OS released the listening socket, independent of fetch caching.
        const rebound = await bind(port);
        await close(rebound);
      } finally {
        // Best-effort teardown also prevents a failing regression test leaving servers.
        harness?.kill('SIGKILL');
        for (const name of ['parent', 'child']) {
          const pid = Number(await readFile(path.join(cwd, `${name}.pid`), 'utf8').catch(() => '0'));
          if (!pid) continue;
          if (process.platform === 'win32') await new Promise<void>((resolve) => execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => resolve()));
          else { try { process.kill(pid, 'SIGKILL'); } catch { /* Already gone. */ } }
        }
        await rm(cwd, { recursive: true, force: true });
      }
    }, 20000);
  }
});
