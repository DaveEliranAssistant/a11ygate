import { scanPageKey } from '@/lib/compare';
import { markdownCell } from '@/lib/export-markdown';
import { impactRank } from '@/lib/gate';
import { getCriterion, type WcagLevel } from '@/lib/mapping';
import type { AxeResults, DiffedFinding, DiffResult, DiffStatus, Impact, Verdict } from '@/lib/types';

/**
 * Evidence report export: one data model rendered as JSON, Markdown, or a
 * self-contained HTML page. Everything except `generatedAt` is derived from the
 * scan input, and every list is sorted, so the same input gives the same bytes.
 */

export const REPORT_DISCLAIMER =
  'Automated checks only (axe-core). Not a WCAG conformance audit, certification, or legal advice. Automated tools detect a subset of accessibility issues.';

export const REPORT_FORMATS = ['html', 'md', 'json'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export function isReportFormat(value: unknown): value is ReportFormat {
  return value === 'html' || value === 'md' || value === 'json';
}

/** `--format` wins; otherwise the output extension decides; HTML is the default. */
export function inferReportFormat(out: string | undefined): ReportFormat {
  const lower = (out ?? '').toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'md';
  if (lower.endsWith('.json')) return 'json';
  return 'html';
}

export type EvidenceReportInput = {
  generatedAt: string;
  version: string;
  projectName: string;
  verdict: Verdict;
  threshold: Impact;
  reason: string;
  synthetic: boolean;
  commit?: string | null;
  branch?: string | null;
  current: readonly AxeResults[];
  baseline: readonly AxeResults[] | null;
  diff: DiffResult;
};

export type ReportCriterion = {
  number: string;
  name: string | null;
  level: WcagLevel | null;
  wcag: string | null;
};

export type ReportFindingStatus = 'new' | 'baselined' | 'fixed' | 'unassessed';

export type ReportFinding = {
  status: ReportFindingStatus;
  impact: Impact | null;
  url: string;
  selector: string;
  html: string;
  fingerprint: string;
  assessmentReason: string | null;
};

export type ReportRule = {
  ruleId: string;
  impact: Impact | null;
  help: string;
  helpUrl: string;
  wcag: ReportCriterion[];
  bestPractice: boolean;
  tags: string[];
  counts: Record<ReportFindingStatus, number>;
  findings: ReportFinding[];
};

export type ReportTrendRow = {
  ruleId: string;
  baseline: number;
  current: number;
  delta: number;
};

export type EvidenceReport = {
  tool: 'a11ygate';
  reportSchemaVersion: 1;
  disclaimer: string;
  generatedAt: string;
  projectName: string;
  synthetic: boolean;
  source: { commit: string | null; branch: string | null };
  tools: { a11ygate: string; axeCore: { current: string[]; baseline: string[] } };
  gate: { verdict: Verdict; threshold: Impact; reason: string };
  summary: {
    new: number;
    baselined: number;
    fixed: number;
    unassessed: number;
    currentViolations: number;
    baselineViolations: number | null;
    rulesWithCurrentViolations: number;
  };
  coverage: {
    status: 'complete' | 'incomplete' | 'unverified';
    issues: { page: string; code: string; detail: string }[];
    unassessedScope: string[];
  };
  pages: {
    url: string;
    page: string;
    scannedAt: string;
    axeCore: string;
    scanStatus: 'complete' | 'failed';
    violations: number;
    new: number;
    baselined: number;
    inBaseline: boolean;
  }[];
  rules: ReportRule[];
  trend: {
    baselineSupplied: boolean;
    totals: { baseline: number; current: number; delta: number } | null;
    rules: ReportTrendRow[];
  };
};

const STATUS: Record<DiffStatus, ReportFindingStatus> = {
  new: 'new',
  'still-open': 'baselined',
  fixed: 'fixed',
  unassessed: 'unassessed',
};

const STATUS_ORDER: Record<ReportFindingStatus, number> = { new: 0, baselined: 1, fixed: 2, unassessed: 3 };

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareText);
}

function compareCriterion(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** axe `wcagNNN` tags name a success criterion; `wcag2aa`-style level tags do not. */
export function wcagCriteria(tags: readonly string[]): ReportCriterion[] {
  const found = new Map<string, ReportCriterion>();
  for (const tag of tags) {
    const known = getCriterion(tag);
    if (known) {
      found.set(known.number, { number: known.number, name: known.name, level: known.level, wcag: known.wcag });
      continue;
    }
    const match = /^wcag(\d)(\d)(\d{1,2})$/i.exec(tag);
    if (!match) continue;
    const number = `${match[1]}.${match[2]}.${match[3]}`;
    if (!found.has(number)) found.set(number, { number, name: null, level: null, wcag: null });
  }
  return [...found.values()].sort((a, b) => compareCriterion(a.number, b.number));
}

function maxImpact(findings: readonly DiffedFinding[]): Impact | null {
  let best: Impact | null = null;
  for (const finding of findings) {
    if (impactRank(finding.impact) > impactRank(best)) best = finding.impact;
  }
  return best;
}

function reportFinding(finding: DiffedFinding): ReportFinding {
  return {
    status: STATUS[finding.status],
    impact: finding.impact,
    url: finding.url,
    selector: finding.selector,
    html: finding.html,
    fingerprint: finding.fingerprint,
    assessmentReason: finding.assessmentReason ?? null,
  };
}

function emptyCounts(): Record<ReportFindingStatus, number> {
  return { new: 0, baselined: 0, fixed: 0, unassessed: 0 };
}

function currentCount(counts: Record<ReportFindingStatus, number>): number {
  return counts.new + counts.baselined;
}

function baselineCount(counts: Record<ReportFindingStatus, number>): number {
  return counts.baselined + counts.fixed + counts.unassessed;
}

function buildRules(diff: DiffResult): ReportRule[] {
  const all = [...diff.newFindings, ...diff.stillOpen, ...diff.fixedFindings, ...(diff.unassessed ?? [])];
  const byRule = new Map<string, DiffedFinding[]>();
  for (const finding of all) byRule.set(finding.ruleId, [...(byRule.get(finding.ruleId) ?? []), finding]);

  const rules = [...byRule.entries()].map(([ruleId, findings]): ReportRule => {
    const counts = emptyCounts();
    for (const finding of findings) counts[STATUS[finding.status]] += 1;
    const current = findings.filter((finding) => finding.status === 'new' || finding.status === 'still-open');
    // Prefer the current run's metadata; the axe version may have reworded help text.
    const reference = [...(current.length ? current : findings)].sort((a, b) =>
      compareText(a.fingerprint, b.fingerprint),
    )[0] as DiffedFinding;
    const tags = uniqueSorted(findings.flatMap((finding) => finding.tags));
    const wcag = wcagCriteria(tags);
    return {
      ruleId,
      impact: maxImpact(current.length ? current : findings),
      help: reference.help,
      helpUrl: reference.helpUrl,
      wcag,
      bestPractice: wcag.length === 0,
      tags,
      counts,
      findings: findings
        .map(reportFinding)
        .sort(
          (a, b) =>
            STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
            compareText(a.url, b.url) ||
            compareText(a.selector, b.selector) ||
            compareText(a.fingerprint, b.fingerprint),
        ),
    };
  });

  return rules.sort(
    (a, b) =>
      Number(currentCount(b.counts) > 0) - Number(currentCount(a.counts) > 0) ||
      impactRank(b.impact) - impactRank(a.impact) ||
      compareText(a.ruleId, b.ruleId),
  );
}

export function buildEvidenceReport(input: EvidenceReportInput): EvidenceReport {
  const { diff } = input;
  const rules = buildRules(diff);
  const baselineSupplied = input.baseline !== null;
  const baselinePages = new Set((input.baseline ?? []).map((result) => scanPageKey(result.url)));
  const current = [...diff.newFindings, ...diff.stillOpen];

  const pages = input.current
    .map((result) => {
      const page = scanPageKey(result.url);
      const onPage = current.filter((finding) => finding.url === result.url);
      return {
        url: result.url,
        page,
        scannedAt: result.timestamp,
        axeCore: result.testEngine.version,
        scanStatus: result.scanStatus === 'failed' || result.scanError ? ('failed' as const) : ('complete' as const),
        violations: onPage.length,
        new: onPage.filter((finding) => finding.status === 'new').length,
        baselined: onPage.filter((finding) => finding.status === 'still-open').length,
        inBaseline: baselinePages.has(page),
      };
    })
    .sort((a, b) => compareText(a.url, b.url) || compareText(a.scannedAt, b.scannedAt));

  const trendRules = baselineSupplied
    ? rules
        .map((rule) => {
          const baseline = baselineCount(rule.counts);
          const now = currentCount(rule.counts);
          return { ruleId: rule.ruleId, baseline, current: now, delta: now - baseline };
        })
        .sort((a, b) => a.delta - b.delta || compareText(a.ruleId, b.ruleId))
    : [];
  const baselineViolations = baselineSupplied
    ? diff.stillOpen.length + diff.fixedFindings.length + (diff.unassessed?.length ?? 0)
    : null;

  return {
    tool: 'a11ygate',
    reportSchemaVersion: 1,
    disclaimer: REPORT_DISCLAIMER,
    generatedAt: input.generatedAt,
    projectName: input.projectName,
    synthetic: input.synthetic,
    source: { commit: input.commit?.trim() || null, branch: input.branch?.trim() || null },
    tools: {
      a11ygate: input.version,
      axeCore: {
        current: uniqueSorted(input.current.map((result) => result.testEngine.version)),
        baseline: uniqueSorted((input.baseline ?? []).map((result) => result.testEngine.version)),
      },
    },
    gate: { verdict: input.verdict, threshold: input.threshold, reason: input.reason },
    summary: {
      new: diff.newFindings.length,
      baselined: diff.stillOpen.length,
      fixed: diff.fixedFindings.length,
      unassessed: diff.unassessed?.length ?? 0,
      currentViolations: current.length,
      baselineViolations,
      rulesWithCurrentViolations: rules.filter((rule) => currentCount(rule.counts) > 0).length,
    },
    coverage: {
      status: diff.coverage?.status ?? 'unverified',
      issues: [...(diff.coverage?.issues ?? [])].sort(
        (a, b) => compareText(a.page, b.page) || compareText(a.code, b.code) || compareText(a.detail, b.detail),
      ),
      unassessedScope: [...(diff.coverage?.unassessedScope ?? [])],
    },
    pages,
    rules,
    trend: {
      baselineSupplied,
      totals:
        baselineViolations === null
          ? null
          : { baseline: baselineViolations, current: current.length, delta: current.length - baselineViolations },
      rules: trendRules,
    },
  };
}

// ---------------------------------------------------------------------------
// Shared wording

const STATUS_LABEL: Record<ReportFindingStatus, string> = {
  new: 'New',
  baselined: 'Baselined',
  fixed: 'Fixed',
  unassessed: 'Unassessed (not verified fixed)',
};

function criterionLabel(criterion: ReportCriterion): string {
  if (!criterion.name) return `${criterion.number} (not in A11yGate's criterion table)`;
  return `${criterion.number} ${criterion.name} (Level ${criterion.level}, WCAG ${criterion.wcag})`;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function impactLabel(impact: Impact | null): string {
  return impact ?? 'unspecified';
}

function safeHref(url: string): string | null {
  return /^https?:\/\/[^\s"'<>]+$/i.test(url) ? url : null;
}

const MAPPING_NOTE =
  'WCAG success criteria are mapped from axe-core rule tags. The mapping needs expert review before it is relied on.';

// ---------------------------------------------------------------------------
// JSON

export function evidenceReportJson(report: EvidenceReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Markdown

const md = markdownCell;

/** Backslash escapes do not apply inside code spans; only table pipes and backticks need care. */
function codeSpan(value: string): string {
  return `\`${value.replace(/`/g, "'").replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ')}\``;
}

export function evidenceReportMarkdown(report: EvidenceReport): string {
  const { summary, trend } = report;
  const lines: string[] = [
    `# Accessibility evidence report — ${md(report.projectName)}`,
    '',
    `> ${report.disclaimer}`,
    '',
    ...(report.synthetic ? ['**SYNTHETIC evidence — not a real audit or customer assessment.**', ''] : []),
    '## Scan details',
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Generated | ${md(report.generatedAt)} |`,
    `| Commit | ${report.source.commit ? codeSpan(report.source.commit) : 'not recorded'} |`,
    `| Branch | ${report.source.branch ? codeSpan(report.source.branch) : 'not recorded'} |`,
    `| A11yGate | ${md(report.tools.a11ygate)} |`,
    `| axe-core (current) | ${md(report.tools.axeCore.current.join(', ') || 'unknown')} |`,
    `| axe-core (baseline) | ${trend.baselineSupplied ? md(report.tools.axeCore.baseline.join(', ') || 'unknown') : 'no baseline'} |`,
    `| Gate | ${report.gate.verdict} at threshold ${report.gate.threshold} — ${md(report.gate.reason)} |`,
    `| Coverage | ${report.coverage.status} |`,
    '',
    '## Summary',
    '',
    '| Status | Violations |',
    '| --- | --- |',
    `| New | ${summary.new} |`,
    `| Baselined (still open) | ${summary.baselined} |`,
    `| Fixed | ${summary.fixed} |`,
    `| Unassessed (not verified fixed) | ${summary.unassessed} |`,
    `| Current total | ${summary.currentViolations} |`,
    '',
    `Rules with current violations: ${summary.rulesWithCurrentViolations}.`,
    '',
    '## Pages scanned',
    '',
    '| Page | Scanned | axe-core | Scan | Violations | New | Baselined | In baseline |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...report.pages.map(
      (page) =>
        `| ${md(page.url)} | ${md(page.scannedAt)} | ${md(page.axeCore)} | ${page.scanStatus} | ${page.violations} | ${page.new} | ${page.baselined} | ${page.inBaseline ? 'yes' : 'no'} |`,
    ),
    '',
  ];

  if (report.coverage.issues.length > 0) {
    lines.push(
      '### Coverage issues',
      '',
      ...report.coverage.issues.map((issue) => `- ${md(issue.code)} on ${codeSpan(issue.page)}: ${md(issue.detail)}`),
      '',
    );
  }

  lines.push('## Trend versus baseline', '');
  if (!trend.baselineSupplied || !trend.totals) {
    lines.push('No baseline was supplied, so every current violation is reported as new.', '');
  } else {
    lines.push(
      `Total violations: ${trend.totals.baseline} in the baseline, ${trend.totals.current} now (${signed(trend.totals.delta)}).`,
      '',
      '| Rule | Baseline | Current | Change |',
      '| --- | --- | --- | --- |',
      ...trend.rules.map((row) => `| ${md(row.ruleId)} | ${row.baseline} | ${row.current} | ${signed(row.delta)} |`),
      '',
    );
  }

  lines.push('## Violations by rule', '', MAPPING_NOTE, '');
  if (report.rules.length === 0) lines.push('No violations were reported.', '');
  for (const rule of report.rules) {
    const href = safeHref(rule.helpUrl);
    lines.push(
      `### ${md(rule.ruleId)} — ${impactLabel(rule.impact)}`,
      '',
      `${md(rule.help)}${href ? ` ([rule documentation](${href}))` : ''}`,
      '',
      `- WCAG: ${rule.bestPractice ? 'none mapped (best practice)' : rule.wcag.map((criterion) => md(criterionLabel(criterion))).join('; ')}`,
      `- Counts: ${rule.counts.new} new, ${rule.counts.baselined} baselined, ${rule.counts.fixed} fixed, ${rule.counts.unassessed} unassessed`,
      '',
      '| Status | Impact | Page | Selector | Element |',
      '| --- | --- | --- | --- | --- |',
      ...rule.findings.map(
        (finding) =>
          `| ${STATUS_LABEL[finding.status]}${finding.assessmentReason ? ` — ${md(finding.assessmentReason)}` : ''} | ${impactLabel(finding.impact)} | ${md(finding.url)} | ${codeSpan(finding.selector)} | ${codeSpan(finding.html)} |`,
      ),
      '',
    );
  }

  lines.push('## Disclaimer', '', report.disclaimer, '');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// HTML

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STYLE = `
:root{color-scheme:light;--fg:#1b1f24;--muted:#4b5563;--line:#d0d7de;--bg:#ffffff;--soft:#f6f8fa}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:72rem;margin:0 auto;padding:2rem 1.25rem 4rem}
h1{font-size:1.75rem;margin:0 0 .5rem}
h2{font-size:1.35rem;margin:2.5rem 0 .75rem;border-bottom:1px solid var(--line);padding-bottom:.25rem}
h3{font-size:1.1rem;margin:1.75rem 0 .5rem}
.disclaimer{border:2px solid #9a6700;background:#fff8c5;padding:.75rem 1rem;border-radius:.375rem;font-weight:600}
.synthetic{border:2px solid #cf222e;background:#ffebe9;padding:.5rem 1rem;border-radius:.375rem;font-weight:700}
table{border-collapse:collapse;width:100%;margin:.5rem 0 1rem;font-size:.9375rem}
caption{text-align:left;font-weight:600;padding:.25rem 0}
th,td{border:1px solid var(--line);padding:.375rem .5rem;text-align:left;vertical-align:top}
thead th{background:var(--soft)}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.875em;word-break:break-word}
.muted{color:var(--muted)}
.impact{display:inline-block;padding:0 .4rem;border-radius:.25rem;border:1px solid currentColor;font-size:.8125rem;font-weight:600;text-transform:uppercase}
.impact-critical{color:#a40e26}.impact-serious{color:#9a3412}.impact-moderate{color:#7c4a03}.impact-minor,.impact-unspecified{color:#374151}
a{color:#0550ae}
@media print{main{padding:0}h2{break-after:avoid}table{break-inside:auto}tr{break-inside:avoid}}
`.trim();

function impactBadge(impact: Impact | null): string {
  const label = impactLabel(impact);
  return `<span class="impact impact-${label}">${label}</span>`;
}

function row(cells: string[]): string {
  return `<tr>${cells.join('')}</tr>`;
}

function td(value: string | number, numeric = false): string {
  return numeric ? `<td class="num">${value}</td>` : `<td>${value}</td>`;
}

function table(caption: string, headers: string[], rows: string[], numeric: readonly number[] = []): string {
  const head = headers
    .map((header, index) => `<th scope="col"${numeric.includes(index) ? ' class="num"' : ''}>${esc(header)}</th>`)
    .join('');
  return `<table>\n<caption>${esc(caption)}</caption>\n<thead><tr>${head}</tr></thead>\n<tbody>\n${rows.join('\n')}\n</tbody>\n</table>`;
}

function keyValueTable(caption: string, entries: [string, string][]): string {
  const rows = entries.map(([key, value]) => `<tr><th scope="row">${esc(key)}</th><td>${value}</td></tr>`);
  return `<table>\n<caption>${esc(caption)}</caption>\n<tbody>\n${rows.join('\n')}\n</tbody>\n</table>`;
}

function codeOrMissing(value: string | null): string {
  return value ? `<code>${esc(value)}</code>` : '<span class="muted">not recorded</span>';
}

export function evidenceReportHtml(report: EvidenceReport): string {
  const { summary, trend } = report;
  const title = `Accessibility evidence report — ${report.projectName}`;
  const parts: string[] = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`,
    '<meta name="generator" content="a11ygate">',
    `<title>${esc(title)}</title>`,
    `<style>${STYLE}</style>`,
    '</head>',
    '<body>',
    '<main>',
    `<h1>${esc(title)}</h1>`,
    `<p class="disclaimer" role="note">${esc(report.disclaimer)}</p>`,
    ...(report.synthetic
      ? ['<p class="synthetic" role="note">SYNTHETIC evidence — not a real audit or customer assessment.</p>']
      : []),
    '<h2 id="scan">Scan details</h2>',
    keyValueTable('Scan details', [
      ['Generated', `<time datetime="${esc(report.generatedAt)}">${esc(report.generatedAt)}</time>`],
      ['Commit', codeOrMissing(report.source.commit)],
      ['Branch', codeOrMissing(report.source.branch)],
      ['A11yGate', esc(report.tools.a11ygate)],
      ['axe-core (current)', esc(report.tools.axeCore.current.join(', ') || 'unknown')],
      [
        'axe-core (baseline)',
        trend.baselineSupplied ? esc(report.tools.axeCore.baseline.join(', ') || 'unknown') : 'no baseline',
      ],
      ['Gate', `${esc(report.gate.verdict)} at threshold ${esc(report.gate.threshold)} — ${esc(report.gate.reason)}`],
      ['Coverage', esc(report.coverage.status)],
    ]),
    '<h2 id="summary">Summary</h2>',
    table(
      'Violations by status',
      ['Status', 'Violations'],
      [
        row([td('New'), td(summary.new, true)]),
        row([td('Baselined (still open)'), td(summary.baselined, true)]),
        row([td('Fixed'), td(summary.fixed, true)]),
        row([td('Unassessed (not verified fixed)'), td(summary.unassessed, true)]),
        row([td('Current total'), td(summary.currentViolations, true)]),
      ],
      [1],
    ),
    `<p>Rules with current violations: ${summary.rulesWithCurrentViolations}.</p>`,
    '<h2 id="pages">Pages scanned</h2>',
    table(
      'Pages scanned',
      ['Page', 'Scanned', 'axe-core', 'Scan', 'Violations', 'New', 'Baselined', 'In baseline'],
      report.pages.map((page) =>
        row([
          td(`<code>${esc(page.url)}</code>`),
          td(esc(page.scannedAt)),
          td(esc(page.axeCore)),
          td(page.scanStatus),
          td(page.violations, true),
          td(page.new, true),
          td(page.baselined, true),
          td(page.inBaseline ? 'yes' : 'no'),
        ]),
      ),
      [4, 5, 6],
    ),
  ];

  if (report.coverage.issues.length > 0) {
    parts.push(
      '<h3>Coverage issues</h3>',
      '<ul>',
      ...report.coverage.issues.map(
        (issue) => `<li><strong>${esc(issue.code)}</strong> on <code>${esc(issue.page)}</code>: ${esc(issue.detail)}</li>`,
      ),
      '</ul>',
    );
  }

  parts.push('<h2 id="trend">Trend versus baseline</h2>');
  if (!trend.baselineSupplied || !trend.totals) {
    parts.push('<p>No baseline was supplied, so every current violation is reported as new.</p>');
  } else {
    parts.push(
      `<p>Total violations: ${trend.totals.baseline} in the baseline, ${trend.totals.current} now (${signed(trend.totals.delta)}).</p>`,
      table(
        'Violations per rule, baseline and current',
        ['Rule', 'Baseline', 'Current', 'Change'],
        trend.rules.map((entry) =>
          row([
            td(`<code>${esc(entry.ruleId)}</code>`),
            td(entry.baseline, true),
            td(entry.current, true),
            td(signed(entry.delta), true),
          ]),
        ),
        [1, 2, 3],
      ),
    );
  }

  parts.push('<h2 id="rules">Violations by rule</h2>', `<p class="muted">${esc(MAPPING_NOTE)}</p>`);
  if (report.rules.length === 0) parts.push('<p>No violations were reported.</p>');
  for (const rule of report.rules) {
    const href = safeHref(rule.helpUrl);
    parts.push(
      '<section>',
      `<h3 id="rule-${esc(rule.ruleId)}"><code>${esc(rule.ruleId)}</code> ${impactBadge(rule.impact)}</h3>`,
      `<p>${esc(rule.help)}${href ? ` (<a href="${esc(href)}">rule documentation</a>)` : ''}</p>`,
      '<ul>',
      `<li>WCAG: ${
        rule.bestPractice
          ? 'none mapped (best practice)'
          : rule.wcag.map((criterion) => esc(criterionLabel(criterion))).join('; ')
      }</li>`,
      `<li>Counts: ${rule.counts.new} new, ${rule.counts.baselined} baselined, ${rule.counts.fixed} fixed, ${rule.counts.unassessed} unassessed</li>`,
      '</ul>',
      table(
        `Occurrences of ${rule.ruleId}`,
        ['Status', 'Impact', 'Page', 'Selector', 'Element'],
        rule.findings.map((finding) =>
          row([
            td(
              esc(STATUS_LABEL[finding.status]) +
                (finding.assessmentReason ? ` <span class="muted">— ${esc(finding.assessmentReason)}</span>` : ''),
            ),
            td(impactBadge(finding.impact)),
            td(`<code>${esc(finding.url)}</code>`),
            td(`<code>${esc(finding.selector)}</code>`),
            td(`<code>${esc(finding.html)}</code>`),
          ]),
        ),
      ),
      '</section>',
    );
  }

  parts.push(
    '<h2 id="disclaimer">Disclaimer</h2>',
    `<p>${esc(report.disclaimer)}</p>`,
    '</main>',
    '</body>',
    '</html>',
    '',
  );
  return parts.join('\n');
}

export function renderEvidenceReport(report: EvidenceReport, format: ReportFormat): string {
  if (format === 'json') return evidenceReportJson(report);
  if (format === 'md') return evidenceReportMarkdown(report);
  return evidenceReportHtml(report);
}
