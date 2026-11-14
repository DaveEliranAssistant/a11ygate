import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createFingerprintBaseline, parseScanReport } from '@/lib/scan/baseline';
import type { RunIo } from './run';

export const BASELINE_HELP = `a11ygate baseline create [<scan.json|out-dir>] [--output <file>]
  --from <scan.json>   Read a saved site-scan report (also accepts an out-dir).
  --out-dir <dir>     Read a11ygate-scan.json from this directory.
  --output <file>     Default: .a11ygate-baseline.json in the current directory.
Without an input, read ./a11ygate-scan.json after a scan.
Use this fingerprint file with a11ygate scan --baseline or a11ygate report --baseline.
The separate a11ygate [ci] --baseline continues to accept axe JSON only.
Automated testing only. Not a WCAG audit, certification or legal advice.
`;

export async function readScanInput(file: string, cwd: string) {
  let absolute = path.resolve(cwd, file);
  if ((await stat(absolute)).isDirectory()) absolute = path.join(absolute, 'a11ygate-scan.json');
  return parseScanReport(JSON.parse(await readFile(absolute, 'utf8')));
}

export async function runBaseline(argv: readonly string[], io: RunIo): Promise<number> {
  const stdout = io.stdout ?? ((s: string) => process.stdout.write(s));
  const stderr = io.stderr ?? ((s: string) => process.stderr.write(s));
  if (argv.includes('--help') || argv.includes('-h')) { stdout(BASELINE_HELP); return 0; }
  if (argv[0] !== 'create') { stderr(BASELINE_HELP); return 2; }
  let source: string | undefined;
  let output = '.a11ygate-baseline.json';
  try {
    for (let i = 1; i < argv.length; i++) {
      const token = argv[i]!;
      if (['--from', '--out-dir', '--output'].includes(token)) {
        const value = argv[++i];
        if (!value || value.startsWith('-')) throw new Error(`${token} needs a value.`);
        if (token === '--output') output = value;
        else { if (source) throw new Error('Pass one scan input.'); source = value; }
      } else if (!token.startsWith('-') && !source) source = token;
      else throw new Error(`Unexpected baseline argument ${token}.`);
    }
    const cwd = io.cwd ?? process.cwd();
    const report = await readScanInput(source ?? 'a11ygate-scan.json', cwd);
    if (report.counts.pagesFailed || report.engines?.errored.length || report.verdict === 'ERROR') throw new Error('Cannot create a baseline from incomplete scan coverage.');
    // Exclusive creation keeps an existing baseline or input report safe; updates are explicit file replacement.
    await writeFile(path.resolve(cwd, output), JSON.stringify(createFingerprintBaseline(report), null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    stdout(`Wrote fingerprint baseline ${output}\n`);
    return 0;
  } catch (error) {
    stderr(`Could not create baseline: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}
