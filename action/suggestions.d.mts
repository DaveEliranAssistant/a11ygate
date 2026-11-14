import type { FixFinding, PlanResult, SourceFile, Suggestion } from '../lib/fix/types';
import type { PublishMode, PublishSummary } from '../lib/modelfix/publish';
import type { CandidateVerifier, ModelAdapter, ModelFixConfig, ModelFixRun } from '../lib/modelfix/types';

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
  /** Present only when a model-fix config was passed. Routing metadata; never published output. */
  model?: ModelFixRun;
  /** Present only when verified model drafts were handed to the draft-only publisher. */
  published?: PublishSummary;
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
  /** Resolved model-fix config. Omit for the plain rule-based path. */
  modelFixes?: ModelFixConfig;
  /** Adapters for the model path. Defaults to the built-in list, which is empty in this phase. */
  modelAdapters?: readonly ModelAdapter[];
  env?: Readonly<Record<string, string | undefined>>;
  /** Isolated apply + re-scan verifier. Without one, model drafts are discarded unpublished. */
  modelVerifier?: CandidateVerifier;
  /** Draft-only publishing of verified drafts. Omit to keep verified drafts unpublished. */
  modelPublish?: { mode?: PublishMode; baseBranch?: string | null; models?: Readonly<Record<string, string>>; routes?: readonly string[] };
}): Promise<SuggestionSummary>;
