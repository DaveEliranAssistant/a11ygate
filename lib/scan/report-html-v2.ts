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
import { AUTOMATED_LIMITS, AUTOMATED_TESTING_DISCLAIMER, DISCLAIMER, LEGAL_DISCLAIMER } from '@/lib/copy';
import { impactRank } from '@/lib/gate';
import { groupSharedComponents, SHARED_COMPONENT_DISCLAIMER } from '@/lib/group';
import { findingGuidance } from '@/lib/guidance';
import { EN301549_COLUMN, EN301549_LABEL, EN301549_SOURCE, en301549Ref, understandingUrl } from '@/lib/mapping';
import { groupByCriterion, scanHtml, sortFindings, type ScanCriterion, type ScanFinding, type ScanReport } from '@/lib/scan/report';
import type { Finding, Impact } from '@/lib/types';
import { catalogFor, DEFAULT_REPORT_LANG, translator, type Catalog, type ReportLang, type Translator } from '@/lib/i18n';
import { REVIEW_DECISION_NOTICE, reviewedGroups } from '@/lib/scan/review';
import { diffScanSummary, criterionGroupLabel, engineAttribution, reviewDecisionLabel, reviewDecisionSummary, reviewGateEffect } from '@/lib/scan/report-markdown';

export const REPORT_VERSIONS = [1, 2] as const;
export type ReportVersion = (typeof REPORT_VERSIONS)[number];
export const DEFAULT_REPORT_VERSION: ReportVersion = 2;

export function isReportVersion(value: unknown): value is ReportVersion {
  return (REPORT_VERSIONS as readonly unknown[]).includes(value);
}

export type ScanHtmlOptions = {
  /** Opt-in: add the "EN 301 549 ref." column (reference mapping only) to report v2. Default off. */
  en301549Ref?: boolean;
  /** Report language (A11Y-R58). Default `en`; `en-XA` / `ar-XB` are pseudo-locales for layout tests. HTML v2 only. */
  lang?: ReportLang;
};

/** Render the HTML report. Version 1 is the legacy, byte-stable layout. */
export function renderScanHtml(report: ScanReport, version: ReportVersion = DEFAULT_REPORT_VERSION, options: ScanHtmlOptions = {}): string {
  return version === 1 ? scanHtml(report) : scanHtmlV2(report, options);
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

function badge(t: Translator, impact: Impact | null): string {
  const key = impactKey(impact);
  return `<span class="impact ${key}">${t.t(`impact.${key}`)}</span>`;
}

/** Translator over an HTML-escaped catalog: message text is escaped, variables must already be HTML-safe. */
export function htmlTranslator(lang: ReportLang = DEFAULT_REPORT_LANG): Translator {
  const catalog = Object.fromEntries(Object.entries(catalogFor(lang)).map(([k, v]) => [k, esc(v)])) as Catalog;
  return translator(lang, catalog);
}

/** Disclaimer and legal wording stay verbatim English in every locale; mark them so in non-English reports. */
function verbatimAttrs(t: Translator): string {
  return t.lang === 'en' ? '' : ' lang="en" dir="ltr"';
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

function summarySection(t: Translator, report: ScanReport): string {
  const c = report.counts;
  const rows = IMPACT_ORDER.map((k) => `<tr><th scope="row">${t.t(`impact.${k}`)}</th><td>${c.byImpact[k]}</td></tr>`).join('');
  const baseline = report.baseline
    ? `<li>${t.t('summary.baseline', { new: `<strong>${t.t('summary.baselineNew', { n: report.baseline.new })}</strong>`, existing: report.baseline.existing, fixed: report.baseline.fixed, unassessed: report.baseline.unassessed })}</li>`
    : `<li>${t.t('summary.noBaseline')}</li>`;
  const none = t.t('summary.enginesNone');
  const engines = report.engines
    ? `<li>${t.t('summary.enginesUsed', { engines: report.engines.used.length ? esc(report.engines.used.join(', ')) : none })}</li><li>${t.t('summary.enginesErrored', { errors: report.engines.errored.length ? report.engines.errored.map((e) => esc(`${e.engine} — ${e.url} — ${e.error}`)).join('; ') : none })}</li>`
    : `<li>${t.t('summary.enginesUsed', { engines: t.t('summary.axeEngine', { version: report.axeVersion === null ? t.t('summary.notAvailable') : esc(report.axeVersion) }) })}</li><li>${t.t('summary.enginesErrored', { errors: none })}</li>`;
  return `<section id="summary" aria-labelledby="summary-h">
<h2 id="summary-h">${t.t('summary.heading')}</h2>${report.diffScan ? diffScanSummary(report, t).map(line => `<p>${esc(line)}</p>`).join('') : ''}
<p class="verdict">${t.t('summary.verdict', { verdict: esc(report.verdict) })} <span class="muted">${t.t('summary.failOn', { failOn: esc(report.failOn) })}</span></p>
<p>${esc(report.reason)}</p>
<ul class="facts">
<li>${t.t('summary.pages', { scanned: `<strong>${c.pagesScanned}</strong>`, failed: c.pagesFailed, notAuthenticated: c.pagesNotAuthenticated !== undefined ? t.t('summary.notAuthenticated', { n: c.pagesNotAuthenticated }) : '', skipped: c.skippedLinks })}</li>
<li>${t.t('summary.totalFindings', { findings: `<strong>${c.findings}</strong>`, rules: t.plural('plural.rule', new Set(report.findings.map((f) => f.ruleId)).size) })}</li>
${baseline}
${engines}
<li>${t.t('summary.scannedWith', { scannedAt: esc(report.scannedAt), version: esc(report.version) })}</li>
</ul>
<table><caption>${t.t('summary.severityCaption')}</caption><thead><tr><th scope="col">${t.t('summary.severityColumn')}</th><th scope="col">${t.t('summary.findingsColumn')}</th></tr></thead><tbody>${rows}</tbody></table>
</section>`;
}

function topFixesSection(t: Translator, rules: RuleSummary[]): string {
  const top = rules.slice(0, TOP_FIXES_LIMIT);
  const body = top.length === 0
    ? `<p>${t.t('topFixes.empty')}</p>`
    : `<ol class="top">${top.map((r, i) => `<li><a href="#${ruleAnchor(i)}"><strong>${esc(r.ruleId)}</strong></a> ${badge(t, r.impact)} — ${esc(r.help)}<br><span class="muted">${t.t('topFixes.stats', { pages: t.plural('plural.page', r.pages.length), occurrences: t.plural('plural.occurrence', r.occurrences), newCount: r.newOccurrences ? t.t('topFixes.newCount', { n: r.newOccurrences }) : '', score: r.score, criteria: r.wcag.length ? t.t('topFixes.wcag', { numbers: esc(r.wcag.map((c) => c.number).join(', ')) }) : t.t('topFixes.bestPractice') })}</span></li>`).join('')}</ol>`;
  return `<section id="top-fixes" aria-labelledby="top-fixes-h">
<h2 id="top-fixes-h">${t.t('topFixes.heading', { limit: TOP_FIXES_LIMIT })}</h2>
<p class="muted">${t.t('topFixes.ordering')}</p>
${body}
</section>`;
}

function sharedComponentsSection(t: Translator, report: ScanReport): string {
  const groups = groupSharedComponents(report.findings).filter((g) => g.likelySharedComponent);
  return `<section id="shared-components" aria-labelledby="shared-components-h">
<h2 id="shared-components-h">${t.t('shared.heading')}</h2>
<p${verbatimAttrs(t)}>${esc(SHARED_COMPONENT_DISCLAIMER)}</p>
${groups.length ? groups.map((g) => `<section><h3>${t.t('shared.groupHeading', { ruleId: esc(g.ruleId), pages: t.plural('plural.page', g.pageCount) })}</h3><p>${t.t('shared.groupSummary', { findings: t.plural('plural.finding', g.findingCount), selector: `<code>${esc(g.normalizedSelector)}</code>` })}</p><ul>${g.examples.map((f) => `<li>${t.t('shared.examplePage', { url: `<code>${esc(f.pageUrl)}</code>` })}<br>${t.t('shared.selector', { selector: `<code>${esc(f.selector)}</code>` })}<br>${t.t('shared.html', { html: `<code>${esc(f.html)}</code>` })}</li>`).join('')}</ul></section>`).join('') : `<p>${t.t('shared.none')}</p>`}
</section>`;
}

function reviewFinding(t: Translator, f: ScanFinding): string {
  const href = safeHref(f.helpUrl) ?? '#';
  return `<li>${f.baselineStatus ? esc(f.baselineStatus) + ': ' : ''}${f.reviewDecision ? t.t('review.findingTag', { decision: reviewDecisionLabel(t, f.reviewDecision, esc) }) : ''}<strong>${esc(f.ruleId)}</strong> <span class="impact ${esc(f.impact ?? 'unknown')}">${f.impact ? esc(f.impact) : t.t('review.findingImpactUnknown')}</span><br>${t.t('review.findingPage', { url: `<code>${esc(f.pageUrl)}</code>` })}<br>${t.t('review.findingSelector', { selector: `<code>${esc(f.selector)}</code>` })}<br>${esc(f.help)}${f.engines ? '<br>' + engineAttribution(t, f, esc) : ''}${f.states?.length ? '<br>' + t.t('review.findingStates', { states: f.states.map(esc).join(', ') }) : ''} — <a href="${href}">${t.t('review.ruleGuidance')}<span class="sr">${t.t('review.ruleGuidanceFor', { ruleId: esc(f.ruleId) })}</span></a></li>`;
}

/** R39 decided groups; empty without decisions so existing output is unchanged. */
function reviewSection(t: Translator, report: ScanReport): string {
  const groups = reviewedGroups(report.findings);
  if (!groups.length) return '';
  return `<section id="review-decisions" aria-labelledby="review-decisions-h">
<h2 id="review-decisions-h">${t.t('review.heading')}</h2><p${verbatimAttrs(t)}>${esc(REVIEW_DECISION_NOTICE)}</p>` +
    groups.map(({ decision: d, findings }) => `<section><h3>${t.t('review.groupHeading', { group: `<code>${esc(d.group)}</code>`, ruleId: esc(d.ruleId), count: findings.length })}</h3><p>${t.t('review.normalizedSelector', { selector: `<code>${esc(d.normalizedSelector)}</code>` })}</p><p>${t.t('review.decision', { summary: reviewDecisionSummary(t, d, esc), effect: reviewGateEffect(t, d) })}</p><ul>${sortFindings(findings).map((f) => reviewFinding(t, f)).join('')}</ul></section>`).join('') +
    `<p${verbatimAttrs(t)}>${esc(AUTOMATED_TESTING_DISCLAIMER)}</p>
</section>
`;
}

/**
 * Opt-in table: WCAG success criterion -> EN 301 549 V3.2.1 clause. The source
 * URL comes from lib/mapping.ts (no URL literal here). The label is always
 * rendered with the column.
 */
export function en301549RefTable(report: ScanReport, t: Translator = htmlTranslator()): string {
  const criteria = new Map<string, ScanCriterion>();
  for (const f of report.findings) for (const c of f.wcag) criteria.set(c.number, c);
  const rows = [...criteria.values()]
    .sort((a, b) => a.number.localeCompare(b.number, 'en', { numeric: true }))
    .map((c) => `<tr><th scope="row">${esc(wcagLabel(c))}</th><td>${esc(c.wcag)}</td><td>${esc(en301549Ref(c.number))}</td></tr>`)
    .join('');
  return `<table id="en301549-ref"><caption>${esc(EN301549_COLUMN)} — ${esc(EN301549_LABEL)} ${t.t('en301549.source', { link: `<a href="${esc(EN301549_SOURCE.url)}">${esc(EN301549_SOURCE.title)}</a>` })}</caption>
<thead><tr><th scope="col">${t.t('en301549.criterionColumn')}</th><th scope="col">${t.t('en301549.versionColumn')}</th><th scope="col">${esc(EN301549_COLUMN)}</th></tr></thead>
<tbody>${rows || `<tr><td colspan="3">${t.t('en301549.empty')}</td></tr>`}</tbody></table>
<p class="muted">${esc(EN301549_LABEL)}</p>`;
}

function byWcagSection(t: Translator, report: ScanReport, rules: RuleSummary[], options: ScanHtmlOptions = {}): string {
  const groups = groupByCriterion(report.findings);
  const anchor = new Map(rules.map((r, i) => [r.ruleId, ruleAnchor(i)]));
  const body = groups.length === 0
    ? `<p>${t.t('wcag.none')}</p>`
    : groups.map((g) => {
      const perRule = new Map<string, ScanFinding[]>();
      for (const f of g.findings) perRule.set(f.ruleId, [...(perRule.get(f.ruleId) ?? []), f]);
      const items = [...perRule.entries()]
        .sort((a, b) => (rules.findIndex((r) => r.ruleId === a[0]) - rules.findIndex((r) => r.ruleId === b[0])))
        .map(([ruleId, list]) => `<li>${t.t('wcag.ruleLine', { ruleId: `<a href="#${anchor.get(ruleId)}">${esc(ruleId)}</a>`, occurrences: t.plural('plural.occurrence', list.length), pages: t.plural('plural.page', new Set(list.map((f) => f.pageUrl)).size) })}</li>`)
        .join('');
      return `<section><h3>${criterionGroupLabel(t, g.key, g.findings, esc)} (${g.findings.length})</h3><ul>${items}</ul></section>`;
    }).join('\n');
  return `<section id="by-wcag" aria-labelledby="by-wcag-h">
<h2 id="by-wcag-h">${t.t('wcag.heading')}</h2>
<p class="muted">${t.t('wcag.note')}</p>
${options.en301549Ref ? en301549RefTable(report, t) + '\n' : ''}${body}
</section>`;
}

function pageFinding(t: Translator, f: ScanFinding): string {
  return `<li>${f.baselineStatus ? `<span class="tag">${esc(f.baselineStatus)}</span> ` : ''}<strong>${esc(f.ruleId)}</strong> ${badge(t, f.impact)} — ${esc(f.help)}<br>${t.t('page.selector', { selector: `<code>${esc(f.selector)}</code>` })}${f.engines ? '<br><span class="muted">' + engineAttribution(t, f, esc) + '</span>' : ''}</li>`;
}

function byPageSection(t: Translator, report: ScanReport): string {
  const body = report.pages.map((p) => {
    const list = report.findings
      .filter((f) => [p.url, p.finalUrl, normalizeUrl(p.url)].includes(f.pageUrl))
      .sort((a, b) => impactRank(b.impact) - impactRank(a.impact) || a.ruleId.localeCompare(b.ruleId));
    const status = t.t('page.status', { status: p.status ?? t.t('page.noStatus'), scanStatus: esc(p.scanStatus), error: p.error ? ' — ' + esc(p.error) : '' });
    return `<section><h3><code>${esc(p.url)}</code> (${p.findings})</h3><p class="muted">${status}</p>${list.length ? `<ul>${list.map((f) => pageFinding(t, f)).join('')}</ul>` : `<p>${t.t('page.none')}</p>`}</section>`;
  }).join('\n');
  return `<section id="by-page" aria-labelledby="by-page-h">
<h2 id="by-page-h">${t.t('page.heading')}</h2>
${body || `<p>${t.t('page.noPages')}</p>`}
</section>`;
}

function howToFixSection(t: Translator, rules: RuleSummary[]): string {
  const body = rules.length === 0
    ? `<p>${t.t('fix.none')}</p>`
    : rules.map((r, i) => {
      const g = findingGuidance(asGuidanceInput(r));
      const links = [
        ...r.helpUrls.map((u) => `<li><a href="${safeHref(u)}">${t.t('fix.engineHelp')}<span class="sr">${t.t('fix.engineHelpFor', { ruleId: esc(r.ruleId) })}</span></a></li>`),
        ...r.wcag.flatMap((c) => {
          const url = understandingUrl(c);
          return url ? [`<li><a href="${esc(url)}">${t.t('fix.understanding', { criterion: esc(wcagLabel(c)) })}</a></li>`] : [];
        }),
      ];
      return `<section id="${ruleAnchor(i)}"><h3>${esc(r.ruleId)} ${badge(t, r.impact)}</h3>
<p>${esc(r.help)}</p>
<p><strong>${t.t('fix.whoAffected')}</strong> ${esc(g.userImpact)}</p>
<p><strong>${t.t('fix.howToFix')}</strong> ${esc(g.remediation)}</p>
<p><strong>${t.t('fix.howToVerify')}</strong></p><ul>${g.verification.map((v) => `<li>${esc(v)}</li>`).join('')}</ul>
${links.length ? `<p><strong>${t.t('fix.references')}</strong></p><ul>${links.join('')}</ul>` : `<p>${t.t('fix.noReference')}</p>`}
<p class="muted">${esc(g.source)}</p></section>`;
    }).join('\n');
  return `<section id="how-to-fix" aria-labelledby="how-to-fix-h">
<h2 id="how-to-fix-h">${t.t('fix.heading')}</h2>
<p class="muted">${t.t('fix.noInventedText')}</p>
${body}
</section>`;
}

function limitsSection(t: Translator, report: ScanReport): string {
  const notScanned = report.skipped.filter((s) => s.reason === 'robots' || s.reason === 'cap');
  return `<section id="limits" aria-labelledby="limits-h">
<h2 id="limits-h">${t.t('limits.heading')}</h2>
<p>${t.t('limits.intro')}</p>
<ul${verbatimAttrs(t)}>${AUTOMATED_LIMITS.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
<p>${t.t('limits.manual')}</p>
<h3>${t.t('limits.scope')}</h3>
<ul${verbatimAttrs(t)}>${report.boundaries.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
${notScanned.length ? `<h3>${t.t('limits.notScanned')}</h3><ul>${notScanned.map((s) => `<li><code>${esc(s.url)}</code> — ${s.reason === 'robots' ? t.t('skip.robots') : t.t('skip.cap')}</li>`).join('')}</ul>` : ''}${report.skipped.some((s) => s.reason !== 'robots' && s.reason !== 'cap') ? `<h3>${t.t('limits.skipped')}</h3><ul>${report.skipped.map((s) => `<li><code>${esc(s.url)}</code> — ${esc(s.reason)}</li>`).join('')}</ul>` : ''}
</section>`;
}

/* i18n-ignore */
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

/** Extra rules for right-to-left locales only, so the default (en) output stays byte-identical. */
/* i18n-ignore */
const RTL_STYLE = `th,td,caption{text-align:right}`;

/** Self-contained HTML (inline CSS, no scripts, no remote assets). */
export function scanHtmlV2(report: ScanReport, options: ScanHtmlOptions = {}): string {
  const rules = summarizeRules(report.findings);
  const t = htmlTranslator(options.lang ?? DEFAULT_REPORT_LANG);
  return `<!doctype html>
<html lang="${t.lang}"${t.dir === 'rtl' ? ' dir="rtl"' : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${t.t('html.title', { startUrl: esc(report.startUrl) })}</title>
<style>
${STYLE}${t.dir === 'rtl' ? '\n' + RTL_STYLE : ''}
</style>
</head>
<body>
<header>
<h1>${t.t('html.heading')}</h1>
<p>${t.t('html.startUrl', { startUrl: `<code>${esc(report.startUrl)}</code>` })}</p>
<p class="disclaimer" id="disclaimer"${verbatimAttrs(t)}>${esc(AUTOMATED_TESTING_DISCLAIMER)}</p>
<nav aria-label="${t.t('html.navLabel')}"><ul>
<li><a href="#summary">${t.t('summary.heading')}</a></li>
<li><a href="#top-fixes">${t.t('topFixes.heading', { limit: TOP_FIXES_LIMIT })}</a></li>
<li><a href="#shared-components">${t.t('shared.heading')}</a></li>
${report.findings.some((f) => f.reviewDecision) ? `<li><a href="#review-decisions">${t.t('nav.reviewDecisions')}</a></li>\n` : ''}<li><a href="#by-wcag">${t.t('wcag.heading')}</a></li>
<li><a href="#by-page">${t.t('page.heading')}</a></li>
<li><a href="#how-to-fix">${t.t('fix.heading')}</a></li>
<li><a href="#limits">${t.t('limits.heading')}</a></li>
</ul></nav>
</header>
<main>
${summarySection(t, report)}
${topFixesSection(t, rules)}
${sharedComponentsSection(t, report)}
${reviewSection(t, report)}${byWcagSection(t, report, rules, options)}
${byPageSection(t, report)}
${howToFixSection(t, rules)}
${limitsSection(t, report)}
</main>
<footer${verbatimAttrs(t)}>
<p>${esc(AUTOMATED_TESTING_DISCLAIMER)}</p>
<p>${esc(DISCLAIMER)}</p>
<p>${esc(LEGAL_DISCLAIMER)}</p>
</footer>
</body>
</html>
`;
}
