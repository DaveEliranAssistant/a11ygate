import { DISCLAIMER, LEGAL_DISCLAIMER } from '@/lib/copy';

export function DisclaimerNote() {
  return (
    <aside className="disclaimer" aria-labelledby="disclaimer-heading">
      <h2 id="disclaimer-heading">Disclaimer</h2>
      <p>
        {DISCLAIMER} {LEGAL_DISCLAIMER}
      </p>
    </aside>
  );
}
