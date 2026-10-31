'use client';

import { useState } from 'react';
import { statementMarkdown } from '@/lib/statement';
import type { Impact, Verdict } from '@/lib/types';

type StatementDraftProps = {
  projectName: string;
  verdict: Verdict;
  threshold: Impact;
  counts: {
    newCount: number;
    fixedCount: number;
    stillOpen: number;
  };
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function StatementDraft({ projectName, verdict, threshold, counts }: StatementDraftProps) {
  const [organisation, setOrganisation] = useState('');
  const [email, setEmail] = useState('');
  const [date, setDate] = useState('');
  const [copyMessage, setCopyMessage] = useState('');

  const organisationOk = organisation.trim().length > 0;
  const emailOk = EMAIL_PATTERN.test(email.trim());
  const dateOk = DATE_PATTERN.test(date.trim());
  const ready = organisationOk && emailOk && dateOk;
  const markdown = ready
    ? statementMarkdown({
        organisation,
        email,
        date,
        projectName,
        verdict,
        threshold,
        counts,
      })
    : '';

  return (
    <section aria-labelledby="statement-heading">
      <h2 id="statement-heading">Accessibility statement draft</h2>
      <p>
        Organisation, contact email, and date stay in these fields. They are not saved and they are
        not sent anywhere.
      </p>
      <div>
        <label htmlFor="organisation">Organisation name</label>
        <input
          id="organisation"
          name="organisation"
          type="text"
          autoComplete="organization"
          value={organisation}
          onChange={(event) => setOrganisation(event.target.value)}
        />
        <label htmlFor="contact-email">Contact email</label>
        <input
          id="contact-email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          aria-invalid={email.length > 0 && !emailOk}
          onChange={(event) => setEmail(event.target.value)}
        />
        <label htmlFor="statement-date">Date</label>
        <input
          id="statement-date"
          name="date"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-describedby="date-hint"
          aria-invalid={date.length > 0 && !dateOk}
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
        <p id="date-hint" className="hint">
          Type the date as YYYY-MM-DD.
        </p>
        <div className="row-actions">
          <button
            type="button"
            className="primary"
            disabled={!ready}
            onClick={() => {
              void navigator.clipboard.writeText(markdown).then(
                () => setCopyMessage('Markdown copied.'),
                () =>
                  setCopyMessage('Clipboard is unavailable. Select the Markdown below and copy it.'),
              );
            }}
          >
            Copy as Markdown
          </button>
        </div>
        <p role="status">{copyMessage}</p>
        {ready ? (
          <>
            <label htmlFor="statement-markdown">Markdown preview</label>
            <textarea id="statement-markdown" readOnly value={markdown} rows={16} />
          </>
        ) : (
          <p>Enter an organisation name, a contact email, and a date to generate the draft.</p>
        )}
      </div>
    </section>
  );
}
