import type { Server } from 'node:http';

export type BenchOptions = { pages: number; concurrency: number[]; engines: string[]; recycleEvery: number[]; out: string; name: string; maxRunMs: number };
export function parseBenchArgs(argv: readonly string[]): BenchOptions;
export function fixturePage(index: number, total: number): string;
export function startFixture(total: number): Promise<{ server: Server; origin: string }>;
export function treeRss(table: Map<number, { ppid: number; rssBytes: number }>, rootPid: number): { node: number; browser: number; processes: number };
