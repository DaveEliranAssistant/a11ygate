import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AUTOMATED_TESTING_DISCLAIMER, CI_AXE_SNIPPET, CI_FIRST_RUN_STEPS, CI_WORKFLOW, DISCLAIMER, LEGAL_DISCLAIMER } from '@/lib/copy';
import { doctorChecks } from '@/packages/cli/src/doctor';
import { run } from '@/packages/cli/src/run';
import { minimalResult } from './helpers';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const yaml = createRequire(import.meta.url)('js-yaml') as { load: (text: string) => unknown };
const read = (rel: string) => readFile(path.join(repoRoot, rel), 'utf8');

const README = 'README.md';
const TROUBLESHOOTING = 'docs/troubleshooting.md';
const LIMITS = 'docs/what-a11ygate-does-not-do.md';
const DOCS = [README, TROUBLESHOOTING, LIMITS] as const;

const CLAIM_RE = /fixes everything|WCAG\/EAA compliant|\bcertified\b|\bguarantee\b/i;
const INCLUDE_RE = /<!-- include:([^\s]+?) -->\s*```(?:\w+)?\n([\s\S]*?)```/g;
const FENCE_RE = /^```(\w*)\n[\s\S]*?^```$/gm;
const LINK_RE = /\[[^\]]*]\(([^)\s]+)\)/g;
// Files that README includes, each executed or checked below.
const README_INCLUDES = [
  'examples/quickstart/quickstart.sh',
  'examples/quickstart/axe-results.spec.ts',
  'examples/cli/usage.sh',
  'examples/github-action/published-action.yml',
  'examples/github-action/first-baseline-steps.yml',
];

/** Run a snippet file line by line, the way a reader would paste it, and check each `# exit N` comment. */
async function runSnippet(rel: string, cwd: string): Promise<number> {
  let commands = 0;
  for (const raw of (await read(rel)).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [command = '', expected] = line.split(/\s+# exit /);
    const argv = command.trim().split(/\s+/);
    if (argv[0] === 'mkdir' && argv[1] === '-p' && argv.length === 3) {
      await mkdir(path.join(cwd, argv[2] as string), { recursive: true });
      continue;
    }
    expect(argv.slice(0, 2), line).toSatisfy((head: string[]) => head[0] === 'npx' && ['a11ygate', '@qe-atlas/a11ygate'].includes(head[1] as string));
    expect(expected, `${line} needs an "# exit N" comment`).toMatch(/^\d$/);
    let out = '';
    const code = await run(argv.slice(2), { cwd, stdout: (chunk) => (out += chunk), stderr: (chunk) => (out += chunk) });
    expect(code, `${line}\n${out}`).toBe(Number(expected));
    commands += 1;
  }
  return commands;
}

describe('README and docs snippets', () => {
  it('every README code block is an include of a tested file, byte-for-byte', async () => {
    const readme = await read(README);
    const fences = [...readme.matchAll(FENCE_RE)];
    const includes = [...readme.matchAll(INCLUDE_RE)];
    expect(includes.map((match) => match[1])).toEqual(README_INCLUDES);
    expect(fences.length).toBe(includes.length);
    for (const match of includes) {
      const rel = match[1] as string;
      expect((match[2] as string).replace(/\s+$/, ''), rel).toBe((await read(rel)).replace(/\s+$/, ''));
    }
  });

  it('the troubleshooting and limits pages contain no code blocks that could drift', async () => {
    for (const rel of [TROUBLESHOOTING, LIMITS]) expect([...(await read(rel)).matchAll(FENCE_RE)], rel).toEqual([]);
  });

  it('runs the quickstart exactly as written: FAIL, PASS at critical, baseline update, then PASS', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'a11ygate-quickstart-'));
    try {
      await mkdir(path.join(cwd, 'fixtures'));
      for (const name of ['demo-shop-current.json', 'demo-shop-baseline.json']) {
        await copyFile(path.join(repoRoot, 'fixtures', name), path.join(cwd, 'fixtures', name));
      }
      expect(await runSnippet('examples/quickstart/quickstart.sh', cwd)).toBe(4);
      await expect(stat(path.join(cwd, 'a11y/baseline.json'))).resolves.toBeTruthy();
      expect(await readFile(path.join(cwd, 'a11y/summary.md'), 'utf8')).toMatch(/FAIL/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
    const readme = await read(README);
    expect(readme).toContain('2 new, 3 fixed, 5 still open');
  });

  it('runs the everyday CLI calls against generated axe JSON', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'a11ygate-usage-'));
    try {
      for (const [name, url] of [['axe.json', 'https://demo.shop/'], ['home.json', 'https://demo.shop/'], ['cart.json', 'https://demo.shop/cart']]) {
        await writeFile(path.join(cwd, name as string), JSON.stringify(minimalResult({ url })));
      }
      expect(await runSnippet('examples/cli/usage.sh', cwd)).toBe(4);
      await expect(stat(path.join(cwd, 'result.json'))).resolves.toBeTruthy();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('keeps the axe and published-Action snippets identical to the landing page copy', async () => {
    expect((await read('examples/quickstart/axe-results.spec.ts')).replace(/\s+$/, '')).toBe(CI_AXE_SNIPPET);
    const dropCart = (text: string) => text.replace('            a11y-results/cart.json\n', '').replace(/\s+$/, '');
    expect(dropCart(await read('examples/github-action/published-action.yml'))).toBe(CI_WORKFLOW);
    expect(dropCart(await read('examples/github-action/first-baseline-steps.yml'))).toBe(CI_FIRST_RUN_STEPS.replace(/\s+$/, ''));
  });

  it('uses only inputs that action/action.yml declares in the Action snippets', async () => {
    const actionYml = yaml.load(await read('action/action.yml')) as { inputs: Record<string, unknown> };
    const workflow = yaml.load(await read('examples/github-action/published-action.yml')) as {
      jobs: { a11y: { steps: { uses?: string; with?: Record<string, unknown> }[] } };
    };
    const firstRun = yaml.load(await read('examples/github-action/first-baseline-steps.yml')) as { uses?: string; with?: Record<string, unknown> }[];
    const gateSteps = [...workflow.jobs.a11y.steps, ...firstRun].filter((step) => step.uses?.startsWith('DaveEliranAssistant/a11ygate-action@'));
    expect(gateSteps).toHaveLength(2);
    for (const step of gateSteps) {
      for (const input of Object.keys(step.with ?? {})) expect(Object.keys(actionYml.inputs), input).toContain(input);
    }
  });
});

describe('CI matrix', () => {
  const rows = async () => {
    const readme = await read(README);
    const start = readme.indexOf('## CI matrix');
    const section = readme.slice(start, readme.indexOf('\n## ', start + 3));
    return section.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| CI ') && !line.startsWith('| ---'));
  };

  it('has one row per supported CI, each linking a guide, the CI file and a test or recorded run', async () => {
    const table = await rows();
    expect(table.map((row) => row.split('|')[1]?.trim())).toEqual(['GitHub Actions', 'Jenkins', 'GitLab', 'Azure DevOps', 'CircleCI']);
    for (const row of table) {
      const cells = row.split('|').map((cell) => cell.trim());
      expect(cells[2], row).toMatch(/\[Guide]\(/);
      expect(cells[3], row).toMatch(/tests\/[\w-]+\.test\.ts|actions\/runs\/\d+/);
      expect(cells[4]?.length, row).toBeGreaterThan(20);
    }
  });

  it('states only what the tests and recorded runs show', async () => {
    const [gh, jenkins, gitlab, azure, circle] = await rows();
    const jenkinsGuide = await read('docs/integrations/jenkins.md');
    const run = /https:\/\/github\.com\/DaveEliranAssistant\/a11ygate\/actions\/runs\/\d+/.exec(jenkins as string)?.[0];
    expect(run).toBeTruthy();
    expect(jenkinsGuide).toContain(run);
    expect(jenkinsGuide).toContain('2.580.2 LTS');
    expect(jenkins).toContain('2.580.2 LTS');
    // Rows without a recorded run must say so.
    expect(gh).toMatch(/not itself run as a workflow/);
    expect(gitlab).toMatch(/No GitLab runner run/);
    expect(gitlab).toMatch(/Docker was unavailable/);
    expect(azure).toMatch(/No Azure DevOps organization/);
    expect(circle).toMatch(/`circleci config validate` has not been run/);
    expect(circle).toMatch(/CircleCI CLI and Docker were not available/);
    // The same gaps are recorded in each guide.
    expect(await read('docs/integrations/circleci.md')).toContain('`circleci config validate` has not been run on this config.');
    expect(await read('docs/integrations/azure-devops.md')).toContain('No Azure DevOps organization is needed or contacted');
    expect(await read('integrations/gitlab/README.md')).toContain('Docker is unavailable');
    expect(await read('tests/github-action-docs.test.ts')).toContain('runs the workflow gate command against the fixtures');
    // Only a recorded run may be called one.
    for (const row of [gh, gitlab, azure, circle]) expect(row).not.toMatch(/recorded run|actions\/runs\//i);
  });
});

describe('troubleshooting covers the doctor failures verbatim', () => {
  it('contains each doctor FAIL message', async () => {
    const doc = await read(TROUBLESHOOTING);
    const io = {
      env: { A11Y_HEAD_SHA: 'b', GITHUB_REPOSITORY: 'o/r', A11Y_COMMENT: 'true', A11YGATE_GITHUB_PERMISSIONS: '{"contents":"read"}' },
      head: () => 'a',
      nodeVersion: 'v18.0.0',
      chromium: () => false,
      hasPackage: (name: string) => name !== 'html_codesniffer',
      repoConfig: 'modelFixes: true\nmodelProviders: [groq]\n',
      fetch: (async () => new Response(JSON.stringify({ can_approve_pull_request_reviews: false }), { status: 200 })) as typeof fetch,
    };
    const findings = await doctorChecks({ engines: ['axe', 'htmlcs'], modelFixes: 'on' }, io);
    const failed = findings.filter((finding) => finding.status === 'fail');
    const byCheck = Object.fromEntries(failed.map((finding) => [finding.check, finding.message]));
    expect(Object.keys(byCheck).sort()).toEqual(expect.arrayContaining(['browser', 'checkout', 'engines', 'node']));
    for (const [check, message] of Object.entries(byCheck)) {
      if (check === 'config' || check === 'permissions') continue; // variable lists; checked below
      expect(doc, check).toContain(`### ${check}`);
      expect(doc, check).toContain(message);
    }
    const config = await doctorChecks({ browser: false }, { ...io, repoConfig: 'threshold: banana\n' });
    const configFail = config.find((finding) => finding.check === 'config');
    expect(configFail?.status).toBe('fail');
    expect(configFail?.message).toMatch(/^\.a11ygate\.yml has \d+ problems?: /);
    expect(doc).toContain((configFail?.message as string).slice((configFail?.message as string).indexOf('See ')));

    const permissions = await doctorChecks({ browser: false }, { ...io, env: { ...io.env, A11Y_SUGGEST_FIXES: 'false' }, repoConfig: null });
    expect(doc).toContain(permissions.find((finding) => finding.check === 'permissions')?.message);
  });

  it('contains the provider and pr-creation FAIL messages', async () => {
    const doc = await read(TROUBLESHOOTING);
    const source = await read('packages/cli/src/doctor.ts');
    for (const message of [
      'Model fixes are on but no allowlisted provider is configured. Set the provider credentials and model ID; allowlist stub explicitly only for offline demos.',
      'Actions PR creation is disabled. Model-fix draft PRs will fall back to report-only. Only the owner should decide whether to enable Allow GitHub Actions to create and approve pull requests.',
      'GitHub denied the read-only repository probe. Check the job token and workflow permissions; no write was attempted.',
    ]) {
      expect(source).toContain(message);
      expect(doc).toContain(message);
    }
  });

  it('contains the gate exit-2 messages the CLI prints', async () => {
    const doc = await read(TROUBLESHOOTING);
    const cwd = await mkdtemp(path.join(tmpdir(), 'a11ygate-trouble-'));
    try {
      await writeFile(path.join(cwd, 'bad.json'), '{}');
      for (const [argv, fragment] of [[['--current', 'nope.json'], ': file not found.'], [['--current', 'bad.json'], ': result.url must be a non-empty string']] as const) {
        let err = '';
        expect(await run([...argv], { cwd, stdout: () => undefined, stderr: (chunk) => (err += chunk) })).toBe(2);
        expect(err).toContain(fragment);
        expect(doc).toContain(`\`<path>${fragment}\``);
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
    expect(await read('packages/cli/src/run.ts')).toContain('Missing, failed or materially incomparable scan coverage prevents a regression PASS.');
    expect(doc).toContain('Missing, failed or materially incomparable scan coverage prevents a regression PASS.');
  });
});

describe('docs link check and claims', () => {
  it('resolves every relative link and uses https for external links', async () => {
    const missing: string[] = [];
    for (const rel of DOCS) {
      const docPath = path.join(repoRoot, rel);
      const doc = await readFile(docPath, 'utf8');
      const hrefs = [...doc.matchAll(LINK_RE)].map((match) => match[1] as string);
      expect(hrefs.length, rel).toBeGreaterThan(3);
      for (const href of hrefs) {
        if (/^[a-z]+:/i.test(href)) {
          expect(href, rel).toMatch(/^https:\/\//);
          continue;
        }
        const [file, hash] = href.split('#');
        const target = file ? path.resolve(path.dirname(docPath), file) : docPath;
        try {
          await stat(target);
        } catch {
          missing.push(`${rel}: ${href}`);
          continue;
        }
        if (hash && target.endsWith('.md')) {
          const text = await readFile(target, 'utf8');
          const slugs = new Set([
            ...[...text.matchAll(/^#+ (.+)$/gm)].map((m) => (m[1] as string).toLowerCase().replace(/[^\w\- ]/g, '').replace(/ /g, '-')),
            ...[...text.matchAll(/<a id="([^"]+)"><\/a>/g)].map((m) => m[1] as string),
          ]);
          if (!slugs.has(hash)) missing.push(`${rel}: ${href} (anchor)`);
        }
      }
    }
    expect(missing, missing.join(', ')).toEqual([]);
  });

  it('keeps the disclaimers verbatim and makes no compliance claims', async () => {
    const readme = await read(README);
    expect(readme).toContain(`**${LEGAL_DISCLAIMER}** ${DISCLAIMER}`);
    expect(readme).toContain(AUTOMATED_TESTING_DISCLAIMER);
    for (const rel of [...DOCS, ...README_INCLUDES.filter((file) => file.endsWith('.sh'))]) {
      const text = await read(rel);
      if (rel !== README && !rel.endsWith('.sh')) expect(text, rel).toContain(AUTOMATED_TESTING_DISCLAIMER);
      if (rel.endsWith('.sh')) expect(text, rel).toContain(AUTOMATED_TESTING_DISCLAIMER);
      expect(text, rel).not.toMatch(CLAIM_RE);
    }
    const limits = await read(LIMITS);
    expect(limits).toContain(`**${LEGAL_DISCLAIMER}** ${DISCLAIMER}`);
    for (const heading of ['manual accessibility audit', 'assistive technology', 'legal advice', 'certify']) expect(limits).toContain(heading);
  });
});
