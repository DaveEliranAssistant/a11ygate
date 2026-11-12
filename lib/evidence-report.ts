import { scanPageKey } from '@/lib/compare';
import { markdownCell } from '@/lib/export-markdown';
import { impactRank } from '@/lib/gate';
import { findingGuidance } from '@/lib/guidance';
import { getCriterion, type WcagLevel } from '@/lib/mapping';
import type { ScanReport } from '@/lib/scan/report';
import type { AxeResults, DiffedFinding, DiffResult, DiffStatus, Impact, Verdict } from '@/lib/types';

/**
 * Evidence report export: one data model rendered as JSON, Markdown, or a
 * self-contained HTML page. Everything except `generatedAt` is derived from the
 * scan input, and every list is sorted, so the same input gives the same bytes.
 */

/** Fixed, verbatim, and always rendered: no flag or input can remove it. */
export const REQUIRED_DISCLAIMER = 'Automated testing only. Not a WCAG audit, certification or legal advice.';

export const REPORT_DISCLAIMER = `${REQUIRED_DISCLAIMER} Automated tools such as axe-core detect only a subset of accessibility issues.`;

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

/** The parts of an `a11ygate scan` JSON report (kind "site-scan") that the evidence report uses. */
export type SiteScanSource = Pick<
  ScanReport,
  'version' | 'axeVersion' | 'scannedAt' | 'startUrl' | 'origin' | 'options' | 'pages' | 'skipped' | 'boundaries' | 'results'
>;

export type ParsedSiteScan = { ok: true; scan: SiteScanSource } | { ok: false; error: string };

/** Accept only the JSON written by `a11ygate scan`; plain axe JSON belongs in `--current`. */
export function parseSiteScan(text: string): ParsedSiteScan {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: 'The scan file is not valid JSON.' };
  }
  const doc = value as Partial<ScanReport> | null;
  if (!doc || typeof doc !== 'object' || doc.tool !== 'a11ygate' || doc.kind !== 'site-scan') {
    return { ok: false, error: 'This is not an a11ygate scan report (kind "site-scan"). Use --current for axe-core JSON.' };
  }
  if (doc.schemaVersion !== 1) return { ok: false, error: `Unsupported scan schemaVersion ${String(doc.schemaVersion)}.` };
  if (typeof doc.scannedAt !== 'string' || typeof doc.startUrl !== 'string' || !Array.isArray(doc.results)) {
    return { ok: false, error: 'The scan report is missing scannedAt, startUrl or results.' };
  }
  const options = doc.options ?? { maxPages: 0, delayMs: 0, tags: [], userAgent: '', robots: '' };
  return {
    ok: true,
    scan: {
      version: typeof doc.version === 'string' ? doc.version : 'unknown',
      axeVersion: typeof doc.axeVersion === 'string' ? doc.axeVersion : null,
      scannedAt: doc.scannedAt,
      startUrl: doc.startUrl,
      origin: typeof doc.origin === 'string' ? doc.origin : '',
      options,
      pages: Array.isArray(doc.pages) ? doc.pages : [],
      skipped: Array.isArray(doc.skipped) ? doc.skipped : [],
      boundaries: Array.isArray(doc.boundaries) ? doc.boundaries.filter((b): b is string => typeof b === 'string') : [],
      results: doc.results,
    },
  };
}

export type EvidenceReportInput = {
  /** Set when the input is an `a11ygate scan` report; `previous` is the scan it is compared with. */
  scan?: { current: SiteScanSource; previous: SiteScanSource | null } | null;
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
  /** How-to-fix text from A11yGate's rule guidance (falls back to axe help). */
  fix: string;
  userImpact: string;
  counts: Record<ReportFindingStatus, number>;
  findings: ReportFinding[];
};

export type ReportTrendRow = {
  ruleId: string;
  baseline: number;
  current: number;
  delta: number;
  new: number;
  fixed: number;
  stillOpen: number;
};

export type ReportTrendTotals = { baseline: number; current: number; delta: number; new: number; fixed: number; stillOpen: number };

export type SeverityCounts = Record<Impact | 'unknown', number>;

export type SkipReasonGroup = { reason: string; label: string; count: number; urls: string[] };

export type ReportScope = {
  startUrl: string;
  origin: string;
  scannedAt: string;
  previousScannedAt: string | null;
  maxPages: number;
  delayMs: number;
  robots: string;
  userAgent: string;
  axeTags: string[];
  pages: { url: string; finalUrl: string; status: number | null; scanStatus: string; error: string | null }[];
  skipped: SkipReasonGroup[];
  boundaries: string[];
};

export type ReportCriterionGroup = { criterion: ReportCriterion; ruleIds: string[]; currentFindings: number };

export type EvidenceReport = {
  tool: 'a11ygate';
  reportSchemaVersion: 1;
  disclaimer: string;
  /** `site-scan` when built from `a11ygate scan` JSON; `axe-results` for --current/--baseline. */
  input: 'site-scan' | 'axe-results';
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
    /** Current (new + still open) violations by severity. */
    bySeverity: SeverityCounts;
  };
  /** Site-scan scope: start URL, pages, skipped links and the scanner's read-only boundaries. */
  scope: ReportScope | null;
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
  /** Rules grouped by their first WCAG success criterion; best-practice rules are not in here. */
  criteria: ReportCriterionGroup[];
  trend: {
    baselineSupplied: boolean;
    totals: ReportTrendTotals | null;
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
    const guidance = findingGuidance({ ruleId, help: reference.help });
    return {
      ruleId,
      impact: maxImpact(current.length ? current : findings),
      help: reference.help,
      helpUrl: reference.helpUrl,
      wcag,
      bestPractice: wcag.length === 0,
      tags,
      fix: guidance.remediation,
      userImpact: guidance.userImpact,
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

/** Per-rule and total trend versus the baseline or previous scan. `unassessed` counts as neither fixed nor open. */
export function computeTrend(rules: readonly Pick<ReportRule, 'ruleId' | 'counts'>[]): {
  rules: ReportTrendRow[];
  totals: ReportTrendTotals;
} {
  const rows = rules
    .map((rule) => {
      const baseline = baselineCount(rule.counts);
      const now = currentCount(rule.counts);
      return {
        ruleId: rule.ruleId,
        baseline,
        current: now,
        delta: now - baseline,
        new: rule.counts.new,
        fixed: rule.counts.fixed,
        stillOpen: rule.counts.baselined,
      };
    })
    .sort((a, b) => a.delta - b.delta || compareText(a.ruleId, b.ruleId));
  const totals = rows.reduce(
    (sum, row) => ({
      baseline: sum.baseline + row.baseline,
      current: sum.current + row.current,
      delta: sum.delta + row.delta,
      new: sum.new + row.new,
      fixed: sum.fixed + row.fixed,
      stillOpen: sum.stillOpen + row.stillOpen,
    }),
    { baseline: 0, current: 0, delta: 0, new: 0, fixed: 0, stillOpen: 0 },
  );
  return { rules: rows, totals };
}

const SKIP_LABEL: Record<string, string> = {
  cap: 'Page limit reached (--crawl cap)',
  external: 'Different origin (not crawled)',
  'not-http': 'Not an http(s) link (javascript:, mailto:, …)',
  'non-html': 'Not an HTML page (file download)',
  robots: 'Disallowed by robots.txt',
  logout: 'Looks like a logout/sign-out link (never followed)',
  'redirected-off-origin': 'Redirected to another origin',
};

function buildScope(scan: NonNullable<EvidenceReportInput['scan']>): ReportScope {
  const { current } = scan;
  const groups = new Map<string, Set<string>>();
  for (const link of current.skipped) {
    const set = groups.get(link.reason) ?? new Set<string>();
    set.add(link.url);
    groups.set(link.reason, set);
  }
  return {
    startUrl: current.startUrl,
    origin: current.origin,
    scannedAt: current.scannedAt,
    previousScannedAt: scan.previous?.scannedAt ?? null,
    maxPages: current.options.maxPages,
    delayMs: current.options.delayMs,
    robots: current.options.robots,
    userAgent: current.options.userAgent,
    axeTags: [...current.options.tags],
    pages: current.pages.map((page) => ({
      url: page.url,
      finalUrl: page.finalUrl,
      status: page.status,
      scanStatus: page.scanStatus,
      error: page.error ?? null,
    })),
    skipped: [...groups.entries()]
      .map(([reason, urls]) => ({ reason, label: SKIP_LABEL[reason] ?? reason, count: urls.size, urls: uniqueSorted(urls) }))
      .sort((a, b) => b.count - a.count || compareText(a.reason, b.reason)),
    boundaries: [...current.boundaries],
  };
}

function groupByCriterion(rules: readonly ReportRule[]): ReportCriterionGroup[] {
  const groups = new Map<string, ReportCriterionGroup>();
  for (const rule of rules) {
    const primary = rule.wcag[0];
    if (!primary) continue;
    const group = groups.get(primary.number) ?? { criterion: primary, ruleIds: [], currentFindings: 0 };
    group.ruleIds.push(rule.ruleId);
    group.currentFindings += currentCount(rule.counts);
    groups.set(primary.number, group);
  }
  return [...groups.values()].sort((a, b) => compareCriterion(a.criterion.number, b.criterion.number));
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

  const trend = computeTrend(rules);
  const bySeverity: SeverityCounts = { critical: 0, serious: 0, moderate: 0, minor: 0, unknown: 0 };
  for (const finding of current) bySeverity[finding.impact ?? 'unknown'] += 1;
  const baselineViolations = baselineSupplied
    ? diff.stillOpen.length + diff.fixedFindings.length + (diff.unassessed?.length ?? 0)
    : null;

  return {
    tool: 'a11ygate',
    reportSchemaVersion: 1,
    disclaimer: REPORT_DISCLAIMER,
    input: input.scan ? 'site-scan' : 'axe-results',
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
      bySeverity,
    },
    scope: input.scan ? buildScope(input.scan) : null,
    coverage: {
      status: diff.coverage?.status ?? 'unverified',
      issues: [...(diff.coverage?.issues ?? [])].sort(
        (a, b) => compareText(a.page, b.page) || compareText(a.code, b.code) || compareText(a.detail, b.detail),
      ),
      unassessedScope: [...(diff.coverage?.unassessedScope ?? [])],
    },
    pages,
    rules,
    criteria: groupByCriterion(rules),
    trend: {
      baselineSupplied,
      totals: baselineSupplied ? trend.totals : null,
      rules: baselineSupplied ? trend.rules : [],
    },
  };
}

// ---------------------------------------------------------------------------
// Shared wording

function statusLabel(report: EvidenceReport, status: ReportFindingStatus): string {
  if (status === 'baselined') return report.input === 'site-scan' ? 'Still open' : 'Baselined (still open)';
  if (status === 'unassessed') return 'Unassessed (not verified fixed)';
  return status === 'new' ? 'New' : 'Fixed';
}

/** "baseline" for the CI gate inputs, "previous scan" for `--scan` + `--previous-scan`. */
function comparedWith(report: EvidenceReport): string {
  return report.input === 'site-scan' ? 'previous scan' : 'baseline';
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

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

const SEVERITIES = ['critical', 'serious', 'moderate', 'minor', 'unknown'] as const;

/** Skipped-link URLs listed per reason in Markdown/HTML; the JSON keeps all of them. */
const SKIPPED_EXAMPLES = 10;

const MAPPING_NOTE =
  'WCAG success criteria are mapped from axe-core rule tags. The mapping needs expert review before it is relied on. A rule mapped to more than one criterion is listed under the first.';

function bestPracticeRules(report: EvidenceReport): ReportRule[] {
  return report.rules.filter((rule) => rule.bestPractice);
}

function rulesFor(report: EvidenceReport, ruleIds: readonly string[]): ReportRule[] {
  return report.rules.filter((rule) => ruleIds.includes(rule.ruleId));
}

function trendSentence(report: EvidenceReport): string {
  const totals = report.trend.totals;
  if (!totals) {
    return report.input === 'site-scan'
      ? 'No previous scan was supplied, so every current violation is reported as new.'
      : 'No baseline was supplied, so every current violation is reported as new.';
  }
  return `Total violations: ${totals.baseline} in the ${comparedWith(report)}, ${totals.current} now (${signed(totals.delta)}): ${totals.new} new, ${totals.fixed} fixed, ${totals.stillOpen} still open.`;
}

// ---------------------------------------------------------------------------
// JSON

export function evidenceReportJson(report: EvidenceReport): string {
  // The disclaimer is not optional: always the fixed text, whatever the object holds.
  return `${JSON.stringify({ ...report, disclaimer: REPORT_DISCLAIMER }, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Markdown

const md = markdownCell;

/** Backslash escapes do not apply inside code spans; only table pipes and backticks need care. */
function codeSpan(value: string): string {
  return `\`${value.replace(/`/g, "'").replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ')}\``;
}

function markdownRule(report: EvidenceReport, rule: ReportRule, heading: string): string[] {
  const href = safeHref(rule.helpUrl);
  return [
    `${heading} ${md(rule.ruleId)} — ${impactLabel(rule.impact)}`,
    '',
    `${md(rule.help)}${href ? ` ([rule documentation](${href}))` : ''}`,
    '',
    `- How to fix: ${md(rule.fix)}`,
    `- WCAG: ${rule.bestPractice ? 'none mapped (best practice)' : rule.wcag.map((criterion) => md(criterionLabel(criterion))).join('; ')}`,
    `- Counts: ${rule.counts.new} new, ${rule.counts.baselined} ${report.input === 'site-scan' ? 'still open' : 'baselined'}, ${rule.counts.fixed} fixed, ${rule.counts.unassessed} unassessed`,
    '',
    '| Status | Severity | Page | Selector | Element |',
    '| --- | --- | --- | --- | --- |',
    ...rule.findings.map(
      (finding) =>
        `| ${statusLabel(report, finding.status)}${finding.assessmentReason ? ` — ${md(finding.assessmentReason)}` : ''} | ${impactLabel(finding.impact)} | ${md(finding.url)} | ${codeSpan(finding.selector)} | ${codeSpan(finding.html)} |`,
    ),
    '',
  ];
}

export function evidenceReportMarkdown(report: EvidenceReport): string {
  const { summary, trend, scope } = report;
  const scanMode = report.input === 'site-scan';
  const lines: string[] = [
    `# Accessibility evidence report — ${md(report.projectName)}`,
    '',
    `> **${REPORT_DISCLAIMER}**`,
    '',
    ...(report.synthetic ? ['**SYNTHETIC evidence — not a real audit or customer assessment.**', ''] : []),
    '## Scan details',
    '',
    '| Field | Value |',
    '| --- | --- |',
    ...(scope
      ? [
          `| Scanned at | ${md(scope.scannedAt)} |`,
          `| Previous scan | ${scope.previousScannedAt ? md(scope.previousScannedAt) : 'none supplied'} |`,
        ]
      : []),
    `| Generated | ${md(report.generatedAt)} |`,
    `| Commit | ${report.source.commit ? codeSpan(report.source.commit) : 'not recorded'} |`,
    `| Branch | ${report.source.branch ? codeSpan(report.source.branch) : 'not recorded'} |`,
    `| A11yGate | ${md(report.tools.a11ygate)} |`,
    `| axe-core (current) | ${md(report.tools.axeCore.current.join(', ') || 'unknown')} |`,
    `| axe-core (${comparedWith(report)}) | ${trend.baselineSupplied ? md(report.tools.axeCore.baseline.join(', ') || 'unknown') : `no ${comparedWith(report)}`} |`,
    `| Gate | ${report.gate.verdict} at threshold ${report.gate.threshold} — ${md(report.gate.reason)} |`,
    `| Coverage | ${report.coverage.status} |`,
    '',
    '## Summary',
    '',
    '| Severity | Current violations |',
    '| --- | --- |',
    ...SEVERITIES.map((severity) => `| ${capitalise(severity)} | ${summary.bySeverity[severity]} |`),
    `| Total | ${summary.currentViolations} |`,
    '',
    '| Status | Violations |',
    '| --- | --- |',
    `| New | ${summary.new} |`,
    `| ${statusLabel(report, 'baselined')} | ${summary.baselined} |`,
    `| Fixed | ${summary.fixed} |`,
    `| Unassessed (not verified fixed) | ${summary.unassessed} |`,
    `| Current total | ${summary.currentViolations} |`,
    '',
    `Rules with current violations: ${summary.rulesWithCurrentViolations}. WCAG success criteria with findings: ${report.criteria.length}. Best-practice rules: ${bestPracticeRules(report).length}.`,
    '',
  ];

  if (scope) {
    lines.push(
      '## Scope',
      '',
      '| Field | Value |',
      '| --- | --- |',
      `| Start URL | ${md(scope.startUrl)} |`,
      `| Origin | ${md(scope.origin)} |`,
      `| Page limit | ${scope.maxPages} |`,
      `| Delay between pages | ${scope.delayMs} ms |`,
      `| robots.txt | ${md(scope.robots)} |`,
      `| User agent | ${codeSpan(scope.userAgent)} |`,
      `| axe-core tags | ${md(scope.axeTags.join(', '))} |`,
      '',
      '### Boundaries',
      '',
      ...scope.boundaries.map((boundary) => `- ${md(boundary)}`),
      '',
    );
  }

  lines.push(
    '## Pages scanned',
    '',
    `| Page | Scanned | axe-core | Scan | Violations | New | ${scanMode ? 'Still open' : 'Baselined'} | In ${comparedWith(report)} |`,
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...report.pages.map(
      (page) =>
        `| ${md(page.url)} | ${md(page.scannedAt)} | ${md(page.axeCore)} | ${page.scanStatus} | ${page.violations} | ${page.new} | ${page.baselined} | ${page.inBaseline ? 'yes' : 'no'} |`,
    ),
    '',
  );

  if (scope) {
    const notScanned = scope.pages.filter((page) => page.scanStatus !== 'complete');
    if (notScanned.length > 0) {
      lines.push(
        '### Pages not scanned',
        '',
        ...notScanned.map((page) => `- ${md(page.url)} — ${page.scanStatus}${page.error ? `: ${md(page.error)}` : ''}`),
        '',
      );
    }
    lines.push('### Links skipped and why', '');
    if (scope.skipped.length === 0) lines.push('No links were skipped.', '');
    for (const group of scope.skipped) {
      const extra = group.urls.length - SKIPPED_EXAMPLES;
      lines.push(
        `- ${md(group.label)}: ${group.count}`,
        ...group.urls.slice(0, SKIPPED_EXAMPLES).map((url) => `  - ${codeSpan(url)}`),
        ...(extra > 0 ? [`  - …and ${extra} more (full list in the JSON report)`] : []),
      );
    }
    if (scope.skipped.length > 0) lines.push('');
  }

  if (report.coverage.issues.length > 0) {
    lines.push(
      '### Coverage issues',
      '',
      ...report.coverage.issues.map((issue) => `- ${md(issue.code)} on ${codeSpan(issue.page)}: ${md(issue.detail)}`),
      '',
    );
  }

  lines.push(`## Trend versus ${comparedWith(report)}`, '', trendSentence(report), '');
  if (trend.totals) {
    lines.push(
      `| Rule | New | Fixed | Still open | ${capitalise(comparedWith(report))} | Current | Change |`,
      '| --- | --- | --- | --- | --- | --- | --- |',
      ...trend.rules.map(
        (row) =>
          `| ${md(row.ruleId)} | ${row.new} | ${row.fixed} | ${row.stillOpen} | ${row.baseline} | ${row.current} | ${signed(row.delta)} |`,
      ),
      `| **Total** | ${trend.totals.new} | ${trend.totals.fixed} | ${trend.totals.stillOpen} | ${trend.totals.baseline} | ${trend.totals.current} | ${signed(trend.totals.delta)} |`,
      '',
    );
  }

  lines.push('## Findings by WCAG success criterion', '', MAPPING_NOTE, '');
  if (report.criteria.length === 0) lines.push('No findings were mapped to a WCAG success criterion.', '');
  for (const group of report.criteria) {
    lines.push(`### WCAG ${md(criterionLabel(group.criterion))}`, '', `Current findings: ${group.currentFindings}.`, '');
    for (const rule of rulesFor(report, group.ruleIds)) lines.push(...markdownRule(report, rule, '####'));
  }

  const bestPractice = bestPracticeRules(report);
  lines.push('## Best-practice rules (no WCAG success criterion)', '');
  if (bestPractice.length === 0) lines.push('No best-practice findings.', '');
  for (const rule of bestPractice) lines.push(...markdownRule(report, rule, '###'));

  lines.push('## Disclaimer', '', REPORT_DISCLAIMER, '');
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
h3{font-size:1.15rem;margin:1.75rem 0 .5rem}
h4{font-size:1.05rem;margin:1.5rem 0 .5rem}
.disclaimer{border:2px solid #9a6700;background:#fff8c5;padding:.75rem 1rem;border-radius:.375rem;font-weight:600}
.synthetic{border:2px solid #cf222e;background:#ffebe9;padding:.5rem 1rem;border-radius:.375rem;font-weight:700}
table{border-collapse:collapse;width:100%;margin:.5rem 0 1rem;font-size:.9375rem}
caption{text-align:left;font-weight:600;padding:.25rem 0}
th,td{border:1px solid var(--line);padding:.375rem .5rem;text-align:left;vertical-align:top}
thead th{background:var(--soft)}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.875em;overflow-wrap:anywhere;word-break:break-word}
.muted{color:var(--muted)}
.impact{display:inline-block;padding:0 .4rem;border-radius:.25rem;border:1px solid currentColor;font-size:.8125rem;font-weight:600;text-transform:uppercase}
.impact-critical{color:#a40e26}.impact-serious{color:#9a3412}.impact-moderate{color:#7c4a03}.impact-minor,.impact-unspecified,.impact-unknown{color:#374151}
a{color:#0550ae}
@media print{
@page{margin:1.5cm}
body{font-size:11pt}
main{max-width:none;padding:0}
.sheet{break-before:page}
h2,h3,h4,caption{break-after:avoid}
table{break-inside:auto}
thead{display:table-header-group}
tr,li{break-inside:avoid}
a{color:inherit}
a[href]::after{content:" (" attr(href) ")";font-size:.85em;overflow-wrap:anywhere}
}
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

function htmlRule(report: EvidenceReport, rule: ReportRule, level: 3 | 4): string[] {
  const href = safeHref(rule.helpUrl);
  return [
    '<section class="rule">',
    `<h${level} id="rule-${esc(rule.ruleId)}"><code>${esc(rule.ruleId)}</code> ${impactBadge(rule.impact)}</h${level}>`,
    `<p>${esc(rule.help)}${href ? ` (<a href="${esc(href)}">rule documentation for ${esc(rule.ruleId)}</a>)` : ''}</p>`,
    '<ul>',
    `<li><strong>How to fix:</strong> ${esc(rule.fix)}</li>`,
    `<li>WCAG: ${
      rule.bestPractice
        ? 'none mapped (best practice)'
        : rule.wcag.map((criterion) => esc(criterionLabel(criterion))).join('; ')
    }</li>`,
    `<li>Counts: ${rule.counts.new} new, ${rule.counts.baselined} ${report.input === 'site-scan' ? 'still open' : 'baselined'}, ${rule.counts.fixed} fixed, ${rule.counts.unassessed} unassessed</li>`,
    '</ul>',
    table(
      `Occurrences of ${rule.ruleId}`,
      ['Status', 'Severity', 'Page', 'Selector', 'Element'],
      rule.findings.map((finding) =>
        row([
          td(
            esc(statusLabel(report, finding.status)) +
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
  ];
}

export function evidenceReportHtml(report: EvidenceReport): string {
  const { summary, trend, scope } = report;
  const scanMode = report.input === 'site-scan';
  const title = `Accessibility evidence report — ${report.projectName}`;
  const compared = comparedWith(report);
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
    `<p class="disclaimer" role="note">${esc(REPORT_DISCLAIMER)}</p>`,
    ...(report.synthetic
      ? ['<p class="synthetic" role="note">SYNTHETIC evidence — not a real audit or customer assessment.</p>']
      : []),
    '<h2 id="scan">Scan details</h2>',
    keyValueTable('Scan details', [
      ...(scope
        ? ([
            ['Scanned at', `<time datetime="${esc(scope.scannedAt)}">${esc(scope.scannedAt)}</time>`],
            [
              'Previous scan',
              scope.previousScannedAt
                ? `<time datetime="${esc(scope.previousScannedAt)}">${esc(scope.previousScannedAt)}</time>`
                : 'none supplied',
            ],
          ] as [string, string][])
        : []),
      ['Generated', `<time datetime="${esc(report.generatedAt)}">${esc(report.generatedAt)}</time>`],
      ['Commit', codeOrMissing(report.source.commit)],
      ['Branch', codeOrMissing(report.source.branch)],
      ['A11yGate', esc(report.tools.a11ygate)],
      ['axe-core (current)', esc(report.tools.axeCore.current.join(', ') || 'unknown')],
      [
        `axe-core (${compared})`,
        trend.baselineSupplied ? esc(report.tools.axeCore.baseline.join(', ') || 'unknown') : `no ${compared}`,
      ],
      ['Gate', `${esc(report.gate.verdict)} at threshold ${esc(report.gate.threshold)} — ${esc(report.gate.reason)}`],
      ['Coverage', esc(report.coverage.status)],
    ]),
    '<h2 id="summary">Summary</h2>',
    table(
      'Current violations by severity',
      ['Severity', 'Current violations'],
      [
        ...SEVERITIES.map((severity) => row([td(capitalise(severity)), td(summary.bySeverity[severity], true)])),
        row([td('Total'), td(summary.currentViolations, true)]),
      ],
      [1],
    ),
    table(
      'Violations by status',
      ['Status', 'Violations'],
      [
        row([td('New'), td(summary.new, true)]),
        row([td(esc(statusLabel(report, 'baselined'))), td(summary.baselined, true)]),
        row([td('Fixed'), td(summary.fixed, true)]),
        row([td('Unassessed (not verified fixed)'), td(summary.unassessed, true)]),
        row([td('Current total'), td(summary.currentViolations, true)]),
      ],
      [1],
    ),
    `<p>Rules with current violations: ${summary.rulesWithCurrentViolations}. WCAG success criteria with findings: ${report.criteria.length}. Best-practice rules: ${bestPracticeRules(report).length}.</p>`,
    `<section class="sheet" aria-labelledby="${scope ? 'scope' : 'pages'}">`,
  ];

  if (scope) {
    parts.push(
      '<h2 id="scope">Scope</h2>',
      keyValueTable('Scan scope', [
        ['Start URL', `<code>${esc(scope.startUrl)}</code>`],
        ['Origin', `<code>${esc(scope.origin)}</code>`],
        ['Page limit', String(scope.maxPages)],
        ['Delay between pages', `${scope.delayMs} ms`],
        ['robots.txt', esc(scope.robots)],
        ['User agent', `<code>${esc(scope.userAgent)}</code>`],
        ['axe-core tags', esc(scope.axeTags.join(', '))],
      ]),
      '<h3>Boundaries</h3>',
      '<ul>',
      ...scope.boundaries.map((boundary) => `<li>${esc(boundary)}</li>`),
      '</ul>',
    );
  }

  parts.push(
    '<h2 id="pages">Pages scanned</h2>',
    table(
      'Pages scanned',
      ['Page', 'Scanned', 'axe-core', 'Scan', 'Violations', 'New', scanMode ? 'Still open' : 'Baselined', `In ${compared}`],
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
  );

  if (scope) {
    const notScanned = scope.pages.filter((page) => page.scanStatus !== 'complete');
    if (notScanned.length > 0) {
      parts.push(
        '<h3>Pages not scanned</h3>',
        '<ul>',
        ...notScanned.map(
          (page) =>
            `<li><code>${esc(page.url)}</code> — ${esc(page.scanStatus)}${page.error ? `: ${esc(page.error)}` : ''}</li>`,
        ),
        '</ul>',
      );
    }
    parts.push('<h3>Links skipped and why</h3>');
    if (scope.skipped.length === 0) parts.push('<p>No links were skipped.</p>');
    else {
      parts.push(
        table(
          'Links skipped and why',
          ['Reason', 'Links', 'Examples'],
          scope.skipped.map((group) => {
            const extra = group.urls.length - SKIPPED_EXAMPLES;
            const examples = group.urls
              .slice(0, SKIPPED_EXAMPLES)
              .map((url) => `<code>${esc(url)}</code>`)
              .join('<br>');
            return row([
              td(esc(group.label)),
              td(group.count, true),
              td(examples + (extra > 0 ? `<br><span class="muted">…and ${extra} more (full list in the JSON report)</span>` : '')),
            ]);
          }),
          [1],
        ),
      );
    }
  }

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

  parts.push(
    '</section>',
    '<section class="sheet" aria-labelledby="trend">',
    `<h2 id="trend">Trend versus ${compared}</h2>`,
    `<p>${esc(trendSentence(report))}</p>`,
  );
  if (trend.totals) {
    parts.push(
      table(
        `Violations per rule, ${compared} and current`,
        ['Rule', 'New', 'Fixed', 'Still open', capitalise(compared), 'Current', 'Change'],
        [
          ...trend.rules.map((entry) =>
            row([
              td(`<code>${esc(entry.ruleId)}</code>`),
              td(entry.new, true),
              td(entry.fixed, true),
              td(entry.stillOpen, true),
              td(entry.baseline, true),
              td(entry.current, true),
              td(signed(entry.delta), true),
            ]),
          ),
          row([
            '<th scope="row">Total</th>',
            td(trend.totals.new, true),
            td(trend.totals.fixed, true),
            td(trend.totals.stillOpen, true),
            td(trend.totals.baseline, true),
            td(trend.totals.current, true),
            td(signed(trend.totals.delta), true),
          ]),
        ],
        [1, 2, 3, 4, 5, 6],
      ),
    );
  }

  parts.push(
    '</section>',
    '<section class="sheet" aria-labelledby="criteria">',
    '<h2 id="criteria">Findings by WCAG success criterion</h2>',
    `<p class="muted">${esc(MAPPING_NOTE)}</p>`,
  );
  if (report.criteria.length === 0) parts.push('<p>No findings were mapped to a WCAG success criterion.</p>');
  for (const group of report.criteria) {
    parts.push(
      `<h3 id="sc-${esc(group.criterion.number)}">WCAG ${esc(criterionLabel(group.criterion))}</h3>`,
      `<p>Current findings: ${group.currentFindings}.</p>`,
    );
    for (const rule of rulesFor(report, group.ruleIds)) parts.push(...htmlRule(report, rule, 4));
  }

  const bestPractice = bestPracticeRules(report);
  parts.push(
    '</section>',
    '<section class="sheet" aria-labelledby="best-practice">',
    '<h2 id="best-practice">Best-practice rules (no WCAG success criterion)</h2>',
  );
  if (bestPractice.length === 0) parts.push('<p>No best-practice findings.</p>');
  for (const rule of bestPractice) parts.push(...htmlRule(report, rule, 3));

  parts.push(
    '</section>',
    '<h2 id="disclaimer">Disclaimer</h2>',
    `<p>${esc(REPORT_DISCLAIMER)}</p>`,
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
