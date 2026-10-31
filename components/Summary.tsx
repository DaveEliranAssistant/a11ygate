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
          className={verdict === 'FAIL' ? 'verdict fail' : 'verdict pass'}
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
    </section>
  );
}
