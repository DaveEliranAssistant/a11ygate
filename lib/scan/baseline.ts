import { normalizeLocator } from './engines/dedupe';
import { normalizeUrl } from './url';
import { gatingScanFindings, type ScanFinding, type ScanReport } from './report';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';

export type BaselineEntry = { fingerprint: string; pageUrl: string; ruleId: string; selector: string };
export type FingerprintBaseline = {
  kind: 'a11ygate-fingerprint-baseline';
  schemaVersion: 1;
  disclaimer: string;
  engines?: string[];
  findings: BaselineEntry[];
};
export type BaselineSummary = { new: number; existing: number; fixed: number; unassessed: number };

/** R12 identity: page + canonical element + SC (or unmapped engine/rule).
 * Legacy axe reports retain rule identity; HTML, severity and timestamps are excluded.
 */
export function baselineFingerprint(finding: ScanFinding, occurrence = 0): string {
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
  const b = value as Partial<FingerprintBaseline> | null;
  if (!b || b.kind !== 'a11ygate-fingerprint-baseline' || b.schemaVersion !== 1 || !Array.isArray(b.findings) ||
      b.findings.some((f) => !f || ['fingerprint', 'pageUrl', 'ruleId', 'selector'].some((k) => typeof f[k as keyof BaselineEntry] !== 'string'))) {
    throw new Error('Expected an A11yGate fingerprint baseline (kind a11ygate-fingerprint-baseline, schemaVersion 1). Axe JSON baselines belong to a11ygate [ci] --baseline.');
  }
  if (b.engines !== undefined && (!Array.isArray(b.engines) || b.engines.some((engine) => typeof engine !== 'string'))) throw new Error('Invalid baseline engine coverage.');
  if (new Set(b.findings.map((f) => f.fingerprint)).size !== b.findings.length) throw new Error('Duplicate baseline fingerprints.');
  return b as FingerprintBaseline;
}

export function parseScanReport(value: unknown): ScanReport {
  const report = value as ScanReport | null;
  if (!report || report.kind !== 'site-scan' || report.schemaVersion !== 1 || !Array.isArray(report.findings) || !Array.isArray(report.pages) || !Array.isArray(report.results)) {
    throw new Error('Expected an A11yGate site-scan JSON report.');
  }
  // Validate identity fields before consuming untrusted JSON.
  for (const f of report.findings) {
    if (typeof f.pageUrl !== 'string' || typeof f.ruleId !== 'string' || typeof f.selector !== 'string' ||
        !Array.isArray(f.selectors) || f.selectors.some((s) => typeof s !== 'string') || !Array.isArray(f.wcag)) throw new Error('Invalid scan finding.');
    baselineFingerprint(f);
  }
  return report;
}

export function applyFingerprintBaseline(report: ScanReport, baseline: FingerprintBaseline): ScanReport {
  const known = new Set(baseline.findings.map((f) => f.fingerprint));
  const current = new Set(report.findings.map(baselineFingerprint));
  const findings = report.findings.map((f, index) => {
    const fingerprint = baselineFingerprint(f, index);
    return { ...f, baselineFingerprint: fingerprint, baselineStatus: known.has(fingerprint) ? 'existing' as const : 'new' as const };
  });
  const complete = new Set(report.pages.filter((p) => p.scanStatus === 'complete').flatMap((p) => [p.url, p.finalUrl]).map((url) => normalizeUrl(url) ?? url));
  const missing = baseline.findings.filter((f) => !current.has(f.fingerprint));
  // Engine errors make missing findings unassessed; absence is not evidence of a fix.
  const currentEngines = report.engines?.used ?? ['axe'];
  const comparable = (baseline.engines ?? ['axe']).every((engine) => currentEngines.includes(engine));
  const fixed = missing.filter((f) => comparable && !report.engines?.errored.length && complete.has(normalizeUrl(f.pageUrl) ?? f.pageUrl)).length;
  const summary = { new: findings.filter((f) => f.baselineStatus === 'new').length,
    existing: findings.filter((f) => f.baselineStatus === 'existing').length, fixed, unassessed: missing.length - fixed };
  const gating = gatingScanFindings(findings, report.failOn);
  return { ...report, findings, baseline: summary,
    verdict: report.verdict === 'ERROR' ? 'ERROR' : gating.length ? 'FAIL' : 'PASS',
    reason: report.verdict === 'ERROR' ? report.reason : report.failOn === 'none' ? 'Reporting only (--fail-on none).' : `${gating.length} new finding${gating.length === 1 ? '' : 's'} at or above ${report.failOn}.`,
    disclaimer: AUTOMATED_TESTING_DISCLAIMER };
}
