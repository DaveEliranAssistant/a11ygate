import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { blockNetwork } from './network-guard';
import { IncrementalCache, installedEngineVersions, normalizeDom, type CachedAnalysis } from '@/packages/cli/src/incremental';
import { parseScanArgs, runScan, type ScanEngineFactory } from '@/packages/cli/src/scan';
import { buildEvidencePack } from '@/lib/evidence/pack';
import type { ScanReport } from '@/lib/scan/report';
import type { AxeResults } from '@/lib/types';

const result = (url: string): AxeResults => ({ url, timestamp: '2026-11-17T00:00:00Z', testEngine: { version: 'fixture-1' }, violations: [{ id: 'image-alt', impact: 'critical', tags: ['wcag111'], help: 'Image needs alternative text', helpUrl: 'https://example.test/rule', nodes: [{ target: ['img'], html: '<img>' }] }] });
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); vi.restoreAllMocks(); });
async function directory() { const dir = await mkdtemp(path.join(tmpdir(), 'a11y-r60-')); dirs.push(dir); return dir; }
const fixtureAnalysis = (url: string): CachedAnalysis => ({ result: result(url), engineResults: [], rawEngineResults: [{ engine: 'axe', url, status: 'complete', native: result(url) }] });

describe('incremental fixture scans', () => {
  it('runs no engines on the second scan, rescans only a changed page, invalidates versions/config, and marks evidence', async () => {
    const guard = blockNetwork();
    try {
      const dir = await directory();
      const pages: Record<string, string> = { '/': '<main><a href="/other">Other</a><img></main>', '/other': '<main><img></main>' };
      let engineVersion = '1'; let ruleConfig = 'a';
      const engineRuns: string[] = [];
      // Local rendered fixture adapter uses the same cache boundary as Playwright.
      const engine: ScanEngineFactory = async ({ incremental }) => {
        const cache = incremental ? new IncrementalCache({ ...incremental, config: { scan: incremental.config, engineVersion, ruleConfig } }) : undefined;
        return { incremental: cache, close: async () => {}, visit: async url => {
          const run = async () => { engineRuns.push(url); return fixtureAnalysis(url); };
          const analysis = cache ? await cache.analyze(url, pages[new URL(url).pathname]!, run) : await run();
          return { status: 200, finalUrl: url, contentType: 'text/html', links: new URL(url).pathname === '/' ? [new URL('/other', url).href] : [], result: analysis.result };
        } };
      };
      async function scan(cache = true) {
        let json = ''; let warnings = '';
        const code = await runScan(['http://127.0.0.1/', '--crawl', '2', '--ignore-robots', '--delay-ms', '0', '--json', '-', ...(cache ? ['--incremental', dir] : [])], { engine, env: { NODE_ENV: 'test' }, repoConfig: null, stdout: s => { json += s; }, stderr: s => { warnings += s; } });
        expect(code, warnings).toBe(1);
        return { report: JSON.parse(json) as ScanReport, warnings };
      }
      const first = (await scan()).report;
      expect(engineRuns).toHaveLength(2);
      engineRuns.length = 0;
      const second = (await scan()).report;
      expect(engineRuns).toHaveLength(0);
      expect(second.findings).toEqual(first.findings);
      expect(second.pages.map(p => p.cache?.scanId)).toEqual([first.incremental?.scanId, first.incremental?.scanId]);
      expect(second.pages[0].cache?.note).toBe(`from cache (DOM unchanged since ${first.incremental?.scanId})`);
      const pack = buildEvidencePack({ scanJson: JSON.stringify(second), files: [], toolVersion: 'test', commit: { sha: 'abc', source: 'flag' }, packedAt: new Date('2026-11-17T00:00:00Z') });
      expect(pack.ok).toBe(true);
      if (!pack.ok) throw Error(pack.error);
      expect(pack.manifest.scope.pages.every(p => p.cache?.scanId === first.incremental?.scanId)).toBe(true);
      for (const name of ['report.md', 'report.html', 'scan/a11ygate-scan.md', 'scan/a11ygate-scan.html']) {
        expect(Buffer.from(pack.entries.find(e => e.path === name)!.data).toString()).toMatch(/from cache.*DOM unchanged since/);
      }
      pages['/other'] += '<p>Changed</p>';
      await scan();
      expect(engineRuns).toEqual(['http://127.0.0.1/other']);
      engineRuns.length = 0;
      engineVersion = '2'; await scan(); expect(engineRuns).toHaveLength(2);
      engineRuns.length = 0;
      ruleConfig = 'b'; await scan(); expect(engineRuns).toHaveLength(2);
      engineRuns.length = 0;
      await writeFile(path.join(dir, (await readdir(dir))[0]!), '{broken');
      const corrupted = await scan();
      expect(corrupted.warnings).toContain('corrupted');
      expect(engineRuns).toHaveLength(2);
      expect(corrupted.report.pages.every(p => !p.cache)).toBe(true);
      engineRuns.length = 0;
      const defaultRun = await scan(false);
      expect(defaultRun.report.incremental).toBeUndefined();
      expect(engineRuns).toHaveLength(2);
      expect(guard.attempts).toEqual([]);
    } finally { guard.restore(); }
  });

  it('normalizes nonces, CSRF fields and ISO timestamps, and supports replacement regexes', async () => {
    const dom = (n: string) => `<script nonce="${n}"></script><input name="csrf_token" value="${n}"><meta content="${n}" name="csrf-token"><time>2026-11-17T00:00:0${n}Z</time><p data-timestamp="${n}">stable</p>`;
    expect(normalizeDom(dom('1'))).toBe(normalizeDom(dom('2')));
    expect(normalizeDom('<p>build-1</p>', ['build-\\d+'])).toBe(normalizeDom('<p>build-2</p>', ['build-\\d+']));
    expect(normalizeDom('<img alt="one">')).not.toBe(normalizeDom('<img alt="two">'));
    const dir = await directory(); const run = vi.fn(async () => fixtureAnalysis('http://127.0.0.1/'));
    await new IncrementalCache({ dir, config: {}, patterns: ['build-\\d+'], warn: vi.fn() }).analyze('http://127.0.0.1/', '<p>build-1</p>', run);
    await new IncrementalCache({ dir, config: {}, patterns: ['build-\\d+'], warn: vi.fn() }).analyze('http://127.0.0.1/', '<p>build-2</p>', run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(parseScanArgs(['http://127.0.0.1/', '--incremental-normalize', '['])).toMatchObject({ ok: false });
  });

  it('ignores checksum corruption and never caches failed engine results', async () => {
    const dir = await directory(); const warn = vi.fn();
    const cache = () => new IncrementalCache({ dir, config: {}, warn });
    const run = vi.fn(async () => fixtureAnalysis('http://127.0.0.1/'));
    await cache().analyze('http://127.0.0.1/', '<img>', run);
    const file = path.join(dir, (await readdir(dir))[0]!);
    const entry = JSON.parse(await readFile(file, 'utf8')); entry.payload += ' ';
    await writeFile(file, JSON.stringify(entry));
    await cache().analyze('http://127.0.0.1/', '<img>', run);
    expect(run).toHaveBeenCalledTimes(2); expect(warn).toHaveBeenCalledOnce();
    const failed = vi.fn(async (): Promise<CachedAnalysis> => ({ engineResults: [{ engine: 'axe', url: '/failed', status: 'errored', error: 'failed' }], rawEngineResults: [] }));
    await cache().analyze('/failed', '<img>', failed); await cache().analyze('/failed', '<img>', failed);
    expect(failed).toHaveBeenCalledTimes(2);
    expect(installedEngineVersions(['axe'])).toMatchObject({ 'axe-core': expect.any(String), playwright: expect.any(String) });
  });
});
