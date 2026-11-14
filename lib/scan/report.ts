import { normalizeUrl } from '@/lib/scan/url';
import { attribution, dedupeFindings, engineSummary, type Agreement } from '@/lib/scan/engines/dedupe';
import type { EnginePageResult } from '@/lib/scan/engines/types';
import { AUTOMATED_TESTING_DISCLAIMER, DISCLAIMER, LEGAL_DISCLAIMER } from '@/lib/copy';
import { cell } from '@/lib/export-markdown';
import { impactRank, meetsThreshold } from '@/lib/gate';
import { groupFindings } from '@/lib/group';
import { CRITERIA, lookupStandards, type Criterion } from '@/lib/mapping';
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

export type ScanFinding = Partial<Agreement> & {
  baselineStatus?: 'new' | 'existing';
  baselineFingerprint?: string;
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
  baseline?: import('./baseline').BaselineSummary;
  engineResults?: EnginePageResult[];
  engines?: ReturnType<typeof engineSummary>;
  disclaimer?: string;
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
  return findings.filter((f) => f.baselineStatus !== 'existing' && meetsThreshold(f.impact, failOn));
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
  authenticated?: boolean;
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
  const extended = input.engineResults?.some((e) => e.engine !== 'axe') ?? false;
  if (extended) {
    const merged = dedupeFindings(input.engineResults ?? []);
    findings.splice(0, findings.length, ...merged.map((f): ScanFinding => {
      const wcag = CRITERIA.filter((c) => f.wcagSc.includes(c.number));
      return {
        pageUrl: f.url, ruleId: f.ruleId, impact: f.impact, selector: f.selector,
        selectors: [f.selector], html: f.snippet, help: f.compatibility?.help ?? f.ruleId,
        helpUrl: f.helpUrl, tags: wcag.map((c) => c.tag), wcag,
        bestPractice: f.wcagSc.length === 0,
        fingerprint: JSON.stringify([f.url, f.elementKey ?? f.selector, f.wcagSc, f.wcagSc.length ? '' : `${f.engine}:${f.ruleId}`]),
        engines: f.engines, confidence: f.confidence,
      };
    }));
    for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] = 0;
    for (const f of findings) totals[f.impact ?? 'unknown'] += 1;
    for (const page of pages) {
      const pageFindings = findings.filter((f) => f.pageUrl === (normalizeUrl(page.url) ?? page.url));
      page.findings = pageFindings.length;
      page.violations = new Set(pageFindings.map((f) => f.ruleId)).size;
      page.byImpact = emptyCounts();
      for (const f of pageFindings) page.byImpact[f.impact ?? 'unknown'] += 1;
    }
  }
  const gating = gatingScanFindings(findings, input.failOn);
  const engineErrors = (input.engineResults ?? []).filter((e) => e.status === 'errored').length;
  const authenticationFailed = input.crawl.pages.some((p) => p.error?.startsWith('Not authenticated:'));
  const startFailed = input.crawl.pages[0]?.scanStatus !== 'complete';
  const verdict = (engineErrors || authenticationFailed || startFailed) ? 'ERROR' : gating.length > 0 ? 'FAIL' : 'PASS';
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
    reason: authenticationFailed ? 'Not authenticated: protected content was not scanned.' : startFailed ? 'Start page could not be scanned; coverage is incomplete.' : engineErrors ? `${engineErrors} engine execution(s) errored; coverage is incomplete.` : reason,
    ...(extended ? { engineResults: input.engineResults, engines: engineSummary(input.engineResults ?? []), disclaimer: AUTOMATED_TESTING_DISCLAIMER } : {}),
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
    boundaries: input.authenticated ? SCAN_BOUNDARIES.map((boundary, index) => index === 2
      ? 'Authentication was explicitly configured. Page analysis is read-only; interactions and dynamic states beyond the loaded pages are unassessed. Use test accounts only.'
      : boundary) : SCAN_BOUNDARIES,
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
  return `-${f.baselineStatus ? ' [' + f.baselineStatus + ']' : ''} **${cell(f.ruleId)}** (${f.impact ?? 'unspecified'}) on ${code(f.pageUrl)} — ${code(f.selector)} — ${cell(f.help)}${f.engines ? ' — ' + attribution(f) : ''} — [rule guidance](${encodeURI(f.helpUrl).replace(/[()]/g, encodeURIComponent)})`;
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
    ...(report.baseline ? [`Baseline: ${report.baseline.new} new; ${report.baseline.existing} existing; ${report.baseline.fixed} fixed; ${report.baseline.unassessed} unassessed.`, '', AUTOMATED_TESTING_DISCLAIMER, ''] : []),
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
  if (report.engines) lines.push('## Engines used / engines errored', '',
    `Engines used: ${report.engines.used.join(', ') || 'none'}.`,
    `Engines errored: ${report.engines.errored.length ? report.engines.errored.map((e) => `${cell(e.engine)} — ${code(e.url)} — ${cell(e.error)}`).join('; ') : 'none'}.`,
    '', AUTOMATED_TESTING_DISCLAIMER, '');
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
  return `<li>${f.baselineStatus ? esc(f.baselineStatus) + ": " : ""}<strong>${esc(f.ruleId)}</strong> <span class="impact ${esc(f.impact ?? 'unknown')}">${esc(f.impact ?? 'unspecified')}</span><br>Page: <code>${esc(f.pageUrl)}</code><br>Selector: <code>${esc(f.selector)}</code><br>${esc(f.help)}${f.engines ? '<br>' + esc(attribution(f)) : ''} — <a href="${safeHref(f.helpUrl)}">Rule guidance<span class="sr"> for ${esc(f.ruleId)}</span></a></li>`;
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
${report.baseline ? `<p>Baseline: ${report.baseline.new} new; ${report.baseline.existing} existing; ${report.baseline.fixed} fixed; ${report.baseline.unassessed} unassessed.</p><p>${esc(AUTOMATED_TESTING_DISCLAIMER)}</p>` : ""}<h2>Pages</h2>
<table><thead><tr><th scope="col">Page</th><th scope="col">HTTP</th><th scope="col">Status</th><th scope="col">Findings</th></tr></thead><tbody>${pages}</tbody></table>
${htmlGroups('Findings by WCAG criterion', groupByCriterion(report.findings))}
${htmlGroups('Findings by severity', groupBySeverity(report.findings))}
${report.engines ? '<h2>Engines used / engines errored</h2><p>Engines used: ' + esc(report.engines.used.join(', ') || 'none') + '.</p><p>Engines errored: ' + (report.engines.errored.length ? report.engines.errored.map((e) => esc(`${e.engine} — ${e.url} — ${e.error}`)).join('; ') : 'none') + '.</p><p>' + esc(AUTOMATED_TESTING_DISCLAIMER) + '</p>\n' : ''}<h2>Scope and boundaries</h2>
<ul>${report.boundaries.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
<p>${esc(DISCLAIMER)}</p>
<p>${esc(LEGAL_DISCLAIMER)}</p>
</main>
</body>
</html>
`;
}
