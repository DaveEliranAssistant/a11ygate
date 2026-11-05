import type { AxeResults, DiffResult } from '@/lib/types';

export function baselineReview(results: readonly AxeResults[], diff: DiffResult) {
  return {schemaVersion:1,approval:'review-required' as const,acceptedFindings:[...diff.newFindings,...diff.stillOpen],newlyAccepted:diff.newFindings,retained:diff.stillOpen,noLongerObserved:diff.fixedFindings,unassessed:diff.unassessed??[],pages:results.map(r=>r.url),coverage:diff.coverage,warning:'This proposal accepts the listed current findings as existing debt, not resolved issues. Review and commit separately; no approval or certification is implied.'};
}

export function baselineDocument(results: readonly AxeResults[]): string {
  return `${JSON.stringify(results, null, 2)}\n`;
}
