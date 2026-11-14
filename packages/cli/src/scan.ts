import { resolveElementKeys } from '@/lib/scan/engines/locators';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:net';
import { ENGINE_IDS, createHtmlcsEngine, createIbmEngine, createLighthouseEngine, type EngineId } from '@/lib/scan/engines/optional';
import type { EnginePageResult } from '@/lib/scan/engines/types';
import { clampPages, crawl, type VisitOutcome } from '@/lib/scan/crawl';
import { AXE_TAGS, buildScanReport, isFailOn, scanExitCode, scanHtml, scanMarkdown, type FailOn } from '@/lib/scan/report';
import { fetchRobots, robotsAllowsUrl, type FetchLike } from '@/lib/scan/robots';
import { isHtmlContentType, MAX_CRAWL_PAGES, normalizeUrl } from '@/lib/scan/url';
import { createAxeEngine, type AxeLike } from '@/lib/scan/engines/axe';
import { runEngine } from '@/lib/scan/engines/types';
export { toAxeResults } from '@/lib/scan/engines/axe';
import { toJunit } from '@/lib/export-junit';
import { toSarif } from '@/lib/export-sarif';
import { formatFileName, formatReportFromScan, mergeFormats, parseFormatList, type ReportFormat } from '@/lib/report-formats';

export type ScanOptions = {
  help: boolean;
  url: string;
  maxPages: number;
  failOn: FailOn;
  delayMs: number;
  outDir?: string;
  json?: string;
  markdown?: string;
  html?: string;
  formats: ReportFormat[];
  warnings: string[];
  engines: EngineId[];
};

export type ParsedScanArgs = { ok: true; options: ScanOptions } | { ok: false; error: string };

export const DEFAULT_DELAY_MS = 1000;
const NAVIGATION_TIMEOUT_MS = 30_000;

const VALUE_FLAGS = new Set(['--fail-on', '--out-dir', '--json', '--markdown', '--html', '--delay-ms', '--engines', '--format']);

export function parseScanArgs(argv: readonly string[]): ParsedScanArgs {
  const options: ScanOptions = { help: false, url: '', maxPages: 1, failOn: 'serious', delayMs: DEFAULT_DELAY_MS, formats: [], warnings: [], engines: ['axe'] };
  const positionals: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? '';
    if (token === '--help' || token === '-h') {
      options.help = true;
      continue;
    }
    if (!token.startsWith('-') || token === '-') {
      positionals.push(token);
      continue;
    }
    const eq = token.indexOf('=');
    const name = eq === -1 ? token : token.slice(0, eq);
    const inline = eq === -1 ? undefined : token.slice(eq + 1);

    if (name === '--crawl') {
      // The page count is optional: `--crawl` alone means the cap (20).
      let text = inline;
      if (text === undefined && /^\d+$/.test(argv[index + 1] ?? '')) {
        text = argv[index + 1];
        index += 1;
      }
      if (text === undefined) {
        options.maxPages = MAX_CRAWL_PAGES;
        continue;
      }
      if (!/^\d+$/.test(text) || Number(text) < 1) return { ok: false, error: '--crawl needs a whole number of pages from 1 to 20.' };
      const requested = Number(text);
      if (requested > MAX_CRAWL_PAGES) options.warnings.push(`--crawl ${requested} exceeds the hard maximum; scanning at most ${MAX_CRAWL_PAGES} pages.`);
      options.maxPages = clampPages(requested);
      continue;
    }
    if (!VALUE_FLAGS.has(name)) return { ok: false, error: `Unknown scan option ${token}.` };
    const value = inline !== undefined ? inline : argv[index + 1];
    if (inline === undefined) index += 1;
    if (value === undefined || value.length === 0 || (value.startsWith('-') && !(name === '--json' && value === '-'))) {
      return { ok: false, error: `${name} needs a value.` };
    }
    if (name === '--engines') {
      const ids = value.split(',');
      if (ids.some((id) => !(ENGINE_IDS as readonly string[]).includes(id)) || new Set(ids).size !== ids.length) {
        return { ok: false, error: `Unknown or duplicate --engines "${value}". Use a comma-separated list of axe,htmlcs,ibm,lighthouse.` };
      }
      options.engines = ids as EngineId[];
    } else if (name === '--fail-on') {
      if (!isFailOn(value)) return { ok: false, error: `Unknown --fail-on "${value}". Use minor, moderate, serious, critical, or none.` };
      options.failOn = value;
    } else if (name === '--delay-ms') {
      if (!/^\d+$/.test(value) || Number(value) > 60_000) return { ok: false, error: '--delay-ms needs a whole number of milliseconds from 0 to 60000.' };
      options.delayMs = Number(value);
    } else if (name === '--out-dir') options.outDir = value;
    else if (name === '--json') options.json = value;
    else if (name === '--markdown') options.markdown = value;
    else if (name === '--html') options.html = value;
    else {
      const parsed = parseFormatList(value);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      options.formats = mergeFormats(options.formats, parsed.formats);
    }
  }
  if (options.help) return { ok: true, options };
  if (positionals.length === 0) return { ok: false, error: 'Pass the URL to scan: a11ygate scan <url>.' };
  if (positionals.length > 1) return { ok: false, error: `Unexpected argument ${positionals[1]}.` };
  const url = normalizeUrl(positionals[0] as string);
  if (!url) return { ok: false, error: `Not a valid http(s) URL: ${positionals[0]}` };
  options.url = url;
  if (options.outDir && (options.json || options.markdown || options.html)) {
    return { ok: false, error: 'Use either --out-dir or --json/--markdown/--html, not both.' };
  }
  if (options.formats.length > 0 && !options.outDir) {
    return { ok: false, error: '--format requires --out-dir.' };
  }
  return { ok: true, options };
}

export function scanHelpText(): string {
  return `a11ygate scan — load live pages in headless Chromium and run axe-core

Usage:
  a11ygate scan <url> [--crawl [n]] [--fail-on <impact>] [--out-dir <dir>]
                      [--format junit|sarif|json|md] [--json <file>] [--markdown <file>]
                      [--html <file>] [--delay-ms <ms>]

Options:
  --engines <ids>      Default: axe. Opt in: --engines axe,htmlcs,ibm,lighthouse.
  --crawl [n]          Breadth-first crawl of same-origin a[href] links, up to n pages
                       (default and hard maximum: ${MAX_CRAWL_PAGES}). Without --crawl only <url> is scanned.
  --fail-on <impact>   minor, moderate, serious, critical, or none. Default: serious.
  --out-dir <dir>      Write a11ygate-scan.json, a11ygate-scan.md and a11ygate-scan.html here.
  --format <fmt>       Also write junit, sarif, json, or md into --out-dir. Repeat or comma-separate.
                       Exit codes are unchanged.
  --json <file>        Write the JSON report (use - to print JSON instead of Markdown).
  --markdown <file>    Write the Markdown summary. It is printed to stdout unless --json -.
  --html <file>        Write a self-contained HTML summary.
  --delay-ms <ms>      Pause between page loads. Default: ${DEFAULT_DELAY_MS}.

Requires the optional peer dependencies:
  npm install --save-dev playwright @axe-core/playwright && npx playwright install chromium

Opt-in engine peers (install only those selected):
  npm install --save-dev html_codesniffer accessibility-checker-engine lighthouse puppeteer-core
IBM uses the installed engine's offline rules; Lighthouse snapshots the existing page.
See docs/engines.md for licenses and engine result/error reporting.

Boundaries: only scan sites you own or are authorized to test. Read-only (no clicks, forms or
login), same-origin only, honours robots.txt, identifies itself as A11yGate. Automated testing
finds a subset of issues; PASS is not conformance, certification or legal advice.

Automated testing only. Not a WCAG audit, certification or legal advice.

Exit codes:
  0  No finding is at or above --fail-on.
  1  At least one finding is at or above --fail-on.
  2  Bad arguments, missing browser/dependencies, or the start page is unreachable.
`;
}

export type ScanEngine = {
  /** Native adapter outputs, archived independently of public report serialization. */
  rawEngineResults?: { engine: string; url: string; status: string; native?: unknown; error?: string }[];
  axeVersion?: string;
  engineResults?: EnginePageResult[];
  visit: (url: string, collectLinks: boolean) => Promise<VisitOutcome>;
  close: () => Promise<void>;
};

export type ScanEngineFactory = (options: { userAgent: string; origin: string; engines?: EngineId[] }) => Promise<ScanEngine>;

export class ScanSetupError extends Error {}

export type ScanIo = {
  cwd?: string;
  stdout?: (chunk: string) => void;
  stderr?: (chunk: string) => void;
  now?: () => Date;
  version?: string;
  engine?: ScanEngineFactory;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
};

export const INSTALL_HINT =
  'a11ygate scan needs the optional peer dependencies playwright and @axe-core/playwright.\n' +
  'Install them with: npm install --save-dev playwright @axe-core/playwright && npx playwright install chromium\n';

function isModuleNotFound(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND';
}

/** Default engine: playwright + @axe-core/playwright, loaded lazily so gate mode stays dependency-free. */
export const playwrightEngine: ScanEngineFactory = async ({ userAgent, origin, engines = ['axe'] }) => {
  const extended = engines.length !== 1 || engines[0] !== 'axe';
  let playwright: typeof import('playwright');
  let axeModule: typeof import('@axe-core/playwright') | undefined;
  try {
    playwright = await import('playwright');
    if (engines.includes('axe') && !extended) axeModule = await import('@axe-core/playwright');
  } catch (error) {
    if (isModuleNotFound(error)) throw new ScanSetupError(INSTALL_HINT);
    throw error;
  }
  let nativeAxe: AxeLike | undefined;
  const axeEngine = engines.includes('axe') ? createAxeEngine(async (page: import('playwright').Page) => {
    if (!axeModule) {
      try { axeModule = await import('@axe-core/playwright'); }
      catch { throw new Error('Missing @axe-core/playwright. Install with: npm install --save-dev @axe-core/playwright'); }
    }
    const AxeBuilder = axeModule.default ?? (axeModule as unknown as { AxeBuilder: typeof axeModule.default }).AxeBuilder;
    nativeAxe = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).analyze() as unknown as AxeLike;
    return nativeAxe;
  }, userAgent) : undefined;
  const engineResults: EnginePageResult[] = [];
  const rawEngineResults: NonNullable<ScanEngine['rawEngineResults']> = [];
  // Bind debugging to loopback only and enable it only for Lighthouse. Chromium and
  // all adapters share the same browser and targets.
  let debugPort: number | undefined;
  if (engines.includes('lighthouse')) {
    const server = createServer();
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    debugPort = (server.address() as import('node:net').AddressInfo).port;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  const browserURL = debugPort ? `http://127.0.0.1:${debugPort}` : undefined;
  const optionalEngines = { htmlcs: createHtmlcsEngine(), ibm: createIbmEngine(), lighthouse: createLighthouseEngine() };
  let browser: import('playwright').Browser;
  try {
    browser = await playwright.chromium.launch({ headless: true, ...(debugPort ? { args: [`--remote-debugging-port=${debugPort}`, '--remote-debugging-address=127.0.0.1'] } : {}) });
  } catch (error) {
    const detail = error instanceof Error ? error.message.split('\n')[0] : 'unknown error';
    throw new ScanSetupError(`Could not launch headless Chromium (${detail}).\nInstall it with: npx playwright install chromium\n`);
  }
  const context = await browser.newContext({ userAgent, acceptDownloads: false, serviceWorkers: 'block', javaScriptEnabled: true });
  return {
    rawEngineResults,
    ...(extended ? { engineResults } : {}),
    visit: async (url, collectLinks) => {
      const page = await context.newPage();
      // Read-only: no clicks, no form input, no dialogs accepted.
      page.on('dialog', (dialog) => void dialog.dismiss().catch(() => undefined));
      try {
        const response = await page.goto(url, { waitUntil: 'load', timeout: NAVIGATION_TIMEOUT_MS });
        const status = response?.status() ?? null;
        const finalUrl = page.url();
        const contentType = response?.headers()['content-type'] ?? null;
        if (new URL(finalUrl).origin !== origin) return { status, finalUrl, contentType, links: [] };
        if (status !== null && status >= 400) return { status, finalUrl, contentType, links: [], error: `HTTP ${status}` };
        if (!isHtmlContentType(contentType)) return { status, finalUrl, contentType, links: [], error: `Not an HTML page (${contentType}).` };
        const links = collectLinks ? await page.$$eval('a[href]', (anchors) => anchors.map((a) => (a as HTMLAnchorElement).href)) : [];
        let result: import('@/lib/types').AxeResults | undefined;
        for (const id of engines) {
          if (id === 'axe' && axeEngine) {
            nativeAxe = undefined;
            const execution = await runEngine(axeEngine, page, url);
            rawEngineResults.push({ ...execution, ...(execution.status === 'complete' ? { native: nativeAxe } : {}), url });
            if (extended && execution.status === 'complete') execution.findings = await resolveElementKeys(page, execution.findings);
            if (!extended && execution.status === 'errored') throw new Error(execution.error);
            if (execution.status === 'complete') result = execution.native;
            if (extended) engineResults.push(execution.status === 'complete'
              ? { url, engine: id, status: 'complete', findings: execution.findings }
              : { url, engine: id, status: 'errored', error: execution.error });
          } else if (id !== 'axe') {
            const execution = await runEngine(optionalEngines[id], { page, browserURL }, url);
            rawEngineResults.push({ ...execution, url });
            if (execution.status === 'complete') execution.findings = await resolveElementKeys(page, execution.findings);
            engineResults.push(execution.status === 'complete'
              ? { url, engine: id, status: 'complete', findings: execution.findings }
              : { url, engine: id, status: 'errored', error: execution.error });
          }
        }
        return { status, finalUrl, contentType, links, result, ...(extended ? { analysed: true } : {}) };
      } catch (error) {
        const detail = error instanceof Error ? error.message.split('\n')[0] : 'Navigation failed.';
        return { status: null, finalUrl: url, links: [], error: detail };
      } finally {
        await page.close().catch(() => undefined);
      }
    },
    close: async () => {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    },
  };
};

export function scanUserAgent(version: string): string {
  return `Mozilla/5.0 (compatible; A11yGate/${version}; +https://a11ygate.vercel.app) read-only accessibility scan`;
}

export async function runScan(argv: readonly string[], io: ScanIo = {}): Promise<number> {
  const stdout = io.stdout ?? ((chunk: string) => process.stdout.write(chunk));
  const stderr = io.stderr ?? ((chunk: string) => process.stderr.write(chunk));
  const cwd = io.cwd ?? process.cwd();
  const now = io.now ?? (() => new Date());
  const version = io.version ?? '0.0.0';

  const parsed = parseScanArgs(argv);
  if (!parsed.ok) {
    stderr(`${parsed.error}\nRun a11ygate scan --help for usage.\n`);
    return 2;
  }
  const options = parsed.options;
  if (options.help) {
    stdout(scanHelpText());
    return 0;
  }
  for (const warning of options.warnings) stderr(`${warning}\n`);

  const userAgent = scanUserAgent(version);
  const origin = new URL(options.url).origin;
  const fetchImpl = io.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const robots = await fetchRobots(origin, userAgent, fetchImpl);
  if (!robotsAllowsUrl(robots.rules, options.url)) {
    stderr(`${options.url} is disallowed by ${origin}/robots.txt; nothing was scanned.\n`);
    return 2;
  }

  let engine: ScanEngine;
  try {
    engine = await (io.engine ?? playwrightEngine)({ userAgent, origin, engines: options.engines });
  } catch (error) {
    stderr(error instanceof ScanSetupError ? error.message : `Could not start the browser: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }

  let result: Awaited<ReturnType<typeof crawl>>;
  try {
    result = await crawl({
      startUrl: options.url,
      maxPages: options.maxPages,
      delayMs: options.delayMs,
      robots: robots.rules,
      visit: engine.visit,
      sleep: io.sleep,
      log: (message) => stderr(`${message}\n`),
    });
  } finally {
    await engine.close();
  }

  const first = result.pages[0];
  if (!first || first.scanStatus !== 'complete') {
    stderr(`Start page could not be scanned: ${first?.error ?? 'unreachable'}\n`);
    return 2;
  }

  const report = buildScanReport({
    crawl: result,
    version,
    scannedAt: now().toISOString(),
    startUrl: options.url,
    failOn: options.failOn,
    maxPages: options.maxPages,
    delayMs: options.delayMs,
    userAgent,
    robotsNote: robots.note,
    engineResults: engine.engineResults,
  });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = scanMarkdown(report);

  const formatReport = formatReportFromScan(report);
  const extra: [string, string][] = [];
  if (options.outDir && options.formats.includes('junit')) {
    extra.push([path.join(options.outDir, formatFileName('scan', 'junit')), toJunit(formatReport)]);
  }
  if (options.outDir && options.formats.includes('sarif')) {
    extra.push([path.join(options.outDir, formatFileName('scan', 'sarif')), toSarif(formatReport)]);
  }
  const targets: [string | undefined, string][] = options.outDir
    ? [
        [path.join(options.outDir, 'a11ygate-scan.json'), json],
        [path.join(options.outDir, 'a11ygate-scan.md'), markdown],
        [path.join(options.outDir, 'a11ygate-scan.html'), scanHtml(report)],
        ...extra,
      ]
    : [
        [options.json === '-' ? undefined : options.json, json],
        [options.markdown, markdown],
        [options.html, options.html ? scanHtml(report) : ''],
      ];
  try {
    if (options.outDir) await mkdir(path.resolve(cwd, options.outDir), { recursive: true });
    if (options.outDir) {
      const evidenceDir = path.resolve(cwd, options.outDir, 'engines');
      await mkdir(evidenceDir, { recursive: true });
      for (const id of options.engines) {
        const native = engine.rawEngineResults?.filter((e) => e.engine === id);
        const evidence = native?.length ? native : id === 'axe' ? report.results : report.engineResults?.filter((e) => e.engine === id) ?? [];
        await writeFile(path.join(evidenceDir, `${id}.json`), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
      }
    }
    for (const [file, content] of targets) {
      if (file) await writeFile(path.resolve(cwd, file), content, 'utf8');
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    stderr(`Could not write the scan report${code ? ` (${code})` : ''}.\n`);
    return 2;
  }

  stdout(options.json === '-' ? json : markdown);
  if (report.engineResults?.some((e) => e.status === 'errored')) return 2;
  return report.verdict === 'FAIL' ? 1 : scanExitCode(report.findings, options.failOn);
}
