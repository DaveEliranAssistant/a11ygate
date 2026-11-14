import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { serializeLighthouse } from '@/lib/scan/engines/lighthouse-lock';
import { runScan } from '@/packages/cli/src/scan';
import type { ScanReport } from '@/lib/scan/report';
import { startFixture } from '../scripts/bench-chromium.mjs';
import { guardLocalhostNetwork } from './network-guard';

it('serializes snapshots in order and releases the mutex after rejection', async () => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const order: string[] = [];
  const first = serializeLighthouse(async () => { order.push('first'); await held; throw Error('snapshot failed'); });
  const rejected = expect(first).rejects.toThrow('snapshot failed');
  const second = serializeLighthouse(async () => { order.push('second'); return 42; });
  await Promise.resolve();
  expect(order).toEqual(['first']);
  release();
  await rejected;
  expect(await second).toBe(42);
  expect(order).toEqual(['first', 'second']);
});

describe.skipIf(!existsSync(chromium.executablePath()))('Lighthouse concurrent local crawl', () => {
  it('matches concurrency 1 on ten pages with zero errors at concurrency 4 three times', async () => {
    const guard = guardLocalhostNetwork();
    const { server, origin } = await startFixture(10);
    try {
      async function scan(concurrency: number) {
        let output = ''; let errors = '';
        const code = await runScan([origin, '--engines', 'axe,lighthouse', '--concurrency', String(concurrency), '--max-pages', '10', '--delay-ms', '0', '--fail-on', 'none', '--json=-'], {
          env: { NODE_ENV: 'test' }, stdout: s => { output += s; }, stderr: s => { errors += s; },
        });
        expect(code, errors + output).toBe(0);
        expect(errors.match(/lighthouse serialized/g)).toHaveLength(1);
        const report = JSON.parse(output) as ScanReport;
        expect(report.pages).toHaveLength(10);
        expect(report.pages.every(p => p.scanStatus === 'complete')).toBe(true);
        expect(report.engineResults).toHaveLength(20);
        expect(report.engineResults!.every(e => e.status === 'complete')).toBe(true);
        return Object.fromEntries(report.engineResults!.filter(e => e.engine === 'lighthouse').map(e => [e.url,
          e.status === 'complete' ? [...new Set(e.findings.map(f => f.ruleId))].sort() : []]));
      }
      const serial = await scan(1);
      expect(Object.values(serial).some(ids => ids.includes('image-alt'))).toBe(true);
      for (let i = 0; i < 3; i++) expect(await scan(4)).toEqual(serial);
      expect(guard.attempts).toEqual([]);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      guard.restore();
    }
  }, 600_000);
});
