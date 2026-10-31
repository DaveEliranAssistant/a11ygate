'use client';

import { baselineDocument } from '@/lib/export-baseline';
import { findingsToCsv } from '@/lib/export-csv';
import { prSummaryMarkdown } from '@/lib/export-markdown';
import { downloadText } from '@/lib/download';
import type { AxeResults, DiffResult, Impact, Verdict } from '@/lib/types';

type ExportsProps = {
  projectName: string;
  verdict: Verdict;
  threshold: Impact;
  diff: DiffResult;
  generatedAt: string;
  reason: string;
  currentResults: AxeResults[];
};

export function Exports({
  projectName,
  verdict,
  threshold,
  diff,
  generatedAt,
  reason,
  currentResults,
}: ExportsProps) {
  const summary = prSummaryMarkdown({
    projectName,
    verdict,
    threshold,
    diff,
    generatedAt,
    reason,
  });

  return (
    <section aria-labelledby="exports-heading">
      <h2 id="exports-heading">Exports</h2>
      <p>Files are created in this browser. Nothing is uploaded.</p>
      <div className="row-actions">
        <button
          type="button"
          onClick={() =>
            downloadText('a11ygate-baseline.json', baselineDocument(currentResults), 'application/json')
          }
        >
          Download new baseline JSON
        </button>
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
