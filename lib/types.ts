export const IMPACTS = ['minor', 'moderate', 'serious', 'critical'] as const;

export type Impact = (typeof IMPACTS)[number];

export type AxeNode = {
  target: string[];
  html: string;
  impact?: Impact | null;
};

export type AxeViolation = {
  id: string;
  impact: Impact | null;
  tags: string[];
  help: string;
  helpUrl: string;
  nodes: AxeNode[];
};

export type AxeResults = {
  url: string;
  timestamp: string;
  testEngine: {
    version: string;
  };
  violations: AxeViolation[];
};

export type Finding = {
  fingerprint: string;
  ruleId: string;
  impact: Impact | null;
  tags: string[];
  help: string;
  helpUrl: string;
  selector: string;
  html: string;
  url: string;
  path: string;
  engineVersion: string;
  timestamp: string;
};

export type PageInfo = {
  url: string;
  path: string;
  timestamp: string;
  engineVersion: string;
};

export type DiffStatus = 'new' | 'fixed' | 'still-open';

export type DiffedFinding = Finding & {
  status: DiffStatus;
};

export type DiffResult = {
  newFindings: DiffedFinding[];
  fixedFindings: DiffedFinding[];
  stillOpen: DiffedFinding[];
  all: DiffedFinding[];
};

export type Verdict = 'PASS' | 'FAIL';

export type GroupBy = 'rule' | 'page';

export type GroupKey = GroupBy | 'impact';

export type FindingGroup = {
  key: string;
  label: string;
  findings: DiffedFinding[];
};

export type ScanState = {
  projectName: string;
  currentSynthetic: boolean;
  baselineSynthetic: boolean;
  currentResults: AxeResults[];
  baselineResults: AxeResults[] | null;
  threshold: Impact;
  groupBy: GroupBy;
  generatedAt: string;
};

export function isImpact(value: unknown): value is Impact {
  return value === 'minor' || value === 'moderate' || value === 'serious' || value === 'critical';
}
