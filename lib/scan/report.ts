import type { EnginePageResult } from '@/lib/scan/engines/types';
import { DISCLAIMER, LEGAL_DISCLAIMER } from '@/lib/copy';
import { cell } from '@/lib/export-markdown';
import { impactRank, meetsThreshold } from '@/lib/gate';
import { groupFindings } from '@/lib/group';
import { lookupStandards, type Criterion } from '@/lib/mapping';
import { normalizeAxeResults, toLegacyFinding } from '@/lib/scan/engines/normalized';
import type { CrawlResult, SkippedLink } from '@/lib/scan/crawl';
import { IMPACTS, type AxeResults, type Finding, type Impact } from '@/lib/types';

export type FailOn = Impact | 'none';

export const FAIL_ON_VALUES: readonly FailOn[] = [...IMPACTS, 'none'];

export function isFailOn(value: unknown): value is FailOn {
  return typeof value === 'string' && (FAIL_ON_VALUES as readonly string[]).includes(value);
}

export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa', 'best-practice'] as const;

export const SCAN_BOUNDARIES = [
  'Only scan sites you own or are explicitly authorized to test.',
  'Automated testing only: axe-core detects a subset of WCAG issues. Absence of findings is not conformance, certification or legal advice.',
  'Read-only: pages were loaded without logging in, filling forms or clicking. Authenticated areas, interactions and dynamic states are unassessed.',
  'Only same-origin pages reachable through a[href] links (at most 20) were visited; robots.txt Disallow rules were honoured.',
];

export type ScanCriterion = Pick<Criterion, 'number' | 'name' | 'level' | 'wcag' | 'en301549'>;

export type ScanFinding = {
  pageUrl: string;
  ruleId: string;
  impact: Impact | null;
  selector: string;
  selectors: string[];
  html: string;
  help: string;
  helpUrl: string;
  tags: string[];
  wcag: ScanCriterion[];
  bestPractice: boolean;
  fingerprint: string;
};

export type ScanPageSummary = {
  url: string;
  finalUrl: string;
  status: number | null;
  scanStatus: 'complete' | 'failed' | 'skipped';
  error?: string;
  violations: number;
  findings: number;
  byImpact: Record<Impact | 'unknown', number>;
};

export type ScanReport = {
  engineResults?: EnginePageResult[];
  tool: 'a11ygate';
  kind: 'site-scan';
  schemaVersion: 1;
  version: string;
  axeVersion: string | null;
  scannedAt: string;
  startUrl: string;
  origin: string;
  verdict: 'PASS' | 'FAIL' | 'ERROR';
  failOn: FailOn;
  reason: string;
  options: { maxPages: number; delayMs: number; tags: string[]; userAgent: string; robots: string };
  counts: { pagesScanned: number; pagesFailed: number; skippedLinks: number; findings: number; byImpact: Record<Impact | 'unknown', number> };
  pages: ScanPageSummary[];
  skipped: SkippedLink[];
  findings: ScanFinding[];
  boundaries: string[];
  /** Raw per-page axe results; valid `--current` input for the A11yGate gate. */
  results: AxeResults[];
};

function emptyCounts(): Record<Impact | 'unknown', number> {
  return { critical: 0, serious: 0, moderate: 0, minor: 0, unknown: 0 };
}

function selectorsFor(result: AxeResults, ruleId: string, selector: string): string[] {
  const node = result.violations.find((v) => v.id === ruleId)?.nodes.find((n) => n.target.join(' ') === selector);
  return node ? [...node.target] : [selector];
}

export function toScanFinding(finding: Finding, result: AxeResults): ScanFinding {
  const hits = lookupStandards(finding.tags);
  const wcag = hits.flatMap((hit) =>
    hit.kind === 'criterion' ? [{ number: hit.number, name: hit.name, level: hit.level, wcag: hit.wcag, en301549: hit.en301549 }] : [],
  );
  return {
    pageUrl: finding.url,
    ruleId: finding.ruleId,
    impact: finding.impact,
    selector: finding.selector,
    selectors: selectorsFor(result, finding.ruleId, finding.selector),
    html: finding.html,
    help: finding.help,
    helpUrl: finding.helpUrl,
    tags: finding.tags,
    wcag,
    bestPractice: wcag.length === 0,
    fingerprint: finding.fingerprint,
  };
}

export function gatingScanFindings(findings: readonly ScanFinding[], failOn: FailOn): ScanFinding[] {
  if (failOn === 'none') return [];
  return findings.filter((f) => meetsThreshold(f.impact, failOn));
}

/** 0 = nothing at or above --fail-on, 1 = at least one finding meets it. Errors (2) are decided by the caller. */
export function scanExitCode(findings: readonly ScanFinding[], failOn: FailOn): 0 | 1 {
  return gatingScanFindings(findings, failOn).length > 0 ? 1 : 0;
}

export function buildScanReport(input: {
  crawl: CrawlResult;
  version: string;
  scannedAt: string;
  startUrl: string;
  failOn: FailOn;
  maxPages: number;
  delayMs: number;
  userAgent: string;
  robotsNote: string;
  engineResults?: EnginePageResult[];
}): ScanReport {
  const pages: ScanPageSummary[] = [];
  const findings: ScanFinding[] = [];
  const results: AxeResults[] = [];
  const totals = emptyCounts();
  for (const page of input.crawl.pages) {
    const byImpact = emptyCounts();
    let pageFindings: ScanFinding[] = [];
    if (page.result) {
      results.push(page.result);
      pageFindings = normalizeAxeResults(page.result).map((f) => toScanFinding(toLegacyFinding(f), page.result as AxeResults));
      for (const f of pageFindings) {
        byImpact[f.impact ?? 'unknown'] += 1;
        totals[f.impact ?? 'unknown'] += 1;
      }
      findings.push(...pageFindings);
    }
    pages.push({
      url: page.url,
      finalUrl: page.finalUrl,
      status: page.status,
      scanStatus: page.scanStatus,
      ...(page.error ? { error: page.error } : {}),
      violations: page.result?.violations.length ?? 0,
      findings: pageFindings.length,
      byImpact,
    });
  }
  const gating = gatingScanFindings(findings, input.failOn);
  const extraGating = input.failOn === 'none' ? [] : (input.engineResults ?? []).flatMap((e) =>
    e.engine !== 'axe' && e.status === 'complete' ? e.findings.filter((f) => meetsThreshold(f.impact, input.failOn as Impact)) : []);
  const engineErrors = (input.engineResults ?? []).filter((e) => e.status === 'errored').length;
  const verdict = engineErrors ? 'ERROR' : gating.length + extraGating.length > 0 ? 'FAIL' : 'PASS';
  const reason =
    input.failOn === 'none'
      ? 'Reporting only (--fail-on none).'
      : gating.length === 0
        ? `No finding is at or above ${input.failOn}.`
        : `${gating.length} finding${gating.length === 1 ? '' : 's'} at or above ${input.failOn}: ${[...new Set(gating.map((f) => f.ruleId))].join(', ')}.`;
  return {
    tool: 'a11ygate',
    kind: 'site-scan',
    schemaVersion: 1,
    version: input.version,
    axeVersion: results[0]?.testEngine.version ?? null,
    scannedAt: input.scannedAt,
    startUrl: input.startUrl,
    origin: new URL(input.startUrl).origin,
    verdict,
    failOn: input.failOn,
    reason: engineErrors ? `${engineErrors} engine execution(s) errored; coverage is incomplete.` : extraGating.length ? `${gating.length + extraGating.length} findings at or above ${input.failOn} across selected engines (not deduplicated).` : reason,
    ...(input.engineResults ? { engineResults: input.engineResults } : {}),
    options: { maxPages: input.maxPages, delayMs: input.delayMs, tags: [...AXE_TAGS], userAgent: input.userAgent, robots: input.robotsNote },
    counts: {
      pagesScanned: input.crawl.pages.filter((p) => p.scanStatus === 'complete').length,
      pagesFailed: input.crawl.pages.filter((p) => p.scanStatus === 'failed').length,
      skippedLinks: input.crawl.skipped.length,
      findings: findings.length,
      byImpact: totals,
    },
    pages,
    skipped: input.crawl.skipped,
    findings,
    boundaries: SCAN_BOUNDARIES,
    results,
  };
}

export type ScanGroup = { key: string; label: string; findings: ScanFinding[] };

/** Group by WCAG success criterion (a finding mapped to two criteria appears in both). Best practice last. */
export function groupByCriterion(findings: readonly ScanFinding[]): ScanGroup[] {
  const groups = new Map<string, ScanGroup>();
  for (const finding of findings) {
    const keys = finding.bestPractice
      ? [{ key: 'best-practice', label: 'Best practice (no WCAG success criterion mapped)' }]
      : finding.wcag.map((c) => ({ key: c.number, label: `WCAG ${c.number} ${c.name} (${c.level}); EN 301 549 ${c.en301549}` }));
    for (const { key, label } of keys) {
      const group = groups.get(key) ?? { key, label, findings: [] };
      group.findings.push(finding);
      groups.set(key, group);
    }
  }
  const order = (key: string) => (key === 'best-practice' ? [Infinity] : key.split('.').map(Number));
  return [...groups.values()].sort((a, b) => {
    const x = order(a.key);
    const y = order(b.key);
    for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
      const d = (x[i] ?? 0) - (y[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  });
}

/** Group by impact, most severe first, reusing the app's impact grouping. */
export function groupBySeverity(findings: readonly ScanFinding[]): ScanGroup[] {
  const asDiffed = findings.map((f, index) => ({
    fingerprint: String(index),
    ruleId: f.ruleId,
    impact: f.impact,
    tags: f.tags,
    help: f.help,
    helpUrl: f.helpUrl,
    selector: f.selector,
    html: f.html,
    url: f.pageUrl,
    path: f.pageUrl,
    engineVersion: '',
    timestamp: '',
    status: 'new' as const,
  }));
  return groupFindings(asDiffed, 'impact').map((group) => ({
    key: group.key,
    label: group.label,
    findings: group.findings.map((f) => findings[Number(f.fingerprint)] as ScanFinding),
  }));
}

function sortFindings(findings: readonly ScanFinding[]): ScanFinding[] {
  return [...findings].sort((a, b) => impactRank(b.impact) - impactRank(a.impact) || a.pageUrl.localeCompare(b.pageUrl) || a.ruleId.localeCompare(b.ruleId));
}

/** Inside a code span only backticks and line breaks need neutralising. */
function code(value: string): string {
  return '`' + value.replace(/`/g, "'").replace(/[\r\n|]/g, ' ') + '`';
}

function heading(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\r\n]/g, ' ');
}

function mdFinding(f: ScanFinding): string {
  return `- **${cell(f.ruleId)}** (${f.impact ?? 'unspecified'}) on ${code(f.pageUrl)} — ${code(f.selector)} — ${cell(f.help)} — [rule guidance](${encodeURI(f.helpUrl).replace(/[()]/g, encodeURIComponent)})`;
}

export function scanMarkdown(report: ScanReport): string {
  const lines = [
    `# A11yGate site scan — ${cell(report.startUrl)}`,
    '',
    `**Verdict: ${report.verdict}** (fail on: ${report.failOn})`,
    '',
    cell(report.reason),
    '',
    '| Severity | Findings |',
    '| --- | --- |',
    ...(['critical', 'serious', 'moderate', 'minor', 'unknown'] as const).map((k) => `| ${k} | ${report.counts.byImpact[k]} |`),
    '',
    `Scanned: ${report.scannedAt}. Pages analysed: ${report.counts.pagesScanned}; failed: ${report.counts.pagesFailed}. axe-core ${report.axeVersion ?? 'n/a'}; A11yGate ${report.version}.`,
    '',
    '## Pages',
    '',
    '| Page | HTTP | Status | Findings |',
    '| --- | --- | --- | --- |',
    ...report.pages.map((p) => `| ${cell(p.url)} | ${p.status ?? '—'} | ${p.scanStatus}${p.error ? ' — ' + cell(p.error) : ''} | ${p.findings} |`),
    '',
    '## Findings by WCAG criterion',
    '',
  ];
  const byCriterion = groupByCriterion(report.findings);
  if (byCriterion.length === 0) lines.push('None detected.', '');
  for (const group of byCriterion) {
    lines.push(`### ${heading(group.label)}`, '', ...sortFindings(group.findings).map(mdFinding), '');
  }
  lines.push('## Findings by severity', '');
  const bySeverity = groupBySeverity(report.findings);
  if (bySeverity.length === 0) lines.push('None detected.', '');
  for (const group of bySeverity) {
    lines.push(`### ${heading(group.label)} (${group.findings.length})`, '', ...group.findings.map(mdFinding), '');
  }
  const robotsSkipped = report.skipped.filter((s) => s.reason === 'robots' || s.reason === 'cap');
  if (robotsSkipped.length > 0) {
    lines.push('## Not scanned', '', ...robotsSkipped.map((s) => `- ${cell(s.url)} — ${s.reason === 'robots' ? 'disallowed by robots.txt' : 'page cap reached'}`), '');
  }
  if (report.engineResults) lines.push('## Engine results (separate, not deduplicated)', '', ...report.engineResults.flatMap((e) => [
    `### ${cell(e.engine)} — ${cell(e.url)} — ${e.status}`, '',
    ...(e.status === 'errored' ? [cell(e.error)] : e.findings.map((f) => `- **${cell(f.ruleId)}** (${f.impact ?? 'unspecified'}) — ${code(f.selector)} — ${code(f.snippet)}`)), '',
  ]));
  lines.push('## Scope and boundaries', '', ...report.boundaries.map((b) => `- ${cell(b)}`), '', DISCLAIMER, LEGAL_DISCLAIMER, '');
  return lines.join('\n');
}

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeHref(url: string): string {
  return /^https?:\/\//i.test(url) ? esc(url) : '#';
}

function htmlFinding(f: ScanFinding): string {
  return `<li><strong>${esc(f.ruleId)}</strong> <span class="impact ${esc(f.impact ?? 'unknown')}">${esc(f.impact ?? 'unspecified')}</span><br>Page: <code>${esc(f.pageUrl)}</code><br>Selector: <code>${esc(f.selector)}</code><br>${esc(f.help)} — <a href="${safeHref(f.helpUrl)}">Rule guidance<span class="sr"> for ${esc(f.ruleId)}</span></a></li>`;
}

function htmlGroups(title: string, groups: ScanGroup[]): string {
  if (groups.length === 0) return `<h2>${esc(title)}</h2><p>None detected.</p>`;
  return `<h2>${esc(title)}</h2>` + groups.map((g) => `<section><h3>${esc(g.label)} (${g.findings.length})</h3><ul>${sortFindings(g.findings).map(htmlFinding).join('')}</ul></section>`).join('');
}

/** Self-contained HTML (inline CSS, no scripts, no remote assets). */
export function scanHtml(report: ScanReport): string {
  const counts = (['critical', 'serious', 'moderate', 'minor', 'unknown'] as const).map((k) => `<tr><th scope="row">${k}</th><td>${report.counts.byImpact[k]}</td></tr>`).join('');
  const pages = report.pages
    .map((p) => `<tr><td><code>${esc(p.url)}</code></td><td>${p.status ?? '—'}</td><td>${esc(p.scanStatus)}${p.error ? ' — ' + esc(p.error) : ''}</td><td>${p.findings}</td></tr>`)
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>A11yGate site scan — ${esc(report.startUrl)}</title>
<style>
body{font:16px/1.5 system-ui,sans-serif;max-width:60rem;margin:0 auto;padding:1rem;color:#1a1a1a;background:#fff}
code{background:#f2f2f2;padding:0 .2em;word-break:break-all}
table{border-collapse:collapse;margin:1rem 0}th,td{border:1px solid #767676;padding:.25rem .5rem;text-align:left}
li{margin:.5rem 0}.impact{font-weight:600}.critical,.serious{color:#a00000}.moderate{color:#6b4e00}
.verdict{font-size:1.25rem;font-weight:700}.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
a{color:#0b57d0}
</style>
</head>
<body>
<main>
<h1>A11yGate site scan</h1>
<p>Start URL: <code>${esc(report.startUrl)}</code></p>
<p class="verdict">Verdict: ${esc(report.verdict)} (fail on: ${esc(report.failOn)})</p>
<p>${esc(report.reason)}</p>
<p>Scanned ${esc(report.scannedAt)}. Pages analysed: ${report.counts.pagesScanned}; failed: ${report.counts.pagesFailed}. axe-core ${esc(report.axeVersion ?? 'n/a')}; A11yGate ${esc(report.version)}.</p>
<table><caption>Findings by severity</caption><thead><tr><th scope="col">Severity</th><th scope="col">Findings</th></tr></thead><tbody>${counts}</tbody></table>
<h2>Pages</h2>
<table><thead><tr><th scope="col">Page</th><th scope="col">HTTP</th><th scope="col">Status</th><th scope="col">Findings</th></tr></thead><tbody>${pages}</tbody></table>
${htmlGroups('Findings by WCAG criterion', groupByCriterion(report.findings))}
${htmlGroups('Findings by severity', groupBySeverity(report.findings))}
${report.engineResults ? '<h2>Engine results (separate, not deduplicated)</h2>' + report.engineResults.map((e) => `<section><h3>${esc(e.engine)} — ${esc(e.url)} — ${esc(e.status)}</h3>${e.status === 'errored' ? `<p>${esc(e.error)}</p>` : `<ul>${e.findings.map((f) => `<li><strong>${esc(f.ruleId)}</strong> (${esc(f.impact ?? 'unspecified')}) — <code>${esc(f.selector)}</code> — <code>${esc(f.snippet)}</code></li>`).join('')}</ul>`}</section>`).join('') + '\n' : ''}<h2>Scope and boundaries</h2>
<ul>${report.boundaries.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
<p>${esc(DISCLAIMER)}</p>
<p>${esc(LEGAL_DISCLAIMER)}</p>
</main>
</body>
</html>
`;
}
