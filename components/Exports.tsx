'use client';

import { baselineDocument, baselineReview } from '@/lib/export-baseline';
import { findingsToCsv } from '@/lib/export-csv';
import { prSummaryMarkdown } from '@/lib/export-markdown';
import { downloadText } from '@/lib/download';
import type { ManualCheck } from '@/lib/manual-evidence';
import type { AxeResults, DiffResult, Impact, Verdict } from '@/lib/types';

type ExportsProps = {
  projectName: string;
  verdict: Verdict;
  threshold: Impact;
  diff: DiffResult;
  generatedAt: string;
  reason: string;
  currentResults: AxeResults[];
  manualChecks?: ManualCheck[];
};

export function Exports({
  projectName,
  verdict,
  threshold,
  diff,
  generatedAt,
  reason,
  currentResults,
  manualChecks,
}: ExportsProps) {
  const summary = prSummaryMarkdown({
    projectName,
    verdict,
    threshold,
    diff,
    generatedAt,
    reason,
    manualChecks,
  });

  const review = baselineReview(currentResults, diff);
  return (
    <section aria-labelledby="exports-heading">
      <h2 id="exports-heading">Exports</h2>
      <p>Files are created in this browser. Nothing is uploaded.</p>
      <h3>Review baseline acceptance</h3>
      <p>{review.warning}</p>
      <p>{review.newlyAccepted.length} newly accepted; {review.retained.length} retained; {review.noLongerObserved.length} no longer observed; {review.unassessed.length} unassessed. No baseline is committed or approved automatically.</p>
      <ul>{review.acceptedFindings.map(f => <li key={f.fingerprint}><code>{f.fingerprint}</code> — {f.ruleId} ({f.impact ?? 'unspecified'}) on <code>{f.url}</code>, element <code>{f.selector}</code>; {f.status === 'new' ? 'newly accepted debt' : 'retained debt'}</li>)}</ul>
      {diff.coverage?.status === 'incomplete' ? <p className="alert">Baseline export is blocked until scan coverage is repaired.</p> : null}
      <div className="row-actions">
        <button
          type="button"
          disabled={diff.coverage?.status === 'incomplete'}
          onClick={() =>
            downloadText('a11ygate-baseline.json', baselineDocument(currentResults), 'application/json')
          }
        >
          Download new baseline JSON
        </button>
        <button type="button" onClick={() => downloadText('a11ygate-baseline-review.json', JSON.stringify(review, null, 2), 'application/json')}>Download baseline acceptance review</button>
        <button
          type="button"
          onClick={() => downloadText('a11ygate-pr-summary.md', summary, 'text/markdown')}
        >
          Download Markdown PR summary
        </button>
        <button
          type="button"
          onClick={() => downloadText('a11ygate-findings.csv', findingsToCsv(diff.all), 'text/csv')}
        >
          Download CSV of findings
        </button>
      </div>
    </section>
  );
}
