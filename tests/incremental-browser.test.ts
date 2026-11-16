import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { guardLocalhostNetwork } from './network-guard';
import * as incrementalModule from '@/packages/cli/src/incremental';
import { runScan } from '@/packages/cli/src/scan';
import type { ScanReport } from '@/lib/scan/report';

// Matches the existing optional Chromium acceptance convention; exercised explicitly in this PR.
describe.skipIf(process.env.A11YGATE_BROWSER_TESTS !== '1')('incremental Chromium fixture', () => {
  it('hashes loaded DOM and replayed interaction states, preserving findings while skipping axe', async () => {
    const guard = guardLocalhostNetwork();
    const dir = await mkdtemp(path.join(tmpdir(), 'r60-browser-'));
    const AxeBuilder = (await import('@axe-core/playwright')).default;
    const analyze = vi.spyOn(AxeBuilder.prototype, 'analyze');
    let changed = false; let counter = 0;
    const server = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      const token = String(++counter);
      const body = req.url === '/other' ? `<main><h1>Other</h1>${changed ? '<hr>' : '<img src="data:,">'}</main>` : `<main><h1>Home</h1><a href="/other">Other</a><button id="open" aria-expanded="false" onclick="this.setAttribute('aria-expanded','true');document.getElementById('panel').hidden=false">Open</button><div id="panel" hidden><img src="data:,"></div><input type="hidden" name="csrf_token" value="${token}"></main>`;
      res.end(`<!doctype html><html lang="en"><title>Fixture</title><meta name="csrf-token" content="${token}"><script nonce="${token}"></script>${body}</html>`);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
    const states = [{ route: '/', name: 'opened', steps: [{ action: 'click', selector: '#open' }] }];
    const scan = async (flags: string[] = []) => {
      let json = ''; let errors = '';
      const code = await runScan([origin, '--crawl', '2', '--ignore-robots', '--delay-ms', '0', '--incremental', dir, '--interactions', JSON.stringify(states), '--json', '-', ...flags], { repoConfig: null, env: { NODE_ENV: 'test' }, stdout: s => { json += s; }, stderr: s => { errors += s; } });
      expect(code, errors).toBe(1);
      expect(errors).not.toContain('cache disabled');
      return JSON.parse(json) as ScanReport;
    };
    try {
      const first = await scan();
      expect(analyze).toHaveBeenCalledTimes(3);
      expect(first.findings.some(f => f.states?.includes(origin + '/#opened'))).toBe(true);
      analyze.mockClear();
      const second = await scan();
      expect(analyze).not.toHaveBeenCalled();
      expect(second.findings).toEqual(first.findings);
      expect(second.pages).toHaveLength(3);
      expect(second.pages.every(p => p.cache?.scanId === first.incremental?.scanId)).toBe(true);
      changed = true;
      const third = await scan();
      expect(analyze).toHaveBeenCalledTimes(1);
      expect(third.pages.find(p => p.url === origin + '/other')?.cache).toBeUndefined();
      expect(third.findings.filter(f => f.ruleId === 'image-alt')).toHaveLength(1);
      analyze.mockClear();
      const multi = await scan(['--engines', 'axe,htmlcs']);
      expect(analyze).toHaveBeenCalledTimes(3);
      expect(multi.engineResults).toHaveLength(6);
      expect(multi.engineResults?.every(r => r.status === 'complete')).toBe(true);
      analyze.mockClear();
      expect((await scan(['--engines', 'axe,htmlcs'])).findings).toEqual(multi.findings);
      expect(analyze).not.toHaveBeenCalled();
      const versions = incrementalModule.installedEngineVersions(['axe', 'htmlcs'])!;
      const versionSpy = vi.spyOn(incrementalModule, 'installedEngineVersions').mockReturnValue({ ...versions, 'axe-core': 'fixture-version-bump' });
      try {
        const bumped = await scan(['--engines', 'axe,htmlcs']);
        expect(analyze).toHaveBeenCalledTimes(3);
        expect(bumped.pages.every(p => !p.cache)).toBe(true);
      } finally { versionSpy.mockRestore(); }
      expect(guard.attempts).toEqual([]);
    } finally {
      analyze.mockRestore();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
      guard.restore();
    }
  }, 120_000);
});
