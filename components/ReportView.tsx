'use client';

import Link from 'next/link';
import { formatTimestamp, plural, statusLabel } from '@/lib/format';
import { safeHttpUrl } from '@/lib/url';
import { findingGuidance } from '@/lib/guidance';
import { useScanModel } from '@/lib/store';
import { DisclaimerNote } from '@/components/DisclaimerNote';
import { StandardsList } from '@/components/StandardsList';
import { StatementDraft } from '@/components/StatementDraft';
import { Summary } from '@/components/Summary';
import { ManualEvidence } from '@/components/ManualEvidence';

export function ReportView() {
  const { ready, scan, model, setManualChecks } = useScanModel();

  if (!scan || !model) {
    return (
      <main id="main" className="shell" tabIndex={-1}>
        <h1>EAA evidence report</h1>
        <p>{ready ? 'No scan is loaded. Load results on the workspace first.' : 'Checking this browser for a saved scan.'}</p>
        <DisclaimerNote />
        <p>
          <Link href="/">Back to workspace</Link>
        </p>
      </main>
    );
  }

  const synthetic = scan.currentSynthetic || scan.baselineSynthetic;

  return (
    <main id="main" className="shell" tabIndex={-1}>
      <div className="report-head">
        <div>
          <p className="kicker">A11yGate evidence report</p>
          <h1>EAA evidence report</h1>
        </div>
        <button type="button" className="no-print" onClick={() => window.print()}>
          Print or save as PDF
        </button>
      </div>
      {synthetic ? (
        <p className="banner">Synthetic data. Demo Shop is not a real audit.</p>
      ) : null}
      <DisclaimerNote />
      <section aria-labelledby="scope-heading">
        <h2 id="scope-heading">Scope</h2>
        <ul className="meta">
          <li>
            <strong>Scope:</strong> {scan.projectName}. {plural(model.pages.length, 'page')} in the
            current run.
          </li>
          <li>
            <strong>Generated:</strong> {formatTimestamp(scan.generatedAt)} ({scan.generatedAt})
          </li>
          <li>
            <strong>axe-core engine:</strong> {model.engines.join(', ') || 'unknown'}
          </li>
          <li>
            <strong>Baseline:</strong>{' '}
            {scan.baselineResults
              ? `${plural(model.baselinePages.length, 'page')} compared.`
              : 'None. Every current finding is treated as new.'}
          </li>
        </ul>
        <h3>Pages</h3>
        <ul>
          {model.pages.map((page) => (
            <li key={`${page.url}-${page.timestamp}`}>
              <code>{page.url}</code> — scanned {formatTimestamp(page.timestamp)}
            </li>
          ))}
        </ul>
      </section>
      <Summary diff={model.diff} verdict={model.verdict} reason={model.reason} />
      <p className="hint">Impact threshold: {scan.threshold}.</p>
      <section aria-labelledby="mapped-heading">
        <h2 id="mapped-heading">Mapped findings</h2>
        <p>
          Standards mapping needs expert review before it is used as compliance evidence. Tags with
          no success criterion are shown as best practice.
        </p>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Mapped findings table">
          <table>
            <caption className="sr-only">Mapped findings for {scan.projectName}</caption>
            <thead>
              <tr>
                <th scope="col">Status</th>
                <th scope="col">Rule</th>
                <th scope="col">Impact</th>
                <th scope="col">Page</th>
                <th scope="col">Selector</th>
                <th scope="col">HTML snippet</th>
                <th scope="col">Standards</th>
                <th scope="col">Help</th>
              </tr>
            </thead>
            <tbody>
              {model.diff.all.map((finding) => {
                const help = safeHttpUrl(finding.helpUrl);
                return (
                  <tr key={`${finding.status}-${finding.fingerprint}`}>
                    <td className={`status status-${finding.status}`}>{statusLabel(finding.status)}</td>
                    <td>{finding.ruleId}</td>
                    <td>{finding.impact ?? 'unspecified'}</td>
                    <td>
                      <code>{finding.path}</code>
                    </td>
                    <td>
                      <code>{finding.selector}</code>
                    </td>
                    <td>
                      <code>{finding.html}</code>
                    </td>
                    <td>
                      <StandardsList tags={finding.tags} />
                    </td>
                    <td>
                      {help ? (
                        <a href={help}>{finding.help}</a>
                      ) : (
                        finding.help
                      )}
                      <p><strong>User impact:</strong> {findingGuidance(finding).userImpact}</p>
                      <p><strong>Remediation:</strong> {findingGuidance(finding).remediation}</p>
                      <p><strong>Verification:</strong> {findingGuidance(finding).verification.join(' ')}</p>
                      {finding.assessmentReason ? <p>{finding.assessmentReason}</p> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section aria-labelledby="manual-heading">
        <h2 id="manual-heading">Manual checks</h2>
        <p>
          A11yGate does not perform these checks. Record the result beside the printed report.
        </p>
        <ul className="checklist">
          <li>
            <strong>Keyboard.</strong> Every action can be reached and operated without a pointer.
            Record what failed.
          </li>
          <li>
            <strong>Screen reader.</strong> Names, roles, and states match what a person needs.
            Record the reader and the browser.
          </li>
          <li>
            <strong>Focus order.</strong> Focus moves in an order that matches the meaning of the
            page. Record any traps or skips.
          </li>
        </ul>
      </section>
      <ManualEvidence checks={scan.manualChecks ?? []} onChange={setManualChecks} />
      <StatementDraft
        projectName={scan.projectName}
        verdict={model.verdict}
        threshold={scan.threshold}
        counts={{
          newCount: model.diff.newFindings.length,
          fixedCount: model.diff.fixedFindings.length,
          stillOpen: model.diff.stillOpen.length,
        }}
      />
    </main>
  );
}
