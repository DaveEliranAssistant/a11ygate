import { createHash } from 'node:crypto';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import ownHosts from '@/config/own-hosts.json';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { prospectHtml } from '@/lib/scan/prospect-report';
import type { ScanReport } from '@/lib/scan/report';
import { MAX_CRAWL_PAGES, normalizeUrl } from '@/lib/scan/url';
import { readScanInput } from './baseline';
import { assertSafeOutputs, privateOutputDir } from './output-paths';
import { printProspectPdf, writeBinaryAtomic } from './report-pdf';
import { runScan, type ScanIo } from './scan';

const HELP = `Usage: a11ygate prospect <url|scan-dir> [--max-pages <1-20>] [--company <name>] [--out-dir <dir>] [--offer]
       a11ygate prospect --from <scan-dir|scan.json> [--company <name>] [--out-dir <dir>] [--offer]

Write a prospect summary (HTML and PDF) and manifest to prospect-out by default.
URL mode scans one page by default. Sites outside the own-host allowlist require
both --authorized-by <name> and --authorization-note <text> before scanning.
--outreach-data saves the scan JSON alongside its approval manifest for offline kit
generation. URL mode only. Keep the resulting private data outside repositories.
--from reads saved scan data offline. PDF output requires Playwright Chromium.

${AUTOMATED_TESTING_DISCLAIMER}
`;

const valueFlags = new Set(['--from', '--company', '--max-pages', '--out-dir', '--authorized-by', '--authorization-note']);

export function isOwnProspectHost(url: string): boolean {
  const normalized = normalizeUrl(url);
  return normalized !== null && ownHosts.includes(new URL(normalized).hostname.replace(/^\[|\]$/g, ''));
}

function parseProspectArgs(argv: readonly string[]) {
  let target: string | undefined;
  let offer = false;
  let outreachData = false;
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === '--offer') {
      offer = true;
    } else if (token === '--outreach-data') {
      outreachData = true;
    } else if (token.startsWith('-')) {
      const eq = token.indexOf('=');
      const flag = eq < 0 ? token : token.slice(0, eq);
      if (!valueFlags.has(flag)) throw new Error(`Unknown prospect option ${token}.`);
      if (values.has(flag)) throw new Error(`Pass ${flag} once.`);
      const value = eq < 0 ? argv[++i]?.trim() : token.slice(eq + 1).trim();
      if (!value || (eq < 0 && value.startsWith('--'))) throw new Error(`${flag} needs a value.`);
      values.set(flag, value);
    } else {
      if (target) throw new Error('Pass one URL or saved scan.');
      target = token;
    }
  }
  const from = values.get('--from');
  if (Boolean(from) === Boolean(target)) throw new Error('Pass one URL or saved scan.');
  const url = from ? null : normalizeUrl(target!);
  if (!url && target && /^[a-z][a-z\d+.-]*:\/\//i.test(target)) {
    throw new Error('Pass an HTTP(S) URL without credentials or a local saved scan path.');
  }
  if (outreachData && (!url || !values.has('--out-dir'))) {
    throw new Error('--outreach-data requires URL mode and an explicit --out-dir.');
  }
  const max = values.get('--max-pages');
  const maxPages = max === undefined ? 1 : Number(max);
  if (max !== undefined && (!/^\d+$/.test(max) || maxPages < 1 || maxPages > MAX_CRAWL_PAGES)) {
    throw new Error(`--max-pages must be from 1 to ${MAX_CRAWL_PAGES}.`);
  }
  if (!url && max !== undefined) throw new Error('--max-pages applies to URL scans only.');
  const authorizedBy = values.get('--authorized-by');
  const authorizationNote = values.get('--authorization-note');
  if (Boolean(authorizedBy) !== Boolean(authorizationNote)) {
    throw new Error('Provide both --authorized-by and --authorization-note.');
  }
  if (url && !isOwnProspectHost(url) && !authorizedBy) {
    throw new Error('This host requires both --authorized-by and --authorization-note.');
  }
  return {
    input: (from ?? target)!,
    url,
    maxPages,
    company: values.get('--company'),
    outDir: values.get('--out-dir') ?? 'prospect-out',
    offer,
    outreachData,
    authorization: authorizedBy && authorizationNote ? { authorizedBy, authorizationNote } : undefined,
  };
}

async function scanProspectUrl(url: string, maxPages: number, io: ScanIo) {
  let report: ScanReport | undefined;
  const code = await runScan([url, '--crawl', String(maxPages), '--fail-on', 'none'], {
    ...io, readOnly: true, stdout: () => {}, onReport: value => { report = value; },
  });
  if (code === 2 || !report) throw new Error('The prospect scan could not complete.');
  return report;
}

export async function runProspect(argv: readonly string[], io: ScanIo = {}): Promise<number> {
  const stdout = io.stdout ?? ((s: string) => process.stdout.write(s));
  const stderr = io.stderr ?? ((s: string) => process.stderr.write(s));
  const cwd = io.cwd ?? process.cwd();
  if (argv.includes('--help') || argv.includes('-h')) { stdout(HELP); return 0; }
  try {
    const options = parseProspectArgs(argv);
    const requested = path.resolve(cwd, options.outDir);
    const output = options.outreachData ? (await privateOutputDir(requested)).canonical : requested;
    const htmlPath = path.join(output, 'prospect-summary.html');
    const pdfPath = path.join(output, 'prospect-summary.pdf');
    const manifestPath = path.join(output, 'prospect-manifest.json');
    const outputs = [htmlPath, pdfPath, manifestPath];
    const scanPath = path.join(output, 'a11ygate-scan.json');
    if (options.outreachData) outputs.push(scanPath);
    let source: string | undefined;
    if (!options.url) {
      const input = path.resolve(cwd, options.input);
      source = (await stat(input)).isDirectory() ? path.join(input, 'a11ygate-scan.json') : input;
    }
    await assertSafeOutputs(cwd, source ? [source] : [], outputs);
    const report = options.url
      ? await scanProspectUrl(options.url, options.maxPages, io)
      : await readScanInput(options.input, cwd);
    const html = prospectHtml(report, options);
    const pdf = await printProspectPdf(html, report.scannedAt);
    const scanData = options.outreachData
      ? Buffer.from(JSON.stringify({ ...report, disclaimer: AUTOMATED_TESTING_DISCLAIMER }, null, 2) + '\n')
      : undefined;
    const manifest = {
      schemaVersion: 1,
      source: options.url ? 'url' : 'saved-scan',
      startUrl: report.startUrl,
      scannedAt: report.scannedAt,
      company: options.company ?? null,
      offer: options.offer,
      authorizedBy: options.authorization?.authorizedBy ?? null,
      authorizationNote: options.authorization?.authorizationNote ?? null,
      files: ['prospect-summary.html', 'prospect-summary.pdf', ...(scanData ? ['a11ygate-scan.json'] : [])],
      ...(scanData ? { scanSha256: createHash('sha256').update(scanData).digest('hex') } : {}),
      disclaimer: AUTOMATED_TESTING_DISCLAIMER,
    };
    await mkdir(output, { recursive: true, ...(options.outreachData ? { mode: 0o700 } : {}) });
    await writeBinaryAtomic(htmlPath, Buffer.from(html));
    await writeBinaryAtomic(pdfPath, pdf);
    if (scanData) await writeBinaryAtomic(scanPath, scanData);
    await writeBinaryAtomic(manifestPath, Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
    stdout(`Wrote prospect-summary.html, prospect-summary.pdf and prospect-manifest.json${scanData ? ' with a11ygate-scan.json' : ''} to ${options.outDir}\n${AUTOMATED_TESTING_DISCLAIMER}\n`);
    return 0;
  } catch (error) {
    stderr(`Prospect report failed: ${error instanceof Error ? error.message : String(error)}\n${AUTOMATED_TESTING_DISCLAIMER}\n`);
    return 2;
  }
}
