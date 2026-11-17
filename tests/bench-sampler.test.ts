import { describe, expect, it } from 'vitest';
import { PS_ARGS, parsePsOutput, readProcessTable, startTreeSampler, sumTree } from '../scripts/proc-tree-sampler.mjs';
import { parseBenchArgs } from '../scripts/bench-chromium.mjs';

// Recorded-shape `ps -A -o pid=,ppid=,rss=,comm=` output (RSS in KiB). Pid 500 is the Node
// CLI; 501 is the Chromium browser; 502-505 are its GPU, network and renderer children;
// 506 is a renderer's grandchild. 900/901 are unrelated processes that must not be counted.
const MAC_PS = `    1     0  12000 /sbin/launchd
  500   400 300000 node
  501   500 150000 /Users/x/Library/Caches/ms-playwright/chromium_headless_shell-1200/chrome-mac/headless_shell
  502   501  60000 /Users/x/Library/Caches/ms-playwright/chromium_headless_shell-1200/chrome-mac/headless_shell Helper (GPU)
  503   501  40000 /Users/x/Library/Caches/ms-playwright/chromium_headless_shell-1200/chrome-mac/headless_shell Helper
  504   501 120000 /Users/x/Library/Caches/ms-playwright/chromium_headless_shell-1200/chrome-mac/headless_shell Helper (Renderer)
  505   501 110000 /Users/x/Library/Caches/ms-playwright/chromium_headless_shell-1200/chrome-mac/headless_shell Helper (Renderer)
  506   504   1000 cat
  900     1 777777 Google Chrome
  901   900 555555 Google Chrome Helper (Renderer)
`;

// Linux procps prints the same columns; comm is the short name.
const LINUX_PS = `  1  0  9000 systemd
 42  1  3000 bash
 77 42 250000 node
 78 77 140000 headless_shell
 79 78  50000 headless_shell
 80 78  90000 headless_shell
 81 42  80000 node
`;

const KiB = 1024;

describe('process-tree RSS sampler (A11Y-R49)', () => {
  it('uses the same portable ps columns on macOS and Linux', () => {
    expect(PS_ARGS).toEqual(['-A', '-o', 'pid=,ppid=,rss=,comm=']);
  });

  it('parses macOS ps output, keeping commands with spaces', () => {
    const table = parsePsOutput(MAC_PS);
    expect(table.size).toBe(10);
    expect(table.get(504)).toMatchObject({ ppid: 501, rssBytes: 120000 * KiB });
    expect(table.get(504)!.command).toMatch(/Helper \(Renderer\)$/);
  });

  it('sums Node plus every Chromium descendant (grandchildren included, unrelated processes excluded)', () => {
    const tree = sumTree(parsePsOutput(MAC_PS), 500);
    expect(tree.rootBytes).toBe(300000 * KiB);
    expect(tree.descendantsBytes).toBe((150000 + 60000 + 40000 + 120000 + 110000 + 1000) * KiB);
    expect(tree.totalBytes).toBe(781000 * KiB);
    expect(tree.processCount).toBe(7);
    expect(tree.pids.sort((a, b) => a - b)).toEqual([500, 501, 502, 503, 504, 505, 506]);
  });

  it('sums Linux ps output the same way and ignores a sibling Node process', () => {
    const tree = sumTree(parsePsOutput(LINUX_PS), 77);
    expect(tree.totalBytes).toBe((250000 + 140000 + 50000 + 90000) * KiB);
    expect(tree.processCount).toBe(4);
  });

  it('reads the table through an injectable ps runner', () => {
    const calls: Array<[string, string[]]> = [];
    const table = readProcessTable((cmd, args) => { calls.push([cmd, args]); return LINUX_PS; });
    expect(calls).toEqual([['ps', PS_ARGS]]);
    expect(sumTree(table, 77).totalBytes).toBe(530000 * KiB);
  });

  it('returns zeros for an exited root and survives a malformed self-parent cycle', () => {
    expect(sumTree(parsePsOutput(LINUX_PS), 12345)).toEqual({ rootBytes: 0, descendantsBytes: 0, totalBytes: 0, processCount: 0, pids: [] });
    const cyclic = parsePsOutput('10 12 100\n11 10 10\n12 11 1\n13 13 5\n');
    expect(sumTree(cyclic, 10).totalBytes).toBe(111 * KiB);
  });

  it('keeps the peak of the per-sample total, not the sum of per-process peaks', () => {
    // Sample 1: Node high, Chromium low. Sample 2: Node low, Chromium high.
    const frames = [
      '10 1 400\n11 10 100\n',
      '10 1 100\n11 10 350\n12 11 50\n',
      'garbage line\n', // exited / unreadable: no sample, no crash
    ];
    let i = 0;
    const seen: number[] = [];
    const sampler = startTreeSampler(10, { intervalMs: 60_000, readTable: () => parsePsOutput(frames[i++] ?? ''), onSample: (s) => seen.push(s.totalBytes) });
    sampler.tick();
    sampler.tick();
    const { peak, samples, intervalMs } = sampler.stop();
    expect(seen).toEqual([500 * KiB, 500 * KiB]);
    expect(samples).toBe(2);
    expect(peak.totalBytes).toBe(500 * KiB); // not 400 + 400
    expect(peak.rootBytes).toBe(400 * KiB);
    expect(peak.descendantsBytes).toBe(400 * KiB);
    expect(peak.processCount).toBe(3);
    expect(intervalMs).toBe(60_000);
  });

  it('counts a failing ps call as a sampler error instead of throwing', () => {
    const sampler = startTreeSampler(10, { intervalMs: 60_000, readTable: () => { throw new Error('ps raced with exit'); } });
    expect(sampler.stop()).toMatchObject({ samples: 0, errors: 1 });
  });

  it('defaults to a 250 ms interval', () => {
    const sampler = startTreeSampler(10, { readTable: () => new Map() });
    expect(sampler.stop().intervalMs).toBe(250);
  });
});

describe('bench v2 options', () => {
  it('accepts the per-run cut-off and the start window, and rejects bad values', () => {
    expect(parseBenchArgs(['--max-run-ms', '1800000', '--no-new-cell-after', '2026-11-17T13:40:00Z'])).toMatchObject({ maxRunMs: 1_800_000, noNewCellAfter: '2026-11-17T13:40:00Z' });
    expect(parseBenchArgs([])).toMatchObject({ maxRunMs: 900_000, noNewCellAfter: null });
    expect(() => parseBenchArgs(['--max-run-ms', '10'])).toThrow();
    expect(() => parseBenchArgs(['--no-new-cell-after', 'soon'])).toThrow();
  });
});
