import { normalizeLocator } from './engines/dedupe';
import { normalizeUrl } from './url';
import { gatingScanFindings, type ScanFinding, type ScanReport } from './report';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { applyGroupDecisions, validateGroupDecision, type GroupDecision } from './review';

export type BaselineEntry = { fingerprint: string; pageUrl: string; ruleId: string; selector: string };
export type FingerprintBaseline = {
  kind: 'a11ygate-fingerprint-baseline';
  schemaVersion: 1;
  disclaimer: string;
  engines?: string[];
  findings: BaselineEntry[];
  /** Optional reviewer decisions keyed by component group (R39). Absent unless a11ygate review wrote one. */
  groupDecisions?: GroupDecision[];
};
export type BaselineSummary = { new: number; existing: number; fixed: number; unassessed: number };

type BaselineIdentity = Pick<ScanFinding, 'engines' | 'fingerprint' | 'pageUrl' | 'selectors' | 'ruleId'> & {
  wcag: readonly { number: string }[];
};

/** R12 identity: page + canonical element + SC (or unmapped engine/rule).
 * Legacy axe reports retain rule identity; HTML, severity and timestamps are excluded.
 */
export function baselineFingerprint(finding: BaselineIdentity, occurrence = 0): string {
  if (finding.engines) {
    const [page, locator, sc, rule] = JSON.parse(finding.fingerprint) as [string, string, string[], string];
    return JSON.stringify([normalizeUrl(page) ?? page, normalizeLocator(locator) || ['unlocated', occurrence], [...sc].sort(), rule]);
  }
  return JSON.stringify([normalizeUrl(finding.pageUrl) ?? finding.pageUrl,
    finding.selectors.some((selector) => selector.trim()) ? finding.selectors.map(normalizeLocator) : ['unlocated', occurrence], finding.ruleId, [...new Set(finding.wcag.map((c) => c.number))].sort()]);
}

export function createFingerprintBaseline(report: ScanReport): FingerprintBaseline {
  return {
    kind: 'a11ygate-fingerprint-baseline', schemaVersion: 1, disclaimer: AUTOMATED_TESTING_DISCLAIMER,
    engines: report.engines?.used ?? ['axe'],
    findings: [...new Map(report.findings.map((f, index) => {
      const fingerprint = baselineFingerprint(f, index);
      return [fingerprint, { fingerprint, pageUrl: f.pageUrl, ruleId: f.ruleId, selector: f.selector }];
    })).values()].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint)),
  };
}

export function parseFingerprintBaseline(value: unknown): FingerprintBaseline {
  const raw = value as Partial<FingerprintBaseline> | null;
  const field = !raw || typeof raw !== 'object' || Array.isArray(raw) ? '(top level)' : raw.kind !== 'a11ygate-fingerprint-baseline' ? 'kind' : raw.schemaVersion !== 1 ? 'schemaVersion' : !Array.isArray(raw.findings) ? 'findings' : null;
  if (field) {
    throw new Error(`Expected an A11yGate fingerprint baseline (kind a11ygate-fingerprint-baseline, schemaVersion 1, findings list); invalid field ${field}. Axe JSON baselines belong to a11ygate [ci] --baseline.`);
  }
  const b = raw as FingerprintBaseline;
  b.findings.forEach((f, index) => {
    if (!f || typeof f !== 'object') throw new Error(`Invalid baseline field findings[${index}]: expected an object.`);
    const key = (['fingerprint', 'pageUrl', 'ruleId', 'selector'] as const).find((k) => typeof f[k] !== 'string');
    if (key) throw new Error(`Invalid baseline field findings[${index}].${key}: expected a string.`);
  });
  if (b.engines !== undefined && (!Array.isArray(b.engines) || b.engines.some((engine) => typeof engine !== 'string'))) throw new Error('Invalid baseline engine coverage (field engines): expected a list of engine names.');
  if (new Set(b.findings.map((f) => f.fingerprint)).size !== b.findings.length) throw new Error('Duplicate baseline fingerprints (field findings[].fingerprint).');
  if (b.groupDecisions !== undefined) {
    if (!Array.isArray(b.groupDecisions)) throw new Error('Invalid baseline group decisions (field groupDecisions).');
    b.groupDecisions.forEach((decision, index) => {
      try { validateGroupDecision(decision); } catch (error) { throw new Error(`${(error as Error).message.replace(/\.$/, '')} (field groupDecisions[${index}]).`); }
    });
    if (new Set(b.groupDecisions.map((d) => d.groupKey)).size !== b.groupDecisions.length) throw new Error('Duplicate group decisions (field groupDecisions[].groupKey).');
  }
  return b as FingerprintBaseline;
}

/** Multi-engine fingerprints are JSON tuples [page, locator, sc[], rule]; reject anything else before baselineFingerprint parses them. */
function validEngineFingerprint(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return false; }
  return Array.isArray(parsed) && parsed.length === 4 && typeof parsed[0] === 'string' && typeof parsed[1] === 'string'
    && Array.isArray(parsed[2]) && parsed[2].every((sc) => typeof sc === 'string') && typeof parsed[3] === 'string';
}

export function parseScanReport(value: unknown): ScanReport {
  const report = value as ScanReport | null;
  const field = !report || typeof report !== 'object' || Array.isArray(report) ? '(top level)' : report.kind !== 'site-scan' ? 'kind' : report.schemaVersion !== 1 ? 'schemaVersion'
    : !Array.isArray(report.findings) ? 'findings' : !Array.isArray(report.pages) ? 'pages' : !Array.isArray(report.results) ? 'results' : null;
  if (field) throw new Error(`Expected an A11yGate site-scan JSON report; invalid field ${field}.`);
  // Validate identity fields before consuming untrusted JSON.
  report!.findings.forEach((f, index) => {
    if (!f || typeof f !== 'object') throw new Error(`Invalid scan finding (field findings[${index}]).`);
    const key = (['pageUrl', 'ruleId', 'selector'] as const).find((k) => typeof f[k] !== 'string')
      ?? (!Array.isArray(f.selectors) || f.selectors.some((s) => typeof s !== 'string') ? 'selectors' : !Array.isArray(f.wcag) || f.wcag.some((c) => !c || typeof c !== 'object' || typeof c.number !== 'string') ? 'wcag' : undefined);
    if (key) throw new Error(`Invalid scan finding (field findings[${index}].${key}).`);
    if (f.engines !== undefined) {
      if (!Array.isArray(f.engines) || f.engines.some((e) => typeof e !== 'string')) throw new Error(`Invalid scan finding (field findings[${index}].engines).`);
      if (!validEngineFingerprint(f.fingerprint)) throw new Error(`Invalid scan finding (field findings[${index}].fingerprint).`);
    }
    baselineFingerprint(f);
  });
  return report!;
}

export function applyFingerprintBaseline(report: ScanReport, baseline: FingerprintBaseline, now: Date = new Date()): ScanReport {
  const known = new Set(baseline.findings.map((f) => f.fingerprint));
  const current = new Set(report.findings.map(baselineFingerprint));
  const baselined = report.findings.map((finding, index) => {
    const fingerprint = baselineFingerprint(finding, index);
    // Decisions are recomputed against this baseline (and today's date), never carried over from a saved report.
    const { reviewDecision: _stale, ...f } = finding;
    void _stale;
    return { ...f, baselineFingerprint: fingerprint, baselineStatus: known.has(fingerprint) ? 'existing' as const : 'new' as const };
  });
  const findings = baseline.groupDecisions?.length ? applyGroupDecisions(baselined, baseline.groupDecisions, now) : baselined;
  const complete = new Set(report.pages.filter((p) => p.scanStatus === 'complete').flatMap((p) => [p.url, p.finalUrl]).map((url) => normalizeUrl(url) ?? url));
  const missing = baseline.findings.filter((f) => !current.has(f.fingerprint));
  // Engine errors make missing findings unassessed; absence is not evidence of a fix.
  const currentEngines = report.engines?.used ?? ['axe'];
  const comparable = (baseline.engines ?? ['axe']).every((engine) => currentEngines.includes(engine));
  const fixed = missing.filter((f) => comparable && !report.engines?.errored.length && complete.has(normalizeUrl(f.pageUrl) ?? f.pageUrl)).length;
  const summary = { new: findings.filter((f) => f.baselineStatus === 'new').length,
    existing: findings.filter((f) => f.baselineStatus === 'existing').length, fixed, unassessed: missing.length - fixed };
  const gating = gatingScanFindings(findings, report.failOn);
  const reviewed = report.failOn === 'none' ? 0 : gatingScanFindings((findings as ScanFinding[]).map((f) => ({ ...f, reviewDecision: undefined })), report.failOn).length - gating.length;
  return { ...report, findings, baseline: summary,
    verdict: report.verdict === 'ERROR' ? 'ERROR' : gating.length ? 'FAIL' : 'PASS',
    reason: report.verdict === 'ERROR' ? report.reason : report.failOn === 'none' ? 'Reporting only (--fail-on none).' : `${gating.length} new finding${gating.length === 1 ? '' : 's'} at or above ${report.failOn}.${reviewed ? ` ${reviewed} new finding${reviewed === 1 ? '' : 's'} excluded from the gate by review decisions (still listed below).` : ''}`,
    disclaimer: AUTOMATED_TESTING_DISCLAIMER };
}
