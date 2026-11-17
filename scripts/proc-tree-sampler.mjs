// Whole-process-tree RSS sampler for the benchmark (A11Y-R49).
//
// Reads the process table with `ps -A -o pid=,ppid=,rss=,comm=` (same flags on macOS and
// Linux procps; RSS is reported in KiB on both), walks the tree below a root pid and sums
// the RSS of the root (the Node CLI) and every descendant (Chromium browser, GPU, network,
// utility and renderer processes). Sampling runs every 250 ms by default and keeps the
// peak of the summed total, not the sum of per-process peaks.
import { execFileSync } from 'node:child_process';

export const PS_ARGS = ['-A', '-o', 'pid=,ppid=,rss=,comm='];

/** Parse `ps -A -o pid=,ppid=,rss=,comm=` output into pid -> { ppid, rssBytes, command }. */
export function parsePsOutput(text) {
  const table = new Map();
  for (const line of String(text).split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*(.*)$/.exec(line);
    if (m) table.set(Number(m[1]), { ppid: Number(m[2]), rssBytes: Number(m[3]) * 1024, command: m[4].trim() });
  }
  return table;
}

/** Run `ps` and parse it. `exec` is injectable so tests can feed recorded output. */
export function readProcessTable(exec = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })) {
  return parsePsOutput(exec('ps', PS_ARGS));
}

/**
 * Sum RSS over the tree rooted at rootPid (root included). Returns zeros when the root is
 * not in the table (already exited). Cycles in a malformed table are ignored.
 */
export function sumTree(table, rootPid) {
  const root = table.get(rootPid);
  if (!root) return { rootBytes: 0, descendantsBytes: 0, totalBytes: 0, processCount: 0, pids: [] };
  const children = new Map();
  for (const [pid, info] of table) {
    if (pid === info.ppid) continue;
    if (!children.has(info.ppid)) children.set(info.ppid, []);
    children.get(info.ppid).push(pid);
  }
  const seen = new Set([rootPid]);
  const pids = [rootPid];
  let descendantsBytes = 0;
  const stack = [...(children.get(rootPid) ?? [])];
  while (stack.length) {
    const pid = stack.pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    pids.push(pid);
    descendantsBytes += table.get(pid)?.rssBytes ?? 0;
    stack.push(...(children.get(pid) ?? []));
  }
  return { rootBytes: root.rssBytes, descendantsBytes, totalBytes: root.rssBytes + descendantsBytes, processCount: pids.length, pids };
}

/**
 * Start sampling the tree below rootPid every intervalMs. `stop()` returns the peaks and
 * sample count. `onSample` receives every sample (used for the growth metric).
 */
export function startTreeSampler(rootPid, { intervalMs = 250, readTable = readProcessTable, onSample, now = () => performance.now() } = {}) {
  const startedAt = now();
  const peak = { rootBytes: 0, descendantsBytes: 0, totalBytes: 0, processCount: 0 };
  let samples = 0; let errors = 0; let lastPids = [];
  const tick = () => {
    let tree;
    try { tree = sumTree(readTable(), rootPid); } catch { errors += 1; return; } // ps can race with process exit.
    if (!tree.processCount) return;
    samples += 1;
    lastPids = tree.pids;
    peak.rootBytes = Math.max(peak.rootBytes, tree.rootBytes);
    peak.descendantsBytes = Math.max(peak.descendantsBytes, tree.descendantsBytes);
    peak.totalBytes = Math.max(peak.totalBytes, tree.totalBytes);
    peak.processCount = Math.max(peak.processCount, tree.processCount);
    onSample?.({ t: Math.round(now() - startedAt), ...tree });
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  return {
    tick,
    lastPids: () => lastPids,
    stop() { clearInterval(timer); return { peak: { ...peak }, samples, errors, intervalMs }; },
  };
}
