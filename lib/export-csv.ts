import { EN301549_COLUMN, EN301549_LABEL, en301549Ref, formatStandards, lookupStandards } from '@/lib/mapping';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
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

export function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Header of the opt-in EN 301 549 column; the label is part of the header so it travels with the column. */
export const CSV_EN301549_HEADER = `${EN301549_COLUMN} (${EN301549_LABEL})`;

export type CsvOptions = {
  /** Opt-in: append an "EN 301 549 ref." column (reference mapping only). Default off. */
  en301549Ref?: boolean;
};

function en301549Cell(tags: readonly string[]): string {
  return lookupStandards(tags)
    .flatMap((hit) => (hit.kind === 'criterion' ? [`${hit.number}: ${en301549Ref(hit.number)}`] : []))
    .join(' | ');
}

export function findingsToCsv(findings: readonly DiffedFinding[], options: CsvOptions = {}): string {
  const columns: string[] = options.en301549Ref ? [...COLUMNS, CSV_EN301549_HEADER] : [...COLUMNS];
  const header = columns.map((column) => csvField(column)).join(',');
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
      ...(options.en301549Ref ? [en301549Cell(finding.tags)] : []),
    ]
      .map((value) => csvField(value))
      .join(','),
  );
  // The opt-in variant ends with a disclaimer row (text in the first column, the rest empty so the
  // column count stays constant for importers). The default export stays byte-identical.
  const footer = options.en301549Ref
    ? [[AUTOMATED_TESTING_DISCLAIMER, ...columns.slice(1).map(() => '')].map((value) => csvField(value)).join(',')]
    : [];
  return `\uFEFF${[header, ...rows, ...footer].join('\n')}\n`;
}
