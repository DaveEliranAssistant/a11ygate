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
/** One code line outside block scalars: its indentation, its text without a comment, and whether it had one. */
type Token = { line: number; indent: number; code: string; comment: boolean };
/** The subset of YAML init reads inside `include:` and `workflow:`. Anything outside it is refused. */
type Node =
  | { kind: 'scalar'; value: string }
  | { kind: 'seq'; indent: number; items: (Node | null)[] }
  | { kind: 'map'; indent: number; entries: Map<string, { line: number; value: Node | null }> };

// Plain keys may contain colons not followed by whitespace, as in GitLab job names like `test:unit`.
const KEY_RE = /^[ ]*(?:"([^"]+)"|'((?:[^']|'')+)'|((?:[^\s#'":-]|[-:](?=\S))(?:[^:#]|:(?=\S))*?))[ \t]*:(?:[ \t]+(.*))?$/;
// Plain keys starting with a YAML indicator (complex keys, anchors, aliases, tags, flow, directives).
const UNSAFE_KEY_START = /^[?&*!|>%@`{}[\],]/;
// Keys the planner reads or edits. A quoted spelling of one of them is refused, never guessed at.
const PLANNER_KEYS = new Set(['workflow', 'include']);
// Anchors, aliases, tags (including !reference) and merge keys outside quoted strings.
const NODE_PROPERTY_RE = /(^|[\s[{,])(?:&[\w-]|\*[\w-]|![\w!]|<<[ \t]*:)/;
// A block scalar header (`|`, `>`, with any chomping or indentation indicator) ends the code of its line,
// whatever comes before it: `key: |+`, `- |`, `- - >-`, `- key: !tag |2`.
const BLOCK_HEADER_RE = /(^|[ ])[|>][-+0-9]*$/;
const ITEM_RE = /^-(?:[ ]+|$)/;
const PLAIN_KEY_RE = /^([A-Za-z_][\w-]*)[ ]*:(?:[ ]+(.*))?$/;
const indentOf = (line: string) => /^[ ]*/.exec(line)![0].length;
const unquoted = (line: string) => line.replace(/'(?:[^']|'')*'|"(?:[^"\\]|\\.)*"/g, '""');
const JOB_FILES = new Set([CI_FILES.gitlab, `/${CI_FILES.gitlab}`]);

/**
 * Reads one line outside block scalars. A `#` starts a comment only at the start or after whitespace and outside
 * quoted scalars; a quote opens a scalar only at the start or after whitespace or a flow indicator. Quoted scalars
 * and flow collections must close on the same line, and a flow mapping must not repeat a key; otherwise the line
 * is reported as a reason to leave the file alone.
 */
function scanLine(text: string): { code: string; comment: boolean } | string {
  let quote: string | undefined;
  const flow: { map: boolean; keys: Set<string>; entry: string }[] = [];
  const endEntry = () => {
    const top = flow[flow.length - 1]!;
    const key = (/^(.*?):(?:[ ]|$)/.exec(top.entry.trim())?.[1] ?? top.entry).trim();
    top.entry = '';
    if (!top.map || !key) return true;
    if (top.keys.has(key)) return false;
    top.keys.add(key);
    return true;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const top = flow[flow.length - 1];
    if (quote) {
      if (top) top.entry += c;
      if (quote === "'") { if (c === "'") { if (text[i + 1] === "'") { i++; if (top) top.entry += "'"; } else quote = undefined; } }
      else if (c === '\\') { i++; if (top) top.entry += text[i] ?? ''; } else if (c === '"') quote = undefined;
      continue;
    }
    const previous = i ? text[i - 1]! : ' ';
    if ((c === "'" || c === '"') && /[\s[{,]/.test(previous)) { quote = c; if (top) top.entry += c; }
    else if (c === '#' && /\s/.test(previous)) {
      if (flow.length) return 'has a flow collection that continues on the next line';
      return { code: text.slice(0, i).trimEnd(), comment: true };
    } else if ((c === '[' || c === '{') && (flow.length || /\s/.test(previous))) flow.push({ map: c === '{', keys: new Set(), entry: '' });
    else if ((c === ']' || c === '}') && top) {
      if ((c === '}') !== top.map) return 'has a flow collection init cannot read';
      if (!endEntry()) return 'repeats a key in a flow mapping';
      flow.pop();
    } else if (c === ',' && top) { if (!endEntry()) return 'repeats a key in a flow mapping'; }
    else if (top) top.entry += c;
  }
  if (quote) return 'has a quoted value that continues on the next line';
  if (flow.length) return 'has a flow collection that continues on the next line';
  return { code: text.trimEnd(), comment: false };
}

/** Returns the value of a single-line scalar init can read exactly, or undefined. */
function scalar(value: string): string | undefined {
  const single = /^'((?:[^']|'')*)'$/.exec(value);
  if (single) return single[1]!.replace(/''/g, "'");
  const double = /^"([^"\\]*)"$/.exec(value);
  if (double) return double[1];
  // Plain scalars only; indicators would start block scalars, flow nodes, anchors, aliases, tags or keys.
  if (!value || /^[\s&*!|>%@`{}[\],#?:'"-]/.test(value) || /:[ ]|:$|[ ]#/.test(value)) return undefined;
  return value;
}

type Scan = { lines: string[]; tokens: Token[]; headers: number[]; comments: number[]; keys: Key[] };

/**
 * Reads the whole file: every line must be blank, a comment, block scalar content, or a single-line code line,
 * no block mapping may repeat a key, and the top level must be a plain column-0 block mapping whose values do
 * not continue on later lines. Returns a reason when any line falls outside that.
 */
function scanFile(text: string): Scan | string {
  const lines = text.split('\n');
  const tokens: Token[] = [];
  const headers: number[] = [];
  const comments: number[] = [];
  const scopes: { col: number; keys: Set<string> }[] = [];
  let block = -1;
  for (const [i, line] of lines.entries()) {
    if (block >= 0) {
      if (line.trim() === '' || indentOf(line) > block) continue;
      block = -1;
    }
    if (line.trim() === '') continue;
    if (line.trim().startsWith('#')) { comments.push(i); continue; }
    const scanned = scanLine(line);
    if (typeof scanned === 'string') return `line ${i + 1} ${scanned}`;
    const indent = indentOf(line);
    tokens.push({ line: i, indent, code: scanned.code.slice(indent), comment: scanned.comment });
    // Duplicate keys in any block mapping, including mappings inside list items (`- a: 1` / `  a: 2`).
    while (scopes.length && scopes[scopes.length - 1]!.col > indent) scopes.pop();
    let col = indent;
    let rest = scanned.code.slice(indent);
    for (let item = ITEM_RE.exec(rest); item; item = ITEM_RE.exec(rest)) {
      col += item[0].length;
      rest = rest.slice(item[0].length);
      while (scopes.length && scopes[scopes.length - 1]!.col >= col) scopes.pop();
    }
    const key = rest ? KEY_RE.exec(rest) : null;
    if (key) {
      const name = key[1] ?? key[2]?.replace(/''/g, "'") ?? key[3]!;
      if (scopes[scopes.length - 1]?.col !== col) scopes.push({ col, keys: new Set() });
      const scope = scopes[scopes.length - 1]!;
      if (scope.keys.has(name)) return `it repeats the key '${name}' (line ${i + 1})`;
      scope.keys.add(name);
    }
    if (BLOCK_HEADER_RE.test(scanned.code)) { headers.push(i); block = indent; }
  }
  const keys = topLevelKeys(lines, tokens);
  return typeof keys === 'string' ? keys : { lines, tokens, headers, comments, keys };
}

/** The column-0 keys of the root mapping. Values that continue on deeper lines must be empty, a block scalar or only node properties. */
function topLevelKeys(lines: string[], tokens: Token[]): Key[] | string {
  const keys: Key[] = [];
  for (const token of tokens) {
    const i = token.line;
    const last = keys[keys.length - 1];
    if (token.indent > 0) {
      if (!last) return 'its top-level mapping is indented';
      if (last.value && !BLOCK_HEADER_RE.test(last.value) && !/^(?:[&!]\S*[ ]*)+$/.test(last.value)) {
        return `line ${i + 1} continues the value of the top-level key '${last.name}' on a new line`;
      }
      continue;
    }
    // "- " at column 0 continues an indentless sequence under the previous key.
    if (ITEM_RE.test(token.code)) {
      if (last && !last.value) continue;
      return `line ${i + 1} is a list item where init expects a key`;
    }
    const match = KEY_RE.exec(lines[i]!);
    if (!match) return `line ${i + 1} is not a key this tool can read`;
    // A double-quoted key with escapes (`"\x77orkflow"`, `"work\u0066low"`) could decode to any key; do not guess.
    if (match[1]?.includes('\\')) return `line ${i + 1} writes a key with escape sequences, which init does not decode`;
    const name = match[1] ?? match[2]?.replace(/''/g, "'") ?? match[3]!;
    if ((match[1] ?? match[2]) !== undefined && PLANNER_KEYS.has(name)) {
      return `line ${i + 1} writes the '${name}' key in quotes; init only edits it when it is written plainly`;
    }
    if (match[3] && (UNSAFE_KEY_START.test(name) || name === '<<')) return `line ${i + 1} uses a YAML key form init does not edit`;
    if (keys.some((key) => key.name === name)) return `it repeats the key '${name}'`;
    keys.push({ name, start: i, end: lines.length, indent: 0, value: token.code.replace(KEY_RE, '$4').trim() });
  }
  for (const [i, key] of keys.entries()) if (keys[i + 1]) key.end = keys[i + 1]!.start;
  return keys;
}

/**
 * Parses the body of a top-level key with an empty value as the strict YAML subset init understands: block
 * mappings with plain keys, block lists (indented or indentless), single-line scalars, nothing that continues a
 * value on a later line. Returns null for an empty body.
 */
function parseBody(source: Token[]): Node | null | string {
  const tokens = source.map((token) => ({ ...token }));
  let pos = 0;
  const fail = (token: Token, why: string) => `line ${token.line + 1} ${why}`;
  const deeper = (indent: number) => pos < tokens.length && tokens[pos]!.indent > indent;
  function block(indent: number): Node | string {
    return ITEM_RE.test(tokens[pos]!.code) ? seq(indent) : map(indent);
  }
  function child(indent: number): Node | null | string {
    const next = tokens[pos];
    if (!next || next.indent < indent) return null;
    if (next.indent === indent) return ITEM_RE.test(next.code) ? seq(indent) : null;
    return block(next.indent);
  }
  function seq(indent: number): Node | string {
    const items: (Node | null)[] = [];
    while (pos < tokens.length && tokens[pos]!.indent === indent && ITEM_RE.test(tokens[pos]!.code)) {
      const token = tokens[pos]!;
      const dash = ITEM_RE.exec(token.code)![0];
      const rest = token.code.slice(dash.length);
      let value: Node | null | string;
      if (!rest) { pos++; value = deeper(indent) ? block(tokens[pos]!.indent) : null; }
      else if (ITEM_RE.test(rest)) return fail(token, 'nests a list item on the same line');
      else if (PLAIN_KEY_RE.test(rest)) { tokens[pos] = { ...token, indent: indent + dash.length, code: rest }; value = map(indent + dash.length); }
      else {
        const text = scalar(rest);
        if (text === undefined) return fail(token, 'has a list item init cannot read');
        pos++;
        if (deeper(indent)) return fail(tokens[pos]!, 'continues a value on a new line');
        value = { kind: 'scalar', value: text };
      }
      if (typeof value === 'string') return value;
      items.push(value);
    }
    if (deeper(indent)) return fail(tokens[pos]!, 'is indented more than its list');
    return { kind: 'seq', indent, items };
  }
  function map(indent: number): Node | string {
    const entries = new Map<string, { line: number; value: Node | null }>();
    while (pos < tokens.length && tokens[pos]!.indent === indent && !ITEM_RE.test(tokens[pos]!.code)) {
      const token = tokens[pos]!;
      const match = PLAIN_KEY_RE.exec(token.code);
      if (!match) return fail(token, 'is not a plain key init can read (quoted keys, tags and other forms are not edited)');
      if (entries.has(match[1]!)) return fail(token, `repeats the key '${match[1]}'`);
      pos++;
      let value: Node | null | string;
      if (match[2] === undefined) value = child(indent);
      else {
        const text = scalar(match[2]);
        if (text === undefined) return fail(token, 'has a value init cannot read');
        if (deeper(indent)) return fail(tokens[pos]!, 'continues a value on a new line');
        value = { kind: 'scalar', value: text };
      }
      if (typeof value === 'string') return value;
      entries.set(match[1]!, { line: token.line, value });
    }
    if (deeper(indent)) return fail(tokens[pos]!, 'is indented more than its mapping');
    return { kind: 'map', indent, entries };
  }
  if (!tokens.length) return null;
  const result = block(tokens[0]!.indent);
  if (typeof result === 'string') return result;
  return pos === tokens.length ? result : fail(tokens[pos]!, 'is not part of the block init reads');
}

/** The body of a top-level key, after checking it holds none of the forms the strict subset excludes. */
function body(scan: Scan, key: Key, allowComments: boolean): Node | null | string {
  const tokens = scan.tokens.filter((token) => token.line > key.start && token.line < key.end);
  if (key.value) return 'has a value on the key line where init expects a block';
  if (scan.headers.some((line) => line > key.start && line < key.end)) return 'holds a block scalar (| or >)';
  if (tokens.some((token) => NODE_PROPERTY_RE.test(unquoted(token.code)))) return 'uses anchors, aliases, tags or merge keys';
  if (!allowComments && tokens.some((token) => token.comment)) return 'has a comment after a value';
  return parseBody(tokens);
}

const KNOWN_WHEN = new Set(['on_success', 'on_failure', 'always', 'never', 'manual', 'delayed']);
// `never` drops the pipeline, `manual` and `delayed` do not start it on its own: only these enable it.
const ENABLING_WHEN = new Set(['on_success', 'always']);
const MR_EXPRESSION_RE = /^\$CI_PIPELINE_SOURCE[ ]*==[ ]*(["'])merge_request_event\1$/;

type Plan = { kind: 'present' } | { kind: 'insert'; insertion: Insertion } | { kind: 'manual'; reason: string };

/**
 * Every `workflow: rules` entry must be a mapping of plain keys to single-line scalars with a known `when:`.
 * Only a first entry written as `- if: $CI_PIPELINE_SOURCE == "merge_request_event"` (plain, '...' or "..."),
 * optionally with `when: on_success` or `when: always` and nothing else, proves merge request pipelines run.
 */
function planWorkflow(scan: Scan, workflow: Key, tag: () => string): Plan {
  const manual = (reason: string): Plan => ({ kind: 'manual', reason: `its workflow: block ${reason}` });
  const node = body(scan, workflow, false);
  if (typeof node === 'string') return manual(`cannot be read safely (${node})`);
  if (!node || node.kind !== 'map') return manual(node ? 'is not a block mapping' : 'is empty');
  const rules = node.entries.get('rules');
  if (!rules) {
    // No rules: GitLab runs its default pipelines, so add the rule with the branch and tag rules that keep them.
    const childIndent = ' '.repeat(node.indent);
    const ruleLines = GITLAB_WORKFLOW_BLOCK.split('\n').slice(1, -1).map((line) => `${childIndent}${line.slice(2)}`);
    return { kind: 'insert', insertion: { at: workflow.start + 1, lines: [`${childIndent}${tag()}`, ...ruleLines] } };
  }
  if (!rules.value || rules.value.kind !== 'seq' || !rules.value.items.length) return manual('has rules: that are not a non-empty block list');
  const list = rules.value;
  const end = [...node.entries.values()].map((entry) => entry.line).filter((line) => line > rules.line).concat(workflow.end).reduce((a, b) => Math.min(a, b));
  const ruleTokens = scan.tokens.filter((token) => token.line > rules.line && token.line < end);
  // A comment line between two lines of the same rule entry is refused; comments between entries are fine.
  for (const line of scan.comments.filter((c) => c > rules.line && c < end)) {
    if ((ruleTokens.find((token) => token.line > line)?.indent ?? 0) > list.indent) return manual(`has a comment inside a rules: entry (line ${line + 1})`);
  }
  const mentions: number[] = [];
  const enabling: boolean[] = [];
  for (const [index, rule] of list.items.entries()) {
    const fields = rule?.kind === 'map' ? [...rule.entries] : undefined;
    if (!fields || fields.some(([, entry]) => entry.value?.kind !== 'scalar')) {
      return manual(`has a rules: entry init cannot read exactly (rule ${index + 1}: only key: single-line value pairs are read)`);
    }
    const values = new Map(fields.map(([name, entry]) => [name, (entry.value as { value: string }).value]));
    const when = values.get('when');
    if (when !== undefined && !KNOWN_WHEN.has(when)) return manual(`has an unknown when: in rule ${index + 1}`);
    if ([...values.values()].some((value) => value.includes('merge_request_event'))) mentions.push(index);
    enabling.push(MR_EXPRESSION_RE.test(values.get('if')?.trim() ?? '') && [...values.keys()].every((name) => name === 'if' || name === 'when')
      && (when === undefined || ENABLING_WHEN.has(when)));
  }
  // GitLab uses the first matching rule, so only a first entry that enables merge requests proves they run.
  if (enabling[0]) return { kind: 'present' };
  // A rule that mentions merge requests but is not a plain first enabling rule is a deliberate choice; leave it to a person.
  if (mentions.length) return manual('already has a merge_request_event rule that is not a plain first rule creating merge request pipelines');
  const itemIndent = ' '.repeat(list.indent);
  return { kind: 'insert', insertion: { at: rules.line + 1, lines: [`${itemIndent}${tag()}`, `${itemIndent}- if: '$CI_PIPELINE_SOURCE == "merge_request_event"'`] } };
}

function planInclude(scan: Scan, include: Key, tag: () => string): Plan {
  const manual = (reason: string): Plan => ({ kind: 'manual', reason: `its include: entry ${reason}` });
  if (include.value) {
    // A string include must be one single-line value; a plain value continued on later lines is refused by scanFile.
    const file = scalar(include.value);
    if (file !== undefined && JOB_FILES.has(file)) return { kind: 'present' };
    return manual('is not a block list init can extend safely');
  }
  const node = body(scan, include, true);
  if (typeof node === 'string') return manual(`cannot be read safely (${node})`);
  if (!node || node.kind !== 'seq') return manual('is not a block list init can extend safely');
  for (const item of node.items) {
    if (item?.kind === 'scalar' && JOB_FILES.has(item.value)) return { kind: 'present' };
    const local = item?.kind === 'map' ? item.entries.get('local')?.value : undefined;
    if (local?.kind === 'scalar' && JOB_FILES.has(local.value)) {
      // A local include of this file with extra keys (rules, inputs) may not always apply.
      if (item!.kind === 'map' && item!.entries.size === 1) return { kind: 'present' };
      return manual(`already includes ${CI_FILES.gitlab} in a form init cannot confirm`);
    }
  }
  const itemIndent = ' '.repeat(node.indent);
  return { kind: 'insert', insertion: { at: include.start + 1, lines: [`${itemIndent}${tag()}`, `${itemIndent}${INCLUDE_ITEM}`] } };
}

/**
 * Plans the smallest additive change that gives an existing root file the rule and the include. It works as an
 * allowlist: it only inserts whole lines into a file whose every line it can read (see scanFile and parseBody),
 * and reports any other layout as `manual`, so existing bytes are never rewritten.
 */
export function planGitlabRoot(original: string): GitlabRootPlan {
  const plan = draftPlan(original);
  if (plan.kind !== 'update') return plan;
  // Self-check: read the result with the same reader before anything is written.
  const problem = verifyResult(original, plan.text);
  return problem ? { kind: 'manual', reason: `init could not confirm its own edit (${problem})` } : plan;
}

function normalise(original: string): string | { reason: string } {
  const crlf = original.includes('\r\n');
  if (crlf && /(^|[^\r])\n/.test(original)) return { reason: 'it mixes line endings' };
  const text = crlf ? original.replace(/\r\n/g, '\n') : original;
  if (text.includes('\r')) return { reason: 'it uses unsupported line endings' };
  if (text.startsWith('\uFEFF')) return { reason: 'it starts with a byte order mark' };
  if (text.includes('\t')) return { reason: 'it contains tab characters' };
  if (/^(---|\.\.\.)([ ]|$)/m.test(text)) return { reason: 'it uses YAML document markers' };
  return text;
}

function draftPlan(original: string): GitlabRootPlan {
  const manual = (reason: string): GitlabRootPlan => ({ kind: 'manual', reason });
  const text = normalise(original);
  if (typeof text !== 'string') return manual(text.reason);
  const crlf = text !== original;
  const scan = scanFile(text);
  if (typeof scan === 'string') return manual(scan);
  const { lines, keys } = scan;
  const workflow = keys.find((key) => key.name === 'workflow');
  const include = keys.find((key) => key.name === 'include');

  let tagged = original.includes(AUTOMATED_TESTING_DISCLAIMER);
  const tag = () => {
    const disclaimer = tagged ? '' : ` ${AUTOMATED_TESTING_DISCLAIMER}`;
    tagged = true;
    return `# Added by a11ygate init.${disclaimer}`;
  };
  // Work out insertions in file order so the first inserted comment carries the disclaimer.
  const plans: { at: number; plan: () => Plan; label: string }[] = [];
  if (workflow) plans.push({ at: workflow.start, plan: () => planWorkflow(scan, workflow, tag), label: 'merge_request_event workflow rule' });
  if (include) plans.push({ at: include.start, plan: () => planInclude(scan, include, tag), label: 'include' });
  plans.sort((a, b) => a.at - b.at);

  const insertions: Insertion[] = [];
  const added: string[] = [];
  for (const entry of plans) {
    const result = entry.plan();
    if (result.kind === 'manual') return manual(result.reason);
    if (result.kind === 'present') continue;
    insertions.push(result.insertion);
    added.push(entry.label);
  }
  const appended: string[] = [];
  if (!include) { appended.push(GITLAB_INCLUDE_BLOCK); added.unshift('include'); }
  if (!workflow) { appended.push(GITLAB_WORKFLOW_BLOCK); added.push('merge_request_event workflow rule'); }
  if (!insertions.length && !appended.length) return { kind: 'unchanged' };

  const last = keys[keys.length - 1];
  if (appended.length && scan.headers.some((line) => !last || line >= last.start)) {
    // Lines appended after a block scalar (`|`, `>`, `|+`, `- - |+` ...) could become part of its value.
    return manual('its last top-level key holds a block scalar, so appending could change its value');
  }

  const out = [...lines];
  for (const insertion of [...insertions].sort((a, b) => b.at - a.at)) out.splice(insertion.at, 0, ...insertion.lines);
  let result = out.join('\n');
  if (appended.length) {
    if (result && !result.endsWith('\n')) result += '\n';
    result += `${result ? '\n' : ''}${tag()}\n${EXPLAINER}\n${appended.join('\n')}`;
  }
  return { kind: 'update', text: crlf ? result.replace(/\n/g, '\r\n') : result, added: added.sort((a, b) => (a === 'include' ? -1 : b === 'include' ? 1 : 0)) };
}

/**
 * Re-reads a planned result with the planner's own reader: exactly one top-level workflow and include, the include
 * lists the local job file, the first workflow rule is the enabling merge request rule, and every original line is
 * still there in order. Returns the first problem, or undefined.
 */
function verifyResult(original: string, result: string): string | undefined {
  const text = normalise(result);
  if (typeof text !== 'string') return text.reason;
  const scan = scanFile(text);
  if (typeof scan === 'string') return scan;
  const named = (name: string) => scan.keys.filter((key) => key.name === name);
  if (named('workflow').length !== 1 || named('include').length !== 1) return 'the result needs exactly one workflow: and one include:';
  const noTag = () => '';
  if (planInclude(scan, named('include')[0]!, noTag).kind !== 'present') return 'the result does not include the job file';
  if (planWorkflow(scan, named('workflow')[0]!, noTag).kind !== 'present') return 'the result does not start workflow: rules with the merge request rule';
  const before = original.split('\n');
  let kept = 0;
  for (const line of result.split('\n')) if (kept < before.length && line === before[kept]) kept++;
  return kept === before.length ? undefined : 'the result does not keep every original line in order';
}
