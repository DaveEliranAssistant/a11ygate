import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { CI_FILES } from './ci-targets';

/**
 * GitLab creates a merge request pipeline only when the root `.gitlab-ci.yml` itself has a matching
 * rule; rules that come only from `include:` files do not count. `init --target gitlab` therefore
 * writes (or extends) the root file with a `workflow: rules` entry for `merge_request_event` and a
 * local include of the generated job file, which stays the single source for the job steps.
 *
 * The merge is deliberately conservative and text-based (the CLI bundles no YAML library): it only
 * appends or inserts lines, never removes customer keys, and returns `manual` whenever the file's
 * shape is not one it can extend safely, so the caller leaves the file unchanged.
 */
export const GITLAB_ROOT_FILE = '.gitlab-ci.yml';

const INCLUDE_ITEM = `- local: '${CI_FILES.gitlab}'`;
export const GITLAB_INCLUDE_BLOCK = `include:\n  ${INCLUDE_ITEM}\n`;
// Branch and tag rules keep the pipelines GitLab creates by default when a root file has no
// `workflow:` block, so adding the merge request rule never silently disables them.
export const GITLAB_WORKFLOW_BLOCK = `workflow:
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH'
    - if: '$CI_COMMIT_TAG'
`;
const EXPLAINER = `# GitLab creates merge request pipelines only when the root .gitlab-ci.yml has a
# matching rule; rules inside included files do not count. The branch and tag rules
# keep branch and tag pipelines running. See integrations/gitlab/README.md.`;

export const GITLAB_ROOT_SNIPPET = `${GITLAB_INCLUDE_BLOCK}\n${GITLAB_WORKFLOW_BLOCK}`;

export function gitlabRootFile(): string {
  return `# ${AUTOMATED_TESTING_DISCLAIMER}
# Root pipeline written by a11ygate init. The A11yGate job lives in ${CI_FILES.gitlab}.
${EXPLAINER}
${GITLAB_ROOT_SNIPPET}`;
}

export type GitlabRootPlan =
  | { kind: 'unchanged' }
  | { kind: 'update'; text: string; added: string[] }
  | { kind: 'manual'; reason: string };

type Key = { name: string; start: number; end: number; indent: number; value: string };
type Insertion = { at: number; lines: string[] };

// Plain keys may contain colons not followed by whitespace, as in GitLab job names like `test:unit`.
const KEY_RE = /^[ ]*(?:"([^"]+)"|'([^']+)'|((?:[^\s#'":-]|[-:](?=\S))(?:[^:#]|:(?=\S))*?))[ \t]*:(?:[ \t]+(.*))?$/;
// Plain keys starting with a YAML indicator (complex keys, anchors, aliases, tags, flow, directives).
const UNSAFE_KEY_START = /^[?&*!|>%@`{}[\],]/;
const MR_IF_RE = /\$CI_PIPELINE_SOURCE\s*==\s*\\?["']merge_request_event\\?["']/;
// Anchors, aliases, tags (including !reference) and merge keys outside quoted strings.
const NODE_PROPERTY_RE = /(^|[\s[{,])(?:&[\w-]|\*[\w-]|![\w!]|<<[ \t]*:)/;
const BLOCK_SCALAR_RE = /(?:^[ ]*-|:)[ \t]+(?:[!&][^\s]*[ \t]+)*[|>][-+0-9]*[ \t]*(?:#.*)?$/;
const indentOf = (line: string) => /^[ ]*/.exec(line)![0].length;
const meaningful = (line: string) => line.trim() !== '' && !line.trim().startsWith('#');
const stripComment = (value: string) => value.replace(/(^|[ \t]+)#.*$/, '').trim();
const unquoted = (line: string) => line.replace(/'(?:[^']|'')*'|"(?:[^"\\]|\\.)*"/g, '""');
const JOB_FILES = new Set([CI_FILES.gitlab, `/${CI_FILES.gitlab}`]);

/** Returns the plain value of a single-line scalar, or undefined when it is not a simple scalar. */
function scalar(raw: string): string | undefined {
  const value = stripComment(raw);
  const single = /^'((?:[^']|'')*)'$/.exec(value);
  if (single) return single[1]!.replace(/''/g, "'");
  const double = /^"([^"\\]*)"$/.exec(value);
  if (double) return double[1];
  return /^[^\s'"&*!|>%@`{}[\],#?-][^#]*$/.test(value) ? value : undefined;
}

/**
 * Reads the keys of one block mapping whose lines are `lines[from..to)`. Every meaningful line must be
 * indented at least as far as the first one; anything else is reported as a reason to leave the file alone.
 */
function mappingKeys(lines: string[], from: number, to: number): Key[] | string {
  const keys: Key[] = [];
  let indent = -1;
  for (let i = from; i < to; i++) {
    const line = lines[i]!;
    if (!meaningful(line)) continue;
    const at = indentOf(line);
    if (indent < 0) indent = at;
    if (at > indent) continue;
    if (at < indent) return `line ${i + 1} is indented less than the mapping it belongs to`;
    // "- " at the key's own indentation continues an indentless sequence under the previous key.
    if (/^[ ]*-([ ]|$)/.test(line)) {
      if (keys.length && !keys[keys.length - 1]!.value) continue;
      return `line ${i + 1} is a list item where init expects a key`;
    }
    const match = KEY_RE.exec(line);
    if (!match) return `line ${i + 1} is not a key this tool can read`;
    const name = match[1] ?? match[2] ?? match[3]!;
    if (match[3] && (UNSAFE_KEY_START.test(name) || name === '<<')) return `line ${i + 1} uses a YAML key form init does not edit`;
    if (keys.some((key) => key.name === name)) return `it repeats the key '${name}'`;
    const value = stripComment(match[4] ?? '');
    // Multi-line quoted or flow values could hide later lines from this reader.
    if (/^['"]/.test(value) && scalar(value) === undefined) return `line ${i + 1} has a quoted value init cannot read`;
    if (/^[[{]/.test(value) && !/[\]}]$/.test(value)) return `line ${i + 1} has a multi-line flow value`;
    keys.push({ name, start: i, end: to, indent, value });
  }
  for (const [i, key] of keys.entries()) if (keys[i + 1]) key.end = keys[i + 1]!.start;
  return keys;
}

/** Items of a block sequence in `lines[from..to)`, or a reason when the body is not a plain block list. */
function sequenceItems(lines: string[], from: number, to: number): { indent: number; items: string[][] } | string {
  const first = lines.slice(from, to).find(meaningful);
  if (!first || !/^[ ]*-([ ]|$)/.test(first)) return 'it is not a block list';
  const indent = indentOf(first);
  const items: string[][] = [];
  for (let i = from; i < to; i++) {
    const line = lines[i]!;
    if (!meaningful(line)) continue;
    if (indentOf(line) < indent) return `line ${i + 1} is indented less than its list`;
    if (indentOf(line) === indent) {
      if (!/^[ ]*-([ ]|$)/.test(line)) return `line ${i + 1} breaks the list`;
      items.push([line]);
    } else items[items.length - 1]!.push(line);
  }
  return { indent, items };
}

const hasNodeProperties = (lines: string[]) => lines.some((line) => meaningful(line) && NODE_PROPERTY_RE.test(unquoted(line)));

/** An enabling merge request rule: `- if: <merge_request_event test>` without `when: never`. */
const enablesMergeRequests = (item: string[]) =>
  /^[ ]*-[ ]+if:/.test(item[0]!) && MR_IF_RE.test(item[0]!)
  && !item.slice(1).some((line) => /^[ ]*when:[ \t]*['"]?never\b/.test(line));

type WorkflowPlan = { kind: 'present' } | { kind: 'insert'; insertion: Insertion } | { kind: 'manual'; reason: string };

function planWorkflow(lines: string[], workflow: Key, tag: string): WorkflowPlan {
  const manual = (reason: string): WorkflowPlan => ({ kind: 'manual', reason: `its workflow: block ${reason}` });
  if (workflow.value) return manual('is not a plain block mapping');
  const body = lines.slice(workflow.start + 1, workflow.end);
  if (hasNodeProperties(body)) return manual('uses anchors, aliases, tags or merge keys');
  const keys = mappingKeys(lines, workflow.start + 1, workflow.end);
  if (typeof keys === 'string') return manual(`cannot be read safely (${keys})`);
  if (!keys.length) return manual('is empty');
  const childIndent = ' '.repeat(keys[0]!.indent);
  const rules = keys.find((key) => key.name === 'rules');
  if (!rules) {
    // No rules: GitLab runs its default pipelines, so add the rule with the branch and tag rules that keep them.
    const ruleLines = GITLAB_WORKFLOW_BLOCK.split('\n').slice(1, -1).map((line) => `${childIndent}${line.slice(2)}`);
    return { kind: 'insert', insertion: { at: workflow.start + 1, lines: [`${childIndent}${tag}`, ...ruleLines] } };
  }
  if (rules.value) return manual('has rules: that are not a plain block list');
  const list = sequenceItems(lines, rules.start + 1, rules.end);
  if (typeof list === 'string') return manual(`has rules: that init cannot read safely (${list})`);
  if (list.items.some(enablesMergeRequests)) return { kind: 'present' };
  // A rule that mentions merge requests but does not enable them is a deliberate choice; leave it to a person.
  if (list.items.some((item) => item.some((line) => line.includes('merge_request_event')))) {
    return manual('already has a merge_request_event rule that does not create merge request pipelines');
  }
  const itemIndent = ' '.repeat(list.indent);
  return { kind: 'insert', insertion: { at: rules.start + 1, lines: [`${itemIndent}${tag}`, `${itemIndent}- if: '$CI_PIPELINE_SOURCE == "merge_request_event"'`] } };
}

type IncludePlan = { kind: 'present' } | { kind: 'insert'; insertion: Insertion } | { kind: 'manual'; reason: string };

function planInclude(lines: string[], include: Key, tag: string): IncludePlan {
  const manual = (reason: string): IncludePlan => ({ kind: 'manual', reason: `its include: entry ${reason}` });
  if (include.value) {
    const file = scalar(include.value);
    if (file !== undefined && JOB_FILES.has(file)) return { kind: 'present' };
    return manual('is not a block list init can extend safely');
  }
  const list = sequenceItems(lines, include.start + 1, include.end);
  if (typeof list === 'string') return manual(`is not a block list init can extend safely (${list})`);
  if (hasNodeProperties(lines.slice(include.start + 1, include.end))) return manual('uses anchors, aliases, tags or merge keys');
  for (const item of list.items) {
    const rest = item[0]!.replace(/^[ ]*-[ ]*/, '');
    const extra = item.slice(1).filter(meaningful);
    const local = /^local:[ \t]+(.*)$/.exec(rest);
    const file = scalar(local ? local[1]! : rest);
    if (!extra.length && file !== undefined && JOB_FILES.has(file)) return { kind: 'present' };
    // A local include of this file with extra keys (rules, inputs) may not always apply.
    if (item.some((line) => /(^|[\s{,])local:/.test(line)) && item.some((line) => line.includes(CI_FILES.gitlab))) {
      return manual(`already includes ${CI_FILES.gitlab} in a form init cannot confirm`);
    }
  }
  const itemIndent = ' '.repeat(list.indent);
  return { kind: 'insert', insertion: { at: include.start + 1, lines: [`${itemIndent}${tag}`, `${itemIndent}${INCLUDE_ITEM}`] } };
}

/**
 * Plans the smallest additive change that gives an existing root file the rule and the include. It only
 * inserts whole lines into a file it can read as a plain, column-0 block mapping; any other layout is
 * reported as `manual`, so existing bytes are never rewritten.
 */
export function planGitlabRoot(original: string): GitlabRootPlan {
  const manual = (reason: string): GitlabRootPlan => ({ kind: 'manual', reason });
  const crlf = original.includes('\r\n');
  if (crlf && /(^|[^\r])\n/.test(original)) return manual('it mixes line endings');
  const text = crlf ? original.replace(/\r\n/g, '\n') : original;
  if (text.includes('\r')) return manual('it uses unsupported line endings');
  if (text.startsWith('\uFEFF')) return manual('it starts with a byte order mark');
  if (text.includes('\t')) return manual('it contains tab characters');
  if (/^(---|\.\.\.)([ ]|$)/m.test(text)) return manual('it uses YAML document markers');
  const lines = text.split('\n');
  const firstLine = lines.find(meaningful);
  if (firstLine && indentOf(firstLine) > 0) return manual('its top-level mapping is indented');
  const keys = mappingKeys(lines, 0, lines.length);
  if (typeof keys === 'string') return manual(keys);
  const workflow = keys.find((key) => key.name === 'workflow');
  const include = keys.find((key) => key.name === 'include');

  const tagged = { done: original.includes(AUTOMATED_TESTING_DISCLAIMER) };
  const tag = () => {
    const disclaimer = tagged.done ? '' : ` ${AUTOMATED_TESTING_DISCLAIMER}`;
    tagged.done = true;
    return `# Added by a11ygate init.${disclaimer}`;
  };
  // Work out insertions in file order so the first inserted comment carries the disclaimer.
  const plans: { at: number; plan: () => WorkflowPlan | IncludePlan; label: string }[] = [];
  if (workflow) plans.push({ at: workflow.start, plan: () => planWorkflow(lines, workflow, tag()), label: 'merge_request_event workflow rule' });
  if (include) plans.push({ at: include.start, plan: () => planInclude(lines, include, tag()), label: 'include' });
  plans.sort((a, b) => a.at - b.at);

  const insertions: Insertion[] = [];
  const added: string[] = [];
  for (const entry of plans) {
    const before = tagged.done;
    const result = entry.plan();
    if (result.kind === 'manual') return manual(result.reason);
    if (result.kind === 'present') { tagged.done = before; continue; }
    insertions.push(result.insertion);
    added.push(entry.label);
  }
  const appended: string[] = [];
  if (!include) { appended.push(GITLAB_INCLUDE_BLOCK); added.unshift('include'); }
  if (!workflow) { appended.push(GITLAB_WORKFLOW_BLOCK); added.push('merge_request_event workflow rule'); }
  if (!insertions.length && !appended.length) return { kind: 'unchanged' };

  const last = keys[keys.length - 1];
  if (appended.length && last && lines.slice(last.start, last.end).some((line) => BLOCK_SCALAR_RE.test(line))) {
    // Lines appended after a block scalar (`|`, `>`, `|+` ...) could become part of its value.
    return manual('its last top-level key holds a block scalar, so appending could change its value');
  }

  const out = [...lines];
  for (const insertion of [...insertions].sort((a, b) => b.at - a.at)) out.splice(insertion.at, 0, ...insertion.lines);
  let body = out.join('\n');
  if (appended.length) {
    if (body && !body.endsWith('\n')) body += '\n';
    body += `${body ? '\n' : ''}${tag()}\n${EXPLAINER}\n${appended.join('\n')}`;
  }
  return { kind: 'update', text: crlf ? body.replace(/\n/g, '\r\n') : body, added: added.sort((a, b) => (a === 'include' ? -1 : b === 'include' ? 1 : 0)) };
}
