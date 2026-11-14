import { lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

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
