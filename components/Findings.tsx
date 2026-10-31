'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { meetsThreshold } from '@/lib/gate';
import { statusLabel } from '@/lib/format';
import { safeHttpUrl } from '@/lib/url';
import { isImpact, type DiffedFinding, type GroupBy, type Impact } from '@/lib/types';
import { StandardsList } from '@/components/StandardsList';

function Disclosure({
  initiallyOpen,
  summary,
  children,
}: {
  initiallyOpen: boolean;
  summary: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (ref.current && initiallyOpen) ref.current.open = true;
  }, [initiallyOpen]);

  return (
    <details ref={ref}>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}

type FindingsProps = {
  groups: { key: string; label: string; findings: DiffedFinding[] }[];
  groupBy: GroupBy;
  threshold: Impact;
  onGroupBy: (groupBy: GroupBy) => void;
  onThreshold: (threshold: Impact) => void;
};

const IMPACTS: Impact[] = ['minor', 'moderate', 'serious', 'critical'];

export function Findings({ groups, groupBy, threshold, onGroupBy, onThreshold }: FindingsProps) {
  return (
    <section aria-labelledby="findings-heading">
      <h2 id="findings-heading">Findings</h2>
      <div className="controls">
        <div>
          <label htmlFor="impact-threshold">Impact threshold</label>
          <select
            id="impact-threshold"
            value={threshold}
            aria-describedby="threshold-help"
            onChange={(event) => {
              if (isImpact(event.target.value)) onThreshold(event.target.value);
            }}
          >
            {IMPACTS.map((impact) => (
              <option key={impact} value={impact}>
                {impact}
              </option>
            ))}
          </select>
          <p id="threshold-help" className="hint">
            The gate fails if any new finding has this impact or a higher one. Counts stay the full
            diff.
          </p>
        </div>
        <fieldset>
          <legend>Group by</legend>
          <label className="choice">
            <input
              type="radio"
              name="group-by"
              value="rule"
              checked={groupBy === 'rule'}
              onChange={() => onGroupBy('rule')}
            />
            Rule
          </label>
          <label className="choice">
            <input
              type="radio"
              name="group-by"
              value="page"
              checked={groupBy === 'page'}
              onChange={() => onGroupBy('page')}
            />
            Page
          </label>
        </fieldset>
      </div>
      {groups.length === 0 ? (
        <p>No findings to list.</p>
      ) : (
        groups.map((group) => {
          const gating = group.findings.some(
            (finding) => finding.status === 'new' && meetsThreshold(finding.impact, threshold),
          );
          return (
            <Disclosure
              key={group.key}
              initiallyOpen={gating}
              summary={
                <>
                  <span>{group.label}</span>
                  <span className="count-pill">
                    {group.findings.length} {group.findings.length === 1 ? 'finding' : 'findings'}
                  </span>
                </>
              }
            >
              <div className="table-scroll" tabIndex={0} role="region" aria-label={`${group.label} findings`}>
                <table>
                  <caption className="sr-only">{group.label} findings</caption>
                  <thead>
                    <tr>
                      <th scope="col">Status</th>
                      <th scope="col">Impact</th>
                      <th scope="col">Page</th>
                      <th scope="col">Selector</th>
                      <th scope="col">HTML snippet</th>
                      <th scope="col">Standards</th>
                      <th scope="col">Help</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.findings.map((finding) => {
                      const help = safeHttpUrl(finding.helpUrl);
                      return (
                        <tr key={`${finding.status}-${finding.fingerprint}`}>
                          <td className={`status status-${finding.status}`}>{statusLabel(finding.status)}</td>
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
                              <a href={help} target="_blank" rel="noopener noreferrer">
                                {finding.help}
                                <span className="sr-only"> (opens in a new tab)</span>
                              </a>
                            ) : (
                              finding.help
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Disclosure>
          );
        })
      )}
    </section>
  );
}
