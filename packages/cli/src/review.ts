import { debugDetail } from './fatal';
import { execFile } from 'node:child_process';
import { rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import type { SharedComponentGroup } from '@/lib/group';
import { applyFingerprintBaseline, parseFingerprintBaseline, type FingerprintBaseline } from '@/lib/scan/baseline';
import {
  createGroupDecision, groupId, REVIEW_DECISION_NOTICE, isIsoDate, REVIEW_DECISIONS, reviewableGroups, today, upsertGroupDecision,
  type GroupDecision, type ReviewDecisionKind,
} from '@/lib/scan/review';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { readScanInput } from './baseline';
import type { RunIo } from './run';
import { readJsonInput } from './input-file';

export const REVIEW_HELP = `a11ygate review <scan.json|out-dir> --baseline <fingerprints.json> [options]
Record a reviewer decision once for a likely shared component group instead of per finding.
Decisions are stored in the fingerprint baseline (groupDecisions) and shown in reports.

  --baseline <file>        Fingerprint baseline from baseline create. Updated in place.
  --list                   List likely shared component groups and current decisions (default without a TTY).
  --group <id>             Group id from --list (g-...). Requires --decision.
  --decision <kind>        to-fix, accepted-risk or false-positive.
  --reason <text>          Required for accepted-risk and false-positive.
  --expires <YYYY-MM-DD>   Optional last day an accepted-risk decision applies; afterwards findings gate again.
Without --list or --group in a terminal, review groups interactively.
The reviewer is git config user.name; A11yGate never invents a name.
Accepted-risk and false-positive decisions exclude matching findings from the gate, but every
finding stays listed in the report. Groupings are heuristic: review examples before deciding.
${AUTOMATED_TESTING_DISCLAIMER}
`;

export type ReviewIo = RunIo & {
  /** Test seam; defaults to `git config user.name` in cwd. */
  gitUserName?: () => Promise<string>;
  /** Test seam for interactive mode; defaults to a readline prompt when stdin/stdout are TTYs. */
  prompt?: (question: string) => Promise<string>;
  interactive?: boolean;
};

function gitUserName(cwd: string): Promise<string> {
  return new Promise((resolve) => {
    execFile('git', ['config', 'user.name'], { cwd, timeout: 5000 }, (error, stdout) => resolve(error ? '' : String(stdout).trim()));
  });
}

type ReviewArgs = { input?: string; baseline?: string; list: boolean; group?: string; decision?: ReviewDecisionKind; reason?: string; expires?: string };

function parseReviewArgs(argv: readonly string[]): ReviewArgs {
  const args: ReviewArgs = { list: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    const eq = token.indexOf('=');
    const name = token.startsWith('--') && eq > 0 ? token.slice(0, eq) : token;
    if (name === '--list') { args.list = true; continue; }
    if (['--baseline', '--group', '--decision', '--reason', '--expires'].includes(name)) {
      const value = eq > 0 && token.startsWith('--') ? token.slice(eq + 1) : argv[++i];
      if (value === undefined || value === '' || (eq < 0 && value.startsWith('--'))) throw new Error(`${name} needs a value.`);
      if (name === '--baseline') args.baseline = value;
      else if (name === '--group') args.group = value;
      else if (name === '--reason') args.reason = value;
      else if (name === '--expires') args.expires = value;
      else {
        if (!(REVIEW_DECISIONS as readonly string[]).includes(value)) throw new Error(`Unknown decision "${value}". Use ${REVIEW_DECISIONS.join(', ')}.`);
        args.decision = value as ReviewDecisionKind;
      }
      continue;
    }
    if (!token.startsWith('-') && !args.input) { args.input = token; continue; }
    throw new Error(`Unexpected review argument ${token}.`);
  }
  if (!args.input) throw new Error('Pass a saved scan report (a11ygate-scan.json or its out-dir).');
  if (!args.baseline) throw new Error('--baseline <fingerprints.json> is required; decisions are stored there.');
  if (args.group && !args.decision) throw new Error('--group needs --decision.');
  if (args.decision && !args.group) throw new Error('--decision needs --group.');
  if (args.list && args.group) throw new Error('Use either --list or --group.');
  if ((args.reason !== undefined || args.expires !== undefined) && !args.group) throw new Error('--reason and --expires need --group.');
  return args;
}

function checkDecision(decision: ReviewDecisionKind, reason: string | undefined, expires: string | undefined, now: Date): void {
  if (decision !== 'to-fix' && !reason?.trim()) throw new Error(`${decision} needs --reason.`);
  if (expires !== undefined) {
    if (decision !== 'accepted-risk') throw new Error('--expires applies only to accepted-risk.');
    if (!isIsoDate(expires)) throw new Error('--expires must be a date in YYYY-MM-DD form.');
    if (expires < today(now)) throw new Error('--expires is already in the past.');
  }
}

function describeGroup(g: SharedComponentGroup, decisions: readonly GroupDecision[]): string {
  const d = decisions.find((x) => x.groupKey === g.key);
  return `${groupId(g.key)}  ${g.ruleId} — likely shared component on ${g.pageCount} page(s), ${g.findingCount} finding(s)\n` +
    `  normalized selector: ${g.normalizedSelector}\n` +
    g.examples.map((e) => `  example: ${e.pageUrl} — ${e.selector}\n`).join('') +
    `  decision: ${d ? `${d.decision} by ${d.by} on ${d.at}${d.expires ? `; expires ${d.expires}` : ''}${d.reason ? `; reason: ${d.reason}` : ''}` : 'none'}\n`;
}

export async function runReview(argv: readonly string[], io: ReviewIo = {}): Promise<number> {
  const stdout = io.stdout ?? ((s: string) => process.stdout.write(s));
  const stderr = io.stderr ?? ((s: string) => process.stderr.write(s));
  if (argv.includes('--help') || argv.includes('-h')) { stdout(REVIEW_HELP); return 0; }
  const cwd = io.cwd ?? process.cwd();
  const now = (io.now ?? (() => new Date()))();
  try {
    const args = parseReviewArgs(argv);
    if (args.decision) checkDecision(args.decision, args.reason, args.expires, now);
    const report = await readScanInput(args.input!, cwd);
    const baselinePath = path.resolve(cwd, args.baseline!);
    const baseline: FingerprintBaseline = await readJsonInput(cwd, args.baseline!, parseFingerprintBaseline);
    let decisions = baseline.groupDecisions ?? [];
    const groups = reviewableGroups(report.findings);
    const shared = groups.filter((g) => g.likelySharedComponent);
    const save = async (next: GroupDecision[]) => {
      // Write a sibling temp file and rename it over the baseline so an interrupted write never leaves a partial file.
      const temp = `${baselinePath}.${process.pid}.tmp`;
      try {
        await writeFile(temp, JSON.stringify({ ...baseline, groupDecisions: next }, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
        await rename(temp, baselinePath);
      } catch (error) { await rm(temp, { force: true }); throw error; }
    };
    const reviewer = async () => {
      const name = (await (io.gitUserName ?? (() => gitUserName(cwd)))()).trim();
      if (!name) throw new Error('git config user.name is not set. A11yGate records the reviewer from git config and never invents a name.');
      return name;
    };

    if (args.group) {
      const group = groups.find((g) => groupId(g.key) === args.group);
      if (!group) throw new Error(`No component group ${args.group} in this scan. Run a11ygate review ${args.input} --baseline ${args.baseline} --list.`);
      const decision = createGroupDecision(group, { decision: args.decision!, reason: args.reason, expires: args.expires, by: await reviewer(), now });
      decisions = upsertGroupDecision(decisions, decision);
      await save(decisions);
      stdout(`Recorded ${decision.decision} for ${decision.group} (${group.findingCount} finding(s) on ${group.pageCount} page(s)) by ${decision.by} on ${decision.at} in ${args.baseline}.\n` +
        'Matching findings on new pages inherit this decision. Findings stay listed in reports.\n');
      return 0;
    }

    const interactive = !args.list && (io.interactive ?? (!!process.stdin.isTTY && !!process.stdout.isTTY));
    if (!interactive) {
      stdout(`${REVIEW_DECISION_NOTICE}\n\n`);
      stdout(shared.length ? shared.map((g) => describeGroup(g, decisions)).join('\n') : 'No likely shared components detected across pages.\n');
      const applied = applyFingerprintBaseline(report, baseline, now).findings.filter((f) => f.reviewDecision?.expired);
      if (applied.length) stdout(`\n${applied.length} finding(s) match an expired accepted-risk decision and gate again.\n`);
      stdout(`\n${AUTOMATED_TESTING_DISCLAIMER}\n`);
      return 0;
    }

    let close = () => {};
    let ask = io.prompt;
    if (!ask) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      ask = (q) => rl.question(q);
      close = () => rl.close();
    }
    try {
      stdout(`${REVIEW_DECISION_NOTICE}\n`);
      if (!shared.length) { stdout('No likely shared components detected across pages.\n'); return 0; }
      const by = await reviewer();
      let changed = 0;
      for (const g of shared) {
        stdout('\n' + describeGroup(g, decisions));
        const choice = (await ask('[f] to-fix  [a] accepted-risk  [p] false-positive  [s] skip  [q] quit: ')).trim().toLowerCase();
        if (choice === 'q') break;
        const kind = ({ f: 'to-fix', a: 'accepted-risk', p: 'false-positive' } as Record<string, ReviewDecisionKind>)[choice];
        if (!kind) continue;
        let reason: string | undefined;
        let expires: string | undefined;
        if (kind !== 'to-fix') {
          while (!reason) reason = (await ask('Reason (required): ')).trim() || undefined;
        } else reason = (await ask('Reason (optional): ')).trim() || undefined;
        if (kind === 'accepted-risk') {
          for (;;) {
            const value = (await ask('Expires YYYY-MM-DD (optional, blank for none): ')).trim();
            if (!value) break;
            try { checkDecision(kind, reason, value, now); expires = value; break; } catch (error) { stderr(`${(error as Error).message}\n`); }
          }
        }
        decisions = upsertGroupDecision(decisions, createGroupDecision(g, { decision: kind, reason, expires, by, now }));
        changed++;
      }
      if (changed) await save(decisions);
      stdout(`\nRecorded ${changed} decision(s)${changed ? ` in ${args.baseline}` : ''}.\n`);
      return 0;
    } finally { close(); }
  } catch (error) {
    stderr(`Could not record review: ${error instanceof Error ? error.message : String(error)}\n${debugDetail(error)}`);
    return 2;
  }
}
