import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Minimal git plumbing for the isolated verifier. Runs `git` with a fixed
 * argument list (no shell), hooks disabled, no prompts and no CRLF
 * conversion. Never touches the caller's working tree or index.
 */

/** Prefix of every disposable directory the verifier creates under the system temp dir. */
export const WORKTREE_PREFIX = 'a11ygate-modelfix-';

const FULL_SHA = /^[0-9a-f]{40}$/;

export function isFullSha(value: string): boolean {
  return FULL_SHA.test(value);
}

export function git(repoRoot: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-c', 'core.hooksPath=/dev/null', '-c', 'core.autocrlf=false', '-c', 'core.fsmonitor=false', ...args],
      {
        cwd: repoRoot,
        shell: false,
        timeout: 60_000,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
      },
      (error, stdout) => (error ? reject(new Error(`git ${args[0]} failed`)) : resolve(String(stdout))),
    );
  });
}

/** Resolves a ref to a full commit SHA, or null. */
export async function resolveCommit(repoRoot: string, ref: string): Promise<string | null> {
  try {
    const sha = (await git(repoRoot, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])).trim();
    return isFullSha(sha) ? sha : null;
  } catch {
    return null;
  }
}

/** Git blob id of `file` at `commit`, or null when the path does not exist there. */
export async function blobAt(repoRoot: string, commit: string, file: string): Promise<string | null> {
  try {
    const sha = (await git(repoRoot, ['rev-parse', '--verify', '--quiet', `${commit}:${file}`])).trim();
    return isFullSha(sha) ? sha : null;
  } catch {
    return null;
  }
}

export type Worktree = { dir: string; tree: string; remove: () => Promise<void> };

/**
 * Creates a detached, disposable worktree at `commit` under
 * `<tmpdir>/a11ygate-modelfix-XXXX/tree`. `remove` deletes it and its git
 * registration; it never throws and is safe to call twice.
 */
export async function createWorktree(repoRoot: string, commit: string): Promise<Worktree> {
  const dir = await mkdtemp(path.join(tmpdir(), WORKTREE_PREFIX));
  const tree = path.join(dir, 'tree');
  let removed = false;
  const remove = async () => {
    if (removed) return;
    removed = true;
    await git(repoRoot, ['worktree', 'remove', '--force', tree]).catch(() => undefined);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    await git(repoRoot, ['worktree', 'prune']).catch(() => undefined);
  };
  try {
    await git(repoRoot, ['worktree', 'add', '--detach', '--force', tree, commit]);
  } catch (error) {
    await remove();
    throw error;
  }
  return { dir, tree, remove };
}
