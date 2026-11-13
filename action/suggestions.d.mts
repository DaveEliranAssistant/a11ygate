import type { FixFinding, PlanResult, SourceFile, Suggestion } from '../lib/fix/types';

export const MAX_SUGGESTIONS: number;

export function newFindingsFromReport(report: unknown): FixFinding[];

export function readWorkspaceFile(workspace: string, relative: string): string | null;

export function sourceFilesFromPullFiles(
  pullFiles: ReadonlyArray<{ filename?: unknown; patch?: unknown; status?: unknown } | null>,
  readFile: (relative: string) => string | null,
): SourceFile[];

export type ReviewCommentPayload = {
  body: string;
  commit_id: string;
  path: string;
  line: number;
  side: 'RIGHT';
  start_line?: number;
  start_side?: 'RIGHT';
};

export function reviewCommentPayload(suggestion: Suggestion, commitId: string): ReviewCommentPayload;

export type GithubRequest = (pathname: string, options?: { method?: string; body?: unknown }) => Promise<unknown>;

export type SuggestionSummary = {
  planned: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  skipped: PlanResult['skipped'];
};

export function postSuggestions(options: {
  report: unknown;
  github: GithubRequest;
  repo: string;
  pr: string;
  headSha?: string;
  workspace?: string;
  lang?: string;
  warn: (message: string) => void;
  info?: (message: string) => void;
  readFile?: (relative: string) => string | null;
}): Promise<SuggestionSummary>;
