import { execFile } from 'node:child_process';
import { lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** Resolve aliases so rendering cannot overwrite the evidence being compared. */
export async function assertSafeOutputs(cwd: string, inputs: string[], outputs: string[]): Promise<void> {
  const identify = async (file: string) => {
    const absolute = path.resolve(cwd, file);
    const canonical = await realpath(absolute).catch(async () => {
      if ((await lstat(absolute).catch(() => null))?.isSymbolicLink()) throw new Error('Dangling output symlink.');
      return path.join(await realpath(path.dirname(absolute)).catch(() => path.dirname(absolute)), path.basename(absolute));
    });
    const info = await stat(absolute).catch(() => null);
    return { canonical, inode: info ? `${info.dev}:${info.ino}` : undefined };
  };
  const protectedPaths = await Promise.all(inputs.map(identify));
  for (const output of outputs) {
    const id = await identify(output);
    if (protectedPaths.some((p) => p.canonical === id.canonical || !!(id.inode && p.inode === id.inode))) {
      throw new Error('Output paths must be distinct and must not overwrite input evidence.');
    }
    protectedPaths.push(id);
  }
}

async function lstatIfPresent(file: string) {
  return lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
}

async function canonicalOutputDir(dir: string): Promise<string> {
  if (await lstatIfPresent(dir)) {
    const canonical = await realpath(dir);
    if (!(await stat(canonical)).isDirectory()) throw new Error('Output path must be a directory.');
    return canonical;
  }
  return path.join(await canonicalOutputDir(path.dirname(dir)), path.basename(dir));
}

async function gitWorkTree(dir: string): Promise<string | undefined> {
  for (;;) {
    if (await lstatIfPresent(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export async function privateOutputDir(dir: string, allowInRepo = false) {
  const canonical = await canonicalOutputDir(dir);
  const workTree = await gitWorkTree(canonical);
  const inRepo = !!(workTree || await gitWorkTree(dir));
  if (inRepo && !allowInRepo) throw new Error('Output is inside a git work tree. Choose a path outside the repository.');
  return { canonical, inRepo, workTree };
}

/** Ignore rules apply only to untracked paths. */
export async function assertUntrackedOutputs(root: string, files: string[]): Promise<void> {
  const relative = files.map(file => path.relative(root, file));
  if (relative.some(file => file.split(path.sep)[0]!.toLowerCase() === '.git')) {
    throw new Error('Output cannot be written under Git metadata.');
  }
  const { stdout } = await exec('git', ['--literal-pathspecs', 'ls-files', '--', ...relative], { cwd: root, timeout: 5000, windowsHide: true });
  if (stdout) throw new Error('Output would overwrite a tracked file. Choose a private output directory.');
}
