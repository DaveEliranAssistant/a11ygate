import type { Agreement } from '@/lib/scan/engines/dedupe';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { lookupStandards, type Criterion } from '@/lib/mapping';
import { baselineFingerprint } from '@/lib/scan/baseline';
import { findingsFromResults } from '@/lib/parse';
import { toScanFinding, type ScanFinding, type ScanReport } from '@/lib/scan/report';
import type { AxeResults, DiffedFinding, Impact, Verdict } from '@/lib/types';

export const REPORT_FORMATS = ['junit', 'sarif', 'json', 'md', 'gitlab-codequality'] as const;

export type ReportFormat = (typeof REPORT_FORMATS)[number];

export type ReportCommand = 'scan' | 'ci';

export type SourceLocation = {
  file: string;
  startLine: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
};

export type FormatWcag = Pick<Criterion, 'number' | 'name' | 'level' | 'wcag'>;

export type FormatFinding = Partial<Agreement> & {
  baselineStatus?: 'new' | 'existing';
  ruleId: string;
  impact: Impact | null;
  help: string;
  helpUrl: string;
  tags: string[];
  wcag: FormatWcag[];
  pageUrl: string;
  selector: string;
  /** Original selector components used by the R18 baseline identity. */
  selectors?: string[];
  html: string;
  fingerprint?: string;
  /** Exact R18 baseline identity, independent of legacy exporter fingerprints. */
  baselineIdentity?: string;
  status?: string;
  source?: SourceLocation;
};

export type FormatReport = {
  baseline?: ScanReport['baseline'];
  engines?: ScanReport['engines'];
  toolName: 'A11yGate';
  version: string;
  generatedAt: string;
  command: ReportCommand;
  verdict: string;
  reason: string;
  startUrl?: string;
  projectName?: string;
  pages: string[];
  findings: FormatFinding[];
};

export function isReportFormat(value: string): value is ReportFormat {
  return (REPORT_FORMATS as readonly string[]).includes(value);
}

export function parseFormatList(value: string): { ok: true; formats: ReportFormat[] } | { ok: false; error: string } {
  const parts = value.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length === 0) return { ok: false, error: '--format needs a value. Use junit, sarif, json, md, or gitlab-codequality.' };
  const formats: ReportFormat[] = [];
  for (const part of parts) {
    if (!isReportFormat(part)) {
      return { ok: false, error: `Unknown format "${part}". Use junit, sarif, json, md, or gitlab-codequality.` };
    }
    if (!formats.includes(part)) formats.push(part);
  }
  return { ok: true, formats };
}

export function mergeFormats(existing: readonly ReportFormat[], incoming: readonly ReportFormat[]): ReportFormat[] {
  const formats = [...existing];
  for (const format of incoming) {
    if (!formats.includes(format)) formats.push(format);
  }
  return formats;
}

export function formatFileName(command: ReportCommand, format: ReportFormat): string {
  const prefix = command === 'scan' ? 'a11ygate-scan' : 'a11ygate';
  if (format === 'junit') return `${prefix}.junit.xml`;
  if (format === 'sarif') return `${prefix}.sarif`;
  if (format === 'gitlab-codequality') return `${prefix}.gitlab-codequality.json`;
  if (format === 'json') return `${prefix}.json`;
  return `${prefix}.md`;
}

export function formatRequiresOutDir(formats: readonly ReportFormat[]): boolean {
  return formats.length > 0;
}

export function wcagFromTags(tags: readonly string[]): FormatWcag[] {
  return lookupStandards(tags).flatMap((hit) =>
    hit.kind === 'criterion' ? [{ number: hit.number, name: hit.name, level: hit.level, wcag: hit.wcag }] : [],
  );
}

export function formatFindingFromScan(finding: ScanFinding, occurrence = 0): FormatFinding {
  return {
    ruleId: finding.ruleId,
    impact: finding.impact,
    help: finding.help,
    helpUrl: finding.helpUrl,
    tags: finding.tags,
    wcag: finding.wcag.map((item) => ({ number: item.number, name: item.name, level: item.level, wcag: item.wcag })),
    pageUrl: finding.pageUrl,
    selector: finding.selector,
    selectors: finding.selectors,
    html: finding.html,
    fingerprint: finding.baselineFingerprint ?? finding.fingerprint,
    baselineIdentity: baselineFingerprint(finding, occurrence),
    ...(finding.baselineStatus ? { baselineStatus: finding.baselineStatus } : {}),
    ...(finding.engines ? { engines: finding.engines, confidence: finding.confidence } : {}),
  };
}

export function formatReportFromScan(report: ScanReport): FormatReport {
  return {
    toolName: 'A11yGate',
    version: report.version,
    generatedAt: report.scannedAt,
    command: 'scan',
    ...(report.baseline ? { baseline: report.baseline } : {}),
    ...(report.engines ? { engines: report.engines } : {}),
    verdict: report.verdict,
    reason: report.reason,
    startUrl: report.startUrl,
    pages: report.pages.filter((page) => page.scanStatus === 'complete').map((page) => page.url),
    findings: report.findings.map(formatFindingFromScan),
  };
}

export function formatFindingFromDiffed(finding: DiffedFinding): FormatFinding {
  return {
    ruleId: finding.ruleId,
    impact: finding.impact,
    help: finding.help,
    helpUrl: finding.helpUrl,
    tags: finding.tags,
    wcag: wcagFromTags(finding.tags),
    pageUrl: finding.url,
    selector: finding.selector,
    html: finding.html,
    fingerprint: finding.fingerprint,
    status: finding.status,
  };
}

export function formatReportFromGate(input: {
  version: string;
  generatedAt: string;
  projectName: string;
  verdict: Verdict;
  reason: string;
  currentResults: AxeResults[];
  findings: readonly DiffedFinding[];
}): FormatReport {
  const pages = [...new Set(input.currentResults.map((result) => result.url))];
  const statusByFingerprint = new Map(input.findings.map((finding) => [finding.fingerprint, finding.status]));
  // Current violations only; status is copied from the gate diff when present.
  const resultsByUrl = new Map(input.currentResults.map((result) => [result.url, result]));
  const findings = findingsFromResults(input.currentResults).map((finding, index) => {
    const scanFinding = toScanFinding(finding, resultsByUrl.get(finding.url)!);
    return {
      ...formatFindingFromDiffed({ ...finding, status: statusByFingerprint.get(finding.fingerprint) ?? 'new' }),
      baselineIdentity: baselineFingerprint(scanFinding, index),
    };
  });
  return {
    toolName: 'A11yGate',
    version: input.version,
    generatedAt: input.generatedAt,
    command: 'ci',
    verdict: input.verdict,
    reason: input.reason,
    projectName: input.projectName,
    pages,
    findings,
  };
}

export const FORMAT_DISCLAIMER = AUTOMATED_TESTING_DISCLAIMER;
