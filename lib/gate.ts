import type { CoverageComparison, Finding, Impact, Verdict } from '@/lib/types';

const RANK: Record<Impact, number> = {
  minor: 1,
  moderate: 2,
  serious: 3,
  critical: 4,
};

export function impactRank(impact: Impact | null): number {
  if (!impact) return 0;
  return RANK[impact];
}

export function meetsThreshold(impact: Impact | null, threshold: Impact | 'none'): boolean {
  return threshold !== 'none' && impactRank(impact) >= impactRank(threshold);
}

export function gatingFindings<T extends Finding>(findings: readonly T[], threshold: Impact | 'none'): T[] {
  return findings.filter((finding) => meetsThreshold(finding.impact, threshold));
}

export function gateVerdict(newFindings: readonly Finding[], threshold: Impact | 'none', coverage?: CoverageComparison): Verdict {
  if (gatingFindings(newFindings, threshold).length > 0) return 'FAIL';
  return coverage?.status === 'incomplete' ? 'INCOMPLETE' : 'PASS';
}

export function verdictReason(newFindings: readonly Finding[], threshold: Impact | 'none'): string {
  if (threshold === 'none') return 'Finding threshold is disabled (failOn: none).';
  const gating = gatingFindings(newFindings, threshold);
  if (gating.length === 0) {
    return `No new finding is at or above ${threshold}.`;
  }
  const rules = [...new Set(gating.map((finding) => finding.ruleId))];
  const noun = gating.length === 1 ? 'finding' : 'findings';
  return `${gating.length} new ${noun} at or above ${threshold}: ${rules.join(', ')}.`;
}
