import type { ManualCheck } from '@/lib/manual-evidence';
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
  toolOptions?: Record<string, unknown>;
  scanConfig?: Record<string, unknown>;
  testEnvironment?: Record<string, unknown>;
  scanStatus?: 'complete' | 'failed';
  scanError?: string;
  incomplete?: AxeViolation[];
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

export type DiffStatus = 'new' | 'fixed' | 'still-open' | 'unassessed';

export type DiffedFinding = Finding & {
  status: DiffStatus;
  assessmentReason?: string;
};

export type DiffResult = {
  newFindings: DiffedFinding[];
  fixedFindings: DiffedFinding[];
  stillOpen: DiffedFinding[];
  all: DiffedFinding[];
  unassessed?: DiffedFinding[];
  coverage?: CoverageComparison;
};

export type CoverageComparison = {
  status: 'complete' | 'incomplete' | 'unverified';
  issues: { page: string; code: string; detail: string }[];
  pages: { page: string; current: number; baseline: number; comparable: boolean }[];
  unassessedScope: string[];
  unassessedFindings: number;
};

export type Verdict = 'PASS' | 'FAIL' | 'INCOMPLETE';

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
  manualChecks?: ManualCheck[];
  currentResults: AxeResults[];
  baselineResults: AxeResults[] | null;
  threshold: Impact;
  groupBy: GroupBy;
  generatedAt: string;
};

export function isImpact(value: unknown): value is Impact {
  return value === 'minor' || value === 'moderate' || value === 'serious' || value === 'critical';
}
