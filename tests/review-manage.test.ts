import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { groupSharedComponents } from '@/lib/group';
import { createFingerprintBaseline, parseFingerprintBaseline } from '@/lib/scan/baseline';
import { buildScanReport } from '@/lib/scan/report';
import { createGroupDecision, type GroupDecision } from '@/lib/scan/review';
import { runReview } from '@/packages/cli/src/review';
import { writeFileAtomic } from '@/packages/cli/src/atomic-write';
import type { AxeResults } from '@/lib/types';

const origin = 'http://localhost';
const NAV = '<a class="nav-link" href="/x"><img src="/icon.svg"></a>';
const NOW = new Date('2026-11-14T12:00:00Z');

function page(pathname: string, extra = false): AxeResults {
  return { url: origin + pathname, timestamp: '2026-11-14T00:00:00Z', testEngine: { version: '4.11.1' }, violations: [
    { id: 'link-name', impact: 'serious', tags: ['wcag244'], help: 'Links must have discernible text', helpUrl: 'https://example.test/link-name',
      nodes: [{ target: ['nav > a.nav-link'], html: NAV }] },
    ...(extra ? [{ id: 'image-alt', impact: 'critical' as const, tags: ['wcag111'], help: 'Images must have alternate text', helpUrl: 'https://example.test/image-alt',
      nodes: [{ target: ['main > img.hero'], html: '<img class="hero" src="/hero.png">' }] }] : []),
  ] };
}

function report(paths: string[], extraOn: string[] = []) {
  return buildScanReport({ crawl: { pages: paths.map((p) => ({ url: origin + p, finalUrl: origin + p, status: 200, scanStatus: 'complete' as const, result: page(p, extraOn.includes(p)) })), skipped: [] },
    version: '0.2.0', scannedAt: '2026-11-14T00:00:00Z', startUrl: origin + '/', failOn: 'serious', maxPages: 5, delayMs: 0, userAgent: 'fixture', robotsNote: 'fixture' });
}

const groupFor = (ruleId: string) => groupSharedComponents(report(['/', '/about'], ['/', '/about']).findings).find((g) => g.ruleId === ruleId)!;
/** Present in scan.json: link-name nav; active accepted-risk. */
const nav = () => createGroupDecision(groupFor('link-name'), { decision: 'accepted-risk', reason: 'Vendor nav', expires: '2026-12-31', by: 'Alice', now: NOW });
/** Absent from scan.json (no image-alt findings there); expired accepted-risk. */
const hero = () => createGroupDecision(groupFor('image-alt'), { decision: 'accepted-risk', reason: 'Old hero', expires: '2026-11-01', by: 'Bob', now: new Date('2026-10-01T00:00:00Z') });

async function workspace(decisions: GroupDecision[], work: (cwd: string, file: string) => Promise<void>) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'a11ygate-review-manage-'));
  try {
    await writeFile(path.join(cwd, 'scan.json'), JSON.stringify(report(['/', '/about'])));
    await writeFile(path.join(cwd, 'baseline.json'), JSON.stringify({ ...createFingerprintBaseline(report([])), groupDecisions: decisions }, null, 2) + '\n');
    await work(cwd, path.join(cwd, 'baseline.json'));
  } finally { await rm(cwd, { recursive: true, force: true }); }
}

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, text: () => out.join(''), io: { stdout: (s: string) => { out.push(s); }, stderr: (s: string) => { err.push(s); }, now: () => NOW, interactive: false } };
}

const load = async (file: string) => parseFingerprintBaseline(JSON.parse(await readFile(file, 'utf8')));

describe('a11ygate review list', () => {
  it('lists all decisions and filters by --status, --expired and --json', async () => {
    await workspace([nav(), hero()].sort((a, b) => a.group.localeCompare(b.group)), async (cwd) => {
      const all = capture();
      expect(await runReview(['list', '--baseline', 'baseline.json'], { ...all.io, cwd })).toBe(0);
      expect(all.text()).toContain(nav().group);
      expect(all.text()).toContain(hero().group);
      expect(all.text()).toContain('(expired)');
      expect(all.text()).toContain(AUTOMATED_TESTING_DISCLAIMER);

      const expired = capture();
      expect(await runReview(['list', '--baseline', 'baseline.json', '--expired'], { ...expired.io, cwd })).toBe(0);
      expect(expired.text()).toContain(hero().group);
      expect(expired.text()).not.toContain(nav().group);

      const json = capture();
      expect(await runReview(['list', '--baseline=baseline.json', '--status', 'accepted-risk', '--json'], { ...json.io, cwd })).toBe(0);
      const parsed = JSON.parse(json.text());
      expect(parsed.disclaimer).toBe(AUTOMATED_TESTING_DISCLAIMER);
      expect(parsed.decisions.map((d: { group: string; expired: boolean }) => [d.group, d.expired]).sort()).toEqual([[hero().group, true], [nav().group, false]].sort());

      const none = capture();
      expect(await runReview(['list', '--baseline', 'baseline.json', '--status', 'false-positive', '--json'], { ...none.io, cwd })).toBe(0);
      expect(JSON.parse(none.text()).decisions).toEqual([]);

      const bad = capture();
      expect(await runReview(['list', '--baseline', 'baseline.json', '--status', 'ignored'], { ...bad.io, cwd })).toBe(2);
      expect(bad.err.join('')).toContain('Unknown status');
    });
  });
});

describe('a11ygate review remove', () => {
  it('removes one decision by group fingerprint with --yes and keeps it in history', async () => {
    await workspace([nav(), hero()], async (cwd, file) => {
      const before = await readFile(file, 'utf8');
      const refused = capture();
      expect(await runReview(['remove', nav().group, '--baseline', 'baseline.json'], { ...refused.io, cwd })).toBe(2);
      expect(refused.err.join('')).toContain('needs --yes');
      expect(await readFile(file, 'utf8')).toBe(before);

      const c = capture();
      expect(await runReview(['remove', nav().group, '--baseline', 'baseline.json', '--yes'], { ...c.io, cwd, gitUserName: async () => 'Carol' })).toBe(0);
      const stored = await load(file);
      expect(stored.groupDecisions).toEqual([hero()]);
      expect(stored.history).toEqual([{ action: 'remove', by: 'Carol', at: NOW.toISOString(), group: nav().group, previous: nav() }]);
      expect(stored.findings).toEqual(createFingerprintBaseline(report([])).findings);

      const missing = capture();
      expect(await runReview(['remove', 'g-ffffffffffffffff', '--baseline', 'baseline.json', '--yes'], { ...missing.io, cwd })).toBe(2);
    });
  });

  it('asks for confirmation in a terminal; declining writes nothing', async () => {
    await workspace([nav()], async (cwd, file) => {
      const before = await readFile(file, 'utf8');
      const no = capture();
      expect(await runReview(['remove', nav().group, '--baseline', 'baseline.json'], { ...no.io, cwd, interactive: true, prompt: async () => 'n' })).toBe(0);
      expect(await readFile(file, 'utf8')).toBe(before);
      const yes = capture();
      expect(await runReview(['remove', nav().group, '--baseline', 'baseline.json'], { ...yes.io, cwd, interactive: true, prompt: async () => 'y', gitUserName: async () => 'Dee' })).toBe(0);
      expect((await load(file)).groupDecisions).toEqual([]);
    });
  });

  it('--all-expired removes only expired accepted-risk decisions; who falls back to "unknown"', async () => {
    await workspace([nav(), hero()], async (cwd, file) => {
      const c = capture();
      expect(await runReview(['remove', '--all-expired', '--baseline', 'baseline.json', '--yes'], { ...c.io, cwd, gitUserName: async () => '' })).toBe(0);
      const stored = await load(file);
      expect(stored.groupDecisions).toEqual([nav()]);
      expect(stored.history).toEqual([{ action: 'remove', by: 'unknown', at: NOW.toISOString(), group: hero().group, previous: hero() }]);

      const again = capture();
      const bytes = await readFile(file, 'utf8');
      expect(await runReview(['remove', '--all-expired', '--baseline', 'baseline.json', '--yes'], { ...again.io, cwd })).toBe(0);
      expect(again.text()).toContain('No expired decisions');
      expect(await readFile(file, 'utf8')).toBe(bytes);
    });
  });
});

describe('a11ygate review prune', () => {
  it('--dry-run reports stale decisions and writes nothing', async () => {
    await workspace([nav(), hero()], async (cwd, file) => {
      const before = await readFile(file, 'utf8');
      const c = capture();
      expect(await runReview(['prune', 'scan.json', '--baseline', 'baseline.json', '--dry-run'], { ...c.io, cwd })).toBe(0);
      expect(c.text()).toContain('1 decision(s) match no finding in this scan and would be removed');
      expect(c.text()).toContain(hero().group);
      expect(c.text()).not.toContain(nav().group);
      expect(await readFile(file, 'utf8')).toBe(before);
    });
  });

  it('removes decisions whose group is not in the latest scan', async () => {
    await workspace([nav(), hero()], async (cwd, file) => {
      const c = capture();
      expect(await runReview(['prune', 'scan.json', '--baseline', 'baseline.json'], { ...c.io, cwd, gitUserName: async () => 'Erin' })).toBe(0);
      const stored = await load(file);
      expect(stored.groupDecisions).toEqual([nav()]);
      expect(stored.history).toEqual([{ action: 'prune', by: 'Erin', at: NOW.toISOString(), group: hero().group, previous: hero() }]);
      const again = capture();
      expect(await runReview(['prune', 'scan.json', '--baseline', 'baseline.json'], { ...again.io, cwd })).toBe(0);
      expect(again.text()).toContain('Nothing to prune');
    });
  });
});

describe('atomic baseline writes and append-only history', () => {
  it('a failed rename leaves the old baseline byte-identical and no temp file behind', async () => {
    await workspace([nav(), hero()], async (cwd, file) => {
      const before = await readFile(file, 'utf8');
      const failRename = async () => { throw Object.assign(new Error('EIO: simulated rename failure'), { code: 'EIO' }); };
      for (const argv of [['remove', nav().group, '--baseline', 'baseline.json', '--yes'], ['prune', 'scan.json', '--baseline', 'baseline.json'],
        ['scan.json', '--baseline', 'baseline.json', '--group', nav().group, '--decision', 'to-fix']]) {
        const c = capture();
        expect(await runReview(argv, { ...c.io, cwd, gitUserName: async () => 'F', rename: failRename })).toBe(2);
        expect(c.err.join('')).toContain('simulated rename failure');
        expect(await readFile(file, 'utf8')).toBe(before);
      }
      expect((await readdir(cwd)).sort()).toEqual(['baseline.json', 'scan.json']);
    });
  });

  it('writeFileAtomic replaces the file only via rename of a complete temp file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'a11ygate-atomic-'));
    try {
      const file = path.join(dir, 'b.json');
      await writeFile(file, 'old');
      const seen: string[] = [];
      await writeFileAtomic(file, 'new content', { rename: async (from, to) => {
        seen.push(await readFile(from, 'utf8'), await readFile(to, 'utf8'));
        const { rename } = await import('node:fs/promises');
        await rename(from, to);
      } });
      expect(seen).toEqual(['new content', 'old']);
      expect(await readFile(file, 'utf8')).toBe('new content');
      expect(await readdir(dir)).toEqual(['b.json']);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('history entries are appended across record, re-record, remove and prune and never rewritten', async () => {
    await workspace([hero()], async (cwd, file) => {
      const snapshots: unknown[][] = [];
      const step = async (argv: string[]) => {
        const c = capture();
        expect(await runReview(argv, { ...c.io, cwd, gitUserName: async () => 'Gail' })).toBe(0);
        snapshots.push((await load(file)).history ?? []);
      };
      await step(['scan.json', '--baseline', 'baseline.json', '--group', nav().group, '--decision', 'to-fix']);
      await step(['scan.json', '--baseline', 'baseline.json', '--group', nav().group, '--decision', 'false-positive', '--reason', 'Named at runtime']);
      await step(['prune', 'scan.json', '--baseline', 'baseline.json']);
      await step(['remove', nav().group, '--baseline', 'baseline.json', '--yes']);
      expect(snapshots.map((s) => s.length)).toEqual([1, 2, 3, 4]);
      for (let i = 1; i < snapshots.length; i++) expect(snapshots[i]!.slice(0, snapshots[i - 1]!.length)).toEqual(snapshots[i - 1]);
      const final = snapshots[3] as { action: string; decision?: GroupDecision; previous?: GroupDecision }[];
      expect(final.map((h) => h.action)).toEqual(['record', 'record', 'prune', 'remove']);
      expect(final[0]!.previous).toBeUndefined();
      expect(final[1]!.previous).toMatchObject({ decision: 'to-fix', by: 'Gail' });
      expect(final[1]!.decision).toMatchObject({ decision: 'false-positive' });
      expect(final[2]!.previous).toEqual(hero());
      expect(final[3]!.previous).toMatchObject({ decision: 'false-positive' });
      expect((await load(file)).groupDecisions).toEqual([]);
    });
  });

  it('rejects a baseline with a malformed history entry', () => {
    const base = createFingerprintBaseline(report([]));
    expect(() => parseFingerprintBaseline({ ...base, history: [{ action: 'remove', by: 'x', at: NOW.toISOString(), group: 'g-1' }] })).toThrow('needs the removed decision');
    expect(() => parseFingerprintBaseline({ ...base, history: {} })).toThrow('Invalid baseline decision history');
  });
});
