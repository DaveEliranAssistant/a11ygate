/**
 * HTML scan report, version 2: a prioritized, customer-readable report.
 *
 * Rules for this file:
 * - No external URL literals. Every outbound link comes from the scanned
 *   finding (`finding.helpUrl`, the engine's own rule help) or from the
 *   mapping table (`understandingUrl` in lib/mapping.ts). A unit test greps
 *   this file for URL literals.
 * - Guidance text comes from lib/guidance.ts only. Nothing here invents alt
 *   text, labels or accessible names.
 * - No compliance or certification claims. The disclaimer is always present.
 *
 * Version 1 (`scanHtml` in ./report.ts) is kept byte-for-byte for
 * `--report-version 1`.
 */
import { normalizeUrl } from '@/lib/scan/url';
import { attribution } from '@/lib/scan/engines/dedupe';
import { AUTOMATED_LIMITS, AUTOMATED_TESTING_DISCLAIMER, DISCLAIMER, LEGAL_DISCLAIMER } from '@/lib/copy';
import { impactRank } from '@/lib/gate';
import { groupSharedComponents, SHARED_COMPONENT_DISCLAIMER } from '@/lib/group';
import { findingGuidance } from '@/lib/guidance';
import { understandingUrl } from '@/lib/mapping';
import { groupByCriterion, scanHtml, type ScanCriterion, type ScanFinding, type ScanReport } from '@/lib/scan/report';
import type { Finding, Impact } from '@/lib/types';

export const REPORT_VERSIONS = [1, 2] as const;
export type ReportVersion = (typeof REPORT_VERSIONS)[number];
export const DEFAULT_REPORT_VERSION: ReportVersion = 2;

export function isReportVersion(value: unknown): value is ReportVersion {
  return (REPORT_VERSIONS as readonly unknown[]).includes(value);
}

/** Render the HTML report. Version 1 is the legacy, byte-stable layout. */
export function renderScanHtml(report: ScanReport, version: ReportVersion = DEFAULT_REPORT_VERSION): string {
  return version === 1 ? scanHtml(report) : scanHtmlV2(report);
}

export const TOP_FIXES_LIMIT = 10;

const IMPACT_ORDER = ['critical', 'serious', 'moderate', 'minor', 'unknown'] as const;

/**
 * Colour tokens for both schemes. Every `text*` / impact token is checked in
 * tests/report-html-v2.test.ts against `bg` and `surface` for WCAG 1.4.3
 * (4.5:1); `border` is checked against `bg` for 1.4.11 (3:1).
 */
export const PALETTE = {
  light: {
    bg: '#ffffff', surface: '#f2f2f2', text: '#1a1a1a', muted: '#4a4a4a', link: '#0b57d0', border: '#767676',
    critical: '#a00000', serious: '#8a3a00', moderate: '#6b4e00', minor: '#2f4f6f', unknown: '#4a4a4a',
  },
  dark: {
    bg: '#121212', surface: '#1f1f1f', text: '#ececec', muted: '#bdbdbd', link: '#8ab4f8', border: '#8c8c8c',
    critical: '#ff8a80', serious: '#ffb870', moderate: '#e8cc6a', minor: '#a8cdf5', unknown: '#bdbdbd',
  },
} as const;

export type PaletteToken = keyof typeof PALETTE.light;

/** Pairs a reader actually sees: [foreground token, background token, minimum ratio]. */
export const CONTRAST_PAIRS: readonly [PaletteToken, PaletteToken, number][] = [
  ...(['text', 'muted', 'link', 'critical', 'serious', 'moderate', 'minor', 'unknown'] as const).flatMap(
    (fg): [PaletteToken, PaletteToken, number][] => [[fg, 'bg', 4.5], [fg, 'surface', 4.5]],
  ),
  ['border', 'bg', 3],
];

function cssVars(scheme: keyof typeof PALETTE): string {
  return Object.entries(PALETTE[scheme]).map(([k, v]) => `--${k}:${v}`).join(';');
}

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeHref(url: string): string | null {
  return /^https?:\/\//i.test(url) ? esc(url) : null;
}

type ImpactKey = (typeof IMPACT_ORDER)[number];

function impactKey(impact: Impact | null): ImpactKey {
  return impact ?? 'unknown';
}

function badge(impact: Impact | null): string {
  const key = impactKey(impact);
  return `<span class="impact ${key}">${key === 'unknown' ? 'unspecified' : key}</span>`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export type RuleSummary = {
  ruleId: string;
  help: string;
  impact: Impact | null;
  pages: string[];
  occurrences: number;
  newOccurrences: number;
  /** impact weight × pages affected; unspecified impact weighs 1, like minor. */
  score: number;
  wcag: ScanCriterion[];
  helpUrls: string[];
  findings: ScanFinding[];
};

/** One entry per rule, ordered by impact weight × pages affected, then severity, occurrences and rule id. */
export function summarizeRules(findings: readonly ScanFinding[]): RuleSummary[] {
  const byRule = new Map<string, ScanFinding[]>();
  for (const f of findings) byRule.set(f.ruleId, [...(byRule.get(f.ruleId) ?? []), f]);
  const rules = [...byRule.entries()].map(([ruleId, list]): RuleSummary => {
    const impact = list.reduce<Impact | null>((max, f) => (impactRank(f.impact) > impactRank(max) ? f.impact : max), null);
    const pages = [...new Set(list.map((f) => f.pageUrl))].sort();
    const wcag = new Map<string, ScanCriterion>();
    for (const f of list) for (const c of f.wcag) wcag.set(c.number, c);
    return {
      ruleId,
      help: list[0]?.help ?? ruleId,
      impact,
      pages,
      occurrences: list.length,
      newOccurrences: list.filter((f) => f.baselineStatus === 'new').length,
      score: Math.max(impactRank(impact), 1) * pages.length,
      wcag: [...wcag.values()].sort((a, b) => a.number.localeCompare(b.number, 'en', { numeric: true })),
      helpUrls: [...new Set(list.map((f) => f.helpUrl).filter((u) => safeHref(u) !== null))],
      findings: list,
    };
  });
  return rules.sort(
    (a, b) => b.score - a.score || impactRank(b.impact) - impactRank(a.impact) || b.occurrences - a.occurrences || a.ruleId.localeCompare(b.ruleId),
  );
}

export function topFixes(findings: readonly ScanFinding[], limit = TOP_FIXES_LIMIT): RuleSummary[] {
  return summarizeRules(findings).slice(0, limit);
}

function ruleAnchor(index: number): string {
  return `fix-${index + 1}`;
}

function wcagLabel(c: ScanCriterion): string {
  return `${c.number} ${c.name} (${c.level})`;
}

function asGuidanceInput(rule: RuleSummary): Finding {
  const f = rule.findings[0] as ScanFinding;
  return {
    fingerprint: f.fingerprint, ruleId: f.ruleId, impact: f.impact, tags: f.tags, help: f.help, helpUrl: f.helpUrl,
    selector: f.selector, html: f.html, url: f.pageUrl, path: f.pageUrl, engineVersion: '', timestamp: '',
  } as Finding;
}

function summarySection(report: ScanReport): string {
  const c = report.counts;
  const rows = IMPACT_ORDER.map((k) => `<tr><th scope="row">${k === 'unknown' ? 'unspecified' : k}</th><td>${c.byImpact[k]}</td></tr>`).join('');
  const baseline = report.baseline
    ? `<li>Compared with baseline: <strong>${report.baseline.new} new</strong>; ${report.baseline.existing} existing; ${report.baseline.fixed} fixed; ${report.baseline.unassessed} unassessed.</li>`
    : '<li>Compared with baseline: no baseline was supplied, so every finding is reported without new/existing status.</li>';
  const engines = report.engines
    ? `<li>Engines used: ${esc(report.engines.used.join(', ') || 'none')}.</li><li>Engines errored: ${report.engines.errored.length ? report.engines.errored.map((e) => esc(`${e.engine} — ${e.url} — ${e.error}`)).join('; ') : 'none'}.</li>`
    : `<li>Engines used: axe-core ${esc(report.axeVersion ?? 'n/a')}.</li><li>Engines errored: none.</li>`;
  return `<section id="summary" aria-labelledby="summary-h">
<h2 id="summary-h">Executive summary</h2>
<p class="verdict">Gate verdict: ${esc(report.verdict)} <span class="muted">(fail on: ${esc(report.failOn)})</span></p>
<p>${esc(report.reason)}</p>
<ul class="facts">
<li>Pages scanned: <strong>${c.pagesScanned}</strong>; pages that failed to load: ${c.pagesFailed}; links not scanned: ${c.skippedLinks}.</li>
<li>Total findings: <strong>${c.findings}</strong> across ${plural(new Set(report.findings.map((f) => f.ruleId)).size, 'rule')}.</li>
${baseline}
${engines}
<li>Scanned ${esc(report.scannedAt)} with A11yGate ${esc(report.version)}.</li>
</ul>
<table><caption>Findings by severity</caption><thead><tr><th scope="col">Severity</th><th scope="col">Findings</th></tr></thead><tbody>${rows}</tbody></table>
</section>`;
}

function topFixesSection(rules: RuleSummary[]): string {
  const top = rules.slice(0, TOP_FIXES_LIMIT);
  const body = top.length === 0
    ? '<p>No automated findings to prioritise. This does not mean the pages are accessible; see what automated testing does not cover.</p>'
    : `<ol class="top">${top.map((r, i) => `<li><a href="#${ruleAnchor(i)}"><strong>${esc(r.ruleId)}</strong></a> ${badge(r.impact)} — ${esc(r.help)}<br><span class="muted">${plural(r.pages.length, 'page')} affected; ${plural(r.occurrences, 'occurrence')}${r.newOccurrences ? `; ${r.newOccurrences} new` : ''}; priority score ${r.score}. ${r.wcag.length ? 'WCAG ' + esc(r.wcag.map((c) => c.number).join(', ')) : 'Best practice'}.</span></li>`).join('')}</ol>`;
  return `<section id="top-fixes" aria-labelledby="top-fixes-h">
<h2 id="top-fixes-h">Top ${TOP_FIXES_LIMIT} fixes</h2>
<p class="muted">Ordered by impact weight × pages affected (critical 4, serious 3, moderate 2, minor or unspecified 1). Review likely shared components below to assess whether one fix may address multiple pages.</p>
${body}
</section>`;
}

function sharedComponentsSection(report: ScanReport): string {
  const groups = groupSharedComponents(report.findings).filter((g) => g.likelySharedComponent);
  return `<section id="shared-components" aria-labelledby="shared-components-h">
<h2 id="shared-components-h">Likely shared components</h2>
<p>${esc(SHARED_COMPONENT_DISCLAIMER)}</p>
${groups.length ? groups.map((g) => `<section><h3>${esc(g.ruleId)} — likely shared component on ${plural(g.pageCount, 'page')}</h3><p>${plural(g.findingCount, 'finding')}; normalized selector: <code>${esc(g.normalizedSelector)}</code></p><ul>${g.examples.map((f) => `<li>Example page: <code>${esc(f.pageUrl)}</code><br>Selector: <code>${esc(f.selector)}</code><br>HTML: <code>${esc(f.html)}</code></li>`).join('')}</ul></section>`).join('') : '<p>No likely shared components detected across pages.</p>'}
</section>`;
}

function byWcagSection(report: ScanReport, rules: RuleSummary[]): string {
  const groups = groupByCriterion(report.findings);
  const anchor = new Map(rules.map((r, i) => [r.ruleId, ruleAnchor(i)]));
  const body = groups.length === 0
    ? '<p>None detected.</p>'
    : groups.map((g) => {
      const perRule = new Map<string, ScanFinding[]>();
      for (const f of g.findings) perRule.set(f.ruleId, [...(perRule.get(f.ruleId) ?? []), f]);
      const items = [...perRule.entries()]
        .sort((a, b) => (rules.findIndex((r) => r.ruleId === a[0]) - rules.findIndex((r) => r.ruleId === b[0])))
        .map(([ruleId, list]) => `<li><a href="#${anchor.get(ruleId)}">${esc(ruleId)}</a> — ${plural(list.length, 'occurrence')} on ${plural(new Set(list.map((f) => f.pageUrl)).size, 'page')}</li>`)
        .join('');
      return `<section><h3>${esc(g.label)} (${g.findings.length})</h3><ul>${items}</ul></section>`;
    }).join('\n');
  return `<section id="by-wcag" aria-labelledby="by-wcag-h">
<h2 id="by-wcag-h">Findings by WCAG success criterion</h2>
<p class="muted">A finding mapped to two criteria is listed under both. The criterion mapping is a static crosswalk and needs expert review before it is used as evidence.</p>
${body}
</section>`;
}

function pageFinding(f: ScanFinding): string {
  return `<li>${f.baselineStatus ? `<span class="tag">${esc(f.baselineStatus)}</span> ` : ''}<strong>${esc(f.ruleId)}</strong> ${badge(f.impact)} — ${esc(f.help)}<br>Selector: <code>${esc(f.selector)}</code>${f.engines ? '<br><span class="muted">' + esc(attribution(f)) + '</span>' : ''}</li>`;
}

function byPageSection(report: ScanReport): string {
  const body = report.pages.map((p) => {
    const list = report.findings
      .filter((f) => [p.url, p.finalUrl, normalizeUrl(p.url)].includes(f.pageUrl))
      .sort((a, b) => impactRank(b.impact) - impactRank(a.impact) || a.ruleId.localeCompare(b.ruleId));
    const status = `HTTP ${p.status ?? '—'}; ${esc(p.scanStatus)}${p.error ? ' — ' + esc(p.error) : ''}`;
    return `<section><h3><code>${esc(p.url)}</code> (${p.findings})</h3><p class="muted">${status}</p>${list.length ? `<ul>${list.map(pageFinding).join('')}</ul>` : '<p>No automated findings on this page.</p>'}</section>`;
  }).join('\n');
  return `<section id="by-page" aria-labelledby="by-page-h">
<h2 id="by-page-h">Findings by page</h2>
${body || '<p>No pages were scanned.</p>'}
</section>`;
}

function howToFixSection(rules: RuleSummary[]): string {
  const body = rules.length === 0
    ? '<p>None detected.</p>'
    : rules.map((r, i) => {
      const g = findingGuidance(asGuidanceInput(r));
      const links = [
        ...r.helpUrls.map((u) => `<li><a href="${safeHref(u)}">Engine rule help<span class="sr"> for ${esc(r.ruleId)}</span></a></li>`),
        ...r.wcag.flatMap((c) => {
          const url = understandingUrl(c);
          return url ? [`<li><a href="${esc(url)}">W3C Understanding ${esc(wcagLabel(c))}</a></li>`] : [];
        }),
      ];
      return `<section id="${ruleAnchor(i)}"><h3>${esc(r.ruleId)} ${badge(r.impact)}</h3>
<p>${esc(r.help)}</p>
<p><strong>Who is affected:</strong> ${esc(g.userImpact)}</p>
<p><strong>How to fix:</strong> ${esc(g.remediation)}</p>
<p><strong>How to verify:</strong></p><ul>${g.verification.map((v) => `<li>${esc(v)}</li>`).join('')}</ul>
${links.length ? `<p><strong>References:</strong></p><ul>${links.join('')}</ul>` : '<p>No reference link was recorded for this rule.</p>'}
<p class="muted">${esc(g.source)}</p></section>`;
    }).join('\n');
  return `<section id="how-to-fix" aria-labelledby="how-to-fix-h">
<h2 id="how-to-fix-h">How to fix, by rule</h2>
<p class="muted">A11yGate does not write alternative text, labels or accessible names. Any such text is a TODO for a person who knows the content, followed by human review.</p>
${body}
</section>`;
}

function limitsSection(report: ScanReport): string {
  const notScanned = report.skipped.filter((s) => s.reason === 'robots' || s.reason === 'cap');
  return `<section id="limits" aria-labelledby="limits-h">
<h2 id="limits-h">What automated testing does not cover</h2>
<p>This report records what automated rules detected on the pages listed above. It does not assess:</p>
<ul>${AUTOMATED_LIMITS.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
<p>Manual testing by people, including people with disabilities and assistive technology users, is needed for these areas.</p>
<h3>Scope and boundaries of this scan</h3>
<ul>${report.boundaries.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
${notScanned.length ? `<h3>Not scanned</h3><ul>${notScanned.map((s) => `<li><code>${esc(s.url)}</code> — ${s.reason === 'robots' ? 'disallowed by robots.txt' : 'page cap reached'}</li>`).join('')}</ul>` : ''}${report.skipped.some((s) => s.reason !== 'robots' && s.reason !== 'cap') ? `<h3>Skipped pages</h3><ul>${report.skipped.map((s) => `<li><code>${esc(s.url)}</code> — ${esc(s.reason)}</li>`).join('')}</ul>` : ''}
</section>`;
}

const STYLE = `:root{color-scheme:light dark;${cssVars('light')}}
@media (prefers-color-scheme:dark){:root{${cssVars('dark')}}}
body{font:16px/1.5 system-ui,sans-serif;max-width:62rem;margin:0 auto;padding:1rem;color:var(--text);background:var(--bg)}
a{color:var(--link)}a:focus-visible{outline:3px solid var(--link);outline-offset:2px}
code{background:var(--surface);color:var(--text);padding:0 .2em;word-break:break-all}
table{border-collapse:collapse;margin:1rem 0}th,td{border:1px solid var(--border);padding:.25rem .5rem;text-align:left}
caption{text-align:left;font-weight:600}
li{margin:.4rem 0}.muted{color:var(--muted)}.verdict{font-size:1.25rem;font-weight:700}
.impact{font-weight:600;text-transform:capitalize}.critical{color:var(--critical)}.serious{color:var(--serious)}.moderate{color:var(--moderate)}.minor{color:var(--minor)}.unknown{color:var(--unknown)}
.tag{border:1px solid var(--border);border-radius:.25rem;padding:0 .3em;font-size:.875rem}
.disclaimer{border:2px solid var(--border);background:var(--surface);padding:.5rem .75rem;font-weight:600}
section>section{border-top:1px solid var(--border);margin-top:1rem}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media print{
:root{${cssVars('light')}}
body{max-width:none;padding:0;font-size:11pt;color:#000;background:#fff}
nav{display:none}
a{color:#000;text-decoration:underline}
#how-to-fix a[href^="http"]::after{content:" (" attr(href) ")";font-size:9pt;word-break:break-all}
h2,h3{break-after:avoid}li,tr,.disclaimer{break-inside:avoid}
#top-fixes,#how-to-fix,#limits{break-before:page}
}`;

/** Self-contained HTML (inline CSS, no scripts, no remote assets). */
export function scanHtmlV2(report: ScanReport): string {
  const rules = summarizeRules(report.findings);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>A11yGate accessibility scan report — ${esc(report.startUrl)}</title>
<style>
${STYLE}
</style>
</head>
<body>
<header>
<h1>A11yGate accessibility scan report</h1>
<p>Start URL: <code>${esc(report.startUrl)}</code></p>
<p class="disclaimer" id="disclaimer">${esc(AUTOMATED_TESTING_DISCLAIMER)}</p>
<nav aria-label="Report sections"><ul>
<li><a href="#summary">Executive summary</a></li>
<li><a href="#top-fixes">Top ${TOP_FIXES_LIMIT} fixes</a></li>
<li><a href="#shared-components">Likely shared components</a></li>
<li><a href="#by-wcag">Findings by WCAG success criterion</a></li>
<li><a href="#by-page">Findings by page</a></li>
<li><a href="#how-to-fix">How to fix, by rule</a></li>
<li><a href="#limits">What automated testing does not cover</a></li>
</ul></nav>
</header>
<main>
${summarySection(report)}
${topFixesSection(rules)}
${sharedComponentsSection(report)}
${byWcagSection(report, rules)}
${byPageSection(report)}
${howToFixSection(rules)}
${limitsSection(report)}
</main>
<footer>
<p>${esc(AUTOMATED_TESTING_DISCLAIMER)}</p>
<p>${esc(DISCLAIMER)}</p>
<p>${esc(LEGAL_DISCLAIMER)}</p>
</footer>
</body>
</html>
`;
}
