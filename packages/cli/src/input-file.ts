import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

/** Inputs A11yGate reads are small JSON documents; anything larger is refused before it is read. */
export const MAX_INPUT_JSON_BYTES = 64 * 1024 * 1024;

/**
 * Read and validate a local JSON input file. Every failure is an Error whose message starts with
 * the file name as given (`<file>: ...`) and names the field when the validator does. JSON syntax
 * errors are reported without echoing file content, because inputs such as storage state hold credentials.
 */
export async function readJsonInput<T>(cwd: string, file: string, parse: (value: unknown) => T, maxBytes = MAX_INPUT_JSON_BYTES): Promise<T> {
  const absolute = path.resolve(cwd, file);
  let text: string;
  try {
    const info = await stat(absolute);
    if (info.isDirectory()) throw Object.assign(new Error(), { code: 'EISDIR' });
    if (info.size > maxBytes) throw Object.assign(new Error(), { code: 'EFBIG' });
    text = await readFile(absolute, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new Error(`${file}: ${code === 'ENOENT' ? 'file not found' : code === 'EISDIR' ? 'is a directory, not a file' : code === 'EFBIG' ? `larger than ${maxBytes / 1024 / 1024} MB` : 'could not read the file'}.`, { cause: error });
  }
  let value: unknown;
  try { value = JSON.parse(text.replace(/^﻿/, '')); }
  // No cause: engine JSON syntax messages can quote file content (credentials), even under --debug.
  catch { throw new Error(`${file}: not valid JSON.`); }
  try { return parse(value); }
  catch (error) { throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
}
