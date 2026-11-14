import { FORMAT_DISCLAIMER, type FormatFinding, type FormatReport } from '@/lib/report-formats';
import { baselineFingerprint } from '@/lib/scan/baseline';
import { pageUrlToRepoRelativePath } from '@/lib/export-sarif';

export type GitlabSeverity = 'info' | 'minor' | 'major' | 'critical' | 'blocker';
export type GitlabCodeQualityIssue = {
  description: string;
  check_name: string;
  fingerprint: string;
  severity: GitlabSeverity;
  location: { path: string; lines: { begin: number; end?: number } };
};

const severities = { critical: 'critical', serious: 'major', moderate: 'minor', minor: 'info' } as const;

function sourcePath(finding: FormatFinding): string | undefined {
  const file = finding.source?.file.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
  // GitLab paths must be repository-relative; invalid mappings use the virtual page path.
  if (!file || file.startsWith('/') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(file) || file.split('/').some((part) => part === '..' || !part)) return;
  return file;
}

/** GitLab's Code Climate subset: https://docs.gitlab.com/ci/testing/code_quality/#code-quality-report-format */
export function toGitlabCodeQuality(report: FormatReport): string {
  const issues = report.findings.map((finding, index): GitlabCodeQualityIssue => {
    const file = sourcePath(finding);
    const mapped = file && Number.isInteger(finding.source?.startLine) && finding.source!.startLine >= 1;
    const begin = mapped ? finding.source!.startLine : 1;
    const end = mapped && Number.isInteger(finding.source?.endLine) && finding.source!.endLine! >= begin
      ? finding.source!.endLine : undefined;
    return {
      description: `${finding.help} — URL: ${finding.pageUrl} — selector: ${finding.selector || '(unlocated)'} — ${FORMAT_DISCLAIMER}`,
      check_name: finding.ruleId,
      // Exact R18 identity, without hashing or using the legacy report fingerprint.
      fingerprint: finding.baselineIdentity ?? baselineFingerprint({ ...finding, fingerprint: finding.fingerprint ?? '', selectors: finding.selectors ?? [finding.selector] }, index),
      severity: finding.impact ? severities[finding.impact] : 'info',
      location: { path: mapped ? file : pageUrlToRepoRelativePath(finding.pageUrl), lines: { begin, ...(end !== undefined ? { end } : {}) } },
    };
  });
  issues.sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
  return `${JSON.stringify(issues, null, 2)}\n`;
}
