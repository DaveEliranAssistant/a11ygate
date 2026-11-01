'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { HERO_HEADING, PRIVACY_NOTE, WAITLIST_MAILTO } from '@/lib/copy';
import { useScanModel } from '@/lib/store';
import { DisclaimerNote } from '@/components/DisclaimerNote';
import { Exports } from '@/components/Exports';
import { Findings } from '@/components/Findings';
import { ImportPanel } from '@/components/ImportPanel';
import { Summary } from '@/components/Summary';

export function Workspace() {
  const { scan, model, error, notice, setGroupBy, setThreshold } = useScanModel();
  const synthetic = Boolean(scan && (scan.currentSynthetic || scan.baselineSynthetic));
  const alertRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (error) alertRef.current?.focus();
  }, [error]);

  return (
    <main id="main" className="shell" tabIndex={-1}>
      <p className="kicker">Client-side · EU Accessibility Act evidence</p>
      <h1>{HERO_HEADING}</h1>
      <p className="lede">
        Point it at the axe-core JSON your Playwright job already writes. The diff, the gate, and
        the evidence report stay in this browser.
      </p>
      <div className="hero-actions">
        <a className="button button-ink" href={WAITLIST_MAILTO}>
          Join the waitlist
        </a>
      </div>
      <p className="privacy">
        {PRIVACY_NOTE} A11yGate has no account, no analytics, and no upload.{' '}
        <Link href="/privacy">Privacy details</Link>
      </p>
      <ImportPanel />
      {error ? (
        <p ref={alertRef} id="import-error" className="alert" role="alert" tabIndex={-1}>
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="note" role="status">
          {notice}
        </p>
      ) : null}
      {scan && model ? (
        <div className="panel">
          {synthetic ? (
            <p className="banner">Synthetic data. These fixtures are not a real audit.</p>
          ) : null}
          <p>
            <strong>{scan.projectName}</strong>
            {' · '}
            {model.pages.length} current {model.pages.length === 1 ? 'page' : 'pages'}
            {scan.baselineResults
              ? ` · ${model.baselinePages.length} baseline ${model.baselinePages.length === 1 ? 'page' : 'pages'}`
              : ' · no baseline'}
            {model.engines.length > 0 ? ` · axe-core ${model.engines.join(', ')}` : ''}
          </p>
          <Summary diff={model.diff} verdict={model.verdict} reason={model.reason} />
          <Findings
            groups={model.groups}
            groupBy={scan.groupBy}
            threshold={scan.threshold}
            onGroupBy={setGroupBy}
            onThreshold={setThreshold}
          />
          <Exports
            projectName={scan.projectName}
            verdict={model.verdict}
            threshold={scan.threshold}
            diff={model.diff}
            generatedAt={scan.generatedAt}
            reason={model.reason}
            currentResults={scan.currentResults}
          />
          <p>
            <Link className="button" href="/report">
              Open evidence report
            </Link>
          </p>
          <DisclaimerNote />
        </div>
      ) : null}
    </main>
  );
}
