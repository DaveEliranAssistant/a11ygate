import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { run } from '@/packages/cli/src/run';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const EXAMPLE = 'examples/github-action/a11ygate.yml';
const DOCS = ['action/README.md', 'docs/integrations/github-action.md'] as const;

const CLAIM_RE = /fixes everything|WCAG\/EAA compliant|\bcertified\b|\bguarantee\b/i;
const INCLUDE_RE = /<!-- include:([^\s]+?) -->\s*```(?:\w+)?\n([\s\S]*?)```/g;
const LINK_RE = /\[[^\]]*]\(([^)\s]+)\)/g;
const HEAD_SHA_CHECKOUT = 'ref: ${{ github.event.pull_request.head.sha }}';

const read = (rel: string) => readFile(path.join(repoRoot, rel), 'utf8');

function setupSection(doc: string): string {
  const start = doc.indexOf('## Setup requirements');
  expect(start).toBeGreaterThanOrEqual(0);
  const next = doc.slice(start + 3).search(/^## /m);
  return next === -1 ? doc.slice(start) : doc.slice(start, start + 3 + next);
}

describe('GitHub Action setup docs', () => {
  it('both docs include the example workflow byte-for-byte', async () => {
    const expected = (await read(EXAMPLE)).replace(/\s+$/, '');
    for (const rel of DOCS) {
      const doc = await read(rel);
      const includes = [...doc.matchAll(INCLUDE_RE)];
      expect(includes.map((match) => match[1]), rel).toEqual([EXAMPLE]);
      expect((includes[0]?.[2] as string).replace(/\s+$/, ''), rel).toBe(expected);
    }
  });

  it('keeps the Setup requirements section identical in both docs', async () => {
    const [readme, guide] = await Promise.all(DOCS.map(read));
    const a = setupSection(readme as string);
    const b = setupSection(guide as string);
    expect(a).toBe(b);
    // Shared text must not use relative links, which would resolve differently from each file.
    for (const match of a.matchAll(LINK_RE)) expect(match[1]).toMatch(/^https:\/\//);
  });

  it('covers the four setup items with docs.github.com citations', async () => {
    const section = setupSection(await read(DOCS[1]));
    const githubDocs = [...section.matchAll(LINK_RE)]
      .map((match) => match[1] as string)
      .filter((href) => href.startsWith('https://docs.github.com/'));
    expect(githubDocs).toEqual(
      expect.arrayContaining([
        'https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository#preventing-github-actions-from-creating-or-approving-pull-requests',
        'https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions',
        'https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/integrate-with-existing-tools/upload-sarif-file#uploading-a-code-scanning-analysis-with-github-actions',
        'https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request',
        'https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflows-in-forked-repositories',
      ]),
    );
    expect(section).toContain('Allow GitHub Actions to create and approve pull requests');
    expect(section).toContain('report-only');
    expect(section).toContain('OWNER ACTION');
    expect(section).toContain('security-events');
    expect(section).toContain(HEAD_SHA_CHECKOUT);
    expect(section).toMatch(/discarded as stale/);
    expect(section).toMatch(/read-only/);
    expect(section).toMatch(/Do not switch to `pull_request_target`/);

    // Every paragraph or list item (not heading) that names a GitHub setting cites docs.github.com.
    for (const block of section.split(/\n(?=- |\n)/).map((part) => part.trim())) {
      if (!block.startsWith('#') && /Settings →|"Allow GitHub Actions|\*\*Workflow permissions\*\*/.test(block)) {
        expect(block, block).toContain('https://docs.github.com/');
      }
    }
  });

  it('has a working markdown link check', async () => {
    const missing: string[] = [];
    for (const rel of [...DOCS, 'docs/integrations/jenkins.md']) {
      const docPath = path.join(repoRoot, rel);
      const doc = await readFile(docPath, 'utf8');
      const hrefs = [...doc.matchAll(LINK_RE)].map((match) => match[1] as string);
      expect(hrefs.length, rel).toBeGreaterThan(3);
      for (const href of hrefs) {
        if (/^[a-z]+:/i.test(href)) {
          expect(href, rel).toMatch(/^https:\/\//);
          continue;
        }
        const [file] = href.split('#');
        if (!file) continue;
        try {
          await stat(path.resolve(path.dirname(docPath), file));
        } catch {
          missing.push(`${rel}: ${href}`);
        }
      }
    }
    expect(missing, missing.join(', ')).toEqual([]);
    expect(await read(DOCS[0])).toContain('](../docs/integrations/github-action.md)');
    expect(await read('docs/integrations/jenkins.md')).toContain('](github-action.md)');
  });

  it('keeps the disclaimer and makes no compliance claims', async () => {
    for (const rel of [...DOCS, EXAMPLE]) {
      const text = await read(rel);
      expect(text, rel).toContain(AUTOMATED_TESTING_DISCLAIMER);
      expect(text, rel).not.toMatch(CLAIM_RE);
    }
  });
});

describe('examples/github-action/a11ygate.yml', () => {
  it('checks out the head SHA with the documented permissions and no pull_request_target', async () => {
    const yml = await read(EXAMPLE);
    expect(yml).toMatch(/uses: actions\/checkout@v\d+\n\s+with:\n\s+ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
    const permissions = /^permissions:\n((?: {2}.+\n)+)/m.exec(yml)?.[1] ?? '';
    const scopes = Object.fromEntries(
      [...permissions.matchAll(/^ {2}([\w-]+): (\w+)/gm)].map((match) => [match[1], match[2]]),
    );
    expect(scopes).toEqual({
      contents: 'read',
      issues: 'write',
      'pull-requests': 'write',
      'security-events': 'write',
    });
    expect(yml).toMatch(/^on:\n {2}pull_request:\n/m);
    expect(yml).not.toContain('pull_request_target');
    expect(yml).toContain('uses: github/codeql-action/upload-sarif@');
  });

  it('only targets local fixtures on 127.0.0.1', async () => {
    const yml = await read(EXAMPLE);
    expect(yml).not.toMatch(/example\.(com|org|net)/i);
    const hosts = [...yml.matchAll(/https?:\/\/([^/\s:]+)/g)].map((match) => match[1]);
    expect(hosts.length).toBeGreaterThan(0);
    expect(new Set(hosts)).toEqual(new Set(['127.0.0.1']));
    for (const rel of ['current.json', 'baseline.json']) {
      const fixture = JSON.parse(await read(`examples/github-action/fixtures/${rel}`)) as { url: string };
      expect(new URL(fixture.url).hostname).toBe('127.0.0.1');
    }
    for (const doc of DOCS) expect(await read(doc), doc).not.toMatch(/example\.com/i);
  });

  it('uses only inputs that action/action.yml declares', async () => {
    const [yml, actionYml] = await Promise.all([read(EXAMPLE), read('action/action.yml')]);
    const step = yml.slice(yml.indexOf('- uses: ./action'));
    const used = [...step.matchAll(/^ {10}([\w-]+):/gm)].map((match) => match[1] as string);
    expect(used).toEqual(['current', 'baseline', 'threshold', 'comment']);
    const inputsBlock = actionYml.slice(actionYml.indexOf('inputs:'), actionYml.indexOf('outputs:'));
    for (const input of used) expect(inputsBlock).toContain(`\n  ${input}:\n`);
    for (const match of step.matchAll(/(examples\/github-action\/fixtures\/[\w.-]+)/g)) {
      await expect(stat(path.join(repoRoot, match[1] as string))).resolves.toBeTruthy();
    }
  });

  it('runs the workflow gate command against the fixtures and writes SARIF', async () => {
    const yml = await read(EXAMPLE);
    const command = /run: node packages\/cli\/dist\/cli\.mjs (.+)\n/.exec(yml)?.[1];
    expect(command).toBeTruthy();
    const argv = (command as string).split(' ');
    const outIndex = argv.indexOf('--out-dir');
    expect(argv[outIndex + 1]).toBe('a11y-results');
    const outDir = await mkdtemp(path.join(tmpdir(), 'a11ygate-gh-action-'));
    try {
      argv[outIndex + 1] = outDir;
      let stdout = '';
      const code = await run(argv, { cwd: repoRoot, stdout: (chunk) => (stdout += chunk), stderr: () => undefined });
      expect(code).toBe(0);
      expect(stdout).toContain('PASS');
      const sarif = JSON.parse(await readFile(path.join(outDir, 'a11ygate.sarif'), 'utf8')) as {
        version: string;
        runs: { results: unknown[] }[];
      };
      expect(sarif.version).toBe('2.1.0');
      expect(sarif.runs[0]?.results.length).toBeGreaterThan(0);
      expect(yml).toContain('sarif_file: a11y-results/a11ygate.sarif');
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
