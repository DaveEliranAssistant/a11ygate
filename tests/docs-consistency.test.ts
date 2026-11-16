// A11Y-R62: docs consistency checks. No network: links are checked on disk only, and the
// CLI help comes from the built bundle run locally.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const CLI = path.join(repoRoot, 'packages/cli/dist/cli.mjs');
const read = (rel: string) => readFile(path.join(repoRoot, rel), 'utf8');

async function markdownUnder(rel: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(path.join(repoRoot, rel), { withFileTypes: true })) {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await markdownUnder(child)));
    else if (entry.name.endsWith('.md')) out.push(child);
  }
  return out.sort();
}

const docFiles = async () => ['README.md', 'packages/cli/README.md', 'packages/cli/CHANGELOG.md', ...(await markdownUnder('docs'))];

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[ \t]*$/gm;
const stripFences = (text: string) => text.replace(FENCE_RE, '');
const stripInlineCode = (text: string) => text.replace(/(`+)[\s\S]*?\1/g, '');

/** GitHub-style heading anchors, including -1, -2 suffixes for repeated headings and explicit <a id>. */
function anchors(text: string): Set<string> {
  const seen = new Map<string, number>();
  const out = new Set<string>();
  for (const match of stripFences(text).matchAll(/^#{1,6}[ \t]+(.+?)[ \t#]*$/gm)) {
    const base = (match[1] as string)
      .replace(/<[^>]+>/g, '')
      .replace(/\[([^\]]*)]\([^)]*\)/g, '$1')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/ /g, '-');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    out.add(count ? `${base}-${count}` : base);
  }
  for (const match of text.matchAll(/<a (?:id|name)="([^"]+)"/g)) out.add(match[1] as string);
  return out;
}

describe('docs link check (A11Y-R62)', () => {
  it('resolves every relative link and anchor in README.md, packages/cli/README.md, the CHANGELOG and docs/**/*.md', async () => {
    const files = await docFiles();
    expect(files).toEqual(expect.arrayContaining(['docs/README.md', 'docs/known-limits.md']));
    const problems: string[] = [];
    let checked = 0;
    for (const rel of files) {
      const docPath = path.join(repoRoot, rel);
      const text = stripInlineCode(stripFences(await readFile(docPath, 'utf8')));
      const hrefs = [
        ...[...text.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map((m) => m[1] as string),
        ...[...text.matchAll(/^\s*\[[^\]]+]:\s*(\S+)/gm)].map((m) => m[1] as string),
        ...[...text.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1] as string),
      ];
      for (const href of hrefs) {
        if (/^(https?|mailto):/i.test(href)) continue; // external: not fetched (no network in tests)
        if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
          problems.push(`${rel}: ${href} (unsupported scheme)`);
          continue;
        }
        checked += 1;
        const [file, hash] = href.split('#');
        const target = file ? path.resolve(path.dirname(docPath), decodeURI(file)) : docPath;
        if (!target.startsWith(repoRoot)) {
          problems.push(`${rel}: ${href} (outside the repository)`);
          continue;
        }
        try {
          await stat(target);
        } catch {
          problems.push(`${rel}: ${href} (missing file)`);
          continue;
        }
        if (hash && target.endsWith('.md') && !anchors(await readFile(target, 'utf8')).has(hash)) {
          problems.push(`${rel}: ${href} (missing anchor)`);
        }
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
    expect(checked).toBeGreaterThan(50);
  });

  it('links the known-limits page from README, the docs index and the does-not-do page', async () => {
    expect(await read('README.md')).toContain('](docs/known-limits.md)');
    expect(await read('docs/README.md')).toContain('](known-limits.md)');
    expect(await read('docs/what-a11ygate-does-not-do.md')).toContain('](known-limits.md)');
  });
});

// ---------------------------------------------------------------------------------------------
// Command check: every `a11ygate <command>` and `--flag` in the docs exists in the built CLI help.

const help = (args: string[]): string => {
  try {
    return execFileSync(process.execPath, [CLI, ...args, '--help'], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' }, timeout: 30_000 });
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string };
    return `${failed.stdout ?? ''}${failed.stderr ?? ''}`;
  }
};

/**
 * Flags that exist but are not listed in any --help text. Each entry names the source that
 * implements it; the test checks that the source still contains the flag.
 */
const UNLISTED_FLAGS: Record<string, string> = {
  '--debug': 'packages/cli/src/fatal.ts',
};

/** Flags that a design draft proposes and labels as not existing; the doc must keep that label. */
const PROPOSED_FLAGS: Record<string, string> = {
  '--fix-output': 'docs/design/model-written-fix-prs.md',
};

/** Flags of other tools (npm, npx, git, Playwright, Node, CI CLIs) that docs mention next to A11yGate. */
const OTHER_TOOL_FLAGS = new Set([
  '--save-dev', '--with-deps', '--yes', '--no-save', '--dry-run', '--json', '--preview', '--file', '--format', '--config',
  '--project', '--grep', '--reporter', '--workers', '--headed', '--port', '--host', '--prefix', '--package', '--test',
  '--production', '--omit', '--ignore-scripts', '--frozen-lockfile', '--fix', '--force', '--version', '--help', '--depth',
]);

const FLAG_RE = /(?<![\w-])--[a-z0-9][a-z0-9-]*/g;
const INVOCATION_RE = /(?:^|[\s(`'"])(?:npx\s+(?:--yes\s+)?)?(?:@qe-atlas\/)?a11ygate(?:@[\w.-]+)?((?:[ \t]+[^\s;&`]+)*)/g;
/** Shell separators between commands; a bare `|` inside a placeholder such as <scan.json|out-dir> is kept. */
const COMMAND_SPLIT_RE = /\s\|\s|&&|\|\||;/;

describe('docs command check (A11Y-R62)', () => {
  const builtIn = existsSync(CLI);
  const topHelp = builtIn ? help([]) : '';
  const commands = new Set([...topHelp.matchAll(/^\s+a11ygate \[?([a-z]+)]?/gm)].map((m) => m[1] as string));
  const helpCache = new Map<string, string>();
  const helpFor = (command: string): string => {
    if (!helpCache.has(command)) {
      const extra =
        command === 'config' ? [help(['config']), help(['scan']), topHelp, help(['doctor'])]
        : command === 'ci' ? [topHelp]
        : [help([command])];
      // Subcommand helps (report pdf, review list, ...) are folded in.
      const subs = new Set([...[topHelp, ...extra].join('\n').matchAll(new RegExp(`a11ygate ${command} ([a-z|]+)`, 'g'))].flatMap((m) => (m[1] as string).split('|')));
      for (const sub of subs) if (sub) extra.push(help([command, sub]));
      helpCache.set(command, extra.join('\n'));
    }
    return helpCache.get(command) as string;
  };
  const allHelp = () => [topHelp, ...[...commands].map(helpFor)].join('\n');

  it('the built CLI lists its commands', () => {
    expect(builtIn, 'run npm run cli:build first').toBe(true);
    for (const command of ['scan', 'ci', 'review', 'report', 'export', 'estimate', 'evidence', 'trend', 'config', 'doctor', 'init', 'baseline']) {
      expect(commands, command).toContain(command);
    }
  });

  it('unlisted global flags still exist in the source', async () => {
    for (const [flag, source] of Object.entries(UNLISTED_FLAGS)) expect(await read(source), flag).toContain(`'${flag}'`);
    for (const [flag, doc] of Object.entries(PROPOSED_FLAGS)) {
      const text = await read(doc);
      expect(text, flag).toContain('**proposed configuration surface**, not existing supported flags');
      expect(text.indexOf(flag), flag).toBeGreaterThan(text.indexOf('proposed configuration surface'));
      expect(allHelp(), flag).not.toContain(flag);
    }
  });

  it('every a11ygate command and flag in the docs exists in that command\'s --help', async () => {
    const problems: string[] = [];
    let invocations = 0;
    for (const rel of await docFiles()) {
      const text = await read(rel);
      // Code is where commands appear: inline code spans and fenced blocks (shell lines only).
      const segments = [
        ...[...text.matchAll(/(?<!`)`([^`\n]+)`(?!`)/g)].map((m) => m[1] as string),
        ...[...text.matchAll(FENCE_RE)].flatMap((m) => (m[0] as string).split('\n').slice(1, -1)),
      ];
      for (const segment of segments) {
        // npm registry commands name the package, not a CLI call (for example `npm view @qe-atlas/a11ygate dist-tags`).
        if (/^npm\s+(view|info|install|i|pack|dist-tag|publish|ls|uninstall)\b/.test(segment.trim())) continue;
        for (const match of segment.split(COMMAND_SPLIT_RE).flatMap((part) => [...part.matchAll(INVOCATION_RE)])) {
          const tokens = (match[1] ?? '').trim().split(/[ \t]+/).filter(Boolean);
          const first = tokens[0] ?? '';
          let command = 'ci';
          if (/^[a-z]/.test(first)) {
            if (!commands.has(first)) {
              problems.push(`${rel}: unknown command "a11ygate ${first}" in \`${segment.trim()}\``);
              continue;
            }
            command = first;
          }
          invocations += 1;
          const commandHelp = helpFor(command);
          for (const flag of (match[1] ?? '').match(FLAG_RE) ?? []) {
            if (UNLISTED_FLAGS[flag] || flag === '--help' || flag === '--version') continue;
            if (!new RegExp(`(?<![\\w-])${flag}(?![\\w-])`).test(commandHelp)) problems.push(`${rel}: ${flag} not in "a11ygate ${command} --help" (\`${segment.trim()}\`)`);
          }
        }
      }
      // Bare flags in inline code (for example `--incremental`) must exist somewhere in the CLI help.
      const all = allHelp();
      for (const span of [...text.matchAll(/(?<!`)`([^`\n]+)`(?!`)/g)].map((m) => m[1] as string)) {
        if (/a11ygate/.test(span) || /^(npm|npx|git|node|gitlab-ci-local|circleci|docker|brew|playwright)\b/.test(span.trim())) continue;
        for (const flag of span.match(FLAG_RE) ?? []) {
          if (UNLISTED_FLAGS[flag] || OTHER_TOOL_FLAGS.has(flag) || PROPOSED_FLAGS[flag] === rel) continue;
          if (!new RegExp(`(?<![\\w-])${flag}(?![\\w-])`).test(all)) problems.push(`${rel}: ${flag} is not in any a11ygate --help (\`${span}\`)`);
        }
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
    expect(invocations).toBeGreaterThan(50);
  }, 120_000);
});

// ---------------------------------------------------------------------------------------------

describe('versions and claims (A11Y-R62)', () => {
  it('keeps every package.json version unchanged', async () => {
    const expected: Record<string, string> = { 'package.json': '0.1.0', 'packages/cli/package.json': '0.2.0' };
    for (const [rel, version] of Object.entries(expected)) {
      expect((JSON.parse(await read(rel)) as { version: string }).version, rel).toBe(version);
      // When origin/main is available (a normal clone), the version must also match it.
      let upstream: string | undefined;
      try {
        upstream = execFileSync('git', ['show', `origin/main:${rel}`], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      } catch {
        upstream = undefined;
      }
      if (upstream) expect((JSON.parse(upstream) as { version: string }).version, `${rel} on origin/main`).toBe(version);
    }
  });

  it('makes no compliance claims in the consolidated docs and keeps the disclaimer', async () => {
    const CLAIM_RE = /fixes everything|WCAG\/EAA compliant|\bcertified\b|\bguarantee[sd]?\b|\bconformant\b/i;
    for (const rel of ['docs/known-limits.md', 'docs/README.md', 'packages/cli/CHANGELOG.md', 'README.md', 'docs/what-a11ygate-does-not-do.md']) {
      const text = await read(rel);
      expect(text, rel).not.toMatch(CLAIM_RE);
      expect(text, rel).toContain(AUTOMATED_TESTING_DISCLAIMER);
    }
  });

  it('lists every merged task R23-R61 with a PR link in the CHANGELOG, and the tasks not included', async () => {
    const changelog = await read('packages/cli/CHANGELOG.md');
    const unreleased = changelog.slice(changelog.indexOf('## [Unreleased]'), changelog.indexOf('## [0.2.0]'));
    const merged: Record<number, number> = {
      23: 39, 24: 44, 25: 46, 26: 48, 27: 41, 28: 40, 29: 45, 30: 43, 31: 42, 32: 47, 33: 50, 35: 49, 36: 53, 37: 55, 38: 54,
      39: 57, 40: 51, 41: 56, 42: 58, 43: 59, 44: 69, 45: 66, 46: 75, 47: 64, 48: 63, 50: 67, 51: 74, 52: 61, 53: 73, 54: 72,
      55: 71, 56: 65, 57: 76, 58: 70, 59: 60, 60: 77, 61: 62,
    };
    for (const [task, pr] of Object.entries(merged)) {
      expect(unreleased, `R${task}`).toMatch(new RegExp(`A11Y-R${task}\\b[^\\n]*\\[#${pr}]\\(https://github\\.com/DaveEliranAssistant/a11ygate/pull/${pr}\\)`));
    }
    const notIncluded = unreleased.slice(unreleased.indexOf('### Not included'));
    for (const task of ['A11Y-R34', 'A11Y-R49']) expect(notIncluded, task).toContain(task);
  });
});
