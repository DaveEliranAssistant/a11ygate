import { randomBytes } from 'node:crypto';
import { rename as fsRename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type AtomicWriteDeps = {
  /** Test seam; defaults to fs.promises.rename. */
  rename?: (from: string, to: string) => Promise<void>;
};

/**
 * Write `data` to a temp file in the target's directory, then rename it over the target.
 * A crash or a failed rename leaves the previous file untouched; the temp file is removed on failure.
 */
export async function writeFileAtomic(file: string, data: string, deps: AtomicWriteDeps = {}): Promise<void> {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await writeFile(tmp, data, { encoding: 'utf8', flag: 'wx' });
    await (deps.rename ?? fsRename)(tmp, file);
  } catch (error) {
    await unlink(tmp).catch(() => {});
    throw error;
  }
}
