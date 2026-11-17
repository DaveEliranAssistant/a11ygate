export type ProcessInfo = { ppid: number; rssBytes: number; command?: string };
export type ProcessTable = Map<number, ProcessInfo>;
export type TreeSum = { rootBytes: number; descendantsBytes: number; totalBytes: number; processCount: number; pids: number[] };
export type TreePeak = { rootBytes: number; descendantsBytes: number; totalBytes: number; processCount: number };
export const PS_ARGS: string[];
export function parsePsOutput(text: string): ProcessTable;
export function readProcessTable(exec?: (cmd: string, args: string[]) => string): ProcessTable;
export function sumTree(table: ProcessTable, rootPid: number): TreeSum;
export function startTreeSampler(
  rootPid: number,
  options?: { intervalMs?: number; readTable?: () => ProcessTable; onSample?: (sample: TreeSum & { t: number }) => void; now?: () => number },
): { tick: () => void; lastPids: () => number[]; stop: () => { peak: TreePeak; samples: number; errors: number; intervalMs: number } };
