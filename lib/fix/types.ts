import type { DiffedFinding } from '@/lib/types';
import type { OpenTag, SourceKind } from '@/lib/fix/element';

/** The part of a finding the fix rules need. Matches the CLI JSON result. */
export type FixFinding = Pick<DiffedFinding, 'fingerprint' | 'ruleId' | 'html'> & {
  status?: DiffedFinding['status'];
  path?: string;
};

export const PLACEHOLDER = 'TODO(a11ygate)';

export type FixOptions = {
  /** Document language for html-has-lang. Defaults to "en". */
  lang?: string;
};

/** Input handed to one rule: the whole file and the matched element. */
export type RuleInput = {
  source: string;
  kind: SourceKind;
  tag: OpenTag;
  ruleId: string;
  lang: string;
};

/** An offset-based edit on the whole source text. */
export type TextEdit = { start: number; end: number; text: string };

export type RuleResult = {
  rule: FixRuleName;
  edits: TextEdit[];
  /** True when the suggestion contains a TODO(a11ygate) placeholder. */
  placeholder: boolean;
  /** One sentence for the reviewer: what changed and where any text came from. */
  note: string;
};

export type FixRuleName = 'label' | 'accessible-name' | 'image-alt' | 'clickable-element' | 'html-has-lang';

export type Rule = (input: RuleInput) => RuleResult | null;

/** A line-range replacement on the head side of a file. Lines are 1-indexed and inclusive. */
export type Suggestion = {
  fingerprint: string;
  ruleId: string;
  rule: FixRuleName;
  path: string;
  startLine: number;
  endLine: number;
  original: string[];
  replacement: string[];
  placeholder: boolean;
  note: string;
};

export type SourceFile = {
  path: string;
  content: string;
  /** Head-side line numbers that are inside a diff hunk. */
  diffLines: ReadonlySet<number>;
};

export type SkipReason =
  | 'not-new'
  | 'unsupported-rule'
  | 'no-match'
  | 'ambiguous'
  | 'no-safe-fix'
  | 'outside-diff'
  | 'overlaps';

export type PlanResult = {
  suggestions: Suggestion[];
  skipped: { fingerprint: string; ruleId: string; reason: SkipReason }[];
};
