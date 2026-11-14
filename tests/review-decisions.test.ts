import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUTOMATED_TESTING_DISCLAIMER, DISCLAIMER } from '@/lib/copy';
import { groupSharedComponents } from '@/lib/group';
import { applyFingerprintBaseline, createFingerprintBaseline, parseFingerprintBaseline } from '@/lib/scan/baseline';
import { buildScanReport, scanHtml, scanMarkdown } from '@/lib/scan/report';
import { scanHtmlV2 } from '@/lib/scan/report-html-v2';
import { createGroupDecision, groupId, REVIEW_DECISION_NOTICE } from '@/lib/scan/review';
import { runReview } from '@/packages/cli/src/review';
import type { AxeResults } from '@/lib/types';

const origin = 'http://localhost';
const NAV = '<a class="nav-link" href="/x"><img src="/icon.svg"></a>';

function page(pathname: string, extra = false): AxeResults {
  const url = origin + pathname;
  return { url, timestamp: '2026-11-14T00:00:00Z', testEngine: { version: '4.11.1' }, violations: [
    { id: 'link-name', impact: 'serious', tags: ['wcag244'], help: 'Links must have discernible text', helpUrl: 'https://example.test/link-name',
      nodes: [{ target: ['nav > a.nav-link'], html: NAV }] },
    ...(extra ? [{ id: 'image-alt', impact: 'critical' as const, tags: ['wcag111'], help: 'Images must have alternate text', helpUrl: 'https://example.test/image-alt',
      nodes: [{ target: ['main > img.hero'], html: `<img class="hero" src="${pathname}.png">` }] }] : []),
  ] };
}

function report(paths: string[], extraOn: string[] = []) {
  return buildScanReport({ crawl: { pages: paths.map((p) => ({ url: origin + p, finalUrl: origin + p, status: 200, scanStatus: 'complete' as const, result: page(p, extraOn.includes(p)) })), skipped: [] },
    version: '0.2.0', scannedAt: '2026-11-14T00:00:00Z', startUrl: origin + '/', failOn: 'serious', maxPages: 5, delayMs: 0, userAgent: 'fixture', robotsNote: 'fixture' });
}

const NOW = new Date('2026-11-14T12:00:00Z');
const navGroup = () => groupSharedComponents(report(['/', '/about']).findings).find((g) => g.ruleId === 'link-name')!;

/** An empty baseline: every finding is new, so only review decisions can keep the gate green. */
function baselineWith(...decisions: ReturnType<typeof createGroupDecision>[]) {
  return { ...createFingerprintBaseline(report([])), groupDecisions: decisions };
}

describe('R39 group review decisions', () => {
  it('(a) applies one decision to every member finding and a new page joining the group inherits it', () => {
    const decision = createGroupDecision(navGroup(), { decision: 'accepted-risk', reason: 'Vendor nav; tracked in JIRA-1', expires: '2026-12-31', by: 'Reviewer From Git', now: NOW });
    const baseline = parseFingerprintBaseline(JSON.parse(JSON.stringify(baselineWith(decision))));

    const before = applyFingerprintBaseline(report(['/', '/about']), baseline, NOW);
    expect(before.findings).toHaveLength(2);
    expect(before.findings.every((f) => f.reviewDecision?.group === decision.group && f.reviewDecision.suppressesGate)).toBe(true);
    expect(before.verdict).toBe('PASS');

    // /pricing was not in the scan that the reviewer decided on; it matches the same likely shared component.
    const later = applyFingerprintBaseline(report(['/', '/about', '/pricing']), baseline, NOW);
    const joined = later.findings.find((f) => f.pageUrl === origin + '/pricing')!;
    expect(joined.baselineStatus).toBe('new');
    expect(joined.reviewDecision).toMatchObject({ decision: 'accepted-risk', by: 'Reviewer From Git', reason: 'Vendor nav; tracked in JIRA-1' });
    expect(later.verdict).toBe('PASS');
    expect(later.reason).toContain('3 new findings excluded from the gate by review decisions (still listed below)');

    // Findings outside the group are not affected by the decision.
    const unrelated = applyFingerprintBaseline(report(['/', '/about'], ['/about']), baseline, NOW);
    expect(unrelated.findings.find((f) => f.ruleId === 'image-alt')!.reviewDecision).toBeUndefined();
    expect(unrelated.verdict).toBe('FAIL');
  });

  it('false-positive suppresses the gate; to-fix keeps it failing', () => {
    const fp = createGroupDecision(navGroup(), { decision: 'false-positive', reason: 'Name provided via aria-labelledby at runtime', by: 'R', now: NOW });
    expect(applyFingerprintBaseline(report(['/', '/about']), baselineWith(fp), NOW).verdict).toBe('PASS');
    const fix = createGroupDecision(navGroup(), { decision: 'to-fix', by: 'R', now: NOW });
    const result = applyFingerprintBaseline(report(['/', '/about']), baselineWith(fix), NOW);
    expect(result.verdict).toBe('FAIL');
    expect(result.findings.every((f) => f.reviewDecision?.decision === 'to-fix')).toBe(true);
  });

  it('(b) an expired accepted-risk decision fails again', () => {
    const decision = createGroupDecision(navGroup(), { decision: 'accepted-risk', reason: 'Until redesign', expires: '2026-11-30', by: 'R', now: NOW });
    const baseline = baselineWith(decision);
    expect(applyFingerprintBaseline(report(['/', '/about']), baseline, new Date('2026-11-30T23:59:59Z')).verdict).toBe('PASS');
    const expired = applyFingerprintBaseline(report(['/', '/about']), baseline, new Date('2026-12-01T00:00:00Z'));
    expect(expired.verdict).toBe('FAIL');
    expect(expired.findings.every((f) => f.reviewDecision?.expired && !f.reviewDecision.suppressesGate)).toBe(true);
    const md = scanMarkdown(expired);
    expect(md).toMatch(/accepted-risk \\?\(expired\\?\) by R on 2026-11-14; expires 2026-11-30/);
    expect(md).toContain('decision expired; findings gate again');
  });

  it('rejects decisions without a reason, bad expiry or a tampered group id', () => {
    expect(() => createGroupDecision(navGroup(), { decision: 'accepted-risk', reason: ' ', by: 'R', now: NOW })).toThrow(/reason/);
    expect(() => createGroupDecision(navGroup(), { decision: 'false-positive', by: 'R', now: NOW })).toThrow(/reason/);
    expect(() => createGroupDecision(navGroup(), { decision: 'to-fix', expires: '2027-01-01', by: 'R', now: NOW })).toThrow(/expire/);
    expect(() => createGroupDecision(navGroup(), { decision: 'accepted-risk', reason: 'x', expires: '2026-02-30', by: 'R', now: NOW })).toThrow(/YYYY-MM-DD/);
    const ok = createGroupDecision(navGroup(), { decision: 'to-fix', by: 'R', now: NOW });
    expect(() => parseFingerprintBaseline({ ...baselineWith(ok), groupDecisions: [{ ...ok, group: 'g-0000000000000000' }] })).toThrow(/id/);
    expect(() => parseFingerprintBaseline({ ...baselineWith(ok), groupDecisions: [ok, ok] })).toThrow(/Duplicate/);
  });

  it('(c)(d) reports decisions with reason, reviewer and date, and keeps decided findings listed', () => {
    const decision = createGroupDecision(navGroup(), { decision: 'accepted-risk', reason: 'Third-party nav widget', expires: '2026-12-31', by: 'Reviewer From Git', now: NOW });
    const applied = applyFingerprintBaseline(report(['/', '/about']), baselineWith(decision), NOW);
    const md = scanMarkdown(applied);
    const section = md.slice(md.indexOf('## Review decisions'), md.indexOf('## Scope and boundaries'));
    expect(section).toMatchSnapshot();
    expect(section).toContain('by Reviewer From Git on 2026-11-14; expires 2026-12-31; reason: Third-party nav widget');
    expect(section).toContain('likely shared component');
    expect(section).toContain(AUTOMATED_TESTING_DISCLAIMER);
    // Every decided finding remains in the standard sections as well as its own section.
    for (const f of applied.findings) {
      expect(md.split(f.pageUrl).length - 1).toBeGreaterThanOrEqual(3);
    }
    expect(md).toContain(DISCLAIMER);
    expect(section).not.toMatch(/is the root cause|is compliant|conforms|certified/i);
    expect(section).not.toContain('gate decisions are unchanged');
    for (const html of [scanHtml(applied), scanHtmlV2(applied)]) {
      expect(html).toContain('Review decisions (likely shared components)');
      expect(html).toContain('accepted-risk by Reviewer From Git on 2026-11-14; expires 2026-12-31; reason: Third-party nav widget');
      expect(html).toContain(REVIEW_DECISION_NOTICE);
    }
    expect(scanHtmlV2(applied)).toContain('href="#review-decisions"');
  });

  it('leaves reports unchanged when the baseline has no decisions', () => {
    const plain = createFingerprintBaseline(report([]));
    const a = applyFingerprintBaseline(report(['/', '/about']), plain, NOW);
    const b = applyFingerprintBaseline(report(['/', '/about']), { ...plain, groupDecisions: [] }, NOW);
    expect(scanMarkdown(b)).toBe(scanMarkdown(a));
    expect(scanHtmlV2(b)).toBe(scanHtmlV2(a));
    expect(scanMarkdown(a)).not.toContain('Review decisions');
    expect(a.findings.some((f) => 'reviewDecision' in f)).toBe(false);
  });
});

async function workspace(work: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'a11ygate-review-'));
  try {
    await writeFile(path.join(cwd, 'scan.json'), JSON.stringify(report(['/', '/about'])));
    await writeFile(path.join(cwd, 'baseline.json'), JSON.stringify(createFingerprintBaseline(report([])), null, 2) + '\n');
    await work(cwd);
  } finally { await rm(cwd, { recursive: true, force: true }); }
}

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { stdout: (s: string) => { out.push(s); }, stderr: (s: string) => { err.push(s); }, now: () => NOW } };
}

describe('a11ygate review CLI', () => {
  const id = () => groupId(navGroup().key);

  it('lists likely shared groups non-interactively, then records a flag decision by git user.name', async () => {
    await workspace(async (cwd) => {
      const list = capture();
      expect(await runReview(['scan.json', '--baseline', 'baseline.json', '--list'], { ...list.io, cwd })).toBe(0);
      expect(list.out.join('')).toContain(id());
      expect(list.out.join('')).toContain('likely shared component on 2 page(s)');

      const c = capture();
      expect(await runReview(['scan.json', '--baseline', 'baseline.json', '--group', id(), '--decision', 'accepted-risk', '--reason', 'Vendor widget', '--expires', '2027-01-31'],
        { ...c.io, cwd, gitUserName: async () => 'Local Git Name' })).toBe(0);
      const stored = parseFingerprintBaseline(JSON.parse(await readFile(path.join(cwd, 'baseline.json'), 'utf8')));
      expect(stored.groupDecisions).toEqual([expect.objectContaining({ group: id(), decision: 'accepted-risk', reason: 'Vendor widget', expires: '2027-01-31', by: 'Local Git Name', at: '2026-11-14' })]);
      expect(stored.findings).toEqual(createFingerprintBaseline(report([])).findings);
    });
  });

  it('refuses to invent a reviewer, a missing reason, or an unknown group', async () => {
    await workspace(async (cwd) => {
      const noName = capture();
      expect(await runReview(['scan.json', '--baseline', 'baseline.json', '--group', id(), '--decision', 'to-fix'], { ...noName.io, cwd, gitUserName: async () => '' })).toBe(2);
      expect(noName.err.join('')).toContain('git config user.name is not set');
      const noReason = capture();
      expect(await runReview(['scan.json', '--baseline', 'baseline.json', '--group', id(), '--decision', 'false-positive'], { ...noReason.io, cwd, gitUserName: async () => 'R' })).toBe(2);
      expect(noReason.err.join('')).toContain('needs --reason');
      const unknown = capture();
      expect(await runReview(['scan.json', '--baseline', 'baseline.json', '--group', 'g-ffffffffffffffff', '--decision', 'to-fix'], { ...unknown.io, cwd, gitUserName: async () => 'R' })).toBe(2);
      const past = capture();
      expect(await runReview(['scan.json', '--baseline', 'baseline.json', '--group', id(), '--decision', 'accepted-risk', '--reason', 'x', '--expires', '2026-01-01'], { ...past.io, cwd, gitUserName: async () => 'R' })).toBe(2);
      expect(JSON.parse(await readFile(path.join(cwd, 'baseline.json'), 'utf8')).groupDecisions).toBeUndefined();
    });
  });

  it('interactive mode records decisions per group with a required reason', async () => {
    await workspace(async (cwd) => {
      const answers = ['p', '', 'Name set by script at runtime'];
      const c = capture();
      expect(await runReview(['scan.json', '--baseline', 'baseline.json'], { ...c.io, cwd, interactive: true, gitUserName: async () => 'Local Git Name', prompt: async () => answers.shift() ?? 'q' })).toBe(0);
      expect(answers).toEqual([]);
      const stored = parseFingerprintBaseline(JSON.parse(await readFile(path.join(cwd, 'baseline.json'), 'utf8')));
      expect(stored.groupDecisions).toEqual([expect.objectContaining({ decision: 'false-positive', reason: 'Name set by script at runtime', by: 'Local Git Name' })]);
    });
  });
});
