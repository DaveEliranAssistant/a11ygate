import type { DiffedFinding, DiffResult, Finding } from '@/lib/types';

function byLocation(a: Finding, b: Finding): number {
  return (
    a.path.localeCompare(b.path) ||
    a.ruleId.localeCompare(b.ruleId) ||
    a.selector.localeCompare(b.selector)
  );
}

function indexByFingerprint(findings: readonly Finding[]): Map<string, Finding> {
  const indexed = new Map<string, Finding>();
  for (const finding of findings) {
    if (!indexed.has(finding.fingerprint)) indexed.set(finding.fingerprint, finding);
  }
  return indexed;
}

/**
 * A missing baseline treats every current finding as new.
 * A finding in both runs stays open and keeps the current run's details.
 */
export function diffScans(current: readonly Finding[], baseline: readonly Finding[] | null): DiffResult {
  const base = indexByFingerprint(baseline ?? []);
  const next = indexByFingerprint(current);

  const newFindings: DiffedFinding[] = [];
  const stillOpen: DiffedFinding[] = [];
  for (const finding of next.values()) {
    if (base.has(finding.fingerprint)) {
      stillOpen.push({ ...finding, status: 'still-open' });
    } else {
      newFindings.push({ ...finding, status: 'new' });
    }
  }

  const fixedFindings: DiffedFinding[] = [];
  for (const finding of base.values()) {
    if (!next.has(finding.fingerprint)) {
      fixedFindings.push({ ...finding, status: 'fixed' });
    }
  }

  newFindings.sort(byLocation);
  fixedFindings.sort(byLocation);
  stillOpen.sort(byLocation);

  const statusOrder = { new: 0, fixed: 1, 'still-open': 2, unassessed: 3 } as const;
  const all = [...newFindings, ...fixedFindings, ...stillOpen].sort(
    (a, b) => statusOrder[a.status] - statusOrder[b.status] || byLocation(a, b),
  );

  return { newFindings, fixedFindings, stillOpen, all };
}
