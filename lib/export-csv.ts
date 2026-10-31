import { formatStandards } from '@/lib/mapping';
import type { DiffedFinding } from '@/lib/types';

const COLUMNS = [
  'status',
  'rule',
  'impact',
  'page',
  'selector',
  'html',
  'help',
  'helpUrl',
  'standards',
  'fingerprint',
] as const;

function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function findingsToCsv(findings: readonly DiffedFinding[]): string {
  const header = COLUMNS.map((column) => csvField(column)).join(',');
  const rows = findings.map((finding) =>
    [
      finding.status,
      finding.ruleId,
      finding.impact ?? '',
      finding.path,
      finding.selector,
      finding.html,
      finding.help,
      finding.helpUrl,
      formatStandards(finding.tags),
      finding.fingerprint,
    ]
      .map((value) => csvField(value))
      .join(','),
  );
  return `\uFEFF${[header, ...rows].join('\n')}\n`;
}
