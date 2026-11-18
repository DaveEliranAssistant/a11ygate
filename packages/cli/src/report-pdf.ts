import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { isPseudoReportLang, isReportLang, REPORT_LANGS, type ReportLang } from '@/lib/i18n';
import { namedDestinationPages } from '@/lib/scan/pdf-dests';
import type { ScanReport } from '@/lib/scan/report';
import { PDF_HEADER_TEMPLATE, PDF_PAGE, pdfFooterTemplate, pdfSourceHtml, tocEntries, type PdfCoverMeta } from '@/lib/scan/report-pdf';
import { scanHtmlV2 } from '@/lib/scan/report-html-v2';
import { readScanInput } from './baseline';
import { defaultGitHead } from './evidence';
import { debugDetail } from './fatal';

export type ReportPdfIo = {
  cwd?: string;
  stdout?: (chunk: string) => void;
  stderr?: (chunk: string) => void;
  /** Test seam: git HEAD of the working directory. */
  gitHead?: (cwd: string) => Promise<string | null>;
};

export type ReportPdfOptions = { input?: string; out: string; commit?: string; lang?: ReportLang; en301549Ref?: boolean; help: boolean; warnings: string[] };

export const DEFAULT_PDF_OUT = 'a11ygate-report.pdf';

export function reportPdfHelpText(): string {
  return `Usage: a11ygate report pdf <scan.json|out-dir> [-o <file.pdf>] [--commit <sha>] [--report-lang <lang>] [--en301549-ref]

Print HTML report v2 of a saved scan to PDF with the local Chromium (Playwright).
The PDF has a cover page (site, scan date, commit, engines, scope), a table of
contents with page numbers, page numbers and the disclaimer in every page footer.
Text stays selectable; the PDF is tagged and its title and language are set.
No network access: the report is self-contained and every request is blocked.

  -o, --out <file>      Output file. Default: ${DEFAULT_PDF_OUT}
  --commit <sha>        Commit shown on the cover. Default: git HEAD of the current
                        directory; "not recorded" outside a git work tree.
  --report-lang <lang>  ${REPORT_LANGS.join(', ')} (only en is a shipped language).
  --en301549-ref        Include the opt-in EN 301 549 reference column.

Needs playwright and its Chromium: npm install --save-dev playwright && npx playwright install chromium

${AUTOMATED_TESTING_DISCLAIMER}
`;
}

export function parseReportPdfArgs(argv: readonly string[]): { ok: true; options: ReportPdfOptions } | { ok: false; error: string } {
  const options: ReportPdfOptions = { out: DEFAULT_PDF_OUT, help: false, warnings: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] as string;
    if (token === '--help' || token === '-h') { options.help = true; continue; }
    if (token === '--en301549-ref') { options.en301549Ref = true; continue; }
    const eq = token.startsWith('--') ? token.indexOf('=') : -1;
    const name = eq > 0 ? token.slice(0, eq) : token;
    if (['-o', '--out', '--commit', '--report-lang'].includes(name)) {
      const value = eq > 0 ? token.slice(eq + 1) : argv[++i];
      if (!value || (eq < 0 && value.startsWith('-'))) return { ok: false, error: `${name} needs a value.` };
      if (name === '--commit') {
        if (!/^[0-9a-f]{7,64}$/i.test(value)) return { ok: false, error: '--commit must be a hexadecimal commit SHA (7 to 64 characters).' };
        options.commit = value.toLowerCase();
      } else if (name === '--report-lang') {
        if (!isReportLang(value)) return { ok: false, error: `Unknown --report-lang "${value}". Use ${REPORT_LANGS.join(', ')} (only en is a shipped language).` };
        if (isPseudoReportLang(value)) options.warnings.push(`--report-lang ${value} is a pseudo-locale for layout testing only, not a translation.`);
        options.lang = value;
      } else options.out = value;
      continue;
    }
    if (token.startsWith('-')) return { ok: false, error: `Unknown option ${token}.` };
    if (options.input) return { ok: false, error: `Unexpected argument ${token}.` };
    options.input = token;
  }
  if (!options.help && !options.input) return { ok: false, error: 'Missing <scan.json|out-dir>.' };
  return { ok: true, options };
}

type PdfPage = {
  setContent(html: string, options?: { waitUntil?: 'load' }): Promise<unknown>;
  pdf(options: Record<string, unknown>): Promise<Buffer>;
};
export type PdfBrowser = { newContext(options: Record<string, unknown>): Promise<{ route(url: string, handler: (route: { abort(): Promise<void> }) => unknown): Promise<void>; newPage(): Promise<PdfPage>; close(): Promise<void> }>; close(): Promise<void> };

/**
 * Print the report to PDF in two passes: the first finds the page of every
 * section (from Chromium's named destinations), the second prints the TOC with
 * those page numbers. Pagination does not change between passes because only
 * same-width digits in the TOC differ.
 */
export async function renderReportPdf(
  browser: PdfBrowser,
  report: ScanReport,
  meta: PdfCoverMeta,
  options: { lang?: ReportLang; en301549Ref?: boolean } = {},
): Promise<{ pdf: Buffer; html: string; tocPages: Record<string, number> }> {
  const htmlOptions = { ...(options.lang ? { lang: options.lang } : {}), ...(options.en301549Ref ? { en301549Ref: true } : {}) };
  return withPdfPrinter(browser, async print => {
    const ids = tocEntries(scanHtmlV2(report, htmlOptions)).map((e) => e.id);
    const draft = await print(pdfSourceHtml(report, meta, htmlOptions));
    const found = namedDestinationPages(draft);
    const tocPages = Object.fromEntries(ids.flatMap((id) => (found.has(id) ? [[id, found.get(id) as number]] : [])));
    const html = pdfSourceHtml(report, meta, { ...htmlOptions, tocPages });
    return { pdf: await print(html), html, tocPages };
  }, options.lang);
}

async function withPdfPrinter<T>(
  browser: PdfBrowser,
  work: (print: (html: string) => Promise<Buffer>) => Promise<T>,
  lang?: ReportLang,
): Promise<T> {
  const context = await browser.newContext({ javaScriptEnabled: false, colorScheme: 'light' });
  try {
    await context.route('**/*', (route) => route.abort());
    const page = await context.newPage();
    const print = async (html: string) => {
      await page.setContent(html, { waitUntil: 'load' });
      return page.pdf({
        format: PDF_PAGE.format, margin: PDF_PAGE.margin, printBackground: true, tagged: true, outline: true,
        displayHeaderFooter: true, headerTemplate: PDF_HEADER_TEMPLATE, footerTemplate: pdfFooterTemplate(lang),
      });
    };
    return await work(print);
  } finally {
    await context.close();
  }
}

/** Print a self-contained summary with the same offline context and footer as report v2. */
export async function printProspectPdf(html: string, scannedAt: string): Promise<Buffer> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const pdf = await withPdfPrinter(browser as unknown as PdfBrowser, print => print(html));
    // Skia writes wall-clock dates into the uncompressed Info dictionary. Replacing
    // the digits in place preserves PDF cross-reference offsets and selectable text.
    const date = new Date(scannedAt);
    const stamp = Number.isNaN(date.valueOf()) ? '19700101000000'
      : date.toISOString().slice(0, 19).replace(/\D/g, '').slice(0, 14).padEnd(14, '0');
    const source = pdf.toString('latin1');
    return Buffer.from(source.replace(/(\/(?:CreationDate|ModDate) \(D:)\d{14}[+-]\d{2}'\d{2}'(?=\))/g, (_match, prefix: string) => `${prefix}${stamp}+00'00'`), 'latin1');
  } finally {
    await browser.close();
  }
}

export async function writeBinaryAtomic(file: string, data: Uint8Array): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await writeFile(tmp, data, { flag: 'wx' });
    await rename(tmp, file);
  } catch (error) {
    await unlink(tmp).catch(() => {});
    throw error;
  }
}

/** `a11ygate report pdf <scan.json|out-dir> -o report.pdf` */
export async function runReportPdf(argv: readonly string[], io: ReportPdfIo = {}): Promise<number> {
  const stdout = io.stdout ?? ((s: string) => process.stdout.write(s));
  const stderr = io.stderr ?? ((s: string) => process.stderr.write(s));
  const cwd = io.cwd ?? process.cwd();
  const parsed = parseReportPdfArgs(argv);
  if (!parsed.ok) { stderr(`${parsed.error}\n${reportPdfHelpText()}`); return 2; }
  const options = parsed.options;
  if (options.help) { stdout(reportPdfHelpText()); return 0; }
  for (const warning of options.warnings) stderr(`Warning: ${warning}\n`);
  let report: ScanReport;
  try { report = await readScanInput(options.input as string, cwd); }
  catch (error) { stderr(`Could not read report: ${error instanceof Error ? error.message : String(error)}\n${debugDetail(error)}`); return 2; }
  const commit = options.commit ?? (await (io.gitHead ?? defaultGitHead)(cwd).catch(() => null));

  let playwright: typeof import('playwright');
  try { playwright = await import('playwright'); }
  catch { stderr('Playwright or its Chromium executable is missing.\nInstall it with: npm install --save-dev playwright && npx playwright install chromium\n'); return 2; }
  let browser: import('playwright').Browser;
  try { browser = await playwright.chromium.launch({ headless: true }); }
  catch (error) {
    stderr(`Could not launch headless Chromium (${error instanceof Error ? error.message.split('\n')[0] : String(error)}).\nInstall it with: npx playwright install chromium\n${debugDetail(error)}`);
    return 2;
  }
  try {
    const { pdf } = await renderReportPdf(browser as unknown as PdfBrowser, report, { commit }, { lang: options.lang, en301549Ref: options.en301549Ref });
    const out = path.resolve(cwd, options.out);
    await writeBinaryAtomic(out, pdf);
    stdout(`Wrote ${path.relative(cwd, out) || out}\n${AUTOMATED_TESTING_DISCLAIMER}\n`);
    return 0;
  } catch (error) {
    stderr(`Could not write PDF: ${error instanceof Error ? error.message : String(error)}\n${debugDetail(error)}`);
    return 2;
  } finally {
    await browser.close();
  }
}
