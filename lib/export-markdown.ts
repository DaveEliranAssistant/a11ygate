import { DISCLAIMER, LEGAL_DISCLAIMER } from '@/lib/copy';
import { formatStandards } from '@/lib/mapping';
import { findingGuidance } from '@/lib/guidance';
import type { ManualCheck } from '@/lib/manual-evidence';
import type { DiffResult, Impact, Verdict } from '@/lib/types';

export type SummaryInput = {
  projectName: string;
  verdict: Verdict;
  threshold: Impact;
  diff: DiffResult;
  generatedAt: string;
  reason: string;
  manualChecks?: ManualCheck[];
  synthetic?: boolean;
};

export function cell(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_\[\]()!|]/g, '\\$&').replace(/[\r\n]/g, ' ');
}

/** Escape a value for a Markdown table cell or inline text. */
export const markdownCell = cell;

function findingLine(finding: DiffResult['all'][number]): string {
  const selector = finding.selector.replace(/`/g, "'");
  const impact = finding.impact ?? 'unspecified';
  const guidance = findingGuidance(finding);
  return `- **${cell(finding.ruleId)}** (${impact}) on \`${cell(finding.url)}\` — \`${cell(selector)}\` — ${cell(finding.help)} — ${cell(formatStandards(finding.tags))}\n  - Affected element: \`${cell(finding.html)}\`; fingerprint: \`${cell(finding.fingerprint)}\`.\n  - User impact: ${cell(guidance.userImpact)}\n  - Remediation: ${cell(guidance.remediation)}\n  - Verification: ${guidance.verification.map(cell).join(' ')}${finding.assessmentReason ? '\n  - Assessment: '+cell(finding.assessmentReason) : ''}`;
}

function section(title: string, findings: DiffResult['all']): string[] {
  if (findings.length === 0) return [`## ${title}`, '', 'None.', ''];
  return [`## ${title}`, '', ...findings.map(findingLine), ''];
}

export function prSummaryMarkdown(input: SummaryInput): string {
  const lines = [
    `# A11yGate — ${cell(input.projectName)}`,
    ...(input.synthetic ? ['SYNTHETIC evidence — not a real audit or customer assessment.'] : []),
    '',
    `**Verdict: ${input.verdict}** (impact threshold: ${input.threshold})`,
    '',
    input.reason,
    '',
    '| Status | Count |',
    '| --- | --- |',
    `| New | ${input.diff.newFindings.length} |`,
    `| Fixed | ${input.diff.fixedFindings.length} |`,
    `| Still open | ${input.diff.stillOpen.length} |`,
    '',
    `Generated: ${input.generatedAt}`,
    '',
    '## Scan coverage and existing debt',
    '',
    `Coverage: ${input.diff.coverage?.status ?? 'unverified'}. Existing debt: ${input.diff.stillOpen.length}; previously reported findings now unassessed: ${input.diff.unassessed?.length ?? 0}. PASS means no detected new threshold violation, not an accessible or certified service.`,
    ...(input.diff.coverage?.issues ?? []).map(i => `- ${i.code === 'missing-page' ? 'Missing page' : cell(i.code)}: ${cell(i.page)} — ${cell(i.detail)}`),
    '',
    '### Unassessed scope',
    ...(input.diff.coverage?.unassessedScope ?? ['Scan coverage was not supplied.']).map(x => '- '+cell(x)),
    '',
    ...section('New', input.diff.newFindings),
    ...section('Fixed', input.diff.fixedFindings),
    ...section('Still open', input.diff.stillOpen),
    ...section('Unassessed — not verified fixed', input.diff.unassessed ?? []),
    '## Manual evidence — separate from automated checks',
    'Self-reported, editable human assertions. Reviewer identity and freshness are not verified. These records do not improve the automated gate; absent evidence is unassessed.',
    ...(input.manualChecks?.length ? input.manualChecks.map(c => `- ${cell(c.id)}: ${cell(c.check)}; scope ${cell(c.scope)}; reviewer ${cell(c.reviewer)}; date ${cell(c.date)}; status **${c.status}**; notes ${cell(c.notes)}`) : ['No manual evidence recorded.']),
    '',
    DISCLAIMER,
    LEGAL_DISCLAIMER,
    '',
  ];
  return lines.join('\n');
}
