import { impactRank } from '@/lib/gate';
import { isImpact, type DiffedFinding, type FindingGroup, type GroupKey } from '@/lib/types';

function groupLabel(key: GroupKey, value: string): string {
  if (key === 'impact' && value === 'unknown') return 'unknown impact';
  return value;
}

export function groupFindings(findings: readonly DiffedFinding[], by: GroupKey): FindingGroup[] {
  const groups = new Map<string, DiffedFinding[]>();
  for (const finding of findings) {
    const key =
      by === 'rule' ? finding.ruleId : by === 'page' ? finding.path : (finding.impact ?? 'unknown');
    const existing = groups.get(key);
    if (existing) existing.push(finding);
    else groups.set(key, [finding]);
  }

  const grouped = [...groups.entries()].map(([key, items]) => ({
    key,
    label: groupLabel(by, key),
    findings: items,
  }));

  if (by === 'impact') {
    const rank = (key: string) => (isImpact(key) ? impactRank(key) : 0);
    grouped.sort((a, b) => rank(b.key) - rank(a.key));
  } else {
    grouped.sort((a, b) => a.label.localeCompare(b.label));
  }

  return grouped;
}
