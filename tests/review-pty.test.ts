/**
 * A11Y-R51: drive the real built CLI (packages/cli/dist/cli.mjs) through a real
 * pseudo-terminal with node-pty. node-pty is an optional native dependency; when
 * it is missing or its native build fails, the pty tests skip with a note and the
 * non-TTY test still runs. Everything happens in a mkdtemp dir; no network.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, constants as fsConstants, chmodSync, existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { createFingerprintBaseline } from '@/lib/scan/baseline';
import { buildScanReport } from '@/lib/scan/report';
import { createGroupDecision, groupId, reviewableGroups } from '@/lib/scan/review';
import type { AxeResults } from '@/lib/types';

/** The slice of node-pty used here, typed locally so typecheck passes when the optional package is absent. */
type PtyProcess = {
  onData(listener: (data: string) => void): unknown;
  onExit(listener: (e: { exitCode: number; signal?: number }) => void): unknown;
  write(data: string): void;
  kill(signal?: string): void;
};
type Pty = { spawn(file: string, args: string[], options: { name?: string; cols?: number; rows?: number; cwd?: string; env?: Record<string, string> }): PtyProcess };
const NODE_PTY = 'node-pty';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distCli = path.join(repoRoot, 'packages/cli/dist/cli.mjs');
const REVIEWER = 'PTY Reviewer';
const TIMEOUT = 60_000;
const WAIT = 20_000;

/**
 * node-pty 1.1.0's macOS prebuilds ship `spawn-helper` without the execute bit,
 * so every spawn fails with "posix_spawnp failed". Restore it before probing.
 */
function fixSpawnHelper() {
  try {
    const root = path.dirname(createRequire(import.meta.url).resolve('node-pty/package.json'));
    for (const dir of [path.join(root, 'prebuilds', `${process.platform}-${process.arch}`), path.join(root, 'build', 'Release')]) {
      const helper = path.join(dir, 'spawn-helper');
      if (!existsSync(helper)) continue;
      try { accessSync(helper, fsConstants.X_OK); } catch { chmodSync(helper, 0o755); }
    }
  } catch { /* not installed; the probe below reports it */ }
}

async function loadPty(): Promise<{ pty?: Pty; reason?: string }> {
  try {
    const mod = (await import(/* @vite-ignore */ NODE_PTY)) as Pty & { default?: Pty };
    const pty: Pty = typeof mod.spawn === 'function' ? mod : mod.default!;
    fixSpawnHelper();
    const probe = pty.spawn(process.execPath, ['-e', 'process.stdout.write(String(process.stdin.isTTY))'], { cols: 80, rows: 24, cwd: tmpdir(), env: process.env as Record<string, string> });
    let out = '';
    probe.onData((d) => { out += d; });
    const code = await new Promise<number>((resolve) => probe.onExit((e) => resolve(e.exitCode)));
    if (code !== 0 || !out.includes('true')) return { reason: `node-pty probe did not get a TTY (exit ${code}, output ${JSON.stringify(out)})` };
    return { pty };
  } catch (error) {
    return { reason: `node-pty is not installed or its native build failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

const loaded = await loadPty();
const pty = loaded.pty;
if (!pty) console.warn(`[review-pty] Skipping pseudo-TTY review tests: ${loaded.reason}. Install with \`npm install\` (node-pty is an optionalDependency) to run them.`);

const origin = 'http://localhost';
const RULES = [
  { id: 'link-name', impact: 'serious' as const, tags: ['wcag244'], help: 'Links must have discernible text', target: 'nav > a.nav-link', html: '<a class="nav-link" href="/x"><img src="/icon.svg"></a>' },
  { id: 'image-alt', impact: 'critical' as const, tags: ['wcag111'], help: 'Images must have alternate text', target: 'footer > img.logo', html: '<img class="logo" src="/logo.png">' },
  { id: 'button-name', impact: 'critical' as const, tags: ['wcag412'], help: 'Buttons must have discernible text', target: 'header > button.menu', html: '<button class="menu"></button>' },
];

function page(pathname: string): AxeResults {
  return { url: origin + pathname, timestamp: '2026-11-14T00:00:00Z', testEngine: { version: '4.11.1' }, violations: RULES.map((r) => ({
    id: r.id, impact: r.impact, tags: r.tags, help: r.help, helpUrl: `https://example.test/${r.id}`, nodes: [{ target: [r.target], html: r.html }],
  })) };
}

function report(paths: string[]) {
  return buildScanReport({ crawl: { pages: paths.map((p) => ({ url: origin + p, finalUrl: origin + p, status: 200, scanStatus: 'complete' as const, result: page(p) })), skipped: [] },
    version: '0.2.0', scannedAt: '2026-11-14T00:00:00Z', startUrl: origin + '/', failOn: 'serious', maxPages: 5, delayMs: 0, userAgent: 'fixture', robotsNote: 'fixture' });
}

const scan = report(['/', '/about', '/contact']);
/** Shared groups in the order the CLI prompts for them. */
const shared = reviewableGroups(scan.findings).filter((g) => g.likelySharedComponent);
/** Roles: shared[0] gets accepted-risk; shared[1] has an earlier decision that is removed; quit at shared[2]. */
const earlier = () => createGroupDecision(shared[1]!, { decision: 'false-positive', reason: 'Earlier triage note', by: 'Earlier Reviewer', now: new Date('2026-10-01T00:00:00Z') });

let work = '';
let cli = '';

beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), 'a11ygate-review-pty-'));
  // Copy the committed build so a parallel `cli:build` (packages/cli/cli.test.ts) cannot swap it mid-test.
  cli = path.join(work, 'cli.mjs');
  let previous = '';
  for (let i = 0; i < 50; i++) {
    const text = await readFile(distCli, 'utf8');
    if (text.length > 0 && text === previous) break;
    previous = text;
    await new Promise((r) => setTimeout(r, 100));
  }
  await copyFile(distCli, cli);
}, TIMEOUT);

afterAll(async () => { if (work) await rm(work, { recursive: true, force: true }); });

async function workspace(name: string) {
  const cwd = path.join(work, name);
  await mkdir(cwd);
  await writeFile(path.join(cwd, 'scan.json'), JSON.stringify(scan));
  const baseline = path.join(cwd, 'baseline.json');
  await writeFile(baseline, JSON.stringify({ ...createFingerprintBaseline(report([])), groupDecisions: [earlier()] }, null, 2) + '\n');
  return { cwd, baseline };
}

/** Reviewer name for the child from command-line-level git config; no git repo or global config needed. */
function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('GIT_CONFIG') && k !== 'A11YGATE_DEBUG') env[k] = v;
  return { ...env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_VALUE_0: REVIEWER, NO_COLOR: '1', TERM: 'xterm' };
}

class Session {
  private out = '';
  private cursor = 0;
  readonly exited: Promise<{ exitCode: number; signal?: number }>;
  constructor(private readonly term: PtyProcess) {
    term.onData((d) => { this.out += d; });
    this.exited = new Promise((resolve) => term.onExit(resolve));
  }
  get text() { return this.out; }
  /** Wait for `needle` after everything already consumed; returns the text in between. */
  async expect(needle: string): Promise<string> {
    const deadline = Date.now() + WAIT;
    for (;;) {
      const at = this.out.indexOf(needle, this.cursor);
      if (at >= 0) {
        const seen = this.out.slice(this.cursor, at + needle.length);
        this.cursor = at + needle.length;
        return seen;
      }
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${JSON.stringify(needle)}. Output so far:\n${this.out}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  send(keys: string) { this.term.write(keys); }
  kill() { try { this.term.kill(); } catch { /* already gone */ } }
}

function startReview(cwd: string): Session {
  return new Session(pty!.spawn(process.execPath, [cli, 'review', 'scan.json', '--baseline', 'baseline.json'], { name: 'xterm', cols: 200, rows: 50, cwd, env: childEnv() }));
}

const PROMPT = '[s] skip  [q] quit: ';

/** Stable view of the baseline: the CLI's own clock (decision dates, history timestamps) is replaced by placeholders. */
function normalize(text: string) {
  const json = JSON.parse(text) as { groupDecisions?: { by: string; at: string }[]; history?: { action: string; group: string; at: string; decision?: { by: string; at: string } }[] };
  const stamp = <T extends { by: string; at: string }>(d: T): T => (d.by === REVIEWER ? { ...d, at: '<today>' } : d);
  return {
    ...json,
    groupDecisions: json.groupDecisions?.map(stamp),
    history: json.history?.map((h) => {
      expect(Number.isNaN(Date.parse(h.at))).toBe(false);
      return { ...h, at: '<timestamp>', ...(h.decision ? { decision: stamp(h.decision) } : {}) };
    }),
  };
}

describe('a11ygate review in a real pseudo-TTY (A11Y-R51)', () => {
  if (!pty) it.skip(`pseudo-TTY tests skipped: ${loaded.reason}`, () => {});

  it('fixture has three likely shared groups', () => {
    expect(shared.map((g) => g.ruleId).sort()).toEqual(['button-name', 'image-alt', 'link-name']);
  });

  it.skipIf(!pty)('lists groups, records accepted-risk with reason and expiry, removes one, quits; baseline matches the snapshot', async () => {
    const { cwd, baseline } = await workspace('flow');
    const s = startReview(cwd);
    try {
      const first = await s.expect(PROMPT);
      expect(first).toContain('3 likely shared component group(s) to review');
      expect(first).toContain(AUTOMATED_TESTING_DISCLAIMER);
      expect(first).toContain(groupId(shared[0]!.key));
      expect(first).toContain('decision: none');
      expect(first).not.toContain('[r] remove decision');
      s.send('a\r');
      await s.expect('Reason (required): ');
      s.send('Third-party widget; vendor ticket VND-42\r');
      await s.expect('Expires YYYY-MM-DD (optional, blank for none): ');
      s.send('2001-01-01\r');
      await s.expect('--expires is already in the past.');
      await s.expect('Expires YYYY-MM-DD (optional, blank for none): ');
      s.send('2099-12-31\r');

      const second = await s.expect(PROMPT);
      expect(second).toContain(groupId(shared[1]!.key));
      expect(second).toContain('decision: false-positive by Earlier Reviewer on 2026-10-01; reason: Earlier triage note');
      expect(second).toContain('[r] remove decision');
      s.send('r\r');
      await s.expect(`Removed the false-positive decision for ${groupId(shared[1]!.key)}`);

      const third = await s.expect(PROMPT);
      expect(third).toContain(groupId(shared[2]!.key));
      s.send('q\r');
      await s.expect('Recorded 2 decision(s) in baseline.json.');
      await s.expect(AUTOMATED_TESTING_DISCLAIMER);
      expect((await s.exited).exitCode).toBe(0);
    } finally { s.kill(); }

    const stored = normalize(await readFile(baseline, 'utf8'));
    expect(stored.groupDecisions).toEqual([expect.objectContaining({
      group: groupId(shared[0]!.key), decision: 'accepted-risk', reason: 'Third-party widget; vendor ticket VND-42', expires: '2099-12-31', by: REVIEWER,
    })]);
    expect(stored.history?.map((h) => [h.action, h.group])).toEqual([
      ['record', groupId(shared[0]!.key)], ['remove', groupId(shared[1]!.key)],
    ]);
    expect(stored).toMatchSnapshot();
  }, TIMEOUT);

  it.skipIf(!pty)('Ctrl+C mid-prompt exits 130 and leaves the baseline byte-identical', async () => {
    const { cwd, baseline } = await workspace('ctrl-c');
    const before = await readFile(baseline);
    const s = startReview(cwd);
    try {
      await s.expect(PROMPT);
      s.send('a\r');
      await s.expect('Reason (required): ');
      s.send('half-typed reason\r');
      await s.expect('Expires YYYY-MM-DD (optional, blank for none): ');
      s.send('2099-1');
      s.send('\x03');
      const exit = await s.exited;
      expect(exit.exitCode).toBe(130);
      expect(s.text).toContain('Review interrupted. Nothing was written to the baseline.');
    } finally { s.kill(); }
    expect((await readFile(baseline)).equals(before)).toBe(true);
  }, TIMEOUT);
});

describe('a11ygate review without a TTY (A11Y-R51)', () => {
  it('fails with a clear message instead of waiting for input when stdin is piped and no flags are given', async () => {
    const { cwd, baseline } = await workspace('no-tty');
    const before = await readFile(baseline);
    const child: ChildProcess = spawn(process.execPath, [cli, 'review', 'scan.json', '--baseline', 'baseline.json'], { cwd, env: childEnv() as NodeJS.ProcessEnv, stdio: 'pipe' });
    let stdout = '';
    let stderr = '';
    child.stdout!.on('data', (d: Buffer) => { stdout += d; });
    child.stderr!.on('data', (d: Buffer) => { stderr += d; });
    // stdin stays open: a CLI that waited for input would hang here until the timeout.
    const result = await Promise.race([
      new Promise<number | null>((resolve) => child.on('close', (code: number | null) => resolve(code))),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), WAIT)),
    ]);
    child.kill();
    expect(result, `stdout:\n${stdout}\nstderr:\n${stderr}`).toBe(2);
    expect(stderr).toContain('interactive review needs a terminal (stdin and stdout must be a TTY)');
    expect(stderr).toContain('Use --list to list groups, or --group <id> --decision <kind>');
    expect((await readFile(baseline)).equals(before)).toBe(true);
  }, TIMEOUT);
});
