import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MAX_PACK_TOTAL_BYTES, parseScanReport, sha256, type EvidenceManifest } from '@/lib/evidence/pack';
import { readZip } from '@/lib/evidence/zip';
import { createFingerprintBaseline, parseScanReport as parseStrictScanReport } from '@/lib/scan/baseline';
import { buildTrend, renderTrendHtml, type TrendOrder, type TrendRunInput } from '@/lib/trend';

export type TrendIo = { cwd?: string; stdout?: (chunk: string) => void; stderr?: (chunk: string) => void };
export type TrendOptions = { help: boolean; dir?: string; outDir?: string; order?: TrendOrder };

const SCAN_PATH = 'scan/a11ygate-scan.json';
export const TREND_JSON = 'a11ygate-trend.json';
export const TREND_HTML = 'a11ygate-trend.html';

export function trendHelpText(): string {
  return `a11ygate trend — history across evidence packs

Usage:
  a11ygate trend <dir-of-evidence-packs> [--out-dir <dir>] [--order scan|commit]

Reads every evidence pack in <dir> (a11ygate-evidence zip files, or extracted pack
directories containing manifest.json) and writes ${TREND_JSON} and ${TREND_HTML}:
findings per run (new, existing, fixed), top rules over time, and pages with the
most regressions. Runs are ordered by the commit time recorded in each manifest
when every pack has one, otherwise by scan time with a note in the report.

Options:
  --out-dir <dir>         Where to write the two files. Default: <dir>.
  --order scan|commit     scan: order by scan time. commit: order by commit time
                          (falls back to scan time, with a note, if any pack lacks it).

Findings are deduplicated with the same fingerprints as a11ygate baseline create.
Nothing is fetched; the HTML has no scripts and no external resources.

Automated testing only. Not a WCAG audit, certification or legal advice.
`;
}

export function parseTrendArgs(argv: readonly string[]): { ok: true; options: TrendOptions } | { ok: false; error: string } {
  if (argv.includes('--help') || argv.includes('-h')) return { ok: true, options: { help: true } };
  const options: TrendOptions = { help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? '';
    if (token === '--out-dir' || token.startsWith('--out-dir=')) {
      const value = token.includes('=') ? token.slice(token.indexOf('=') + 1) : argv[(index += 1)];
      if (!value || value.startsWith('-')) return { ok: false, error: '--out-dir needs a value.' };
      options.outDir = value;
    } else if (token === '--order' || token.startsWith('--order=')) {
      const value = token.includes('=') ? token.slice(token.indexOf('=') + 1) : argv[(index += 1)];
      if (value !== 'scan' && value !== 'commit') return { ok: false, error: '--order must be scan or commit.' };
      options.order = value;
    } else if (token.startsWith('-')) return { ok: false, error: `Unknown trend option ${token}.` };
    else if (options.dir) return { ok: false, error: `Unexpected argument ${token}.` };
    else options.dir = token;
  }
  if (!options.dir) return { ok: false, error: 'Pass the directory of evidence packs: a11ygate trend <dir>.' };
  return { ok: true, options };
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const optionalString = (v: unknown) => v === undefined || v === null || typeof v === 'string';

/**
 * Returns the manifest, or a message naming the first field the trend report reads that has the wrong shape
 * (for example "field commit.sha must be a string"). Never throws and never echoes field values.
 */
export function parseManifest(text: string): EvidenceManifest | string {
  let m: unknown;
  try { m = JSON.parse(text); } catch { return 'not valid JSON.'; }
  if (!isRecord(m)) return 'field (top level) must be a JSON object.';
  if (m.tool !== 'a11ygate') return 'field tool must be "a11ygate".';
  if (m.kind !== 'evidence-pack') return 'field kind must be "evidence-pack".';
  if (m.schemaVersion !== 1) return 'field schemaVersion must be 1.';
  const { timestamps, commit, files } = m;
  if (!isRecord(timestamps)) return 'field timestamps must be an object.';
  for (const key of ['scannedAt', 'packedAt'] as const) if (!optionalString(timestamps[key])) return `field timestamps.${key} must be a string.`;
  if (!isRecord(commit)) return 'field commit must be an object.';
  if (!optionalString(commit.sha)) return 'field commit.sha must be a string.';
  if (!Array.isArray(files)) return 'field files must be a list.';
  for (const [index, f] of files.entries()) {
    if (!isRecord(f)) return `field files[${index}] must be an object.`;
    if (typeof f.path !== 'string') return `field files[${index}].path must be a string.`;
    if (typeof f.sha256 !== 'string') return `field files[${index}].sha256 must be a string.`;
  }
  const when = timestamps.scannedAt ?? timestamps.packedAt;
  if (Number.isNaN(Date.parse((when ?? '') as string))) return `field timestamps.${timestamps.scannedAt != null ? 'scannedAt' : 'packedAt'} must be an ISO date.`;
  // committedAt and branch are optional (A11Y-R48); packs made earlier have neither.
  // Drop malformed values rather than rejecting the pack.
  if (commit.committedAt !== undefined && (typeof commit.committedAt !== 'string' || Number.isNaN(Date.parse(commit.committedAt)))) delete commit.committedAt;
  if (commit.branch !== undefined && typeof commit.branch !== 'string') delete commit.branch;
  return m as unknown as EvidenceManifest;
}

/** First field of the scan report the trend reads that has the wrong shape, or null. */
function scanReportProblem(report: Record<string, unknown>): string | null {
  if (typeof report.startUrl !== 'string') return 'field startUrl must be a string';
  if (typeof report.verdict !== 'string') return 'field verdict must be a string';
  if (!isRecord(report.counts)) return 'field counts must be an object';
  if (typeof report.counts.pagesScanned !== 'number') return 'field counts.pagesScanned must be a number';
  for (const [index, p] of (report.pages as unknown[]).entries()) {
    if (!isRecord(p)) return `field pages[${index}] must be an object`;
    if (typeof p.url !== 'string') return `field pages[${index}].url must be a string`;
    if (!optionalString(p.finalUrl)) return `field pages[${index}].finalUrl must be a string`;
    if (!optionalString(p.scanStatus)) return `field pages[${index}].scanStatus must be a string`;
  }
  if (report.engines !== undefined) {
    if (!isRecord(report.engines)) return 'field engines must be an object';
    if (!Array.isArray(report.engines.used)) return 'field engines.used must be a list';
    if (!Array.isArray(report.engines.errored)) return 'field engines.errored must be a list';
  }
  return null;
}

/** Validates one pack: manifest shape, scan report shape, and the scan report's SHA-256 against the manifest. */
export function readPack(source: string, files: Map<string, Uint8Array>): TrendRunInput | string {
  const manifestData = files.get('manifest.json');
  const scanData = files.get(SCAN_PATH);
  if (!manifestData || !scanData) return `${source}: not an evidence pack (manifest.json or ${SCAN_PATH} missing).`;
  const manifest = parseManifest(Buffer.from(manifestData).toString('utf8'));
  if (typeof manifest === 'string') return `${source}: manifest.json is not an A11yGate evidence-pack manifest: ${manifest}`;
  const recorded = manifest.files.find((f) => f.path === SCAN_PATH);
  if (!recorded) return `${source}: manifest.json field files has no entry for ${SCAN_PATH}.`;
  if (recorded.sha256 !== sha256(scanData)) return `${source}: ${SCAN_PATH} does not match the SHA-256 in manifest.json.`;
  const report = parseScanReport(Buffer.from(scanData).toString('utf8'));
  if (!report) return `${source}: ${SCAN_PATH} is not an A11yGate site-scan report (${scanReportFieldHint(Buffer.from(scanData).toString('utf8'))}).`;
  // Fields the trend reads; validated here so a malformed pack is skipped instead of failing the whole run.
  const problem = scanReportProblem(report as unknown as Record<string, unknown>);
  if (problem) return `${source}: ${SCAN_PATH} is not an A11yGate site-scan report (${problem}).`;
  try { parseStrictScanReport(report); createFingerprintBaseline(report); }
  catch (error) { return `${source}: ${SCAN_PATH}: ${(error as Error).message}`; }
  return { source, manifest, report };
}

/** Names the first top-level field that makes lib/evidence/pack parseScanReport refuse the report. */
function scanReportFieldHint(text: string): string {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return 'not valid JSON'; }
  if (!isRecord(value)) return 'field (top level) must be a JSON object';
  if (value.tool !== 'a11ygate') return 'field tool must be "a11ygate"';
  if (value.kind !== 'site-scan') return 'field kind must be "site-scan"';
  for (const key of ['pages', 'findings'] as const) if (!Array.isArray(value[key])) return `field ${key} must be a list`;
  return !value.counts ? 'field counts is missing' : 'field options is missing';
}

async function loadPacks(dir: string, warn: (message: string) => void): Promise<TrendRunInput[]> {
  const inputs: TrendRunInput[] = [];
  for (const name of (await readdir(dir)).sort()) {
    const full = path.join(dir, name);
    const info = await lstat(full);
    let files: Map<string, Uint8Array> | null = null;
    if (info.isFile() && name.toLowerCase().endsWith('.zip')) {
      if (info.size > MAX_PACK_TOTAL_BYTES * 2) { warn(`Skipped ${name}: larger than an evidence pack can be.`); continue; }
      try {
        files = new Map(readZip(await readFile(full)).map((e) => [e.path, e.data]));
      } catch (error) {
        warn(`Skipped ${name}: ${(error as Error).message}`);
        continue;
      }
    } else if (info.isDirectory()) {
      const manifest = path.join(full, 'manifest.json');
      const scan = path.join(full, ...SCAN_PATH.split('/'));
      const isFile = async (p: string) => (await lstat(p).catch(() => null))?.isFile() ?? false;
      if (!(await isFile(manifest)) || !(await isFile(scan))) continue;
      files = new Map([['manifest.json', await readFile(manifest)], [SCAN_PATH, await readFile(scan)]]);
    } else continue;
    const pack = readPack(name, files);
    if (typeof pack === 'string') warn(`Skipped ${pack}`);
    else inputs.push(pack);
  }
  return inputs;
}

export async function runTrend(argv: readonly string[], io: TrendIo = {}): Promise<number> {
  const stdout = io.stdout ?? ((chunk: string) => process.stdout.write(chunk));
  const stderr = io.stderr ?? ((chunk: string) => process.stderr.write(chunk));
  const cwd = io.cwd ?? process.cwd();
  const parsed = parseTrendArgs(argv);
  if (!parsed.ok) {
    stderr(`${parsed.error}\nRun a11ygate trend --help for usage.\n`);
    return 2;
  }
  if (parsed.options.help) {
    stdout(trendHelpText());
    return 0;
  }
  const dir = path.resolve(cwd, parsed.options.dir as string);
  const info = await lstat(dir).catch(() => null);
  if (!info?.isDirectory()) {
    stderr(`${parsed.options.dir}: not a directory.\n`);
    return 2;
  }
  const inputs = await loadPacks(dir, (message) => stderr(`${message}\n`));
  if (inputs.length === 0) {
    stderr(`${parsed.options.dir}: no evidence packs found. Create them with a11ygate evidence pack.\n`);
    return 2;
  }
  const trend = buildTrend(inputs, parsed.options.order ?? 'auto');
  // Asked for commit order explicitly but did not get it: say so on stderr too.
  if (parsed.options.order === 'commit' && trend.ordering.note) stderr(`Note: ${trend.ordering.note}\n`);
  const outDir = path.resolve(cwd, parsed.options.outDir ?? (parsed.options.dir as string));
  try {
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, TREND_JSON), `${JSON.stringify(trend, null, 2)}\n`, 'utf8');
    await writeFile(path.join(outDir, TREND_HTML), renderTrendHtml(trend), 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    stderr(`Could not write the trend report${code ? ` (${code})` : ''}.\n`);
    return 2;
  }
  const rel = path.relative(cwd, outDir) || '.';
  stdout(`Wrote ${path.join(rel, TREND_JSON)} and ${path.join(rel, TREND_HTML)} (${trend.runs.length} run${trend.runs.length === 1 ? '' : 's'}).\n`);
  return 0;
}
