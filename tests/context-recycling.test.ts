import { describe, expect, it } from 'vitest';
import { ContextPool } from '@/lib/scan/context-pool';
import { parseScanArgs, runScan, scanHelpText, type ScanEngineFactory } from '@/packages/cli/src/scan';
import { fixturePage, parseBenchArgs, treeRss } from '../scripts/bench-chromium.mjs';

type FakeContext = { id: number; closed: boolean; close: () => Promise<void> };

function fakePool(recycleEvery?: number) {
  const made: FakeContext[] = [];
  const pool = new ContextPool<FakeContext>(async () => {
    const context: FakeContext = { id: made.length, closed: false, close: async () => { context.closed = true; } };
    made.push(context);
    return context;
  }, recycleEvery);
  return { pool, made };
}

describe('browser-context recycling', () => {
  it('keeps one context for the whole scan by default (historical behaviour)', async () => {
    const { pool, made } = fakePool();
    await pool.init();
    for (let i = 0; i < 50; i++) (await pool.acquire()).release();
    expect(made).toHaveLength(1);
    expect(pool.recycled).toBe(0);
    await pool.close();
    expect(made[0]!.closed).toBe(true);
  });

  it('recycles the context every N pages and closes retired contexts', async () => {
    const { pool, made } = fakePool(3);
    await pool.init();
    const used: number[] = [];
    for (let i = 0; i < 10; i++) {
      const lease = await pool.acquire();
      used.push(lease.context.id);
      lease.release();
    }
    expect(used).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2, 3]);
    expect(pool.created).toBe(4);
    expect(pool.recycled).toBe(3);
    await Promise.resolve();
    expect(made.slice(0, 3).every((c) => c.closed)).toBe(true);
    expect(made[3]!.closed).toBe(false);
    expect(pool.openContexts).toBe(1);
    await pool.close();
    expect(made.every((c) => c.closed)).toBe(true);
  });

  it('never closes a retired context while concurrent pages are still using it', async () => {
    const { pool, made } = fakePool(2);
    await pool.init();
    const [a, b] = await Promise.all([pool.acquire(), pool.acquire()]);
    const c = await pool.acquire();
    expect([a.context.id, b.context.id, c.context.id]).toEqual([0, 0, 1]);
    expect(made[0]!.closed).toBe(false);
    a.release();
    expect(made[0]!.closed).toBe(false);
    b.release();
    b.release(); // double release is harmless
    await Promise.resolve();
    expect(made[0]!.closed).toBe(true);
    c.release();
    await pool.close();
  });

  it('creates a single new context when concurrent acquires cross the budget', async () => {
    const { pool, made } = fakePool(1);
    await pool.init();
    const leases = await Promise.all(Array.from({ length: 4 }, () => pool.acquire()));
    expect(new Set(leases.map((l) => l.context.id)).size).toBe(4);
    expect(made).toHaveLength(4);
    leases.forEach((l) => l.release());
    await pool.close();
    expect(made.every((c) => c.closed)).toBe(true);
  });

  it('rejects invalid budgets', () => {
    expect(() => new ContextPool(async () => ({ close: async () => undefined }), 0)).toThrow();
  });
});

describe('--recycle-every', () => {
  const origin = 'http://127.0.0.1:9';
  it('is opt-in, validated and documented', () => {
    const plain = parseScanArgs([origin]);
    expect(plain.ok && plain.options.recycleEvery).toBeUndefined();
    expect(parseScanArgs([origin, '--recycle-every=50'])).toMatchObject({ ok: true, options: { recycleEvery: 50 } });
    for (const v of ['0', '1001', 'x']) expect(parseScanArgs([origin, `--recycle-every=${v}`]).ok).toBe(false);
    expect(scanHelpText()).toContain('--recycle-every <n>');
  });

  it('passes the budget to the engine only when the flag is given', async () => {
    const seen: (number | undefined)[] = [];
    const engine: ScanEngineFactory = async (opts) => {
      seen.push(opts.recycleEvery);
      return { visit: async (url) => ({ status: 200, finalUrl: url, contentType: 'text/html', links: [], result: { url, violations: [], passes: [], incomplete: [], inapplicable: [] } as never }), close: async () => undefined };
    };
    const io = { engine, stdout: () => undefined, stderr: () => undefined, fetch: (async () => new Response('', { status: 404 })) as never };
    await runScan([origin, '--json=-'], io);
    await runScan([origin, '--json=-', '--recycle-every', '7'], io);
    expect(seen).toEqual([undefined, 7]);
  });
});

describe('bench script helpers (no browser)', () => {
  it('parses the default matrix and sums descendant RSS separately from the Node process', () => {
    expect(parseBenchArgs([])).toMatchObject({ pages: 500, concurrency: [1, 2, 4], engines: ['axe', 'all'] });
    expect(() => parseBenchArgs(['--engines', 'remote'])).toThrow();
    const table = new Map([[10, { ppid: 1, rssBytes: 100 }], [11, { ppid: 10, rssBytes: 20 }], [12, { ppid: 11, rssBytes: 5 }], [13, { ppid: 1, rssBytes: 999 }]]);
    expect(treeRss(table, 10)).toEqual({ node: 100, browser: 25, processes: 2 });
  });
  it('generates deterministic local fixture pages', () => {
    expect(fixturePage(3, 500)).toBe(fixturePage(3, 500));
    expect(fixturePage(0, 500).match(/href="\/p\/\d+">Page/g)).toHaveLength(499);
  });
});

// Opt-in: npm test never launches Chromium unless A11YGATE_CRAWL_BROWSER_TESTS=1.
describe.skipIf(process.env.A11YGATE_CRAWL_BROWSER_TESTS !== '1')('real Chromium context recycling (opt-in)', () => {
  it('recycles the browser context every N pages while scanning a local fixture', async () => {
    const { startFixture } = await import('../scripts/bench-chromium.mjs');
    const { playwrightEngine } = await import('@/packages/cli/src/scan');
    const { server, origin } = await startFixture(6);
    const engine = await playwrightEngine({ userAgent: 'A11yGate/test', origin, engines: ['axe'], recycleEvery: 2 });
    try {
      for (let i = 0; i < 5; i++) {
        const outcome = await engine.visit(`${origin}/p/${i + 1}`, false);
        expect(outcome.result).toBeDefined();
      }
      expect(engine.contexts?.()).toEqual({ created: 3, recycled: 2 });
    } finally {
      await engine.close();
      server.close();
    }
  }, 60_000);
});
