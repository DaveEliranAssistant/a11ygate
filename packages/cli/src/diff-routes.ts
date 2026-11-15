import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { matchesPathGlob } from '@/lib/scan/crawl';
import type { DiffScan } from '@/lib/scan/report';
import { translator } from '@/lib/i18n';
import { validateConfig } from './config-schema';

const exec = promisify(execFile);
export type RouteMap = Record<string, string>;
export function parseRoutes(value: unknown): RouteMap {
  const errors = validateConfig({ routes: value });
  if (errors.length) throw new Error(`Invalid routes: ${errors[0]}`);
  return value as RouteMap;
}

/** Committed PR changes only. NUL delimiters preserve spaces/newlines in git paths. */
export async function selectRoutes(ref: string, routes: RouteMap, cwd: string): Promise<DiffScan> {
  if (!ref || ref.startsWith('-') || /\s|\0/.test(ref)) throw new Error('Invalid --changed-since ref: use a non-empty git ref that does not start with "-".');
  let files: string[];
  try {
    // Disable rename detection so both removed and added paths must be mapped.
    const { stdout } = await exec('git', ['diff', '--no-ext-diff', '--no-renames', '--no-relative', '--name-only', '-z', `${ref}...HEAD`, '--'], { cwd, maxBuffer: 8 * 1024 * 1024 });
    files = stdout.split('\0').filter(Boolean);
  } catch {
    throw new Error('Could not resolve --changed-since ref or compute its merge base with HEAD. Fetch the ref and its history, then retry; nothing was scanned.');
  }
  const selected = new Set<string>();
  let reasonCode: DiffScan['reasonCode'] = files.length ? 'mapped' : 'noChanges';
  for (const file of files) {
    const matches = Object.entries(routes).filter(([glob]) => matchesPathGlob(file, glob));
    if (!matches.length) { reasonCode = 'unmapped'; break; }
    if (matches.some(([, route]) => route === '*')) { reasonCode = 'wildcard'; break; }
    matches.forEach(([, route]) => selected.add(route));
  }
  const mode = reasonCode === 'mapped' ? 'diff-aware' : 'full';
  return { mode, ref, reasonCode, reason: translator('en').t(`diff.reason.${reasonCode}`), selectedRoutes: mode === 'diff-aware' ? [...selected] : [], scannedRoutes: [], skippedRoutes: [] };
}
