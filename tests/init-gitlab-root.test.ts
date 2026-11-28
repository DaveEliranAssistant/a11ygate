import { createHash } from 'node:crypto';
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { run } from '@/packages/cli/src/run';
import { GITLAB_ROOT_SNIPPET, GITLAB_ROOT_TEMPLATE } from '@/packages/cli/src/init-gitlab';

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

describe('init --target gitlab root .gitlab-ci.yml (A11Y-R72)', () => {
  it('writes a root file whose own workflow rules create merge request pipelines and includes the generated job', async () => temporary(async (cwd) => {
    const { code, out } = await init(cwd);
    expect(code).toBe(0);
    const text = await read(cwd, ROOT);
    // The golden itself carries the rule in its own workflow.rules and includes the job file.
    const golden = await readFile(path.join('tests/fixtures/init/gitlab', ROOT), 'utf8');
    expect(text).toBe(golden);
    expect(ownMrRule(load(golden))).toBe(true);
    expect(load(golden).include).toEqual([{ local: JOBS }]);
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


  it('prints exactly the include and rule text the created root file contains (single source)', async () => temporary(async (cwd) => {
    await init(cwd);
    const created = await read(cwd, ROOT);
    expect(created.endsWith(GITLAB_ROOT_SNIPPET)).toBe(true);
    expect(created).toBe(GITLAB_ROOT_TEMPLATE);
    const { code, err } = await init(cwd);
    expect(code).toBe(2);
    expect(err).toContain(`\n${GITLAB_ROOT_SNIPPET}`);
    // The printed snippet parses to the same include and workflow rules as the created file.
    const snippet = load(GITLAB_ROOT_SNIPPET);
    expect(snippet).toEqual({ include: load(created).include, workflow: load(created).workflow });
    expect(ownMrRule(snippet)).toBe(true);
  }));
});

const sha = async (file: string) => createHash('sha256').update(await readFile(file)).digest('hex');

/** Every entry under dir (never following symlinks): kind, readlink target or file bytes hash. */
async function tree(dir: string, prefix = ''): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const name of (await readdir(path.join(dir, prefix))).sort()) {
    const rel = path.join(prefix, name);
    const full = path.join(dir, rel);
    const info = await lstat(full);
    if (info.isSymbolicLink()) result[rel] = `link -> ${await readlink(full)}`;
    else if (info.isDirectory()) { result[rel] = 'dir'; Object.assign(result, await tree(dir, rel)); }
    else result[rel] = `file ${await sha(full)} ${info.mtimeMs}`;
  }
  return result;
}

describe('init --target gitlab never writes an existing root .gitlab-ci.yml (A11Y-R72, owner option (a))', () => {
  const existing: [string, string][] = [
    ['a customer pipeline', 'stages: [test]\n\ntest:unit:\n  stage: test\n  script:\n    - npm test\n'],
    ['an empty file', ''],
    ['a file that already has the rule and include', GITLAB_ROOT_TEMPLATE],
    ['invalid YAML', 'include: [unclosed\n  - : :\n\tbad: "x\n'],
  ];

  it.each(existing)('leaves %s byte-identical, exits 2 and prints the snippet, also with --force', async (_, original) => temporary(async (cwd) => {
    const file = path.join(cwd, ROOT);
    await writeFile(file, original);
    const before = { hash: await sha(file), mtime: (await stat(file)).mtimeMs };
    await new Promise((resolve) => setTimeout(resolve, 20));
    for (const flags of [[], ['--force']]) {
      const { code, out, err } = await init(cwd, ...flags);
      expect(code).toBe(2);
      expect(await readFile(file, 'utf8')).toBe(original);
      expect(await sha(file)).toBe(before.hash);
      expect((await stat(file)).mtimeMs).toBe(before.mtime);
      expect(err).toContain(`Left existing ${ROOT} unchanged`);
      expect(err).toContain(`\n${GITLAB_ROOT_SNIPPET}`);
      expect(err).toMatch(/include alone is not enough/);
      expect(out).not.toContain(`Wrote ${ROOT}`);
      expect(out).not.toContain('Open a test merge request');
      // The other starter files are still written.
      expect(load(await read(cwd, JOBS))).toHaveProperty('a11ygate');
      expect(await read(cwd, '.a11ygate.yml')).toContain('ciTarget: gitlab');
    }
  }));

  it('still writes --pilot files when the root file exists', async () => temporary(async (cwd) => {
    await writeFile(path.join(cwd, ROOT), '# customer\n');
    const { code } = await init(cwd, '--pilot');
    expect(code).toBe(2);
    expect(await read(cwd, 'a11ygate-pilot/KICKOFF.md')).toContain(AUTOMATED_TESTING_DISCLAIMER);
    expect(await read(cwd, ROOT)).toBe('# customer\n');
  }));

  it('writes nothing through a symlink to a file, without and with --force', async () => temporary(async (cwd) => {
    await writeFile(path.join(cwd, 'target.yml'), 'keep: me\n');
    await symlink(path.join(cwd, 'target.yml'), path.join(cwd, ROOT));
    const before = await tree(cwd);
    for (const flags of [[], ['--force']]) {
      const { code, out, err } = await init(cwd, ...flags);
      expect(code).toBe(2);
      expect(await read(cwd, 'target.yml')).toBe('keep: me\n');
      expect((await lstat(path.join(cwd, ROOT))).isSymbolicLink()).toBe(true);
      expect(err).toContain(`${ROOT} is a symlink; refusing to write anything`);
      expect(err).toContain(GITLAB_ROOT_SNIPPET);
      expect(out).not.toContain('Wrote ');
      expect(await tree(cwd)).toEqual(before);
    }
  }));

  it('does not create the target of a dangling symlink, without and with --force', async () => temporary(async (cwd) => {
    const missing = path.join(cwd, 'missing.yml');
    await symlink(missing, path.join(cwd, ROOT));
    const before = await tree(cwd);
    for (const flags of [[], ['--force']]) {
      const { code, out, err } = await init(cwd, ...flags);
      expect(code).toBe(2);
      await expect(lstat(missing)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readlink(path.join(cwd, ROOT))).toBe(missing);
      expect(err).toContain(`${ROOT} is a symlink; refusing to write anything`);
      expect(out).not.toContain('Wrote ');
      expect(await tree(cwd)).toEqual(before);
    }
  }));

  it('leaves a directory at the root path untouched, without and with --force', async () => temporary(async (cwd) => {
    await mkdir(path.join(cwd, ROOT));
    await writeFile(path.join(cwd, ROOT, 'inner.txt'), 'x');
    for (const flags of [[], ['--force']]) {
      expect((await init(cwd, ...flags)).code).toBe(2);
      expect(await readdir(path.join(cwd, ROOT))).toEqual(['inner.txt']);
      expect(await read(cwd, `${ROOT}/inner.txt`)).toBe('x');
    }
  }));

  it.each([
    ['github', '.github/workflows/a11ygate.yml'],
    ['jenkins', 'Jenkinsfile'],
    ['azure-devops', 'azure-pipelines.a11ygate.yml'],
  ])('%s init never creates or touches a root .gitlab-ci.yml', async (target, file) => temporary(async (cwd) => {
    const c = capture(cwd);
    expect(await run(['init', '--yes', '--target', target], c.io)).toBe(0);
    await expect(lstat(path.join(cwd, ROOT))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await read(cwd, file)).toContain(AUTOMATED_TESTING_DISCLAIMER);
    expect(c.out()).not.toContain(ROOT);
  }));
});

describe('init never writes through a hard link (A11Y-R72, judge 1 of 2026-11-28 day round)', () => {
  const CUSTOMER = 'stages: [test]\ntest:unit:\n  script: [npm test]\n';

  it.each([
    ['the job file', JOBS, [] as string[]],
    ['.a11ygate.yml', '.a11ygate.yml', [] as string[]],
    ['a pilot file', 'a11ygate-pilot/KICKOFF.md', ['--pilot']],
    ['a pilot file', 'a11ygate-pilot/success-criteria.yml', ['--pilot']],
  ])('refuses when %s (%s) is a hard link to the existing root, with and without --force', async (_, alias, extra) => temporary(async (cwd) => {
    const root = path.join(cwd, ROOT);
    await writeFile(root, CUSTOMER);
    await mkdir(path.join(cwd, 'a11ygate-pilot'), { recursive: true });
    await link(root, path.join(cwd, alias));
    const before = { hash: await sha(root), mtime: (await stat(root)).mtimeMs };
    await new Promise((resolve) => setTimeout(resolve, 20));
    for (const flags of [['--force'], []]) {
      const { code, out, err } = await init(cwd, ...extra, ...flags);
      expect(code).toBe(2);
      expect(await readFile(root, 'utf8')).toBe(CUSTOMER);
      expect(await sha(root)).toBe(before.hash);
      expect((await stat(root)).mtimeMs).toBe(before.mtime);
      expect(await read(cwd, alias)).toBe(CUSTOMER);
      expect(err).toContain(`${alias} is a hard link to the existing ${ROOT}`);
      // Nothing was written, so nothing claims it was.
      expect(out).not.toContain('Wrote ');
      expect(err).not.toContain('The other starter files were written');
    }
  }));

  it('--force replaces a hard-linked starter by rename, so the other name keeps its bytes (gitlab root absent)', async () => temporary(async (cwd) => {
    const other = path.join(cwd, 'other.yml');
    await writeFile(other, CUSTOMER);
    await link(other, path.join(cwd, JOBS));
    const { code } = await init(cwd, '--force');
    expect(code).toBe(0);
    expect(await readFile(other, 'utf8')).toBe(CUSTOMER);
    expect(load(await read(cwd, JOBS))).toHaveProperty('a11ygate');
    expect((await stat(path.join(cwd, JOBS))).nlink).toBe(1);
  }));

  it.each([
    ['github', '.github/workflows/a11ygate.yml'],
    ['jenkins', 'Jenkinsfile'],
    ['azure-devops', 'azure-pipelines.a11ygate.yml'],
  ])('%s --force leaves the other name of a hard-linked starter or config untouched', async (target, file) => temporary(async (cwd) => {
    await mkdir(path.join(cwd, path.dirname(file)), { recursive: true });
    for (const name of [file, '.a11ygate.yml']) {
      const other = path.join(cwd, `other-${path.basename(name)}`);
      await writeFile(other, CUSTOMER);
      await link(other, path.join(cwd, name));
    }
    const c = capture(cwd);
    expect(await run(['init', '--yes', '--target', target, '--force'], c.io)).toBe(0);
    for (const name of [file, '.a11ygate.yml']) {
      expect(await readFile(path.join(cwd, `other-${path.basename(name)}`), 'utf8')).toBe(CUSTOMER);
      expect(await read(cwd, name)).toContain(AUTOMATED_TESTING_DISCLAIMER);
    }
    expect(c.out()).toContain(`Wrote ${file}\n`);
  }));

  it('--force keeps the replaced file mode and leaves no temporary file behind', async () => temporary(async (cwd) => {
    const c = capture(cwd);
    expect(await run(['init', '--yes', '--target', 'github'], c.io)).toBe(0);
    await chmod(path.join(cwd, '.a11ygate.yml'), 0o640);
    expect(await run(['init', '--yes', '--target', 'github', '--force'], capture(cwd).io)).toBe(0);
    expect((await stat(path.join(cwd, '.a11ygate.yml'))).mode & 0o777).toBe(0o640);
    expect((await readdir(cwd)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  }));
});

/** Problems with a GitLab doc section; empty when it describes the owner-chosen init behaviour. */
function gitlabDocProblems(text: string): string[] {
  const problems: string[] = [];
  const blocks = [...text.matchAll(/```yaml\n([\s\S]*?)```/g)].map((match) => { try { return load(match[1]!); } catch { return null; } });
  const workflows = blocks.filter((root): root is Root => Boolean(root?.workflow));
  if (!workflows.length) problems.push('no YAML example with a root workflow');
  for (const root of workflows) {
    if (!ownMrRule(root)) problems.push('root workflow rules lack merge_request_event');
    const ifs = (root.workflow?.rules ?? []).map((rule) => rule.if);
    if (!ifs.includes('$CI_COMMIT_BRANCH') || !ifs.includes('$CI_COMMIT_TAG')) problems.push('branch and tag rules missing');
  }
  if (!/root `\.gitlab-ci\.yml`/.test(text)) problems.push('does not name the root .gitlab-ci.yml');
  if (!/include(:`)?( entry)?\s+alone\s+is\s+not\s+enough/.test(text)) problems.push('does not say an include alone is not enough');
  if (!/leaves it unchanged/.test(text) || !/exits with code 2/.test(text)) problems.push('does not say an existing root file is left unchanged with exit 2');
  // Wording from before A11Y-R72 that implied an include hint was sufficient.
  if (/Add this entry to your \.gitlab-ci\.yml include list|add the generated local include entry|add the printed `include:` entry yourself|include (hint|entry) is enough/i.test(text)) problems.push('claims an include hint alone is enough');
  // Wording from the superseded in-place editor: init never edits an existing root file.
  if (/(init|it)`? (adds|inserts|extends|edits|updates|merges)[^.]*(existing|your) (root )?`?\.gitlab-ci\.yml|Updated \.gitlab-ci\.yml|only inserts (what is missing|lines)|extended with the include/i.test(text)) problems.push('claims init edits an existing .gitlab-ci.yml');
  return problems;
}

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

  it.each(docs)('%s puts merge_request_event in root workflow rules and says an existing root is left unchanged', async (file, heading) => {
    expect(gitlabDocProblems(section(await readFile(file, 'utf8'), heading)), file).toEqual([]);
  });

  it('the docs check fails on planted defects', async () => {
    const good = section(await readFile('docs/integrations/init.md', 'utf8'), docs[1]![1]);
    const planted: [string, string][] = [
      ['no MR rule', good.replaceAll(`    - if: '${MR}'\n`, '')],
      ['include hint only', good.replace(/so an `include:` entry alone is not\s+enough/, 'so the include is enough') + '\nAdd this entry to your .gitlab-ci.yml include list'],
      ['claims in-place edit', `${good}\nWith an existing root file, init adds the include and the rule to your existing \`.gitlab-ci.yml\`.`],
      ['old updated message', `${good}\nIt prints \`Updated .gitlab-ci.yml: ...\`.`],
      ['no exit 2 note', good.replaceAll('exits with code 2', 'exits')],
    ];
    for (const [name, text] of planted) expect(gitlabDocProblems(text), name).not.toEqual([]);
  });

  it('the init guide and quickstart show exactly what init writes', async () => {
    for (const [file, heading] of docs.slice(0, 2)) {
      expect(section(await readFile(file, 'utf8'), heading), file).toContain(`\`\`\`yaml\n${GITLAB_ROOT_SNIPPET}\`\`\``);
    }
  });
});

describe('init --target gitlab refuses a symlinked root or starter before writing anything (A11Y-R72, fix round 2026-11-28 part 2)', () => {
  /** Builds the layout in cwd (and optionally a sibling temp dir outside cwd), runs init twice, asserts nothing changed. */
  async function refuses(cwd: string, linked: string, expectSnippet: boolean, extra: string[] = []) {
    const before = await tree(cwd);
    for (const flags of [[], ['--force']]) {
      const { code, out, err } = await init(cwd, ...extra, ...flags);
      expect(code).toBe(2);
      expect(err).toContain(`${linked} is a symlink; refusing to write anything`);
      expect(err).toContain(`Replace ${linked} with a regular file`);
      if (expectSnippet) expect(err).toContain(GITLAB_ROOT_SNIPPET);
      expect(out).not.toContain('Wrote ');
      expect(await tree(cwd)).toEqual(before);
      expect((await lstat(path.join(cwd, linked))).isSymbolicLink()).toBe(true);
    }
    return before;
  }

  it.each([[[]], [['--pilot']]])('root -> starter, starter absent (dangling): starter is not created %j', async (extra) => temporary(async (cwd) => {
    await symlink(JOBS, path.join(cwd, ROOT));
    await refuses(cwd, ROOT, true, extra);
    await expect(lstat(path.join(cwd, JOBS))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(path.join(cwd, 'a11ygate-pilot'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(path.join(cwd, '.a11ygate.yml'))).rejects.toMatchObject({ code: 'ENOENT' });
  }));

  it('root -> starter, starter is a regular file (live): starter bytes stay the same', async () => temporary(async (cwd) => {
    await writeFile(path.join(cwd, JOBS), 'customer: jobs\n');
    await symlink(JOBS, path.join(cwd, ROOT));
    await refuses(cwd, ROOT, true);
    expect(await read(cwd, JOBS)).toBe('customer: jobs\n');
    expect(await readlink(path.join(cwd, ROOT))).toBe(JOBS);
  }));

  it('root -> another file inside the project', async () => temporary(async (cwd) => {
    await mkdir(path.join(cwd, 'ci'));
    await writeFile(path.join(cwd, 'ci/pipeline.yml'), 'stages: [test]\n');
    await symlink('ci/pipeline.yml', path.join(cwd, ROOT));
    await refuses(cwd, ROOT, true);
    expect(await read(cwd, 'ci/pipeline.yml')).toBe('stages: [test]\n');
  }));

  it('root -> a file in a sibling temp dir outside the project', async () => temporary(async (cwd) => temporary(async (outside) => {
    const target = path.join(outside, 'shared.gitlab-ci.yml');
    await writeFile(target, 'shared: true\n');
    await symlink(target, path.join(cwd, ROOT));
    const outsideBefore = await tree(outside);
    await refuses(cwd, ROOT, true);
    expect(await tree(outside)).toEqual(outsideBefore);
  })));

  it('dangling root symlink to a missing path outside the project', async () => temporary(async (cwd) => temporary(async (outside) => {
    const missing = path.join(outside, 'nope', 'missing.yml');
    await symlink(missing, path.join(cwd, ROOT));
    await refuses(cwd, ROOT, true);
    await expect(lstat(path.join(outside, 'nope'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readlink(path.join(cwd, ROOT))).toBe(missing);
  })));

  it('symlinked starter -> another file (live), no root present: root is not created', async () => temporary(async (cwd) => {
    await writeFile(path.join(cwd, 'other.yml'), 'other: file\n');
    await symlink('other.yml', path.join(cwd, JOBS));
    await refuses(cwd, JOBS, false);
    expect(await read(cwd, 'other.yml')).toBe('other: file\n');
    await expect(lstat(path.join(cwd, ROOT))).rejects.toMatchObject({ code: 'ENOENT' });
  }));

  it('symlinked starter -> missing path (dangling), no root present: neither root nor target is created', async () => temporary(async (cwd) => {
    await symlink('missing.yml', path.join(cwd, JOBS));
    await refuses(cwd, JOBS, false, ['--pilot']);
    await expect(lstat(path.join(cwd, 'missing.yml'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(path.join(cwd, ROOT))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(path.join(cwd, 'a11ygate-pilot'))).rejects.toMatchObject({ code: 'ENOENT' });
  }));

  it('refuses before creating a baseline', async () => temporary(async (cwd) => {
    await symlink('missing.yml', path.join(cwd, ROOT));
    await refuses(cwd, ROOT, true, ['--baseline', 'missing-scan.json']);
    await expect(lstat(path.join(cwd, '.a11ygate-baseline.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  }));
});
