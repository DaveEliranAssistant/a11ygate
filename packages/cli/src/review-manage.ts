import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { componentGroupKey } from '@/lib/group';
import { parseFingerprintBaseline, type FingerprintBaseline } from '@/lib/scan/baseline';
import {
  isExpired, REVIEW_DECISIONS, type DecisionHistoryAction, type DecisionHistoryEntry, type GroupDecision, type ReviewDecisionKind,
} from '@/lib/scan/review';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { debugDetail } from './fatal';
import { writeFileAtomic } from './atomic-write';
import { readScanInput } from './baseline';
import type { ReviewIo } from './review';

export const REVIEW_MANAGE_HELP = `
Manage recorded decisions (R44):
  a11ygate review list --baseline <file> [--status <kind>] [--expired] [--json]
      List decisions. --status keeps one kind (to-fix, accepted-risk, false-positive);
      --expired keeps accepted-risk decisions past their expiry date.
  a11ygate review remove <group-id|--all-expired> --baseline <file> [--yes]
      Remove one decision, or every expired accepted-risk decision. Needs --yes,
      or answer the confirmation prompt in a terminal.
  a11ygate review prune <scan.json|out-dir> --baseline <file> [--dry-run]
      Remove decisions whose component group has no finding in that (latest) scan.
      --dry-run lists what would be removed and writes nothing.
Every change is written atomically (temp file + rename). Earlier decisions are kept in the
baseline's history[] with who (git user.name, else "unknown"), when and the action.`;

export function gitUserName(cwd: string): Promise<string> {
  return new Promise((resolve) => {
    execFile('git', ['config', 'user.name'], { cwd, timeout: 5000 }, (error, stdout) => resolve(error ? '' : String(stdout).trim()));
  });
}

/**
 * Write decisions and append history entries atomically (temp file + rename).
 * Existing history entries are copied verbatim; new ones are only ever appended.
 */
export async function saveReviewBaseline(file: string, baseline: FingerprintBaseline, decisions: GroupDecision[], entries: readonly DecisionHistoryEntry[], io: Pick<ReviewIo, 'rename'> = {}): Promise<void> {
  const next: FingerprintBaseline = { ...baseline, groupDecisions: decisions, history: [...(baseline.history ?? []), ...entries] };
  await writeFileAtomic(file, JSON.stringify(next, null, 2) + '\n', { rename: io.rename });
}

type Flags = { positional: string[]; values: Map<string, string>; switches: Set<string> };

function parseFlags(argv: readonly string[], valued: readonly string[], switches: readonly string[]): Flags {
  const out: Flags = { positional: [], values: new Map(), switches: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    const eq = token.indexOf('=');
    const name = token.startsWith('--') && eq > 0 ? token.slice(0, eq) : token;
    if (switches.includes(name) && eq < 0) { out.switches.add(name); continue; }
    if (valued.includes(name)) {
      const value = eq > 0 ? token.slice(eq + 1) : argv[++i];
      if (value === undefined || value === '' || (eq < 0 && value.startsWith('--'))) throw new Error(`${name} needs a value.`);
      out.values.set(name, value);
      continue;
    }
    if (!token.startsWith('-')) { out.positional.push(token); continue; }
    throw new Error(`Unexpected review argument ${token}.`);
  }
  return out;
}

type Ctx = { stdout: (s: string) => void; stderr: (s: string) => void; cwd: string; now: Date };

function context(io: ReviewIo): Ctx {
  return {
    stdout: io.stdout ?? ((s: string) => process.stdout.write(s)),
    stderr: io.stderr ?? ((s: string) => process.stderr.write(s)),
    cwd: io.cwd ?? process.cwd(),
    now: (io.now ?? (() => new Date()))(),
  };
}

async function loadBaseline(flags: Flags, cwd: string): Promise<{ file: string; baseline: FingerprintBaseline }> {
  const value = flags.values.get('--baseline');
  if (!value) throw new Error('--baseline <fingerprints.json> is required; decisions are stored there.');
  const file = path.resolve(cwd, value);
  return { file, baseline: parseFingerprintBaseline(JSON.parse(await readFile(file, 'utf8'))) };
}

function describe(d: GroupDecision, now: Date): string {
  const expired = isExpired(d, now);
  return `${d.group}  ${d.ruleId}  ${d.decision}${expired ? ' (expired)' : ''} by ${d.by} on ${d.at}` +
    `${d.expires ? `; expires ${d.expires}` : ''}${d.reason ? `; reason: ${d.reason}` : ''}\n  normalized selector: ${d.normalizedSelector}\n`;
}

async function who(io: ReviewIo, cwd: string): Promise<string> {
  const name = (await (io.gitUserName ?? (() => gitUserName(cwd)))()).trim();
  return name || 'unknown';
}

function entries(action: DecisionHistoryAction, removed: readonly GroupDecision[], by: string, now: Date): DecisionHistoryEntry[] {
  return removed.map((previous) => ({ action, by, at: now.toISOString(), group: previous.group, previous }));
}

export async function runReviewList(argv: readonly string[], io: ReviewIo = {}): Promise<number> {
  const { stdout, stderr, cwd, now } = context(io);
  try {
    const flags = parseFlags(argv, ['--baseline', '--status'], ['--expired', '--json']);
    if (flags.positional.length) throw new Error(`Unexpected review list argument ${flags.positional[0]}.`);
    const status = flags.values.get('--status');
    if (status !== undefined && !(REVIEW_DECISIONS as readonly string[]).includes(status)) throw new Error(`Unknown status "${status}". Use ${REVIEW_DECISIONS.join(', ')}.`);
    const { baseline } = await loadBaseline(flags, cwd);
    const decisions = (baseline.groupDecisions ?? [])
      .filter((d) => !status || d.decision === (status as ReviewDecisionKind))
      .filter((d) => !flags.switches.has('--expired') || isExpired(d, now));
    if (flags.switches.has('--json')) {
      stdout(JSON.stringify({
        kind: 'a11ygate-review-decisions', disclaimer: AUTOMATED_TESTING_DISCLAIMER,
        filters: { ...(status ? { status } : {}), ...(flags.switches.has('--expired') ? { expired: true } : {}) },
        decisions: decisions.map((d) => ({ ...d, expired: isExpired(d, now) })),
      }, null, 2) + '\n');
      return 0;
    }
    stdout(decisions.length ? decisions.map((d) => describe(d, now)).join('\n') : 'No matching review decisions.\n');
    stdout(`\n${decisions.length} decision(s).\n${AUTOMATED_TESTING_DISCLAIMER}\n`);
    return 0;
  } catch (error) {
    stderr(`Could not list review decisions: ${error instanceof Error ? error.message : String(error)}\n${debugDetail(error)}`);
    return 2;
  }
}

async function confirm(io: ReviewIo, question: string): Promise<boolean> {
  const interactive = io.interactive ?? (!!process.stdin.isTTY && !!process.stdout.isTTY);
  if (!interactive) return false;
  if (io.prompt) return /^y(es)?$/i.test((await io.prompt(question)).trim());
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return /^y(es)?$/i.test((await rl.question(question)).trim()); } finally { rl.close(); }
}

export async function runReviewRemove(argv: readonly string[], io: ReviewIo = {}): Promise<number> {
  const { stdout, stderr, cwd, now } = context(io);
  try {
    const flags = parseFlags(argv, ['--baseline'], ['--all-expired', '--yes', '-y']);
    const allExpired = flags.switches.has('--all-expired');
    if (allExpired && flags.positional.length) throw new Error('Pass either a group id or --all-expired, not both.');
    if (!allExpired && flags.positional.length !== 1) throw new Error('Pass one group id (g-... from review list) or --all-expired.');
    const { file, baseline } = await loadBaseline(flags, cwd);
    const decisions = baseline.groupDecisions ?? [];
    const target = flags.positional[0];
    const removed = allExpired ? decisions.filter((d) => isExpired(d, now)) : decisions.filter((d) => d.group === target || d.groupKey === target);
    if (!removed.length) {
      if (allExpired) { stdout(`No expired decisions in ${flags.values.get('--baseline')}. Nothing written.\n`); return 0; }
      throw new Error(`No decision for group ${target} in the baseline. Run a11ygate review list --baseline <file>.`);
    }
    stdout(removed.map((d) => describe(d, now)).join(''));
    if (!flags.switches.has('--yes') && !flags.switches.has('-y') && !(await confirm(io, `Remove ${removed.length} decision(s)? [y/N] `))) {
      const interactive = io.interactive ?? (!!process.stdin.isTTY && !!process.stdout.isTTY);
      if (!interactive) throw new Error('Removing decisions needs --yes outside a terminal.');
      stdout('Nothing removed.\n');
      return 0;
    }
    const keep = decisions.filter((d) => !removed.includes(d));
    await saveReviewBaseline(file, baseline, keep, entries('remove', removed, await who(io, cwd), now), io);
    stdout(`Removed ${removed.length} decision(s). The earlier decision(s) are kept in history[]. Matching findings gate as usual again.\n`);
    return 0;
  } catch (error) {
    stderr(`Could not remove review decision: ${error instanceof Error ? error.message : String(error)}\n${debugDetail(error)}`);
    return 2;
  }
}

export async function runReviewPrune(argv: readonly string[], io: ReviewIo = {}): Promise<number> {
  const { stdout, stderr, cwd, now } = context(io);
  try {
    const flags = parseFlags(argv, ['--baseline'], ['--dry-run']);
    if (flags.positional.length !== 1) throw new Error('Pass the latest saved scan report (a11ygate-scan.json or its out-dir).');
    const report = await readScanInput(flags.positional[0]!, cwd);
    const { file, baseline } = await loadBaseline(flags, cwd);
    const decisions = baseline.groupDecisions ?? [];
    const present = new Set(report.findings.map((f) => componentGroupKey(f)));
    const stale = decisions.filter((d) => !present.has(d.groupKey));
    const dry = flags.switches.has('--dry-run');
    const incomplete = report.pages.filter((p) => p.scanStatus !== 'complete').length;
    if (incomplete) stdout(`Warning: ${incomplete} page(s) in this scan did not complete; decisions for components only on those pages may be pruned. Use --dry-run to check.\n`);
    if (!stale.length) { stdout('Every decision still matches a finding in this scan. Nothing to prune.\n'); return 0; }
    stdout(`${stale.length} decision(s) match no finding in this scan${dry ? ' and would be removed' : ''}:\n` + stale.map((d) => describe(d, now)).join(''));
    if (dry) { stdout('Dry run: nothing written.\n'); return 0; }
    await saveReviewBaseline(file, baseline, decisions.filter((d) => present.has(d.groupKey)), entries('prune', stale, await who(io, cwd), now), io);
    stdout(`Pruned ${stale.length} decision(s). The earlier decision(s) are kept in history[].\n`);
    return 0;
  } catch (error) {
    stderr(`Could not prune review decisions: ${error instanceof Error ? error.message : String(error)}\n${debugDetail(error)}`);
    return 2;
  }
}
