import { mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { run } from '@/packages/cli/src/run';
import { planGitlabRoot } from '@/packages/cli/src/init-gitlab';

// A11Y-R72: GitLab only creates merge request pipelines when the root .gitlab-ci.yml itself has a
// matching rule; rules that come only from include: files do not count.
const yaml = createRequire(import.meta.url)('js-yaml') as { load: (text: string) => unknown };
type Root = { include?: unknown; workflow?: { rules?: { if?: string; when?: string }[] }; [job: string]: unknown };
const MR = '$CI_PIPELINE_SOURCE == "merge_request_event"';
const ROOT = '.gitlab-ci.yml';
const JOBS = '.gitlab-ci.a11ygate.yml';
const repoWorkflows = path.resolve('.github/workflows');
let workflowsBefore: string[] = [];

beforeAll(async () => { workflowsBefore = (await readdir(repoWorkflows).catch(() => [])).sort(); });
afterAll(async () => {
  // Nothing in this suite may write into this repository's own workflow directory.
  expect((await readdir(repoWorkflows).catch(() => [])).sort()).toEqual(workflowsBefore);
});

async function temporary(work: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'a11ygate-r72-'));
  try {
    const root = await realpath(cwd);
    expect(path.dirname(root)).toBe(await realpath(tmpdir()));
    expect(root).not.toBe(await realpath(process.cwd()));
    await work(cwd);
  } finally { await rm(cwd, { recursive: true, force: true }); }
}
function capture(cwd: string) {
  let stdout = '', stderr = '';
  return { io: { cwd, stdout: (s: string) => { stdout += s; }, stderr: (s: string) => { stderr += s; } }, out: () => stdout, err: () => stderr };
}
const read = (cwd: string, file: string) => readFile(path.join(cwd, file), 'utf8');
const init = (cwd: string, ...flags: string[]) => {
  const c = capture(cwd);
  return run(['init', '--yes', '--target', 'gitlab', ...flags], c.io).then((code) => ({ code, out: c.out(), err: c.err() }));
};
const load = (text: string) => yaml.load(text) as Root;
/** The file's own rules: the root workflow, never anything reached through include:. */
const ownMrRule = (root: Root) => (root.workflow?.rules ?? []).some((rule) => rule.if === MR && rule.when !== 'never');
/** Removes the include: block so the assertion cannot be satisfied by include text alone. */
const withoutInclude = (text: string) => text.replace(/^include:[^\n]*\n(?:(?:[ ]+|- )[^\n]*\n|\n)*/m, '');

/** Every line of the original is kept, byte for byte and in order; the result only adds lines and parses. */
function expectInsertedOnly(original: string, result: string) {
  const before = original.split('\n');
  const after = result.split('\n');
  let i = 0;
  for (const line of after) if (i < before.length && line === before[i]) i++;
  expect(i, 'original lines kept in order').toBe(before.length);
  expect(after.length).toBeGreaterThan(before.length);
  expect(() => load(result)).not.toThrow();
  const parsed = load(result);
  for (const [key, value] of Object.entries(load(original) ?? {})) {
    if (key !== 'include' && key !== 'workflow') expect(parsed[key], key).toEqual(value);
  }
}

describe('init --target gitlab root .gitlab-ci.yml (A11Y-R72)', () => {
  it('writes a root file whose own workflow rules create merge request pipelines and includes the generated job', async () => temporary(async (cwd) => {
    const { code, out } = await init(cwd);
    expect(code).toBe(0);
    const text = await read(cwd, ROOT);
    const root = load(text);
    expect(ownMrRule(root)).toBe(true);
    expect(root.include).toEqual([{ local: JOBS }]);
    // The rule is in the root text itself, not solely under include:.
    expect(withoutInclude(text)).toContain(`- if: '${MR}'`);
    // Branch and tag pipelines are kept.
    expect(root.workflow!.rules!.map((rule) => rule.if)).toEqual([MR, '$CI_COMMIT_BRANCH', '$CI_COMMIT_TAG']);
    // The job steps stay only in the generated include, without copy-paste drift.
    expect(Object.keys(root)).toEqual(['include', 'workflow']);
    const jobs = load(await read(cwd, JOBS)) as { a11ygate: { script: string[] } };
    expect(jobs.a11ygate.script[0]).toContain('a11ygate scan');
    expect(text).toContain(AUTOMATED_TESTING_DISCLAIMER);
    expect(out).toContain(`Wrote ${JOBS}\nWrote ${ROOT}\n`);
    expect(out).not.toContain('Add this entry');
    await expect(text).toMatchFileSnapshot(`fixtures/init/gitlab/${ROOT}`);
    await expect(await read(cwd, JOBS)).toMatchFileSnapshot('fixtures/init/gitlab/jobs.gitlab-ci.yml');
    await expect(await read(cwd, '.a11ygate.yml')).toMatchFileSnapshot('fixtures/init/gitlab/.a11ygate.yml');
    await expect(out).toMatchFileSnapshot('fixtures/init/gitlab/stdout.txt');
  }));

  it('adds the rule and include to an existing root file without removing its jobs, then skips on rerun and with --force', async () => temporary(async (cwd) => {
    const original = 'stages: [build, test]\n\nbuild:\n  stage: build\n  script:\n    - npm run build\n\ntest:unit:\n  stage: test\n  script: [npm test]\n';
    await writeFile(path.join(cwd, ROOT), original);
    const first = await init(cwd);
    expect(first.code, first.err).toBe(0);
    const text = await read(cwd, ROOT);
    expect(text.startsWith(original)).toBe(true);
    const root = load(text);
    expect(ownMrRule(root)).toBe(true);
    expect(root.include).toEqual([{ local: JOBS }]);
    expect(root).toMatchObject(load(original));
    expect(withoutInclude(text)).toContain(MR);
    expect(first.out).toContain(`Updated ${ROOT}: added the include and the merge_request_event workflow rule`);
    const mtime = (await stat(path.join(cwd, ROOT))).mtimeMs;
    for (const flags of [[], ['--force']]) {
      const again = await init(cwd, ...flags);
      expect(again.code).toBe(0);
      expect(again.out).toContain(`Skipped existing ${ROOT} (it already has a merge_request_event workflow rule`);
      expect(await read(cwd, ROOT)).toBe(text);
      expect((await stat(path.join(cwd, ROOT))).mtimeMs).toBe(mtime);
    }
  }));

  it.each([
    ['indented list', 'include:\n  - template: Security/SAST.gitlab-ci.yml\nlint:\n  script: [npm run lint]\n'],
    ['indentless list', 'include:\n- project: group/shared\n  file: /ci.yml\nlint:\n  script: [npm run lint]\n'],
  ])('inserts the local include into an existing %s', async (_, original) => temporary(async (cwd) => {
    await writeFile(path.join(cwd, ROOT), original);
    expect((await init(cwd)).code).toBe(0);
    const root = load(await read(cwd, ROOT));
    expect(root.include).toEqual(expect.arrayContaining([{ local: JOBS }, ...(load(original).include as unknown[])]));
    expect((root.include as unknown[]).length).toBe((load(original).include as unknown[]).length + 1);
    expect(root.lint).toEqual({ script: ['npm run lint'] });
    expect(ownMrRule(root)).toBe(true);
  }));

  it('skips an existing file that already has the rule and the include, without and with --force', async () => temporary(async (cwd) => {
    const original = `include:\n  - local: '${JOBS}'\n\nworkflow:\n  rules:\n    - if: $CI_PIPELINE_SOURCE == "merge_request_event"\n    - if: $CI_COMMIT_BRANCH == "main"\n\ndeploy:\n  script: [./deploy]\n`;
    await writeFile(path.join(cwd, ROOT), original);
    for (const flags of [[], ['--force']]) {
      const result = await init(cwd, ...flags);
      expect(result.code).toBe(0);
      expect(result.out).toContain(`Skipped existing ${ROOT}`);
      expect(await read(cwd, ROOT)).toBe(original);
    }
  }));

  it('adds only the include when an existing workflow already has the rule', async () => temporary(async (cwd) => {
    const original = 'workflow:\n  rules:\n    - if: \'$CI_PIPELINE_SOURCE == "merge_request_event"\'\n    - if: $CI_COMMIT_TAG\n';
    await writeFile(path.join(cwd, ROOT), original);
    const result = await init(cwd);
    expect(result.code).toBe(0);
    expect(result.out).toContain(`Updated ${ROOT}: added the include;`);
    const text = await read(cwd, ROOT);
    expect(text.startsWith(original)).toBe(true);
    expect(load(text).workflow).toEqual(load(original).workflow);
    expect(load(text).include).toEqual([{ local: JOBS }]);
  }));

  it.each([
    ['a merge request rule that says when: never', 'workflow:\n  rules:\n    - if: $CI_PIPELINE_SOURCE == "merge_request_event"\n      when: never\n    - when: always\n'],
    ['a string include', 'include: ci/shared.yml\nbuild:\n  script: [make]\n'],
    ['YAML document markers', '---\nbuild:\n  script: [make]\n'],
    ['several YAML documents', 'build:\n  script: [make]\n---\ntest:\n  script: [true]\n'],
    // Review of #91: an indented root mapping is valid YAML, but appending column-0 keys would break it.
    ['an indented root mapping', '  build:\n    script: [make]\n  test:\n    script: [true]\n'],
    // Review of #91: appended lines would become part of a trailing keep-chomping block scalar.
    ['a trailing |+ block scalar', 'notes:\n  text: |+\n    hello\n'],
    ['a trailing top-level |+ block scalar without a final newline', 'build:\n  script: [make]\nmessage: |+\n  hello'],
    ['a trailing >- block scalar', 'build:\n  script:\n    - >-\n      make all\n'],
    ['a flow-style root mapping', '{build: {script: [make]}}\n'],
    ['tab characters', 'build:\n  script:\n    - make\t-j2\n'],
    ['mixed line endings', 'build:\r\n  script: [make]\n'],
    ['a top-level merge key', '.base: &base\n  image: node\n<<: *base\n'],
    ['a workflow alias', '.wf: &wf\n  rules:\n    - if: $CI_COMMIT_BRANCH\nworkflow: *wf\n'],
    ['workflow rules from !reference', 'workflow:\n  rules:\n    - !reference [.rules, branch]\n'],
    ['flow-style workflow rules', 'workflow:\n  rules: [{if: $CI_COMMIT_BRANCH}]\n'],
    ['an anchored workflow rules list', 'workflow:\n  rules: &rules\n    - if: $CI_COMMIT_BRANCH\n'],
    ['a local include of the job file with its own rules', `include:\n  - local: '${JOBS}'\n    rules:\n      - if: $CI_COMMIT_BRANCH\n`],
  ])('leaves a root file with %s unchanged, prints the snippet and exits non-zero', async (_, original) => temporary(async (cwd) => {
    await writeFile(path.join(cwd, ROOT), original);
    const result = await init(cwd);
    expect(result.code).toBe(2);
    expect(await read(cwd, ROOT)).toBe(original);
    expect(result.err).toContain(`Left ${ROOT} unchanged`);
    expect(result.err).toContain(`include:\n  - local: '${JOBS}'\n\nworkflow:\n  rules:\n    - if: '${MR}'`);
    // The job file is still generated so the printed snippet can be applied by hand.
    expect(await read(cwd, JOBS)).toContain('a11ygate:');
    expect(result.out).toContain(AUTOMATED_TESTING_DISCLAIMER);
  }));

  it.each([
    ['indented', 'workflow:\n  name: Pipeline\n  rules:\n    - if: $CI_COMMIT_BRANCH == "main"\n    - if: $CI_COMMIT_TAG\n      when: always\n\nbuild:\n  script: [make]\n', '    '],
    ['indentless', 'workflow:\n  rules:\n  - if: $CI_COMMIT_BRANCH\n\nbuild:\n  script: [make]\n', '  '],
  ])('prepends the merge request rule to an existing %s workflow rules list and keeps the other rules', async (_, original, indent) => temporary(async (cwd) => {
    await writeFile(path.join(cwd, ROOT), original);
    const result = await init(cwd);
    expect(result.code, result.err).toBe(0);
    expect(result.out).toContain(`Updated ${ROOT}: added the include and the merge_request_event workflow rule`);
    const text = await read(cwd, ROOT);
    expectInsertedOnly(original, text);
    expect(text).toContain(`  rules:\n${indent}# Added by a11ygate init. ${AUTOMATED_TESTING_DISCLAIMER}\n${indent}- if: '${MR}'\n`);
    const root = load(text);
    const before = load(original).workflow!.rules!;
    expect(root.workflow!.rules).toEqual([{ if: MR }, ...before]);
    expect(root.build).toEqual({ script: ['make'] });
    expect(root.include).toEqual([{ local: JOBS }]);
    // A rerun finds both and leaves the file alone.
    expect((await init(cwd)).out).toContain(`Skipped existing ${ROOT}`);
    expect(await read(cwd, ROOT)).toBe(text);
  }));

  it('adds rules that keep branch and tag pipelines to a workflow block without rules', async () => temporary(async (cwd) => {
    const original = 'workflow:\n  name: "Pipeline for $CI_COMMIT_REF_NAME"\n\nbuild:\n  script: [make]\n';
    await writeFile(path.join(cwd, ROOT), original);
    expect((await init(cwd)).code).toBe(0);
    const text = await read(cwd, ROOT);
    expectInsertedOnly(original, text);
    const root = load(text);
    expect(root.workflow).toMatchObject({ name: 'Pipeline for $CI_COMMIT_REF_NAME' });
    expect(root.workflow!.rules!.map((rule) => rule.if)).toEqual([MR, '$CI_COMMIT_BRANCH', '$CI_COMMIT_TAG']);
  }));

  it.each([
    ['a cross-project include of a file with the same name', `include:\n  - project: group/shared\n    file: '/${JOBS}'\n  - remote: 'https://example.invalid/${JOBS}'\n  - template: ${JOBS}\n`],
    ['a rules:changes mention of the job file', `build:\n  script: [make]\n  rules:\n    - changes:\n        - ${JOBS}\n`],
    ['a comment that mentions the job file', `# TODO include ${JOBS}\nbuild:\n  script: [make]\n`],
  ])('does not mistake %s for the local include', async (_, original) => temporary(async (cwd) => {
    await writeFile(path.join(cwd, ROOT), original);
    const result = await init(cwd);
    expect(result.code, result.err).toBe(0);
    expect(result.out).toContain(`Updated ${ROOT}: added the include`);
    const text = await read(cwd, ROOT);
    expectInsertedOnly(original, text);
    const root = load(text);
    expect(root.include).toEqual(expect.arrayContaining([{ local: JOBS }]));
    expect(ownMrRule(root)).toBe(true);
  }));

  it.each([
    ['a list entry', `include:\n  - '${JOBS}'\n`],
    ['a local entry with a leading slash', `include:\n- local: "/${JOBS}"  # job\n`],
    ['a string include', `include: ${JOBS}\n`],
  ])('recognises the local include written as %s', async (_, include) => temporary(async (cwd) => {
    const original = `${include}workflow:\n  rules:\n    - if: $CI_PIPELINE_SOURCE == 'merge_request_event'\n`;
    await writeFile(path.join(cwd, ROOT), original);
    const result = await init(cwd);
    expect(result.code).toBe(0);
    expect(result.out).toContain(`Skipped existing ${ROOT}`);
    expect(await read(cwd, ROOT)).toBe(original);
  }));

  it('adds the disclaimer when it only inserts the include into an existing list', async () => temporary(async (cwd) => {
    const original = `include:\n  - template: Security/SAST.gitlab-ci.yml\n\nworkflow:\n  rules:\n    - if: $CI_PIPELINE_SOURCE == "merge_request_event"\n`;
    await writeFile(path.join(cwd, ROOT), original);
    const result = await init(cwd);
    expect(result.code).toBe(0);
    expect(result.out).toContain(`Updated ${ROOT}: added the include;`);
    const text = await read(cwd, ROOT);
    expectInsertedOnly(original, text);
    expect(text).toContain(`include:\n  # Added by a11ygate init. ${AUTOMATED_TESTING_DISCLAIMER}\n  - local: '${JOBS}'\n`);
    expect(text.split(AUTOMATED_TESTING_DISCLAIMER).length).toBe(2);
  }));

  it('does not repeat the disclaimer when the root file already carries it', () => {
    const original = `# ${AUTOMATED_TESTING_DISCLAIMER}\ninclude:\n  - template: Jobs/SAST.gitlab-ci.yml\nworkflow:\n  rules:\n    - if: $CI_COMMIT_BRANCH\n`;
    const plan = planGitlabRoot(original);
    expect(plan.kind).toBe('update');
    if (plan.kind !== 'update') return;
    expect(plan.text.split(AUTOMATED_TESTING_DISCLAIMER).length).toBe(2);
    expectInsertedOnly(original, plan.text);
  });

  it('only inserts lines and keeps trailing block scalars that are not last unchanged', () => {
    const original = 'notes:\n  text: |+\n    hello\n\nbuild:\n  script: [make]';
    const plan = planGitlabRoot(original);
    expect(plan.kind).toBe('update');
    if (plan.kind !== 'update') return;
    expect(plan.text.startsWith(`${original}\n`)).toBe(true);
    expect((load(plan.text) as { notes: { text: string } }).notes.text).toBe((load(original) as { notes: { text: string } }).notes.text);
  });

  it('refuses a symlinked root file, without and with --force, before writing anything', async () => temporary(async (cwd) => {
    const outside = await mkdtemp(path.join(tmpdir(), 'a11ygate-r72-outside-'));
    try {
      await writeFile(path.join(outside, 'pipeline.yml'), 'keep: me\n');
      await symlink(path.join(outside, 'pipeline.yml'), path.join(cwd, ROOT));
      for (const flags of [[], ['--force']]) {
        const result = await init(cwd, ...flags);
        expect(result.code).toBe(2);
        expect(result.err).toContain('refusing to edit a symlink');
        expect(await read(outside, 'pipeline.yml')).toBe('keep: me\n');
        await expect(read(cwd, JOBS)).rejects.toMatchObject({ code: 'ENOENT' });
      }
    } finally { await rm(outside, { recursive: true, force: true }); }
  }));

  it('keeps CRLF line endings and does not write into this repository', async () => temporary(async (cwd) => {
    await writeFile(path.join(cwd, ROOT), 'build:\r\n  script: [make]\r\n');
    expect((await init(cwd)).code).toBe(0);
    const text = await read(cwd, ROOT);
    expect(text.replace(/\r\n/g, '')).not.toContain('\n');
    expect(ownMrRule(load(text))).toBe(true);
    await expect(read(cwd, '.github/workflows/a11ygate.yml')).rejects.toMatchObject({ code: 'ENOENT' });
  }));

  it('plans conservatively for job names with colons and comments', () => {
    const plan = planGitlabRoot('# pipeline\ntest:unit:\n  script: [npm test]\n"quoted job":\n  script: [true]\n');
    expect(plan.kind).toBe('update');
    if (plan.kind === 'update') expect(Object.keys(load(plan.text))).toEqual(['test:unit', 'quoted job', 'include', 'workflow']);
    expect(planGitlabRoot('build:\n\tscript: [make]\n').kind).toBe('manual');
    expect(planGitlabRoot('a: 1\na: 2\n').kind).toBe('manual');
  });
});

// Fix round 2026-11-28 (review 2 of #91): quoted/escaped keys and comment-fooled rule detection.
const ENABLING_WHEN = new Set([undefined, 'on_success', 'always']);
type Rule = { if?: unknown; when?: unknown };
/** The parsed root's first workflow rule creates merge request pipelines (GitLab uses the first match). */
const firstRuleEnables = (root: Root) => {
  const first = (root.workflow?.rules as Rule[] | undefined)?.[0];
  return !!first && typeof first.if === 'string' && /^\$CI_PIPELINE_SOURCE\s*==\s*(["'])merge_request_event\1$/.test(first.if.trim())
    && ENABLING_WHEN.has(first.when as string | undefined) && Object.keys(first).every((key) => key === 'if' || key === 'when');
};
/** Whenever init exits 0, the root parses (js-yaml rejects duplicate keys) and its own rules create MR pipelines. */
function expectSafeOutcome(code: number, original: string, after: string) {
  if (code !== 0) {
    expect(code).toBe(2);
    expect(after, 'file byte-identical on refusal').toBe(original);
    return;
  }
  expect(() => load(after), 'result parses without duplicate keys').not.toThrow();
  expect(firstRuleEnables(load(after)), 'root workflow.rules starts with an enabling MR rule').toBe(true);
}

describe('init --target gitlab refuses root layouts it cannot read exactly (A11Y-R72 fix round)', () => {
  const refusals: [string, string][] = [
    ['(a) a double-quoted "workflow" key', `"workflow":\n  rules:\n    - if: $CI_COMMIT_BRANCH\nbuild:\n  script: [make]\n`],
    ['(b) a single-quoted \'workflow\' key', `'workflow':\n  rules:\n    - if: $CI_COMMIT_BRANCH\nbuild:\n  script: [make]\n`],
    ['(c) an escaped "\\x77orkflow" key', `"\\x77orkflow":\n  rules:\n    - if: $CI_COMMIT_BRANCH\n`],
    ['(c) an escaped "work\\u0066low" key', `"work\\u0066low":\n  name: Pipeline\n`],
    ['(c) an escaped "wor\\U0000006Bflow" key', `"wor\\U0000006Bflow":\n  name: Pipeline\n`],
    ['(c) an escaped "\\/" in the "workflow" key', `"\\/workflow":\n  name: Pipeline\n"work\\x66low":\n  name: Pipeline\n`],
    ['(d) a double-quoted "include" key', `"include":\n  - template: Jobs/SAST.gitlab-ci.yml\nbuild:\n  script: [make]\n`],
    ['(d) a single-quoted \'include\' key', `'include':\n  - local: '${JOBS}'\n`],
    ['(d) an escaped "\\x69nclude" key', `"\\x69nclude":\n  - template: Jobs/SAST.gitlab-ci.yml\n`],
    ['a quoted \'rules\' key inside workflow', `workflow:\n  'rules':\n    - if: $CI_COMMIT_BRANCH\n`],
    ['a quoted local key in the include list', `include:\n  - 'local': '${JOBS}'\n`],
    ['(e) a branch-only rule whose inline comment has the MR expression', `workflow:\n  rules:\n    - if: '$CI_COMMIT_BRANCH' # $CI_PIPELINE_SOURCE == "merge_request_event"\n`],
    ['(e) an MR rule with a trailing comment', `workflow:\n  rules:\n    - if: '${MR}' # mr\n`],
    ['(f) an MR rule with \'when\': never', `workflow:\n  rules:\n    - if: '${MR}'\n      'when': never\n    - if: $CI_COMMIT_BRANCH\n`],
    ['(f) an MR rule with "when": never', `workflow:\n  rules:\n    - if: '${MR}'\n      "when": never\n    - if: $CI_COMMIT_BRANCH\n`],
    ['an MR rule with when: manual', `workflow:\n  rules:\n    - if: '${MR}'\n      when: manual\n`],
    ['an MR rule with when: delayed', `workflow:\n  rules:\n    - if: '${MR}'\n      when: delayed\n      start_in: 1 minute\n`],
    ['an MR rule written as a flow mapping', `workflow:\n  rules:\n    - {if: '${MR}', when: never}\n`],
    ['an MR rule with a multi-line value', `workflow:\n  rules:\n    - if: >-\n        ${MR}\n`],
    ['an MR rule that is not the first rule', `workflow:\n  rules:\n    - when: never\n    - if: '${MR}'\n`],
    ['an MR rule combined with another condition', `workflow:\n  rules:\n    - if: '${MR} && $FOO'\n`],
    ['(g) a quoted if-expression with # around the MR text', `workflow:\n  rules:\n    - if: '$CI_PIPELINE_SOURCE == "merge_request_event" #x'\n`],
  ];
  it.each(refusals)('refuses %s: exit 2, file byte-identical, snippet printed', async (_, original) => temporary(async (cwd) => {
    expect(() => load(original), 'fixture is valid YAML').not.toThrow();
    await writeFile(path.join(cwd, ROOT), original);
    const result = await init(cwd);
    expect(result.code, result.out).toBe(2);
    expect(await read(cwd, ROOT)).toBe(original);
    expect(result.err).toContain(`Left ${ROOT} unchanged`);
    expect(result.err).toContain(`include:\n  - local: '${JOBS}'\n\nworkflow:\n  rules:\n    - if: '${MR}'`);
    expectSafeOutcome(result.code, original, await read(cwd, ROOT));
  }));

  it.each([
    ['(g) a # inside a quoted branch condition', `workflow:\n  rules:\n    - if: '$CI_COMMIT_TITLE == "fix #1"'\n    - if: "$CI_COMMIT_TAG =~ / #release/"\n`, 'update'],
    ['(g) a # inside a quoted MR rule followed by other rules', `include:\n  - local: '${JOBS}'\nworkflow:\n  rules:\n    - if: "$CI_PIPELINE_SOURCE == 'merge_request_event'"\n    - if: '$CI_COMMIT_TITLE == "wip #2"'\n`, 'unchanged'],
    ['a quoted job name containing #', `"lint #1":\n  script: [npm run lint]\nbuild:\n  name: "a #b"\n  script: [make]\n`, 'update'],
    ['an MR rule with when: always', `include: ${JOBS}\nworkflow:\n  rules:\n    - if: $CI_PIPELINE_SOURCE == "merge_request_event"\n      when: always\n`, 'unchanged'],
  ])('handles %s without a false positive', async (_, original, kind) => temporary(async (cwd) => {
    expect(planGitlabRoot(original).kind).toBe(kind);
    await writeFile(path.join(cwd, ROOT), original);
    const result = await init(cwd);
    expect(result.code, result.err).toBe(0);
    const after = await read(cwd, ROOT);
    if (kind === 'unchanged') expect(after).toBe(original);
    else expectInsertedOnly(original, after);
    expectSafeOutcome(result.code, original, after);
  }));

  // Property-style check over the update/skip cases above and in the main suite: exit 0 => parses + enabling MR rule.
  const corpus = [
    'stages: [build, test]\n\nbuild:\n  stage: build\n  script:\n    - npm run build\n\ntest:unit:\n  stage: test\n  script: [npm test]\n',
    'include:\n  - template: Security/SAST.gitlab-ci.yml\nlint:\n  script: [npm run lint]\n',
    'include:\n- project: group/shared\n  file: /ci.yml\nlint:\n  script: [npm run lint]\n',
    `include:\n  - local: '${JOBS}'\n\nworkflow:\n  rules:\n    - if: $CI_PIPELINE_SOURCE == "merge_request_event"\n    - if: $CI_COMMIT_BRANCH == "main"\n\ndeploy:\n  script: [./deploy]\n`,
    'workflow:\n  rules:\n    - if: \'$CI_PIPELINE_SOURCE == "merge_request_event"\'\n    - if: $CI_COMMIT_TAG\n',
    'workflow:\n  name: Pipeline\n  rules:\n    - if: $CI_COMMIT_BRANCH == "main"\n    - if: $CI_COMMIT_TAG\n      when: always\n\nbuild:\n  script: [make]\n',
    'workflow:\n  rules:\n  - if: $CI_COMMIT_BRANCH\n\nbuild:\n  script: [make]\n',
    'workflow:\n  name: "Pipeline for $CI_COMMIT_REF_NAME"\n\nbuild:\n  script: [make]\n',
    `include:\n  - project: group/shared\n    file: '/${JOBS}'\n  - remote: 'https://example.invalid/${JOBS}'\n  - template: ${JOBS}\n`,
    `build:\n  script: [make]\n  rules:\n    - changes:\n        - ${JOBS}\n`,
    `# TODO include ${JOBS}\nbuild:\n  script: [make]\n`,
    `include:\n- local: "/${JOBS}"  # job\nworkflow:\n  rules:\n    - if: $CI_PIPELINE_SOURCE == 'merge_request_event'\n`,
    `include: ${JOBS}\nworkflow:\n  rules:\n    - if: $CI_PIPELINE_SOURCE == 'merge_request_event'\n`,
    `# ${AUTOMATED_TESTING_DISCLAIMER}\ninclude:\n  - template: Jobs/SAST.gitlab-ci.yml\nworkflow:\n  rules:\n    - if: $CI_COMMIT_BRANCH\n`,
    'notes:\n  text: |+\n    hello\n\nbuild:\n  script: [make]',
    'build:\r\n  script: [make]\r\n',
    '# pipeline\ntest:unit:\n  script: [npm test]\n"quoted job":\n  script: [true]\n',
    ...refusals.map(([, text]) => text),
  ];
  it('never reports success for a root that would not parse or lacks an enabling MR rule', () => {
    for (const original of corpus) {
      const plan = planGitlabRoot(original);
      if (plan.kind === 'manual') continue;
      const after = plan.kind === 'update' ? plan.text : original;
      expectSafeOutcome(0, original, after);
      if (plan.kind === 'update') expect(load(after).include, original).toEqual(expect.arrayContaining([expect.anything()]));
    }
  });
});

describe('GitLab docs describe the root merge request rule (A11Y-R72)', () => {
  const section = (text: string, heading: string) => {
    const start = text.indexOf(heading);
    expect(start, heading).toBeGreaterThanOrEqual(0);
    const next = text.slice(start + heading.length).search(/\n#{2,3} /);
    return next < 0 ? text.slice(start) : text.slice(start, start + heading.length + next);
  };
  const docs: [string, string][] = [
    ['docs/pilot/quickstart.md', '### GitLab CI'],
    ['docs/integrations/init.md', '## Finish GitLab or Azure DevOps setup'],
    ['integrations/gitlab/README.md', '# GitLab Code Quality and JUnit'],
  ];

  it.each(docs)('%s puts merge_request_event in root workflow rules, not only behind include:', async (file, heading) => {
    const text = section(await readFile(file, 'utf8'), heading);
    const workflows = [...text.matchAll(/```yaml\n([\s\S]*?)```/g)].map((match) => load(match[1]!)).filter((root) => root.workflow);
    expect(workflows.length, file).toBeGreaterThan(0);
    for (const root of workflows) {
      expect(ownMrRule(root), file).toBe(true);
      expect(root.workflow!.rules!.map((rule) => rule.if), file).toEqual(expect.arrayContaining(['$CI_COMMIT_BRANCH', '$CI_COMMIT_TAG']));
    }
    expect(text, file).toMatch(/root `\.gitlab-ci\.yml`/);
    expect(text, file).toMatch(/include(:`)?( entry)?\s+alone\s+is\s+not\s+enough/);
    // Wording from before A11Y-R72 that implied an include hint was sufficient.
    expect(text, file).not.toMatch(/Add this entry to your \.gitlab-ci\.yml include list|add the generated local include entry|init` never edits your existing `\.gitlab-ci\.yml`|add the printed `include:` entry yourself/);
  });

  it('the init guide and quickstart show exactly what init writes', async () => {
    const { GITLAB_ROOT_SNIPPET } = await import('@/packages/cli/src/init-gitlab');
    for (const [file, heading] of docs.slice(0, 2)) {
      expect(section(await readFile(file, 'utf8'), heading), file).toContain(`\`\`\`yaml\n${GITLAB_ROOT_SNIPPET}\`\`\``);
    }
  });
});
