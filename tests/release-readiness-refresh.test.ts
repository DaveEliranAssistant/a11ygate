// A11Y-R75: docs must not promise an npm `next` tag or a published 0.2.0 while the readiness
// refresh records 0.2.0 as unpublished, and the refresh must list real commits. No network:
// the registry state comes from the repository's own records (lib/copy.ts and the refresh file).
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AUTOMATED_TESTING_DISCLAIMER, CLI_NPM_PUBLISHED_VERSION } from '@/lib/copy';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const REFRESH = 'docs/releases/0.2.0-readiness-refresh-2026-11.md';
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), 'utf8');
const UNPUBLISHED_STATUS = '**Status: 0.2.0 is NOT published.** npm `latest` is `@qe-atlas/a11ygate@0.1.0`, and there is no npm `next` tag.';
const SIGN_OFF_SENTENCE =
  'The 2026-11-14 §6 sign-off does not cover these commits. A new §6 gate and `npm login` + publish are Eliran-only.';

/** Claims that only hold once 0.2.0 is on npm. `@next/env` and other `@next/*` packages are not claims. */
const NEXT_TAG_CLAIMS: RegExp[] = [
  /a11ygate@next\b/i,
  /(?:^|[\s`'"(])@next(?![\w/-])/,
  /(?<![\d.])0\.2\.0(?:`|\*{1,2}|_{1,2})?\s+(?:is\s+)?(?:now\s+)?(?:on|published\s+(?:on|to))\s+npm\b/i,
  /(?<![\d.])0\.2\.0(?:`|\*{1,2}|_{1,2})?\s+(?:is\s+)?(?:on|available\s+on)\s+(?:the\s+)?npm\s+`?next`?\s+tag/i,
  /\b(?:npx|npm\s+(?:install|i|add|exec))\b[^\n]*@qe-atlas\/a11ygate@0\.2\.0/,
  // An unpinned registry `npx` resolves to npm `latest` (0.1.0), which has only the gate (`ci` / default
  // command). Pointing it at a 0.2.0-only subcommand or flag fails for the reader.
  /\bnpx\s+(?:(?:-y|--yes)\s+)?@qe-atlas\/a11ygate(?![@\w/-])[^\n]*?(?:\s(?:scan|init|doctor|config|baseline|review|report|export|prospect|pilot|estimate|evidence|trend)\b|\s--(?:format|out-dir|projects|manual-evidence)\b)/,
];

/** Returns `file:line: text` for every line that claims a published 0.2.0 or an npm `next` tag, or runs a 0.2.0-only command from the registry. */
function nextTagProblems(rel: string, text: string): string[] {
  const problems: string[] = [];
  text.split('\n').forEach((line, index) => {
    if (NEXT_TAG_CLAIMS.some((re) => re.test(line))) problems.push(`${rel}:${index + 1}: ${line.trim()}`);
  });
  return problems;
}

const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', '.gradle', 'out', 'test-results', 'playwright-report']);
const TEXT_EXT = /\.(md|mdx|ts|tsx|mjs|js|json|ya?ml|groovy|sh|txt|html)$|(^|\/)Jenkinsfile[^/]*$/;

function walk(rel: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(repoRoot, rel), { withFileTypes: true })) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...walk(child));
    } else if (TEXT_EXT.test(child) && !entry.name.endsWith('package-lock.json')) out.push(child);
  }
  return out;
}

/** User-facing docs, READMEs, recipes, examples, CI integrations and landing copy. Task files are the orchestrator's. */
function userFacingFiles(): string[] {
  const rootDocs = readdirSync(repoRoot).filter((name) => /^README.*\.md$/i.test(name));
  return [
    ...rootDocs,
    'packages/cli/README.md',
    'packages/cli/CHANGELOG.md',
    'lib/copy.ts',
    ...walk('docs'),
    ...walk('integrations'),
    ...walk('examples'),
    ...walk('components'),
    ...walk('app'),
  ].sort();
}

describe('no npm `next` tag claims while 0.2.0 is unpublished (A11Y-R75)', () => {
  const refresh = read(REFRESH);

  it('the readiness refresh says 0.2.0 is unpublished, in step with lib/copy.ts', () => {
    expect(refresh).toContain(UNPUBLISHED_STATUS);
    expect(CLI_NPM_PUBLISHED_VERSION).toBe('0.1.0');
  });

  it('finds no `@next` or "0.2.0 is on npm" line in any user-facing file', () => {
    // Only enforced while the refresh records 0.2.0 as unpublished (asserted above).
    expect(refresh.includes(UNPUBLISHED_STATUS)).toBe(true);
    const files = userFacingFiles();
    expect(files).toEqual(
      expect.arrayContaining([
        'README.md',
        'docs/integrations/jenkins.md',
        'docs/integrations/bitbucket.md',
        'docs/integrations/circleci.md',
        'integrations/jenkins/README.md',
        REFRESH,
        'components/CiCommands.tsx',
      ]),
    );
    const problems = files.flatMap((rel) => nextTagProblems(rel, read(rel)));
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('fails on a planted `@next` line and ignores legitimate mentions', () => {
    const planted = [
      'Use `@qe-atlas/a11ygate@next` (0.2.0) or a source build.',
      '| `scan` unknown | Use `@next` (0.2.0) or a source build. |',
      'npm install --save-dev @qe-atlas/a11ygate@next',
      '0.2.0 is on npm.',
      'Version 0.2.0 is published to npm.',
      '`0.2.0` is on the npm `next` tag.',
      'npx @qe-atlas/a11ygate@0.2.0 scan http://127.0.0.1:3000/',
      '**0.2.0** is on npm.',
      '`0.2.0` is now on npm.',
      '__0.2.0__ is published to npm.',
      '**0.2.0** is on the npm `next` tag.',
      'npx @qe-atlas/a11ygate ci --current axe.json --baseline a11y/baseline.json --format junit,sarif --out-dir a11y',
      'npx @qe-atlas/a11ygate scan http://127.0.0.1:3000/ --out-dir a11y',
      'npx --yes @qe-atlas/a11ygate init --yes --target jenkins',
    ];
    for (const line of planted) expect(nextTagProblems('planted.md', `ok\n${line}\n`), line).toEqual([`planted.md:2: ${line}`]);

    const legitimate = [
      UNPUBLISHED_STATUS,
      'Version **0.2.0** is the current package version on `main`. It is intended for the npm `next` tag only.',
      'npm serves only `@qe-atlas/a11ygate@0.1.0` (`latest`); 0.2.0 is not published and there is no npm `next` tag yet.',
      '"@next/env": "16.4.3",',
      "import localFont from '@next/font/local';",
      'chore: bump @qe-atlas/a11ygate to 0.2.0 for the next tag (A11Y-R22)',
      '## Tarball audit (`npm pack` of `@qe-atlas/a11ygate@0.2.0`)',
      '0.2.0 is not on npm yet (npm serves 0.1.0).',
      'npx @qe-atlas/a11ygate --current axe.json --baseline a11y/baseline.json --markdown summary.md # exit 1',
      'npx @qe-atlas/a11ygate --help # exit 0',
      'npx --no-install a11ygate ci --current axe.json --baseline a11y/baseline.json --format junit,sarif --out-dir a11y',
      "def cli = (args.cli ?: 'npx --yes @qe-atlas/a11ygate').toString()",
    ];
    for (const line of legitimate) expect(nextTagProblems('legit.md', line), line).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// The refresh lists real commits.

type Row = { task: string; pr: number; sha: string };

function refreshRows(text: string): Row[] {
  return [...text.matchAll(/^\| (A11Y-R\d+|none) \| \[#(\d+)\]\([^)]+\) \| `([0-9a-f]{7,40})` \|/gm)].map((m) => ({
    task: m[1] as string,
    pr: Number(m[2]),
    sha: m[3] as string,
  }));
}

const git = (args: string[]) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function isShallow(): boolean {
  try {
    return git(['rev-parse', '--is-shallow-repository']) === 'true';
  } catch {
    return true; // not a git checkout (for example a source tarball): no history to check against
  }
}

describe('readiness refresh content (A11Y-R75)', () => {
  const refresh = read(REFRESH);
  const rows = refreshRows(refresh);

  it('states the sign-off gap verbatim, carries the disclaimer and makes no publish claim', () => {
    expect(refresh).toContain(SIGN_OFF_SENTENCE);
    expect(refresh).toContain(AUTOMATED_TESTING_DISCLAIMER);
    expect(refresh).toContain('cd packages/cli && npm pack --dry-run --json');
    expect(refresh).not.toMatch(/\bcomplian(?:t|ce)\b|\bcertified\b|\bguarantee|\bconformant\b/i);
  });

  it('lists each merged task R22-R74 once, without R34 or the unmerged R72', () => {
    expect(rows).toHaveLength(53);
    expect(new Set(rows.map((row) => row.sha)).size).toBe(rows.length);
    expect(new Set(rows.map((row) => row.pr)).size).toBe(rows.length);
    const tasks = rows.map((row) => row.task).filter((task) => task !== 'none');
    const expected = [22, ...Array.from({ length: 74 - 23 + 1 }, (_, i) => 23 + i)]
      .filter((n) => n !== 34 && n !== 72)
      .map((n) => `A11Y-R${n}`);
    expect(tasks).toEqual(expected);
    expect(refresh).toMatch(/\*\*A11Y-R72\*\*[^\n]*\*\*not merged\*\*/);
  });

  it('keeps every package version unchanged', () => {
    expect(JSON.parse(read('packages/cli/package.json')).version).toBe('0.2.0');
    expect(JSON.parse(read('package.json')).version).toBe('0.1.0');
  });

  // CI's actions/checkout is shallow (fetch-depth 1), so older commits are not in the object
  // store there; the check runs on any full clone. Fetching history would need the network.
  it.skipIf(isShallow())('5 random listed SHAs exist, are ancestors of HEAD and carry the listed PR number', () => {
    const sample = [...rows].sort(() => Math.random() - 0.5).slice(0, 5);
    for (const { sha, pr } of sample) {
      expect(() => git(['cat-file', '-e', `${sha}^{commit}`]), sha).not.toThrow();
      expect(() => git(['merge-base', '--is-ancestor', sha, 'HEAD']), sha).not.toThrow();
      expect(git(['log', '-1', '--format=%s', sha]), sha).toMatch(new RegExp(`\\(#${pr}\\)$`));
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Fix round 2026-11-27: packages/cli/README.md ships inside the npm tarball (and the pilot
// tarball), so it must stay true whether or not 0.2.0 is published, and each install path
// needs its own invocation. README.md is the repo README and may carry a dated status line.

/** Publish-status claims that turn false the moment a version is published. */
const TIME_RELATIVE_PUBLISH_CLAIMS: RegExp[] = [
  /\bnot on npm yet\b/i,
  /\buntil it is\b/i,
  /\bnot yet published\b/i,
  /\bis not published\b/i,
  /\bremains 0\.1\.0\b/i,
];

function timeRelativePublishProblems(rel: string, text: string): string[] {
  const problems: string[] = [];
  text.split('\n').forEach((line, index) => {
    if (TIME_RELATIVE_PUBLISH_CLAIMS.some((re) => re.test(line))) problems.push(`${rel}:${index + 1}: ${line.trim()}`);
  });
  return problems;
}

/**
 * Splits markdown into paragraphs (blank-line separated, fenced blocks kept whole) and flags a
 * paragraph that mentions a source build when the next code block runs `npx --no-install a11ygate`:
 * a source build is not installed into node_modules, so `npx --no-install` cannot find it.
 */
function sourceBuildNpxProblems(text: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) inFence = !inFence;
    if (!inFence && !line.startsWith('```') && line.trim() === '') {
      if (current.length) blocks.push(current.join('\n'));
      current = [];
    } else current.push(line);
  }
  if (current.length) blocks.push(current.join('\n'));
  const problems: string[] = [];
  blocks.forEach((block, index) => {
    const prose = block.startsWith('```') ? '' : block;
    const next = blocks[index + 1] ?? '';
    const labelledSourceBuild = /source build/i.test(prose);
    if (labelledSourceBuild && /npx\s+--no-install\s+a11ygate/.test(`${prose}\n${next.startsWith('```') ? next : ''}`)) {
      problems.push(prose.split('\n')[0]!.slice(0, 120));
    }
  });
  return problems;
}

const PACKAGED_README = 'packages/cli/README.md';

describe('packaged CLI README stays true across a publish (A11Y-R75 fix round)', () => {
  const packaged = read(PACKAGED_README);
  const rootReadme = read('README.md');

  it('has no time-relative publish claim', () => {
    const problems = timeRelativePublishProblems(PACKAGED_README, packaged);
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('flags planted time-relative publish claims', () => {
    const planted = [
      '`--format` needs 0.2.0 or later. 0.2.0 is not on npm yet (npm serves 0.1.0).',
      'Until it is, install the pilot tarball.',
      '0.2.0 is not yet published.',
      'Version 0.2.0 is not published to npm.',
      'The npm `latest` tag remains 0.1.0 until a separate approval.',
    ];
    for (const line of planted) expect(timeRelativePublishProblems('planted.md', `ok\n${line}\n`), line).toEqual([`planted.md:2: ${line}`]);
    expect(timeRelativePublishProblems('legit.md', '`--format` needs 0.2.0 or later. Check `npm view @qe-atlas/a11ygate versions`.')).toEqual([]);
  });

  it('states the version requirement and links both install paths with absolute URLs', () => {
    expect(packaged).toContain('need 0.2.0 or later');
    expect(packaged).toContain('a11ygate --version');
    expect(packaged).toContain('npm view @qe-atlas/a11ygate versions');
    expect(packaged).toContain(
      '(https://github.com/DaveEliranAssistant/a11ygate/blob/main/docs/pilot/quickstart.md#1-install-the-tarball-you-received-5-minutes)',
    );
    expect(packaged).toContain('(https://github.com/DaveEliranAssistant/a11ygate/blob/main/docs/pilot/quickstart.md#source-build-fallback)');
  });

  it('gives the tarball `npx --no-install` and the source build `node <path>/packages/cli/dist/cli.mjs`', () => {
    expect(packaged).toMatch(/pilot tarball\][^\n]*node_modules[^\n]*\n\n```bash\nnpx --no-install a11ygate ci /);
    expect(packaged).toMatch(/source build\][^\n]*\n\n```bash\nnode <path-to-checkout>\/packages\/cli\/dist\/cli\.mjs ci /);
    expect(sourceBuildNpxProblems(packaged)).toEqual([]);
  });

  it('flags a planted source-build instruction that uses `npx --no-install`', () => {
    const planted = [
      'Install the pilot tarball or use a [source build](x), then run the locally installed CLI:',
      '',
      '```bash',
      'npx --no-install a11ygate ci --current axe.json --baseline a11y/baseline.json --format junit,sarif --out-dir a11y',
      '```',
    ].join('\n');
    expect(sourceBuildNpxProblems(planted)).toHaveLength(1);
    expect(sourceBuildNpxProblems(planted.replace('npx --no-install a11ygate', 'node <path-to-checkout>/packages/cli/dist/cli.mjs'))).toEqual([]);
    expect(sourceBuildNpxProblems('If you installed the pilot tarball:\n\n```bash\nnpx --no-install a11ygate ci\n```')).toEqual([]);
  });

  it('README.md does not imply 0.2.0 shipped and agrees with lib/copy.ts and the refresh status', () => {
    const IMPLIES_SHIPPED = /Features after 0\.2\.0 are not yet published/;
    expect(rootReadme).not.toMatch(IMPLIES_SHIPPED);
    expect(IMPLIES_SHIPPED.test('Merged on `main`. Features after 0.2.0 are not yet published to npm; they are listed')).toBe(true);
    // The dated statement is valid only while the refresh records 0.2.0 as unpublished.
    expect(read(REFRESH)).toContain(UNPUBLISHED_STATUS);
    expect(rootReadme).toContain(`npm serves ${CLI_NPM_PUBLISHED_VERSION}; 0.2.0 and the features listed under "Unreleased"`);
    expect(rootReadme).toMatch(/0\.2\.0 and the features listed under "Unreleased" in the \[CHANGELOG\]\([^)]+\) are not published to npm/);
  });
});
