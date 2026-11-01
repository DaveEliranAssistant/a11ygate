import { DISCLAIMER } from '@/lib/copy';
import type { Impact, Verdict } from '@/lib/types';

export type StatementInput = {
  organisation: string;
  email: string;
  date: string;
  projectName: string;
  verdict: Verdict;
  threshold: Impact;
  counts: {
    newCount: number;
    fixedCount: number;
    stillOpen: number;
  };
};

export function statementMarkdown(input: StatementInput): string {
  const organisation = input.organisation.trim();
  const email = input.email.trim();
  const date = input.date.trim();
  return [
    '# Accessibility statement',
    '',
    `**Organisation:** ${organisation}`,
    `**Contact:** ${email}`,
    `**Date:** ${date}`,
    '',
    `${organisation} is working to make its digital services accessible, consistent with the European Accessibility Act and EN 301 549.`,
    '',
    '## How to contact us',
    '',
    `Email ${email} if you cannot access part of the service.`,
    '',
    '## Status of this draft',
    '',
    `This draft was composed locally in the browser from axe-core evidence for ${input.projectName}.`,
    '',
    `- Gate: ${input.verdict} (threshold: ${input.threshold})`,
    `- New: ${input.counts.newCount}`,
    `- Fixed: ${input.counts.fixedCount}`,
    `- Still open: ${input.counts.stillOpen}`,
    '',
    `${DISCLAIMER} This draft is not a legal accessibility statement and it is not a certification.`,
    '',
  ].join('\n');
}
