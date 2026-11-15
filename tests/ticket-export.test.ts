import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { groupSharedComponents } from '@/lib/group';
import { EN301549_LABEL } from '@/lib/mapping';
import {
  buildTickets, exportTickets, JIRA_CSV_IMPORT_DOC, ticketsToCsv, ticketsToGithubMarkdown, ticketsToJiraCsv, type Ticket,
} from '@/lib/export-tickets';
import { applyFingerprintBaseline, createFingerprintBaseline } from '@/lib/scan/baseline';
import { buildScanReport } from '@/lib/scan/report';
import { createGroupDecision } from '@/lib/scan/review';
import { run } from '@/packages/cli/src/run';
import { minimalResult } from './helpers';
import { blockNetwork } from './network-guard';

const DISCLAIMER = 'Automated testing only. Not a WCAG audit, certification or legal advice.';
const CLAIMS = /fixes everything|WCAG\/EAA compliant|\bcompliant\b|\bconformant\b|\bcertified\b|\bguarantee/i;
const now = new Date('2026-11-15T12:00:00Z');

/** Seven pages share a nav image (one group); /about also has a page-specific contrast finding and a best-practice region finding. */
function fixture() {
  const paths = ['/', '/about', '/blog', '/contact', '/faq', '/pricing', '/team'];
  return buildScanReport({ crawl: { pages: paths.map((p) => {
    const url = `http://localhost${p}`;
    const violations = [{
      id: 'image-alt', impact: 'critical', help: 'Images must have alternative text', helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/image-alt', tags: ['wcag2a', 'wcag111'],
      nodes: [{ target: ['nav > img.logo'], html: '<img class="logo" src="/logo.png">' }],
    }];
    if (p === '/about') violations.push(
      { id: 'color-contrast', impact: 'serious', help: 'Elements must meet minimum color contrast ratio thresholds', helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast', tags: ['wcag2aa', 'wcag143'],
        nodes: [{ target: ['p.faint'], html: '<p class="faint">Low contrast</p>' }] },
      { id: 'region', impact: 'moderate', help: 'All page content should be contained by landmarks', helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/region', tags: ['best-practice'],
        nodes: [{ target: ['div.loose'], html: '<div class="loose">x</div>' }] },
    );
    return { url, finalUrl: url, status: 200, scanStatus: 'complete' as const, result: minimalResult({ url, violations }) };
  }), skipped: [] }, version: '0.2.0', scannedAt: now.toISOString(), startUrl: 'http://localhost/', failOn: 'serious', maxPages: 7, delayMs: 0, userAgent: 'fixture', robotsNote: 'fixture' });
}

const ticket = (overrides: Partial<Ticket> = {}): Ticket => ({
  fingerprint: 'a11ygate-g-0000000000000000', title: 'Title', ruleId: 'rule', impact: 'serious', wcag: [], en301549: [], pageCount: 1, findingCount: 1,
  pages: ['http://localhost/'], selector: 'div', snippet: '<div></div>', help: 'help', howToFix: [], ...overrides,
});

/** Minimal RFC 4180 parser, used to prove escaped fields round-trip exactly. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = []; let field = ''; let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

let guard: ReturnType<typeof blockNetwork>;
beforeEach(() => { guard = blockNetwork(); });
afterEach(() => { guard.restore(); expect(guard.attempts).toEqual([]); });

describe('buildTickets', () => {
  it('makes one ticket per shared component group, or per finding when ungrouped', () => {
    const tickets = buildTickets(fixture(), now);
    expect(tickets).toHaveLength(3);
    const [nav, contrast, region] = tickets;
    expect(nav).toMatchObject({ ruleId: 'image-alt', impact: 'critical', pageCount: 7, findingCount: 7, wcag: ['1.1.1 Non-text Content (A)'], en301549: ['1.1.1: 9.1.1.1'],
      howToFix: ['https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html'], selector: 'nav > img.logo', snippet: '<img class="logo" src="/logo.png">' });
    expect(nav!.pages).toEqual(['http://localhost/', 'http://localhost/about', 'http://localhost/blog', 'http://localhost/contact', 'http://localhost/faq']);
    expect(contrast).toMatchObject({ ruleId: 'color-contrast', pageCount: 1, pages: ['http://localhost/about'] });
    // Best-practice rules have no mapped criterion; the axe rule page is the only link.
    expect(region).toMatchObject({ ruleId: 'region', wcag: [], howToFix: ['https://dequeuniversity.com/rules/axe/4.10/region'] });
  });

  it('skips accepted-risk and false-positive groups; expired decisions count as open', () => {
    const scan = fixture();
    const groups = groupSharedComponents(scan.findings);
    const byRule = (rule: string) => groups.find((g) => g.ruleId === rule)!;
    const baseline = { ...createFingerprintBaseline(scan), groupDecisions: [
      createGroupDecision(byRule('image-alt'), { decision: 'accepted-risk', reason: 'Vendor widget', expires: '2026-11-30', by: 'Reviewer', now }),
      createGroupDecision(byRule('region'), { decision: 'false-positive', reason: 'Inside a landmark', by: 'Reviewer', now }),
      createGroupDecision(byRule('color-contrast'), { decision: 'to-fix', by: 'Reviewer', now }),
    ] };
    const active = buildTickets(applyFingerprintBaseline(scan, baseline, now), now);
    expect(active.map((t) => [t.ruleId, t.decision])).toEqual([['color-contrast', 'to-fix']]);
    const later = new Date('2026-12-01T00:00:00Z');
    const expired = buildTickets(applyFingerprintBaseline(scan, baseline, later), later);
    expect(expired.map((t) => [t.ruleId, t.decision])).toEqual([['image-alt', 'accepted-risk (expired 2026-11-30)'], ['color-contrast', 'to-fix']]);
  });

  it('keeps fingerprints stable across re-exports, page order and newly affected pages', () => {
    const first = buildTickets(fixture(), now);
    const shuffled = fixture();
    shuffled.findings = [...shuffled.findings].reverse();
    expect(buildTickets(shuffled, now).map((t) => t.fingerprint)).toEqual(first.map((t) => t.fingerprint));
    const fewer = fixture();
    fewer.findings = fewer.findings.filter((f) => f.pageUrl !== 'http://localhost/team');
    expect(buildTickets(fewer, now)[0]!.fingerprint).toBe(first[0]!.fingerprint);
    for (const format of ['csv', 'jira-csv', 'gh-md'] as const) expect(exportTickets(fixture(), format, now)).toBe(exportTickets(shuffled, format, now));
    expect(new Set(first.map((t) => t.fingerprint)).size).toBe(first.length);
    for (const t of first) expect(t.fingerprint).toMatch(/^a11ygate-g-[0-9a-f]{16}$/);
  });
});

describe('ticket formats', () => {
  it.each(['csv', 'jira-csv', 'gh-md'] as const)('%s snapshot carries the disclaimer, EN 301 549 label and no compliance claims', (format) => {
    const text = exportTickets(fixture(), format, now);
    expect(text).toMatchSnapshot();
    expect(text).toContain(DISCLAIMER);
    expect(text).toContain(EN301549_LABEL);
    expect(text).not.toMatch(CLAIMS);
  });

  it('generic CSV ends with a disclaimer row of the same width', () => {
    const rows = parseCsv(exportTickets(fixture(), 'csv', now));
    expect(rows.every((r) => r.length === rows[0]!.length)).toBe(true);
    expect(rows.at(-1)).toEqual([DISCLAIMER, ...rows[0]!.slice(1).map(() => '')]);
  });

  it('Jira CSV uses Atlassian import headers, repeated Labels columns and the disclaimer in every Description', () => {
    expect(JIRA_CSV_IMPORT_DOC).toBe('https://support.atlassian.com/jira-cloud-administration/docs/import-data-from-a-csv-file/');
    const text = exportTickets(fixture(), 'jira-csv', now);
    expect(text.startsWith('"Summary"')).toBe(true);
    const [header, ...rows] = parseCsv(text);
    expect(header).toEqual(['Summary', 'Issue Type', 'Priority', 'Description', 'Labels', 'Labels', 'Labels']);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r[2])).toEqual(['Highest', 'High', 'Medium']);
    for (const r of rows) {
      expect(r[3]!.endsWith(DISCLAIMER)).toBe(true);
      expect(r[6]).toMatch(/^a11ygate-g-/);
    }
  });

  it('GitHub markdown has one section per ticket, a hidden fingerprint and a disclaimer footer per issue', () => {
    const md = exportTickets(fixture(), 'gh-md', now);
    expect(md.match(/^### /gm)).toHaveLength(3);
    expect(md.match(/<!-- a11ygate-g-[0-9a-f]{16} -->/g)).toHaveLength(3);
    expect(md.split(DISCLAIMER)).toHaveLength(5);
    expect(md.trimEnd().endsWith(DISCLAIMER)).toBe(true);
    expect(md).toContain('- … and 2 more');
  });

  it('empty exports still carry the disclaimer', () => {
    expect(ticketsToCsv([])).toContain(DISCLAIMER);
    expect(ticketsToGithubMarkdown([])).toContain(DISCLAIMER);
    expect(parseCsv(ticketsToJiraCsv([]))).toHaveLength(1);
  });
});

describe('CSV escaping', () => {
  const tricky = ticket({
    title: 'Comma, "quoted" and\nnew line',
    selector: 'a[title="x, y"]',
    snippet: '<button aria-label="סגור, "חלון"">\r\nסגור\n</button>',
    pages: ['http://localhost/he/דף?q=a,b', 'http://localhost/ü'],
    wcag: ['1.1.1 Non-text Content (A)'],
    decision: '=HYPERLINK("http://evil.test")',
  });
  for (const [name, toText] of [['csv', ticketsToCsv], ['jira-csv', ticketsToJiraCsv]] as const) {
    it(`${name} round-trips commas, quotes, newlines and Hebrew text`, () => {
      const text = toText([tricky]);
      const [header, row] = parseCsv(text);
      expect(row).toHaveLength(header!.length);
      const cells = row!.join('\u0000');
      expect(row![0]).toBe(tricky.title);
      expect(cells).toContain(tricky.snippet);
      expect(cells).toContain('http://localhost/he/דף?q=a,b');
      expect(cells).toContain('a[title="x, y"]');
      // Spreadsheet formula cells are neutralised.
      expect(cells).not.toMatch(/(^|\u0000)=HYPERLINK/);
      if (name === 'csv') { expect(text.startsWith('﻿')).toBe(true); expect(row![11]).toBe(`'${tricky.decision}`); }
    });
  }

  it('markdown keeps fences, table cells and headings intact for hostile text', () => {
    const md = ticketsToGithubMarkdown([ticket({ title: 'a\n### injected', ruleId: 'x|y', snippet: '```\n<script>alert(1)</script>\n```', selector: 'div' })]);
    expect(md).toContain('### a ### injected');
    expect(md).toContain('`x\\|y`');
    expect(md).toContain('````html\n```\n<script>alert(1)</script>\n```\n````');
  });
});

describe('a11ygate export tickets', () => {
  it('writes each format from a saved scan and baseline with zero network requests', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'a11ygate-tickets-'));
    try {
      const scan = fixture();
      await writeFile(path.join(cwd, 'a11ygate-scan.json'), JSON.stringify(scan));
      const contrast = groupSharedComponents(scan.findings).find((g) => g.ruleId === 'color-contrast')!;
      await writeFile(path.join(cwd, 'baseline.json'), JSON.stringify({ ...createFingerprintBaseline(scan),
        groupDecisions: [createGroupDecision(contrast, { decision: 'false-positive', reason: 'Decorative', by: 'Reviewer', now })] }));
      const out: string[] = [];
      const io = { cwd, now: () => now, stdout: (s: string) => out.push(s), stderr: (s: string) => out.push(s) };
      expect(await run(['export', 'tickets', '.', '--format', 'jira-csv', '--baseline', 'baseline.json', '--output', 'jira.csv'], io)).toBe(0);
      expect(out.join('')).toContain('Wrote 2 tickets (jira-csv) to jira.csv');
      expect(out.join('')).toContain(DISCLAIMER);
      const jira = await readFile(path.join(cwd, 'jira.csv'), 'utf8');
      expect(jira).not.toContain('color-contrast');
      out.length = 0;
      expect(await run(['export', 'tickets', 'a11ygate-scan.json', '--format=gh-md'], io)).toBe(0);
      expect(out.join('')).toBe(exportTickets(scan, 'gh-md', now));
      expect(await run(['export', 'tickets', '.', '--format', 'pdf'], io)).toBe(2);
      expect(await run(['export', 'tickets', '.'], io)).toBe(2);
      expect(await run(['export', 'tickets', '.', '--format', 'csv', '--output', 'baseline.json', '--baseline', 'baseline.json'], io)).toBe(2);
      expect(await run(['export', '--help'], io)).toBe(0);
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
});
