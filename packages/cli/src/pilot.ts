import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getCheckoutUrl } from '@/lib/billing';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { PILOT_EVIDENCE_PATH, sha256 } from '@/lib/evidence/pack';
import { isIsoDay, pilotResultsHtml, quoteHtml, type PilotCriteria, type PilotEvidence, type PilotPack } from '@/lib/scan/pilot-report';
import criteriaSchema from '@/schema/pilot-success.schema.json';
import evidenceSchema from '@/schema/pilot-evidence.schema.json';
import { parseConfigYaml, validateConfig } from './config-schema';
import { assertSafeOutputs } from './output-paths';
import { printProspectPdf, writeBinaryAtomic } from './report-pdf';
import type { RunIo } from './run';
import { loadPacks, readPack, readPackZip } from './trend';

const HELP = `Usage: a11ygate pilot report --kickoff <evidence.zip> --latest <evidence.zip> --criteria <file.yml>
                            [--packs <dir>] [--customer <name>] [--out-dir <dir>]

Write pilot-results.html/.pdf and a draft quote.html/.pdf locally.
--packs adds the packs in a directory to the timeline.
--customer overrides the customer in the success criteria.
--out-dir defaults to pilot-report. PDF output requires Playwright Chromium.

${AUTOMATED_TESTING_DISCLAIMER}
`;

function parseArgs(argv: readonly string[]) {
  const values = new Map<string, string>();
  const allowed = ['--kickoff', '--latest', '--criteria', '--packs', '--customer', '--out-dir'];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    const eq = token.indexOf('=');
    const flag = eq < 0 ? token : token.slice(0, eq);
    if (!allowed.includes(flag)) throw new Error(`Unknown pilot report option ${token}.`);
    if (values.has(flag)) throw new Error(`Pass ${flag} once.`);
    const value = eq < 0 ? argv[++i]?.trim() : token.slice(eq + 1).trim();
    if (!value || (eq < 0 && value.startsWith('--'))) throw new Error(`${flag} needs a value.`);
    values.set(flag, value);
  }
  for (const flag of ['--kickoff', '--latest', '--criteria']) {
    if (!values.has(flag)) throw new Error(`Pass ${flag}.\n${HELP.split('\n')[0]}`);
  }
  return {
    kickoff: values.get('--kickoff')!,
    latest: values.get('--latest')!,
    criteria: values.get('--criteria')!,
    packs: values.get('--packs'),
    customer: values.get('--customer'),
    outDir: values.get('--out-dir') ?? 'pilot-report',
  };
}

function parseCriteria(text: string, source: string): PilotCriteria {
  const parsed = parseConfigYaml(text);
  const errors = !parsed.ok ? parsed.errors
    : parsed.value == null ? ['expected a mapping.'] : validateConfig(parsed.value, criteriaSchema);
  if (errors.length || !parsed.ok) throw new Error(`${source}: ${errors.join(' ')}`);
  const config = parsed.value as PilotCriteria;
  const { startDate, decisionDate } = config.pilot;
  if (!isIsoDay(startDate) || !isIsoDay(decisionDate) || decisionDate < startDate) {
    throw new Error(`${source}: pilot.startDate and pilot.decisionDate must be valid calendar dates in chronological order.`);
  }
  return config;
}

function parsePilotPack(source: string, files: Map<string, Uint8Array>, warn: (message: string) => void): PilotPack | string {
  const pack = readPack(source, files);
  if (typeof pack === 'string') return pack;
  const data = files.get(PILOT_EVIDENCE_PATH);
  const digest = pack.manifest.files.find(file => file.path === PILOT_EVIDENCE_PATH)?.sha256;
  if (!data && !digest) return pack;
  try {
    if (!data || digest !== sha256(data)) throw new Error('attachment missing or SHA-256 mismatch');
    const parsed: unknown = JSON.parse(Buffer.from(data).toString('utf8'));
    if (parsed == null || validateConfig(parsed, evidenceSchema).length) throw new Error('invalid attachment schema');
    const evidence = parsed as PilotEvidence;
    const { gate, postWeekTwoMerges, evidenceDeliveredOn } = evidence;
    for (const window of [gate, postWeekTwoMerges]) {
      if (window && (!isIsoDay(window.from) || !isIsoDay(window.through) || window.from > window.through)) {
        throw new Error('invalid date range');
      }
    }
    if ((gate && gate.gateRuns > gate.pullRequests) || (evidenceDeliveredOn !== undefined && !isIsoDay(evidenceDeliveredOn))) {
      throw new Error('invalid PR counts or handoff date');
    }
    return { ...pack, pilotEvidence: evidence };
  } catch (error) {
    // Do not echo attachment values, even on JSON syntax errors.
    const reason = error instanceof SyntaxError ? 'invalid JSON' : (error as Error).message;
    warn(`Ignored ${source}!/${PILOT_EVIDENCE_PATH}: ${reason}.`);
    return pack;
  }
}

export async function runPilot(argv: readonly string[], io: RunIo): Promise<number> {
  const stdout = io.stdout ?? ((message: string) => process.stdout.write(message));
  const stderr = io.stderr ?? ((message: string) => process.stderr.write(message));
  const warn = (message: string) => stderr(`Warning: ${message}\n`);
  const cwd = io.cwd ?? process.cwd();
  if (argv.includes('--help') || argv.includes('-h')) { stdout(HELP); return 0; }
  try {
    if (argv[0] !== 'report') throw new Error('Use a11ygate pilot report. See a11ygate pilot report --help.');
    const options = parseArgs(argv.slice(1));
    const criteria = parseCriteria(await readFile(path.resolve(cwd, options.criteria), 'utf8'), options.criteria);
    const loadEndpoint = async (source: string) => {
      const files = await readPackZip(path.resolve(cwd, source));
      const pack = parsePilotPack(source, files, warn);
      if (typeof pack === 'string') throw new Error(pack);
      return pack;
    };
    const kickoff = await loadEndpoint(options.kickoff);
    const latest = await loadEndpoint(options.latest);
    const packs = new Map<string, PilotPack>();
    if (options.packs) {
      const dir = options.packs;
      const loaded = await loadPacks(path.resolve(cwd, dir), warn,
        (name, files) => parsePilotPack(path.join(dir, name), files, warn), PILOT_EVIDENCE_PATH);
      for (const pack of loaded) packs.set(path.resolve(cwd, pack.source), pack);
    }
    for (const pack of [kickoff, latest]) packs.set(path.resolve(cwd, pack.source), pack);
    const output = path.resolve(cwd, options.outDir);
    const names = ['pilot-results.html', 'quote.html', 'pilot-results.pdf', 'quote.pdf'];
    const [resultsHtmlPath, quoteHtmlPath, resultsPdfPath, quotePdfPath] = names.map(name => path.join(output, name));
    await assertSafeOutputs(cwd, [options.criteria, ...packs.keys()], [resultsHtmlPath, quoteHtmlPath, resultsPdfPath, quotePdfPath]);

    const customer = options.customer ?? criteria.pilot.customer;
    const stamp = (io.now ?? (() => new Date()))().toISOString();
    const results = pilotResultsHtml(kickoff, latest, [...packs.values()], criteria, options.criteria, customer);
    const quote = quoteHtml(customer, stamp.slice(0, 10), getCheckoutUrl(io.env, warn));
    await writeBinaryAtomic(resultsHtmlPath, Buffer.from(results));
    await writeBinaryAtomic(quoteHtmlPath, Buffer.from(quote));
    let reportPdf: Buffer;
    let quotePdf: Buffer;
    try {
      reportPdf = await printProspectPdf(results, stamp);
      quotePdf = await printProspectPdf(quote, stamp);
    } catch (error) {
      const reason = error instanceof Error ? error.message.split('\n')[0] : String(error);
      throw new Error(`HTML saved to ${options.outDir}. Could not print PDFs (${reason}). PDF output requires Playwright Chromium (npx playwright install chromium).`);
    }
    await writeBinaryAtomic(resultsPdfPath, reportPdf);
    await writeBinaryAtomic(quotePdfPath, quotePdf);
    stdout(`Wrote ${names.join(', ')} to ${options.outDir}\n${AUTOMATED_TESTING_DISCLAIMER}\n`);
    return 0;
  } catch (error) {
    stderr(`Pilot report failed: ${error instanceof Error ? error.message : String(error)}\n${AUTOMATED_TESTING_DISCLAIMER}\n`);
    return 2;
  }
}
