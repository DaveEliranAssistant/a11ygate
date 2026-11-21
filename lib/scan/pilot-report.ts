import { formatAnnualPrice, pricing } from '@/lib/billing';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { buildTrend, chartSvg, type TrendRunInput } from '@/lib/trend';
import { IMPACTS } from '@/lib/types';
import { applyFingerprintBaseline, createFingerprintBaseline } from './baseline';
import { esc, REPORT_V2_STYLE } from './report-html-v2';
import { normalizeUrl } from './url';

export type PilotCriteria = {
  pilot: { customer: string; startDate: string; decisionDate: string };
  criteria: {
    gateRunsOnEveryPrToMain: boolean;
    targetBranch?: string;
    baselineCreated: boolean;
    maxUnreviewedNewSeriousOrCriticalMergedAfterWeek2: number;
    pagesOrFlowsCovered: { min: number; list?: string[] };
    evidencePackProduced: boolean;
  };
};

type EvidenceWindow = { targetBranch: string; from: string; through: string };
export type PilotEvidence = {
  baselineCommitted?: boolean;
  evidenceDeliveredOn?: string;
  gate?: EvidenceWindow & { required: boolean; pullRequests: number; gateRuns: number };
  postWeekTwoMerges?: EvidenceWindow & { unreviewedNewSeriousOrCritical: number };
};
export type PilotPack = TrendRunInput & { pilotEvidence?: PilotEvidence };

export function isIsoDay(value: string): boolean {
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

const scanPath = (pack: PilotPack) => `${pack.source}!/scan/a11ygate-scan.json`;
const evidencePath = (pack: PilotPack, field: string) => `${pack.source}!/scan/a11ygate-pilot-evidence.json#${field}`;

function evaluateCriteria(config: PilotCriteria, latest: PilotPack, criteriaPath: string) {
  const { pilot, criteria } = config;
  const evidence = latest.pilotEvidence;
  const branch = criteria.targetBranch ?? 'main';
  const { gate, postWeekTwoMerges, baselineCommitted, evidenceDeliveredOn } = evidence ?? {};
  const day = new Date(pilot.startDate);
  day.setUTCDate(day.getUTCDate() + 14);
  const weekThree = day.toISOString().slice(0, 10);
  const matchesWindow = (window: EvidenceWindow | undefined, from: string) =>
    window?.targetBranch === branch && window.from === from && window.through === pilot.decisionDate;

  const completePages = latest.report.pages.filter(page => page.scanStatus === 'complete');
  const pages = new Set<string>();
  const flows = new Set<string>();
  const flowNames = new Set<string>();
  for (const page of completePages) {
    const url = URL.canParse(page.url) ? new URL(page.url) : undefined;
    if (url?.hash) {
      flows.add(url.href);
      const name = url.hash.slice(1);
      try { flowNames.add(decodeURIComponent(name)); } catch { flowNames.add(name); }
    } else {
      const finalUrl = page.finalUrl || page.url;
      pages.add(normalizeUrl(finalUrl) ?? finalUrl);
    }
  }
  const routes = new Set([...pages].flatMap(url => URL.canParse(url) ? [new URL(url).pathname] : []));
  const requiredPages = criteria.pagesOrFlowsCovered;
  const missingRoutes = (requiredPages.list ?? []).filter(name => name.startsWith('/') && !routes.has(name));
  const unverifiedFlows = (requiredPages.list ?? []).filter(name =>
    !name.startsWith('/') && !flows.has(name) && !flowNames.has(name)
    && !(URL.canParse(name) && !new URL(name).hash && pages.has(normalizeUrl(name) ?? name)));
  const hasPageEvidence = latest.report.pages.some(page => page.scanStatus != null);
  const measuredCount = pages.size + flows.size;
  const coverage = measuredCount >= requiredPages.min && !missingRoutes.length
    ? (unverifiedFlows.length ? null : true)
    : (hasPageEvidence ? false : null);
  const coverageDetail = `${pages.size} distinct completed pages and ${flows.size} completed interaction states; target ${requiredPages.min}.`
    + (missingRoutes.length ? ` Paths absent from completed scans: ${missingRoutes.join(', ')}.` : '')
    + (unverifiedFlows.length ? ` Named flows without a recorded match: ${unverifiedFlows.join(', ')}.` : '');

  const rows: { label: string; result: boolean | null; detail: string; path: string }[] = [];
  const add = (
    label: string, selected: boolean, result: boolean | null, detail: string, path: string,
  ) => rows.push({ label, result: selected ? result : null, detail: selected ? detail : 'Target was not selected at kickoff.',
    path: selected ? path : criteriaPath });
  const fullGate = gate && matchesWindow(gate, pilot.startDate);
  add(`Required gate runs on every PR to ${branch}`, criteria.gateRunsOnEveryPrToMain,
    fullGate ? (gate.required && gate.pullRequests === 0 ? null : gate.required && gate.gateRuns === gate.pullRequests) : null,
    fullGate ? `${gate.gateRuns} of ${gate.pullRequests} PRs had a gate run. Required check recorded: ${gate.required ? 'yes' : 'no'}.`
      : 'A complete PR history and required-check record for the target branch and pilot dates are needed.',
    evidencePath(latest, 'gate'));
  add('Fingerprint baseline committed', criteria.baselineCreated, baselineCommitted ?? null,
    baselineCommitted === undefined ? 'Repository confirmation is missing.' : `Committed baseline recorded: ${baselineCommitted ? 'yes' : 'no'}.`,
    evidencePath(latest, 'baselineCommitted'));
  const fullMerges = postWeekTwoMerges && matchesWindow(postWeekTwoMerges, weekThree);
  const mergeCount = fullMerges ? postWeekTwoMerges.unreviewedNewSeriousOrCritical : undefined;
  const max = criteria.maxUnreviewedNewSeriousOrCriticalMergedAfterWeek2;
  add('Unreviewed new serious or critical findings merged after week 2', true,
    mergeCount === undefined ? null : mergeCount <= max,
    mergeCount === undefined ? 'Complete merge and review records for the post-week-two window are needed.'
      : `${mergeCount} recorded; maximum ${max}.`,
    evidencePath(latest, 'postWeekTwoMerges'));
  add('Pages or flows covered', true, coverage, coverageDetail, scanPath(latest));
  add('Evidence pack produced and handed to customer before the decision date', criteria.evidencePackProduced,
    evidenceDeliveredOn === undefined ? null : evidenceDeliveredOn >= pilot.startDate && evidenceDeliveredOn < pilot.decisionDate,
    evidenceDeliveredOn === undefined ? 'The pack is available locally. A handoff date is needed.'
      : `Handoff recorded on ${evidenceDeliveredOn}. Decision date ${pilot.decisionDate}.`,
    evidencePath(latest, 'evidenceDeliveredOn'));
  return rows;
}

function document(title: string, body: string, styles = '') {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${esc(title)}</title>
<style>
${REPORT_V2_STYLE}
code, a { overflow-wrap: anywhere }
tbody tr, figure { break-inside: avoid }
figure { margin: 0 }
svg .grid { stroke: #999 }
svg .axis { fill: var(--muted); font-size: 11px }
svg .value { fill: var(--text); font-size: 12px }
svg .s-existing { fill: #2a78d6 }
svg .s-new { fill: #eb6834 }
svg .hit { fill: transparent }
${styles}
</style>
</head>
<body>
<header>
<h1>${esc(title)}</h1>
<p class="disclaimer">${AUTOMATED_TESTING_DISCLAIMER}</p>
</header>
<main>
${body}
</main>
</body>
</html>
`;
}

function table(caption: string, headers: string[], rows: (string | number)[][]) {
  return `<table><caption>${caption}</caption><thead><tr>${headers.map(label => `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>
${rows.map(([label, ...cells]) => `<tr><th scope="row">${label}</th>${cells.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('\n')}
</tbody></table>`;
}

const quoteDraftBanner = 'DRAFT — needs Eliran review before sending';

export function pilotResultsHtml(
  kickoff: PilotPack, latest: PilotPack, packs: PilotPack[], config: PilotCriteria, criteriaPath: string, customer: string,
): string {
  const trend = buildTrend(packs, 'commit');
  const baseline = createFingerprintBaseline(kickoff.report);
  const current = createFingerprintBaseline(latest.report);
  const known = new Set(baseline.findings.map(finding => finding.fingerprint));
  const added = current.findings.filter(finding => !known.has(finding.fingerprint)).length;
  const { fixed, unassessed } = applyFingerprintBaseline(latest.report, baseline).baseline!;
  const impacts = [...IMPACTS, 'unknown'] as const;
  const totals = (pack: PilotPack) => impacts.map(impact =>
    pack.report.findings.filter(finding => (finding.impact ?? 'unknown') === impact).length);
  const before = totals(kickoff);
  const after = totals(latest);
  const criteria = evaluateCriteria(config, latest, criteriaPath);
  const activity = packs.flatMap(pack => {
    const gate = pack.pilotEvidence?.gate;
    return gate ? [[`<code>${esc(evidencePath(pack, 'gate'))}</code>`, esc(gate.targetBranch),
      `${gate.from} to ${gate.through}`, gate.pullRequests, gate.gateRuns, gate.required ? 'Yes' : 'No']] : [];
  });
  return document(`Pilot results for ${customer}`, `<section>
<h2>Kickoff and latest scans</h2>
<p>Kickoff evidence <code>${esc(scanPath(kickoff))}</code><br>Latest evidence <code>${esc(scanPath(latest))}</code></p>
${table('Recorded findings by impact', ['Impact', 'Kickoff', 'Latest'], [
    ...impacts.map((impact, index) => [impact, before[index]!, after[index]!]),
    ['Total', kickoff.report.findings.length, latest.report.findings.length],
  ])}
${table('Fingerprint groups compared with kickoff', ['Status', 'Groups'], [
    ['New', added], ['Fixed', fixed], ['Remaining', current.findings.length - added], ['Unassessed', unassessed],
  ])}
<p>Fixed groups were absent from a comparable scan of the same page. Groups without comparable coverage are unassessed.</p>
</section>
<section>
<h2>Trend across evidence packs</h2>
<p>Oldest first by ${trend.ordering.used === 'commit' ? 'commit time' : 'scan time'}. Blue shows groups also present in the previous run. Orange shows new groups.</p>
${trend.ordering.note ? `<p>${esc(trend.ordering.note)}</p>` : ''}
<figure>${chartSvg(trend.runs, trend.ordering.used)}</figure>
${table('Trend runs', ['Evidence pack', trend.ordering.used === 'commit' ? 'Commit time' : 'Scan time', 'Groups', 'New', 'Existing', 'Fixed', 'Unassessed'],
    trend.runs.map(run => [`<code>${esc(run.source)}</code>`, esc(run.committedAt && trend.ordering.used === 'commit' ? run.committedAt : run.timestamp),
      run.total, run.new, run.existing, run.fixed, run.unassessed]))}
</section>
<section>
<h2>PR-gate activity</h2>
${activity.length ? table('Recorded PR-gate windows', ['Evidence', 'Branch', 'Dates (UTC)', 'PRs', 'PRs with runs', 'Required'], activity)
    : '<p>No PR-gate activity was recorded in these packs.</p>'}
</section>
<section>
<h2>Success criteria</h2>
<p>Targets from <code>${esc(criteriaPath)}</code>. Pilot dates ${config.pilot.startDate} to ${config.pilot.decisionDate} (UTC).</p>
${table('Pilot targets and observations', ['Criterion', 'Result', 'Observation', 'Evidence'], criteria.map(row => [esc(row.label),
    row.result === null ? 'Not measurable' : row.result ? 'Met' : 'Not met', esc(row.detail), `<code>${esc(row.path)}</code>`]))}
</section>
<section>
<h2>What automated testing can't cover</h2>
<p>Use keyboard and screen-reader testing to review key flows, focus order, and whether text alternatives and labels make sense in context. Review pages and states outside the recorded scan scope.</p>
</section>
<section>
<h2>Draft renewal quote</h2>
<p><strong>${quoteDraftBanner}</strong></p>
<p>${esc(formatAnnualPrice(pricing))}/year (${esc(pricing.currency)}). See the accompanying quote for the term and payment details.</p>
</section>`);
}

export function quoteHtml(customer: string, date: string, checkout?: string, config = pricing): string {
  return document(`${config.plan} renewal quote`, `<p class="draft"><strong>${quoteDraftBanner}</strong></p>
<dl>
<dt>Customer</dt><dd>${esc(customer)}</dd>
<dt>Buyer details</dt><dd>[[MISSING: PO/legal entity]]</dd>
<dt>Quote date</dt><dd><time datetime="${date}">${date}</time>, valid for 30 days</dd>
<dt>Price</dt><dd>${esc(formatAnnualPrice(config))}/year (${esc(config.currency)}), billed ${esc(config.billing)}</dd>
<dt>Term</dt><dd>${config.termMonths} months, starts on explicit written acceptance</dd>
<dt>Payment</dt><dd>${checkout ? `<a href="${esc(checkout)}">${esc(checkout)}</a>` : 'invoice on request'}</dd>
</dl>
<h2>What's included</h2>
<ul>
<li>Compare automated accessibility findings against a baseline in CI.</li>
<li>Generate evidence reports and export findings for developer handoff.</li>
<li>Track changes across scans using evidence packs and trend reports.</li>
</ul>`, '.draft{border:2px solid;padding:.5rem 1rem} dt{font-weight:700} dd{margin:0 0 .6rem}');
}
