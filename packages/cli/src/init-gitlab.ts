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

type TopKey = { name: string; start: number; end: number; value: string };

// Plain keys may contain colons not followed by whitespace, as in GitLab job names like `test:unit`.
const KEY_RE = /^(?:"([^"]+)"|'([^']+)'|((?:[^\s#'":-]|[-:](?=\S))(?:[^:#]|:(?=\S))*?))[ \t]*:(?:[ \t]+(.*))?$/;
const MR_IF_RE = /\$CI_PIPELINE_SOURCE\s*==\s*\\?["']merge_request_event\\?["']/;
const LOCAL_INCLUDE_RE = new RegExp(`(^|[\\s'"/:-])${CI_FILES.gitlab.replace(/\./g, '\\.')}['"]?[ \\t]*(#.*)?$`);
const indentOf = (line: string) => /^[ ]*/.exec(line)![0].length;
const meaningful = (line: string) => line.trim() !== '' && !line.trim().startsWith('#');

function topLevelKeys(lines: string[]): TopKey[] | string {
  const keys: TopKey[] = [];
  for (const [i, line] of lines.entries()) {
    if (!meaningful(line) || /^[ ]/.test(line)) continue;
    // Column-0 "- " lines continue an indentless sequence under the previous key.
    if (/^-([ \t]|$)/.test(line) && keys.length) continue;
    if (line.startsWith('\t')) return 'it uses tab indentation';
    const match = KEY_RE.exec(line);
    if (!match) return `line ${i + 1} is not a top-level key this tool can read`;
    const name = match[1] ?? match[2] ?? match[3]!;
    if (keys.some((key) => key.name === name)) return `it repeats the top-level key '${name}'`;
    keys.push({ name, start: i, end: lines.length, value: (match[4] ?? '').replace(/(^|[ \t]+)#.*$/, '').trim() });
  }
  for (const [i, key] of keys.entries()) if (keys[i + 1]) key.end = keys[i + 1]!.start;
  return keys;
}

/** True when the workflow block has a rule that creates merge request pipelines. */
function hasMergeRequestRule(block: string[]): boolean {
  for (const [i, line] of block.entries()) {
    if (!/^\s*(-\s+)?if:/.test(line) || !MR_IF_RE.test(line)) continue;
    // Find the list item that owns this `if:` and reject it when it says `when: never`.
    let start = i;
    while (start > 0 && !/^\s*-\s/.test(block[start]!)) start--;
    const dash = indentOf(block[start]!);
    let end = start + 1;
    while (end < block.length && (!meaningful(block[end]!) || indentOf(block[end]!) > dash)) end++;
    if (!block.slice(start, end).some((item) => /^\s*(-\s+)?when:\s*['"]?never\b/.test(item))) return true;
  }
  return false;
}

/** Plans the smallest additive change that gives an existing root file the rule and the include. */
export function planGitlabRoot(original: string): GitlabRootPlan {
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const text = original.replace(/\r\n/g, '\n');
  if (text.includes('\r')) return { kind: 'manual', reason: 'it uses unsupported line endings' };
  if (/^(---|\.\.\.)([ \t]|$)/m.test(text)) return { kind: 'manual', reason: 'it uses YAML document markers' };
  const lines = text.split('\n');
  const keys = topLevelKeys(lines);
  if (typeof keys === 'string') return { kind: 'manual', reason: keys };
  const workflow = keys.find((key) => key.name === 'workflow');
  const include = keys.find((key) => key.name === 'include');

  let ruleNeeded = true;
  if (workflow) {
    const block = lines.slice(workflow.start + 1, workflow.end);
    if (workflow.value || !hasMergeRequestRule(block)) {
      return { kind: 'manual', reason: 'it already has a workflow: block without a merge_request_event rule that init can merge safely' };
    }
    ruleNeeded = false;
  }

  let includeAt: { line: number; indent: string } | undefined;
  let includeNeeded = true;
  if (include) {
    const block = lines.slice(include.start, include.end);
    if (block.some((line) => meaningful(line) && LOCAL_INCLUDE_RE.test(line.replace(/[ \t]+#.*$/, '')))) includeNeeded = false;
    else {
      const first = lines.slice(include.start + 1, include.end).find(meaningful);
      if (include.value || !first || !/^[ ]*-\s/.test(first)) {
        return { kind: 'manual', reason: 'its include: entry is not a block list init can extend safely' };
      }
      includeAt = { line: include.start + 1, indent: ' '.repeat(indentOf(first)) };
    }
  }

  if (!ruleNeeded && !includeNeeded) return { kind: 'unchanged' };
  const added: string[] = [];
  const out = [...lines];
  if (includeAt) {
    out.splice(includeAt.line, 0, `${includeAt.indent}# Added by a11ygate init.`, `${includeAt.indent}${INCLUDE_ITEM}`);
    added.push('include');
  }
  let body = out.join('\n');
  const appended: string[] = [];
  if (includeNeeded && !includeAt) { appended.push(GITLAB_INCLUDE_BLOCK); added.push('include'); }
  if (ruleNeeded) { appended.push(GITLAB_WORKFLOW_BLOCK); added.push('merge_request_event workflow rule'); }
  if (appended.length) {
    if (body && !body.endsWith('\n')) body += '\n';
    body += `${body ? '\n' : ''}# Added by a11ygate init. ${AUTOMATED_TESTING_DISCLAIMER}\n${EXPLAINER}\n${appended.join('\n')}`;
  }
  return { kind: 'update', text: body.replace(/\n/g, eol), added };
}
