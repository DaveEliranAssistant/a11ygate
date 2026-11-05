import type { DiffResult, Verdict } from '@/lib/types';

type SummaryProps = {
  diff: DiffResult;
  verdict: Verdict;
  reason: string;
};

export function Summary({ diff, verdict, reason }: SummaryProps) {
  return (
    <section aria-labelledby="result-heading">
      <h2 id="result-heading">Result</h2>
      <ul className="summary">
        <li>
          <p className="kicker">New</p>
          <p className="figure" data-testid="count-new">
            {diff.newFindings.length}
          </p>
        </li>
        <li>
          <p className="kicker">Fixed</p>
          <p className="figure" data-testid="count-fixed">
            {diff.fixedFindings.length}
          </p>
        </li>
        <li>
          <p className="kicker">Still open</p>
          <p className="figure" data-testid="count-still-open">
            {diff.stillOpen.length}
          </p>
        </li>
        <li
          className={verdict === 'PASS' ? 'verdict pass' : 'verdict fail'}
          aria-live="polite"
          aria-atomic="true"
        >
          <p className="kicker">Verdict</p>
          <p className="figure" data-testid="verdict">
            {verdict}
          </p>
          <p className="reason">{reason}</p>
        </li>
      </ul>
      <h3>Scan coverage</h3>
      <p>Coverage: <strong>{diff.coverage?.status ?? 'unverified'}</strong>. Previously reported but now unassessed: {diff.unassessed?.length ?? 0}. Existing debt remains visible above; PASS is only a regression gate, not an accessibility clearance.</p>
      <ul>{diff.coverage?.issues.map((issue, i) => <li key={i}><code>{issue.code}</code>: <code>{issue.page}</code> — {issue.detail}</li>)}</ul>
      <h4>Unassessed scope</h4>
      <ul>{(diff.coverage?.unassessedScope ?? ['Scan coverage was not supplied.']).map(item => <li key={item}>{item}</li>)}</ul>
    </section>
  );
}
