/**
 * Developer handoff export (A11Y-R54): one ticket per likely shared-component group
 * (lib/group.ts, R29) or per finding when the finding is not part of a larger group,
 * as generic CSV, Jira CSV or GitHub-issue Markdown.
 *
 * Export only: this module builds text. It never calls Jira, GitHub or any other API.
 *
 * Ticket strings live in this module on purpose (kept apart from the report templates).
 * All text is copied from the scan (axe help text, selectors, snippets, URLs) or from the
 * static mapping table; nothing here writes alt text, labels or accessible names.
 */
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { csvField } from '@/lib/export-csv';
import { impactRank } from '@/lib/gate';
import { componentGroupKey } from '@/lib/group';
import { EN301549_COLUMN, EN301549_LABEL, en301549Ref, understandingUrl } from '@/lib/mapping';
import { groupId, isExpired } from '@/lib/scan/review';
import type { ScanFinding, ScanReport } from '@/lib/scan/report';
import type { Impact } from '@/lib/types';

export const TICKET_FORMATS = ['csv', 'jira-csv', 'gh-md'] as const;
export type TicketFormat = (typeof TICKET_FORMATS)[number];

/** Atlassian's documented CSV import, which the jira-csv column names follow. Not fetched by A11yGate. */
export const JIRA_CSV_IMPORT_DOC = 'https://support.atlassian.com/jira-cloud-administration/docs/import-data-from-a-csv-file/';

export const TICKET_MAX_URLS = 5;
export const TICKET_FINGERPRINT_PREFIX = 'a11ygate-';
const EN301549_HEADER = `${EN301549_COLUMN} (${EN301549_LABEL})`;

export type Ticket = {
  /** Stable id for dedupe on re-import: a11ygate-g-<hash of the component group key>. */
  fingerprint: string;
  title: string;
  ruleId: string;
  /** Highest impact among the ticket's findings; null when the engine reported none. */
  impact: Impact | null;
  /** "1.1.1 Non-text Content (A)" entries, or empty for best-practice rules. */
  wcag: string[];
  /** "1.1.1: 9.1.1.1" entries (reference mapping only; does not indicate conformance). */
  en301549: string[];
  pageCount: number;
  findingCount: number;
  /** First five affected page URLs, sorted. */
  pages: string[];
  selector: string;
  snippet: string;
  help: string;
  /** W3C Understanding links from the mapping table; the rule's help URL when no criterion is mapped. */
  howToFix: string[];
  /** Present when an expired accepted-risk or to-fix decision applies to the group. */
  decision?: string;
};

function compareText(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

/**
 * Open findings only: accepted-risk and false-positive decisions are skipped unless the
 * accepted-risk decision has expired on `now`, in which case the finding counts as open again.
 */
export function openTicketFindings(findings: readonly ScanFinding[], now: Date): ScanFinding[] {
  return findings.filter((f) => !f.reviewDecision || f.reviewDecision.decision === 'to-fix' || isExpired(f.reviewDecision, now));
}

export function buildTickets(report: Pick<ScanReport, 'findings'>, now: Date = new Date()): Ticket[] {
  const groups = new Map<string, ScanFinding[]>();
  for (const finding of openTicketFindings(report.findings, now)) {
    const key = componentGroupKey(finding);
    groups.set(key, [...(groups.get(key) ?? []), finding]);
  }
  const tickets = [...groups].map(([key, members]): Ticket => {
    const sorted = [...members].sort((a, b) => compareText(JSON.stringify([a.pageUrl, a.selector, a.html]), JSON.stringify([b.pageUrl, b.selector, b.html])));
    const first = sorted[0]!;
    const pages = [...new Set(sorted.map((f) => f.pageUrl))].sort(compareText);
    const impact = sorted.reduce<Impact | null>((best, f) => (f.impact && (!best || impactRank(f.impact) > impactRank(best)) ? f.impact : best), null);
    const criteria = [...new Map(sorted.flatMap((f) => f.wcag).map((c) => [c.number, c])).values()];
    const links = criteria.map((c) => understandingUrl(c)).filter((u): u is string => !!u);
    const decision = first.reviewDecision;
    return {
      fingerprint: `${TICKET_FINGERPRINT_PREFIX}${groupId(key)}`,
      title: `${first.help || first.ruleId} (${first.ruleId}) on ${pages.length} page${pages.length === 1 ? '' : 's'}`,
      ruleId: first.ruleId,
      impact,
      wcag: criteria.map((c) => `${c.number} ${c.name} (${c.level})`),
      en301549: criteria.map((c) => `${c.number}: ${en301549Ref(c.number)}`),
      pageCount: pages.length,
      findingCount: members.length,
      pages: pages.slice(0, TICKET_MAX_URLS),
      selector: first.selector,
      snippet: first.html,
      help: first.help,
      howToFix: links.length ? [...new Set(links)] : first.helpUrl ? [first.helpUrl] : [],
      ...(decision ? { decision: decision.decision === 'accepted-risk' ? `accepted-risk (expired ${decision.expires})` : decision.decision } : {}),
    };
  });
  const rank = (t: Ticket) => (t.impact ? impactRank(t.impact) : 0);
  return tickets.sort((a, b) => rank(b) - rank(a) || b.pageCount - a.pageCount || compareText(a.fingerprint, b.fingerprint));
}

const join = (values: readonly string[], empty = '') => (values.length ? values.join(' | ') : empty);
const wcagText = (t: Ticket) => join(t.wcag, 'best practice (no WCAG success criterion mapped)');

/** Plain-text body shared by the Jira description. */
function plainBody(t: Ticket): string {
  return [
    `Rule: ${t.ruleId}`,
    `WCAG SC: ${wcagText(t)}`,
    `${EN301549_COLUMN}: ${join(t.en301549, 'none')} (${EN301549_LABEL})`,
    `Impact: ${t.impact ?? 'unknown'}`,
    `Pages affected: ${t.pageCount} (${t.findingCount} finding${t.findingCount === 1 ? '' : 's'})`,
    ...t.pages.map((u) => `- ${u}`),
    ...(t.pageCount > t.pages.length ? [`- … and ${t.pageCount - t.pages.length} more`] : []),
    `Selector: ${t.selector}`,
    `Snippet: ${t.snippet}`,
    `How to fix: ${join(t.howToFix, 'none')}`,
    ...(t.decision ? [`Review decision: ${t.decision}`] : []),
    `A11yGate fingerprint: ${t.fingerprint}`,
    '',
    AUTOMATED_TESTING_DISCLAIMER,
  ].join('\n');
}

export const TICKET_CSV_COLUMNS = ['title', 'wcag_sc', EN301549_HEADER, 'impact', 'rule', 'pages_affected', 'findings', 'first_urls',
  'selector', 'snippet', 'how_to_fix', 'review_decision', 'fingerprint'] as const;

/**
 * Generic CSV (UTF-8 with BOM, all fields quoted, formula-like cells prefixed with ').
 * The final row carries the disclaimer in the first column with the other columns empty.
 */
export function ticketsToCsv(tickets: readonly Ticket[]): string {
  const rows = tickets.map((t) => [t.title, wcagText(t), join(t.en301549), t.impact ?? '', t.ruleId, String(t.pageCount), String(t.findingCount),
    t.pages.join('\n'), t.selector, t.snippet, t.howToFix.join('\n'), t.decision ?? '', t.fingerprint]);
  const footer = [AUTOMATED_TESTING_DISCLAIMER, ...TICKET_CSV_COLUMNS.slice(1).map(() => '')];
  return `﻿${[[...TICKET_CSV_COLUMNS], ...rows, footer].map((r) => r.map(csvField).join(',')).join('\n')}\n`;
}

export const JIRA_EMPTY_NOTICE_SUMMARY = 'A11yGate notice: no open findings (do not import)';

const JIRA_PRIORITY: Record<Impact, string> = { critical: 'Highest', serious: 'High', moderate: 'Medium', minor: 'Low' };

/**
 * Jira CSV following Atlassian's CSV import ({@link JIRA_CSV_IMPORT_DOC}): Summary (required),
 * Issue Type, Priority, Description and repeated Labels columns (one value per column).
 * There is no trailing disclaimer row, because Jira would import it as an issue; the disclaimer
 * ends every Description instead. No BOM, so Jira reads the first header as "Summary".
 * With zero tickets the file would otherwise be headers only, so a single clearly labelled
 * notice row (Issue Type Task, label a11ygate-notice, "do not import") carries the disclaimer.
 */
export function ticketsToJiraCsv(tickets: readonly Ticket[]): string {
  const header = ['Summary', 'Issue Type', 'Priority', 'Description', 'Labels', 'Labels', 'Labels'];
  const rows = tickets.map((t) => [t.title, 'Bug', t.impact ? JIRA_PRIORITY[t.impact] : '', plainBody(t), 'accessibility', 'a11ygate', t.fingerprint]);
  if (!rows.length) {
    rows.push([JIRA_EMPTY_NOTICE_SUMMARY, 'Task', '', `A11yGate found no open findings to export. Do not import this notice row.\n\n${AUTOMATED_TESTING_DISCLAIMER}`,
      'a11ygate', 'a11ygate-notice', '']);
  }
  return `${[header, ...rows].map((r) => r.map(csvField).join(',')).join('\n')}\n`;
}

const mdCell = (value: string) => value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>').replace(/</g, '&lt;');
const mdTitle = (value: string) => value.replace(/\s+/g, ' ').replace(/</g, '&lt;').trim();
function fence(code: string, lang = ''): string {
  const longest = Math.max(2, ...[...code.matchAll(/`+/g)].map((m) => m[0].length));
  const ticks = '`'.repeat(longest + 1);
  return `${ticks}${lang}\n${code}\n${ticks}`;
}

/** One GitHub issue per section: "### title" then a body to paste. Fingerprint as a hidden comment and visible line. */
export function ticketsToGithubMarkdown(tickets: readonly Ticket[]): string {
  const sections = tickets.map((t) => [
    `### ${mdTitle(t.title)}`,
    '',
    `<!-- ${t.fingerprint} -->`,
    '| Field | Value |',
    '| --- | --- |',
    `| WCAG SC | ${mdCell(wcagText(t))} |`,
    `| ${EN301549_COLUMN} | ${mdCell(join(t.en301549, 'none'))} |`,
    `| Impact | ${mdCell(t.impact ?? 'unknown')} |`,
    `| Rule | \`${mdCell(t.ruleId)}\` |`,
    `| Pages affected | ${t.pageCount} (${t.findingCount} finding${t.findingCount === 1 ? '' : 's'}) |`,
    ...(t.decision ? [`| Review decision | ${mdCell(t.decision)} |`] : []),
    `| Fingerprint | \`${t.fingerprint}\` |`,
    '',
    `${EN301549_COLUMN}: ${EN301549_LABEL}`,
    '',
    `**Affected pages${t.pageCount > t.pages.length ? ` (first ${t.pages.length} of ${t.pageCount})` : ''}**`,
    '',
    ...t.pages.map((u) => `- <${u.replace(/[<>\s]/g, (c) => encodeURIComponent(c))}>`),
    ...(t.pageCount > t.pages.length ? [`- … and ${t.pageCount - t.pages.length} more`] : []),
    '',
    '**Selector**',
    '',
    fence(t.selector),
    '',
    '**Snippet**',
    '',
    fence(t.snippet, 'html'),
    '',
    '**How to fix**',
    '',
    ...(t.howToFix.length ? t.howToFix.map((u) => `- <${u.replace(/[<>\s]/g, (c) => encodeURIComponent(c))}>`) : ['- No reference link mapped.']),
    '',
    `_${AUTOMATED_TESTING_DISCLAIMER}_`,
  ].join('\n'));
  const intro = tickets.length
    ? `${tickets.length} ticket${tickets.length === 1 ? '' : 's'}; each "###" section is one GitHub issue (title, then body). Groups are heuristic likely shared components; review examples before filing.`
    : 'No open findings to export.';
  return `# A11yGate tickets\n\n${intro}\n\n${sections.join('\n\n---\n\n')}${sections.length ? '\n\n---\n\n' : ''}${AUTOMATED_TESTING_DISCLAIMER}\n`;
}

export function exportTickets(report: Pick<ScanReport, 'findings'>, format: TicketFormat, now: Date = new Date()): string {
  const tickets = buildTickets(report, now);
  return format === 'csv' ? ticketsToCsv(tickets) : format === 'jira-csv' ? ticketsToJiraCsv(tickets) : ticketsToGithubMarkdown(tickets);
}
