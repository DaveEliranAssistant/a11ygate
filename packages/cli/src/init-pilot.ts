import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import pricing from '../../../config/pricing.json';
import type { CiTarget } from './ci-targets';

const lengthDays = pricing.pilot.lengthDays;
const schemaUrl = 'https://raw.githubusercontent.com/DaveEliranAssistant/a11ygate/main/schema/pilot-success.schema.json';

export function pilotSuccessCriteria(target: CiTarget): string {
  const start = new Date();
  const decision = new Date(start);
  decision.setUTCDate(decision.getUTCDate() + lengthDays - 1);
  return `# yaml-language-server: $schema=${schemaUrl}
# Fill in the customer, dates, and coverage targets at kickoff.
# ${AUTOMATED_TESTING_DISCLAIMER}
schemaVersion: 1
pilot:
  customer: "[[MISSING]]"
  ciProvider: ${target}
  startDate: "${start.toISOString().slice(0, 10)}"
  lengthDays: ${lengthDays}
  decisionDate: "${decision.toISOString().slice(0, 10)}"
criteria:
  gateRunsOnEveryPrToMain: true
  targetBranch: main
  baselineCreated: true
  maxUnreviewedNewSeriousOrCriticalMergedAfterWeek2: 0
  pagesOrFlowsCovered:
    min: 5
  evidencePackProduced: true
`;
}

export const PILOT_KICKOFF = `# A11yGate pilot kickoff

Use [docs/pilot/kickoff-checklist.md in the A11yGate repository](https://github.com/DaveEliranAssistant/a11ygate/blob/main/docs/pilot/kickoff-checklist.md) and fill in \`success-criteria.yml\` at kickoff.

${AUTOMATED_TESTING_DISCLAIMER}
`;

const openReview: Record<CiTarget, string> = {
  github: 'gh pr create',
  gitlab: 'glab mr create',
  'azure-devops': 'az repos pr create',
  jenkins: 'git push -u origin HEAD  # then open a pull request on your repository host',
};

export function pilotNextSteps(target: CiTarget, url: string, crawl: number, failOn: string): string {
  return `Pilot next steps (put the current A11yGate CLI on your PATH).
1. a11ygate doctor
2. a11ygate scan '${url}' --crawl ${Math.max(1, crawl)} --fail-on ${failOn} --out-dir a11y-results
3. a11ygate baseline create a11y-results --output .a11ygate-baseline.json
   Review the baseline, wire it into the CI scan, then commit and push the setup on a branch.
4. ${openReview[target]}
5. a11ygate evidence pack --from a11y-results --out a11ygate-evidence.zip
`;
}
