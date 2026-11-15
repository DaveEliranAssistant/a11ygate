import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { buildTickets, exportTickets, JIRA_CSV_IMPORT_DOC, TICKET_FORMATS, type TicketFormat } from '@/lib/export-tickets';
import { applyFingerprintBaseline, parseFingerprintBaseline } from '@/lib/scan/baseline';
import { readScanInput } from './baseline';
import { debugDetail } from './fatal';
import { readJsonInput } from './input-file';
import { assertSafeOutputs } from './output-paths';
import type { RunIo } from './run';

export const EXPORT_HELP = `a11ygate export tickets <scan.json|out-dir> --format csv|jira-csv|gh-md [options]
Developer handoff: one ticket per likely shared component group, or per finding when
it has no group. Export only; A11yGate makes no calls to Jira, GitHub or any other API.

  --format <fmt>       csv (generic, UTF-8), jira-csv (Jira CSV import) or gh-md (GitHub issue Markdown).
  --baseline <file>    Fingerprint baseline with review decisions. Accepted-risk and false-positive
                       groups are skipped; expired accepted-risk decisions count as open.
  --output <file>      Write here instead of printing to stdout.

Fields: title, WCAG SC, EN 301 549 ref. (reference mapping only; does not indicate conformance),
impact, pages affected (count and first 5 URLs), selector, snippet, how-to-fix link and a
stable fingerprint (a11ygate-g-...) to deduplicate on re-import.
jira-csv follows ${JIRA_CSV_IMPORT_DOC}
Groupings are heuristic: review examples before filing.
${AUTOMATED_TESTING_DISCLAIMER}
`;

type ExportArgs = { input?: string; format?: TicketFormat; baseline?: string; output?: string };

function parseExportArgs(argv: readonly string[]): ExportArgs {
  const args: ExportArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    const eq = token.indexOf('=');
    const name = token.startsWith('--') && eq > 0 ? token.slice(0, eq) : token;
    if (['--format', '--baseline', '--output'].includes(name)) {
      const value = eq > 0 && token.startsWith('--') ? token.slice(eq + 1) : argv[++i];
      if (value === undefined || value === '' || (eq < 0 && value.startsWith('--'))) throw new Error(`${name} needs a value.`);
      if (name === '--format') {
        if (!(TICKET_FORMATS as readonly string[]).includes(value)) throw new Error(`Unknown ticket format "${value}". Use ${TICKET_FORMATS.join(', ')}.`);
        args.format = value as TicketFormat;
      } else if (name === '--baseline') args.baseline = value;
      else args.output = value;
      continue;
    }
    if (!token.startsWith('-') && !args.input) { args.input = token; continue; }
    throw new Error(`Unexpected export argument ${token}.`);
  }
  if (!args.input) throw new Error('Pass a saved scan report (a11ygate-scan.json or its out-dir).');
  if (!args.format) throw new Error(`--format is required: ${TICKET_FORMATS.join(', ')}.`);
  return args;
}

export async function runExport(argv: readonly string[], io: RunIo = {}): Promise<number> {
  const stdout = io.stdout ?? ((s: string) => process.stdout.write(s));
  const stderr = io.stderr ?? ((s: string) => process.stderr.write(s));
  if (argv.includes('--help') || argv.includes('-h')) { stdout(EXPORT_HELP); return 0; }
  if (argv[0] !== 'tickets') { stderr(EXPORT_HELP); return 2; }
  try {
    const args = parseExportArgs(argv.slice(1));
    const cwd = io.cwd ?? process.cwd();
    const now = (io.now ?? (() => new Date()))();
    let report = await readScanInput(args.input!, cwd);
    if (args.baseline) report = applyFingerprintBaseline(report, await readJsonInput(cwd, args.baseline, parseFingerprintBaseline), now);
    const text = exportTickets(report, args.format!, now);
    if (!args.output) { stdout(text); return 0; }
    const inputs = [args.input!, path.join(args.input!, 'a11ygate-scan.json'), ...(args.baseline ? [args.baseline] : [])];
    await assertSafeOutputs(cwd, inputs, [args.output]);
    await writeFile(path.resolve(cwd, args.output), text, 'utf8');
    const count = buildTickets(report, now).length;
    stdout(`Wrote ${count} ticket${count === 1 ? '' : 's'} (${args.format}) to ${args.output}\n${AUTOMATED_TESTING_DISCLAIMER}\n`);
    return 0;
  } catch (error) {
    stderr(`Could not export tickets: ${error instanceof Error ? error.message : String(error)}\n${debugDetail(error)}`);
    return 2;
  }
}
