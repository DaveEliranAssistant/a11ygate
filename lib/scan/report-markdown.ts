/**
 * Markdown scan summary (also printed by `a11ygate scan` as the CLI summary).
 * Every user-visible string comes from the report catalog (locales/en.json);
 * the disclaimer and legal wording are verbatim from lib/copy.ts and are never
 * translated. tests/i18n-catalog.test.ts lints this file.
 */
import { AUTOMATED_TESTING_DISCLAIMER, DISCLAIMER, LEGAL_DISCLAIMER } from '@/lib/copy';
import { cell } from '@/lib/export-markdown';
import { DEFAULT_REPORT_LANG, translator, type ReportLang, type Translator } from '@/lib/i18n';
import { REVIEW_DECISION_NOTICE, reviewedGroups, type AppliedReviewDecision } from '@/lib/scan/review';
import { en301549Inline } from '@/lib/mapping';
import { groupByCriterion, groupBySeverity, sortFindings, type ScanCriterion, type ScanFinding, type ScanReport } from '@/lib/scan/report';

const IMPACT_KEYS = ['critical', 'serious', 'moderate', 'minor', 'unknown'] as const;

type Escape = (value: string) => string;
const raw: Escape = (value) => value;

/** Decision label from the catalog; the decision value itself (`to-fix`, `accepted-risk`, ...) is a recorded token. */
export function reviewDecisionLabel(t: Translator, d: AppliedReviewDecision, escape: Escape = raw): string {
  return d.decision === 'accepted-risk' && d.expired ? t.t('review.expiredLabel', { decision: escape(d.decision) }) : escape(d.decision);
}

/** Catalog form of lib/scan/review.ts decisionSummary(); reviewer name, dates and reason are recorded data. */
export function reviewDecisionSummary(t: Translator, d: AppliedReviewDecision, escape: Escape = raw): string {
  return t.t('review.summary', {
    decision: reviewDecisionLabel(t, d, escape), by: escape(d.by), at: escape(d.at),
    expires: d.expires ? t.t('review.expires', { date: escape(d.expires) }) : '',
    reason: d.reason ? t.t('review.reason', { reason: escape(d.reason) }) : '',
  });
}

/** Catalog form of lib/scan/report.ts gateEffect(). */
export function reviewGateEffect(t: Translator, d: AppliedReviewDecision): string {
  return t.t(d.suppressesGate ? 'review.gate.excluded' : d.expired ? 'review.gate.expired' : 'review.gate.gated');
}

/**
 * Catalog form of the lib/scan/report.ts groupByCriterion() label (which stays
 * English for API callers). Criterion number, name and level are mapping data.
 */
export function criterionGroupLabel(t: Translator, key: string, findings: readonly ScanFinding[], escape: Escape = raw): string {
  if (key === 'best-practice') return t.t('wcag.bestPracticeGroup');
  const c = findings.flatMap((f) => f.wcag).find((x) => x.number === key) as ScanCriterion;
  return t.t('wcag.criterionGroup', { number: escape(c.number), name: escape(c.name), level: escape(c.level), en301549: escape(en301549Inline(c.number)) });
}

/** Catalog form of lib/scan/engines/dedupe.ts attribution(); engine names and counts are data. */
export function engineAttribution(t: Translator, f: ScanFinding, escape: Escape = raw): string {
  if (!f.engines || !f.confidence) return '';
  return t.t('engines.attribution', { engines: escape(f.engines.join(', ')), confirmedBy: f.confidence.confirmedBy, enginesRan: f.confidence.enginesRan });
}

/** Inside a code span only backticks and line breaks need neutralising. */
function code(value: string): string {
  return '`' + value.replace(/`/g, "'").replace(/[\r\n|]/g, ' ') + '`';
}

function heading(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\r\n]/g, ' ');
}

function mdFinding(t: Translator, f: ScanFinding): string {
  const tags = `${f.baselineStatus ? ' [' + f.baselineStatus + ']' : ''}${f.reviewDecision ? ' [' + t.t('md.reviewTag', { decision: reviewDecisionLabel(t, f.reviewDecision) }) + ']' : ''}`;
  const impact = f.impact ?? t.t('md.findingImpact.unknown');
  return `-${tags} **${cell(f.ruleId)}** ${t.t('md.findingLocation', { impact, page: code(f.pageUrl) })} — ${code(f.selector)} — ${cell(f.help)}${f.engines ? ' — ' + engineAttribution(t, f) : ''}${f.states?.length ? ' — ' + t.t('md.states', { states: f.states.map(code).join(', ') }) : ''} — [${t.t('md.ruleGuidance')}](${encodeURI(f.helpUrl).replace(/[()]/g, encodeURIComponent)})`;
}

function severityGroupLabel(t: Translator, key: string): string {
  return key === 'unknown' ? t.t('md.impactGroup.unknown') : (IMPACT_KEYS as readonly string[]).includes(key) ? t.t(`md.impact.${key}` as 'md.impact.critical') : key;
}

/** R39: decided findings keep their own section, so no decision hides a finding. Empty without decisions. */
function reviewMarkdown(t: Translator, report: ScanReport): string[] {
  const groups = reviewedGroups(report.findings);
  if (!groups.length) return [];
  return [`## ${t.t('md.reviewHeading')}`, '', cell(REVIEW_DECISION_NOTICE), '',
    ...groups.flatMap(({ decision: d, findings }) => [
      `### ${code(d.group)} — ${heading(d.ruleId)} — ${t.t('md.reviewGroupPages', { findings: t.plural('plural.finding', findings.length), pageCount: new Set(findings.map((f) => f.pageUrl)).size })}`, '',
      t.t('md.normalizedSelector', { selector: code(d.normalizedSelector) }), '',
      t.t('md.decision', { summary: cell(reviewDecisionSummary(t, d)), effect: reviewGateEffect(t, d) }), '',
      ...sortFindings(findings).map((f) => mdFinding(t, f)), '']),
    AUTOMATED_TESTING_DISCLAIMER, ''];
}

export function scanMarkdown(report: ScanReport, lang: ReportLang = DEFAULT_REPORT_LANG): string {
  const t = translator(lang);
  const c = report.counts;
  const lines = [
    `# ${t.t('md.title', { startUrl: cell(report.startUrl) })}`,
    '',
    `**${t.t('md.verdict', { verdict: report.verdict })}** ${t.t('md.failOn', { failOn: report.failOn })}`,
    '',
    cell(report.reason),
    '',
    `| ${t.t('md.severityColumn')} | ${t.t('md.findingsColumn')} |`,
    '| --- | --- |',
    ...IMPACT_KEYS.map((k) => `| ${t.t(`md.impact.${k}`)} | ${c.byImpact[k]} |`),
    '',
    t.t('md.scanned', { scannedAt: report.scannedAt, scanned: c.pagesScanned, failed: c.pagesFailed, notAuthenticated: c.pagesNotAuthenticated !== undefined ? t.t('md.notAuthenticated', { n: c.pagesNotAuthenticated }) : '', axeVersion: report.axeVersion ?? t.t('summary.notAvailable'), version: report.version }),
    '',
    ...(report.baseline ? [t.t('md.baseline', { new: report.baseline.new, existing: report.baseline.existing, fixed: report.baseline.fixed, unassessed: report.baseline.unassessed }), '', AUTOMATED_TESTING_DISCLAIMER, ''] : []),
    `## ${t.t('md.pagesHeading')}`,
    '',
    `| ${t.t('md.pageColumn')} | ${t.t('md.httpColumn')} | ${t.t('md.statusColumn')} | ${t.t('md.findingsColumn')} |`,
    '| --- | --- | --- | --- |',
    ...report.pages.map((p) => `| ${cell(p.url)} | ${p.status ?? '—'} | ${p.scanStatus}${p.error ? ' — ' + cell(p.error) : ''} | ${p.findings} |`),
    '',
    `## ${t.t('md.byCriterionHeading')}`,
    '',
  ];
  const byCriterion = groupByCriterion(report.findings);
  if (byCriterion.length === 0) lines.push(t.t('md.none'), '');
  for (const group of byCriterion) {
    lines.push(`### ${heading(criterionGroupLabel(t, group.key, group.findings))}`, '', ...sortFindings(group.findings).map((f) => mdFinding(t, f)), '');
  }
  lines.push(`## ${t.t('md.bySeverityHeading')}`, '');
  const bySeverity = groupBySeverity(report.findings);
  if (bySeverity.length === 0) lines.push(t.t('md.none'), '');
  for (const group of bySeverity) {
    lines.push(`### ${heading(severityGroupLabel(t, group.key))} (${group.findings.length})`, '', ...group.findings.map((f) => mdFinding(t, f)), '');
  }
  lines.push(...reviewMarkdown(t, report));
  const robotsSkipped = report.skipped.filter((s) => s.reason === 'robots' || s.reason === 'cap');
  if (robotsSkipped.length > 0) {
    lines.push(`## ${t.t('md.notScannedHeading')}`, '', ...robotsSkipped.map((s) => `- ${cell(s.url)} — ${s.reason === 'robots' ? t.t('skip.robots') : t.t('skip.cap')}`), '');
  }
  const otherSkipped = report.skipped.filter((s) => s.reason !== 'robots' && s.reason !== 'cap');
  if (otherSkipped.length) lines.push(`## ${t.t('md.skippedHeading')}`, '', ...otherSkipped.map((s) => `- ${cell(s.url)} — ${cell(s.reason)}`), '');
  if (report.engines) lines.push(`## ${t.t('md.enginesHeading')}`, '',
    t.t('summary.enginesUsed', { engines: report.engines.used.join(', ') || t.t('summary.enginesNone') }),
    t.t('summary.enginesErrored', { errors: report.engines.errored.length ? report.engines.errored.map((e) => `${cell(e.engine)} — ${code(e.url)} — ${cell(e.error)}`).join('; ') : t.t('summary.enginesNone') }),
    '', AUTOMATED_TESTING_DISCLAIMER, '');
  lines.push(`## ${t.t('md.scopeHeading')}`, '', ...report.boundaries.map((b) => `- ${cell(b)}`), '', DISCLAIMER, LEGAL_DISCLAIMER, '');
  return lines.join('\n');
}
