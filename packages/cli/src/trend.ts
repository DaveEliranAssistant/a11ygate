import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MAX_PACK_TOTAL_BYTES, parseScanReport, sha256, type EvidenceManifest } from '@/lib/evidence/pack';
import { readZip } from '@/lib/evidence/zip';
import { buildTrend, renderTrendHtml, type TrendRunInput } from '@/lib/trend';

export type TrendIo = { cwd?: string; stdout?: (chunk: string) => void; stderr?: (chunk: string) => void };
export type TrendOptions = { help: boolean; dir?: string; outDir?: string };

const SCAN_PATH = 'scan/a11ygate-scan.json';
export const TREND_JSON = 'a11ygate-trend.json';
export const TREND_HTML = 'a11ygate-trend.html';

export function trendHelpText(): string {
  return `a11ygate trend — history across evidence packs

Usage:
  a11ygate trend <dir-of-evidence-packs> [--out-dir <dir>]

Reads every evidence pack in <dir> (a11ygate-evidence zip files, or extracted pack
directories containing manifest.json) and writes ${TREND_JSON} and ${TREND_HTML}:
findings per run (new, existing, fixed), top rules over time, and pages with the
most regressions. Runs are ordered by the scan timestamp in each manifest.

Options:
  --out-dir <dir>  Where to write the two files. Default: <dir>.

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
    } else if (token.startsWith('-')) return { ok: false, error: `Unknown trend option ${token}.` };
    else if (options.dir) return { ok: false, error: `Unexpected argument ${token}.` };
    else options.dir = token;
  }
  if (!options.dir) return { ok: false, error: 'Pass the directory of evidence packs: a11ygate trend <dir>.' };
  return { ok: true, options };
}

function parseManifest(text: string): EvidenceManifest | null {
  try {
    const m = JSON.parse(text) as Partial<EvidenceManifest>;
    if (m?.tool !== 'a11ygate' || m.kind !== 'evidence-pack' || m.schemaVersion !== 1 || !m.timestamps || !m.commit || !Array.isArray(m.files)) return null;
    if (Number.isNaN(Date.parse(m.timestamps.scannedAt ?? m.timestamps.packedAt ?? ''))) return null;
    return m as EvidenceManifest;
  } catch {
    return null;
  }
}

/** Validates one pack: manifest shape, scan report shape, and the scan report's SHA-256 against the manifest. */
function readPack(source: string, files: Map<string, Uint8Array>): TrendRunInput | string {
  const manifestData = files.get('manifest.json');
  const scanData = files.get(SCAN_PATH);
  if (!manifestData || !scanData) return `${source}: not an evidence pack (manifest.json or ${SCAN_PATH} missing).`;
  const manifest = parseManifest(Buffer.from(manifestData).toString('utf8'));
  if (!manifest) return `${source}: manifest.json is not an A11yGate evidence-pack manifest.`;
  const recorded = manifest.files.find((f) => f.path === SCAN_PATH);
  if (!recorded || recorded.sha256 !== sha256(scanData)) return `${source}: ${SCAN_PATH} does not match the SHA-256 in manifest.json.`;
  const report = parseScanReport(Buffer.from(scanData).toString('utf8'));
  if (!report) return `${source}: ${SCAN_PATH} is not an A11yGate site-scan report.`;
  return { source, manifest, report };
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
  const trend = buildTrend(inputs);
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
