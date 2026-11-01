import { DISCLAIMER } from '@/lib/copy';
import { formatStandards } from '@/lib/mapping';
import type { DiffResult, Impact, Verdict } from '@/lib/types';

export type SummaryInput = {
  projectName: string;
  verdict: Verdict;
  threshold: Impact;
  diff: DiffResult;
  generatedAt: string;
  reason: string;
};

function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function findingLine(finding: DiffResult['all'][number]): string {
  const selector = finding.selector.replace(/`/g, "'");
  const impact = finding.impact ?? 'unspecified';
  return `- **${cell(finding.ruleId)}** (${impact}) on \`${finding.path}\` — \`${selector}\` — ${cell(finding.help)} — ${cell(formatStandards(finding.tags))}`;
}

function section(title: string, findings: DiffResult['all']): string[] {
  if (findings.length === 0) return [`## ${title}`, '', 'None.', ''];
  return [`## ${title}`, '', ...findings.map(findingLine), ''];
}

export function prSummaryMarkdown(input: SummaryInput): string {
  const lines = [
    `# A11yGate — ${input.projectName}`,
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
    ...section('New', input.diff.newFindings),
    ...section('Fixed', input.diff.fixedFindings),
    ...section('Still open', input.diff.stillOpen),
    DISCLAIMER,
    '',
  ];
  return lines.join('\n');
}
