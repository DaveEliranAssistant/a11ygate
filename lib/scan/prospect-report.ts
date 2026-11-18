import { annualPrice, pricing } from '@/lib/billing';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { findingGuidance } from '@/lib/guidance';
import { esc, REPORT_V2_STYLE, topFixes } from './report-html-v2';
import type { ScanReport } from './report';

export type ProspectAuthorization = { authorizedBy: string; authorizationNote: string };
export type ProspectReportOptions = { company?: string; offer: boolean; authorization?: ProspectAuthorization };

export function prospectHtml(report: ScanReport, options: ProspectReportOptions): string {
  const title = options.company ? `Accessibility scan summary for ${options.company}` : 'Accessibility scan summary';
  const { pagesScanned, pagesFailed, pagesNotAuthenticated, skippedLinks } = report.counts;
  const scanned = report.pages.filter(page => page.scanStatus === 'complete');
  const engines = (report.engines?.used ?? ['axe']).map(engine =>
    engine === 'axe' ? `axe-core ${report.axeVersion ?? '(version unrecorded)'}` : `${engine} (version unrecorded)`);
  const rules = topFixes(report.findings);
  const issues = rules.map(rule => {
    const sample = rule.findings[0]!;
    return `<section>
<h3><code>${esc(rule.ruleId)}</code> <span class="impact ${rule.impact ?? 'unknown'}">${rule.impact ?? 'Unknown impact'}</span></h3>
<p>WCAG reference: ${rule.wcag.map(c => esc(c.number)).join(', ') || 'None mapped'}. ${rule.occurrences} occurrence(s) on ${rule.pages.length} page(s).</p>
<p>Sample selector: <code>${esc(sample.selector)}</code></p>
<p>${esc(findingGuidance(sample).remediation)}</p>
</section>`;
  }).join('\n');
  const offer = options.offer
    ? `<section><h2>Pilot offer</h2><p>${esc(pricing.plan)} costs ${esc(annualPrice)}/yr (${esc(pricing.currency)}). Start with a ${pricing.pilot.lengthDays}-day free pilot.</p></section>`
    : '';
  const authorization = options.authorization
    ? `<p>Authorized by: ${esc(options.authorization.authorizedBy)}<br>Authorization note: ${esc(options.authorization.authorizationNote)}</p>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${esc(title)}</title>
<style>
${REPORT_V2_STYLE}
footer{margin-top:1.5rem;overflow-wrap:anywhere}
@media print{section>section,footer{break-inside:avoid}}
</style>
</head>
<body>
<header>
<h1>${esc(title)}</h1>
<p>Site: <code>${esc(report.startUrl)}</code></p>
<p class="disclaimer">${AUTOMATED_TESTING_DISCLAIMER}</p>
</header>
<main>
<section>
<h2>Scan scope</h2>
<p>Scan date: ${esc(report.scannedAt)}. Engines: ${esc(engines.join(', ') || 'No engine completed')}. A11yGate CLI ${esc(report.version)}.</p>
<p>${pagesScanned} page(s) scanned (cap ${report.options.maxPages}), ${pagesFailed} failed, ${pagesNotAuthenticated ?? 0} unauthenticated, ${skippedLinks} link(s) skipped. ${esc(report.options.robots)}</p>
${scanned.length ? `<ul>${scanned.map(page => `<li><code>${esc(page.finalUrl)}</code></li>`).join('')}</ul>` : ''}
</section>
<section>
<h2>Top issues</h2>
${issues || '<p>The scan recorded no findings in the pages it analyzed.</p>'}
${issues ? '<p>For missing alternative text, labels or accessible names, leave a TODO for someone who knows the content to write and verify the wording.</p>' : ''}
</section>
<section>
<h2>What this means in CI</h2>
<p>This scan recorded ${report.findings.length} finding(s) across ${pagesScanned} scanned page(s). On comparable coverage, a fingerprint baseline would record these existing findings. A pull request gate scanning the same pages could fail a change that adds a finding at or above the configured impact threshold, including another occurrence of a rule already listed here. Re-scan after fixes to reduce the baseline.</p>
</section>
<section>
<h2>What automated testing can't cover</h2>
<p>Review key flows with a keyboard and screen reader. Check focus order, whether text alternatives and labels make sense in context, and states and pages outside this scan.</p>
</section>
${offer}
</main>
<footer>
${authorization}
<p>${AUTOMATED_TESTING_DISCLAIMER}</p>
</footer>
</body>
</html>
`;
}
