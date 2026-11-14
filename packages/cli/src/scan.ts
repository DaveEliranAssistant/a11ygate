import { prepareAuth, installAuth, runLoginScript, envMapping, type AuthOptions, type PreparedAuth } from './auth';
import { AuthRedactor } from '@/lib/scan/redact';
import { secretEnvValues } from '@/lib/evidence/secrets';
import { resolveElementKeys } from '@/lib/scan/engines/locators';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:net';
import { ENGINE_IDS, createHtmlcsEngine, createIbmEngine, createLighthouseEngine, type EngineId } from '@/lib/scan/engines/optional';
import type { EnginePageResult } from '@/lib/scan/engines/types';
import { fetchSitemap } from '@/lib/scan/sitemap';
import { clampPages, crawl, type VisitOutcome } from '@/lib/scan/crawl';
import { AXE_TAGS, buildScanReport, isFailOn, scanExitCode, scanMarkdown, type FailOn } from '@/lib/scan/report';
import { DEFAULT_REPORT_VERSION, isReportVersion, renderScanHtml, type ReportVersion } from '@/lib/scan/report-html-v2';
import { fetchRobots, robotsAllowsUrl, type FetchLike } from '@/lib/scan/robots';
import { isHtmlContentType, MAX_CRAWL_PAGES, normalizeUrl } from '@/lib/scan/url';
import { createAxeEngine, type AxeLike } from '@/lib/scan/engines/axe';
import { runEngine } from '@/lib/scan/engines/types';
export { toAxeResults } from '@/lib/scan/engines/axe';
import { toJunit } from '@/lib/export-junit';
import { toGitlabCodeQuality } from '@/lib/export-gitlab-codequality';
import { toSarif } from '@/lib/export-sarif';
import { formatFileName, formatReportFromScan, mergeFormats, parseFormatList, type ReportFormat } from '@/lib/report-formats';
import { assertSafeOutputs } from './output-paths';
import { applyFingerprintBaseline, parseFingerprintBaseline } from '@/lib/scan/baseline';
import type { FingerprintBaseline } from '@/lib/scan/baseline';
import { readScanInput } from './baseline';

export type ScanOptions = AuthOptions & {
  help: boolean;
  url: string;
  maxPages: number;
  pageLimit?: number;
  maxDepth?: number;
  timeoutMs?: number;
  concurrency?: number;
  include?: string[];
  exclude?: string[];
  sitemap?: string;
  ignoreRobots?: boolean;
  failOn: FailOn;
  delayMs: number;
  outDir?: string;
  baseline?: string;
  json?: string;
  markdown?: string;
  html?: string;
  reportVersion: ReportVersion;
  formats: ReportFormat[];
  warnings: string[];
  engines: EngineId[];
};

export type ParsedScanArgs = { ok: true; options: ScanOptions } | { ok: false; error: string };

export const DEFAULT_DELAY_MS = 1000;
const NAVIGATION_TIMEOUT_MS = 30_000;

const VALUE_FLAGS = new Set(['--sitemap', '--include', '--exclude', '--max-pages', '--max-depth', '--timeout-ms', '--concurrency', '--fail-on', '--out-dir', '--json', '--markdown', '--html', '--delay-ms', '--engines', '--format', '--baseline', '--storage-state', '--login-script', '--login-timeout-ms', '--cookie-env', '--header-env', '--report-version']);

export function parseScanArgs(argv: readonly string[]): ParsedScanArgs {
  const options: ScanOptions = { help: false, url: '', maxPages: 1, failOn: 'serious', delayMs: DEFAULT_DELAY_MS, reportVersion: DEFAULT_REPORT_VERSION, formats: [], warnings: [], engines: ['axe'] };
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

    if (name === '--ignore-robots') {
      if (inline !== undefined) return { ok: false, error: '--ignore-robots takes no value.' };
      options.ignoreRobots = true; continue;
    }
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
    if (name === '--include' || name === '--exclude') {
      if (value.length > 512 || (options[name === '--include' ? 'include' : 'exclude']?.length ?? 0) >= 32) return { ok: false, error: 'Use at most 32 globs, each up to 512 characters.' };
      (options[name === '--include' ? 'include' : 'exclude'] ??= []).push(value);
    } else if (name === '--sitemap') options.sitemap = value;
    else if (['--max-pages', '--max-depth', '--timeout-ms', '--concurrency'].includes(name)) {
      const max = name === '--max-pages' ? 1000 : name === '--max-depth' ? 1000 : name === '--concurrency' ? 8 : 300000;
      const min = name === '--max-depth' ? 0 : 1;
      if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) return { ok: false, error: `${name} must be from ${min} to ${max}.` };
      if (name === '--max-pages') options.pageLimit = Number(value);
      else if (name === '--max-depth') options.maxDepth = Number(value);
      else if (name === '--timeout-ms') options.timeoutMs = Number(value);
      else options.concurrency = Number(value);
    } else if (name === '--storage-state') options.storageState = value;
    else if (name === '--login-script') options.loginScript = value;
    else if (name === '--login-timeout-ms') {
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 300_000) return { ok: false, error: '--login-timeout-ms must be from 1 to 300000.' };
      options.loginTimeoutMs = Number(value);
    } else if (name === '--cookie-env' || name === '--header-env') {
      if (!envMapping(value)) return { ok: false, error: `${name} needs NAME=ENV_VAR_NAME (never a literal credential).` };
      const key = name === '--cookie-env' ? 'cookieEnv' : 'headerEnv';
      (options[key] ??= []).push(value);
    } else if (name === '--engines') {
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
    } else if (name === '--report-version') {
      if (!/^\d+$/.test(value) || !isReportVersion(Number(value))) return { ok: false, error: `Unknown --report-version "${value}". Use 1 or 2.` };
      options.reportVersion = Number(value) as ReportVersion;
    } else if (name === '--baseline') options.baseline = value;
    else if (name === '--out-dir') options.outDir = value;
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
  if (options.pageLimit !== undefined) options.maxPages = options.pageLimit;
  if (options.sitemap) {
    const sitemap = normalizeUrl(options.sitemap, url);
    if (!sitemap || new URL(sitemap).origin !== new URL(url).origin) return { ok: false, error: '--sitemap must be a same-origin http(s) URL.' };
    options.sitemap = sitemap;
    if (options.pageLimit === undefined && !argv.some((arg) => arg === '--crawl' || arg.startsWith('--crawl='))) options.maxPages = MAX_CRAWL_PAGES;
  }
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
                      [--format junit|sarif|json|md|gitlab-codequality] [--json <file>] [--markdown <file>]
                      [--html <file>] [--report-version 1|2] [--delay-ms <ms>]

Options:
  --storage-state <file>  Read a Playwright storageState JSON file (never written back).
  --login-script <file>   Trusted JS module: default async (page, env) => { ... }.
  --login-timeout-ms <ms> Login deadline including module load; default 30000, max 300000.
  --cookie-env <name=ENV> Inject a cookie using an environment variable name. Repeatable.
  --header-env <name=ENV> Inject a header using an environment variable name. Repeatable.
  Use test accounts only. Login scripts execute trusted code and may submit forms.
  --baseline <file>    Fingerprint baseline from baseline create; gate only new findings.
  --engines <ids>      Default: axe. Opt in: --engines axe,htmlcs,ibm,lighthouse.
  --crawl [n]          Breadth-first crawl of same-origin a[href] links, up to n pages
                       (default and hard maximum: ${MAX_CRAWL_PAGES}). Without --crawl only <url> is scanned.
  --max-pages <n>      Explicit page budget, 1–1000; overrides --crawl (legacy cap 20).
  --max-depth <n>      Link depth from start/sitemap seeds (0–1000); default unlimited.
  --sitemap <url>      Same-origin sitemap.xml URL/path; enables crawling (default 20).
                       URL sets and indexes supported; seeds have depth 0.
  --include <glob>     Only matching paths (or full URLs); repeatable. Applies to seeds too.
  --exclude <glob>     Skip matching paths; repeatable, takes precedence over include.
                       Globs: * within a segment, ** across segments, ? one character.
  --timeout-ms <ms>    Whole page deadline including analysis; default 30000, max 300000.
  --concurrency <n>    Active pages, 1–8; default 1. Global delay applies to every start/retry.
  --ignore-robots     Opt out of robots.txt rules for an authorized scan.
  --fail-on <impact>   minor, moderate, serious, critical, or none. Default: serious.
  --out-dir <dir>      Write a11ygate-scan.json, a11ygate-scan.md and a11ygate-scan.html here.
  --format <fmt>       Also write junit, sarif, json, md, or gitlab-codequality into --out-dir. Repeat or comma-separate.
                       Exit codes are unchanged.
  --json <file>        Write the JSON report (use - to print JSON instead of Markdown).
  --markdown <file>    Write the Markdown summary. It is printed to stdout unless --json -.
  --html <file>        Write a self-contained HTML summary.
  --report-version <n> HTML layout. 2 (default): executive summary, top fixes, WCAG/page
                       grouping, how-to-fix links. 1: the previous HTML, byte-for-byte.
  --delay-ms <ms>      Pause between page loads. Default: ${DEFAULT_DELAY_MS}.

Requires the optional peer dependencies:
  npm install --save-dev playwright @axe-core/playwright && npx playwright install chromium

Opt-in engine peers (install only those selected):
  npm install --save-dev html_codesniffer accessibility-checker-engine lighthouse puppeteer-core
IBM uses the installed engine's offline rules; Lighthouse snapshots the existing page.
See docs/engines.md for licenses and engine result/error reporting.

Boundaries: only scan sites you own or are authorized to test. Page scanning is read-only; explicit login scripts may
interact with the login form. Same-origin crawling only, honours robots.txt, identifies itself as A11yGate. Automated testing
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
  visit: (url: string, collectLinks: boolean, signal?: AbortSignal) => Promise<VisitOutcome>;
  close: () => Promise<void>;
};

export type ScanEngineFactory = (options: { userAgent: string; origin: string; engines?: EngineId[]; auth?: PreparedAuth; timeoutMs?: number }) => Promise<ScanEngine>;

export class ScanSetupError extends Error {}

export type ScanIo = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  redactor?: AuthRedactor;
  stdout?: (chunk: string) => void;
  stderr?: (chunk: string) => void;
  now?: () => Date;
  version?: string;
  engine?: ScanEngineFactory;
  /** Saved scan input protected against output aliases. */
  reportInput?: string;
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
export const playwrightEngine: ScanEngineFactory = async ({ userAgent, origin, engines = ['axe'], auth, timeoutMs = NAVIGATION_TIMEOUT_MS }) => {
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
  const nativeByPage = new WeakMap<import('playwright').Page, AxeLike>();
  const axeEngine = engines.includes('axe') ? createAxeEngine(async (page: import('playwright').Page) => {
    if (!axeModule) {
      try { axeModule = await import('@axe-core/playwright'); }
      catch { throw new Error('Missing @axe-core/playwright. Install with: npm install --save-dev @axe-core/playwright'); }
    }
    const AxeBuilder = axeModule.default ?? (axeModule as unknown as { AxeBuilder: typeof axeModule.default }).AxeBuilder;
    const nativeAxe = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).analyze() as unknown as AxeLike;
    nativeByPage.set(page, nativeAxe);
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
  let browserServer: import('playwright').BrowserServer | undefined;
  try {
    const launchOptions = { headless: true, ...(debugPort ? { args: [`--remote-debugging-port=${debugPort}`, '--remote-debugging-address=127.0.0.1'] } : {}) };
    if (auth?.script) {
      browserServer = await playwright.chromium.launchServer({ ...launchOptions, host: '127.0.0.1' });
      browser = await playwright.chromium.connect(browserServer.wsEndpoint());
    } else browser = await playwright.chromium.launch(launchOptions);
  } catch (error) {
    await browserServer?.close().catch(() => undefined);
    const detail = error instanceof Error ? error.message.split('\n')[0] : 'unknown error';
    throw new ScanSetupError(`Could not launch headless Chromium (${detail}).\nInstall it with: npx playwright install chromium\n`);
  }
  const contextOptions = { userAgent, acceptDownloads: false, serviceWorkers: 'block' as const, javaScriptEnabled: true };
  let context: import('playwright').BrowserContext;
  try {
    const storageState = auth?.script ? await runLoginScript(browserServer!.wsEndpoint(), origin, auth, contextOptions) : auth?.state;
    context = await browser.newContext({ ...contextOptions, storageState });
    if (auth) await installAuth(context, origin, { ...auth, cookies: auth.script ? [] : auth.cookies });
  } catch (error) {
    await browser.close().catch(() => undefined);
    await browserServer?.close().catch(() => undefined);
    throw new ScanSetupError(auth?.script ? (error as Error).message : 'Could not initialize authentication storage state.');
  }
  return {
    rawEngineResults,
    ...(extended ? { engineResults } : {}),
    visit: async (url, collectLinks, signal) => {
      const page = await context.newPage();
      const abort = () => { void page.close().catch(() => undefined); };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      // Read-only: no clicks, no form input, no dialogs accepted.
      page.on('dialog', (dialog) => void dialog.dismiss().catch(() => undefined));
      let navigating = true;
      let blockedNavigation: string | undefined;
      try {
        // Playwright route handlers do not intercept redirected requests. CDP's
        // request-stage pause runs on every redirect hop, before network access.
        const session = await context.newCDPSession(page);
        session.on('Fetch.requestPaused', (event) => {
          const external = new URL(event.request.url).origin !== origin;
          if (external) blockedNavigation = event.request.url;
          void session.send(external ? 'Fetch.failRequest' : 'Fetch.continueRequest', {
            requestId: event.requestId,
            ...(external ? { errorReason: 'BlockedByClient' } : {}),
          }).catch(() => undefined);
        });
        await session.send('Fetch.enable', { patterns: [{ resourceType: 'Document', requestStage: 'Request' }] });
        if (collectLinks) await page.addInitScript(() => {
          const routes: string[] = [];
          Object.defineProperty(window, '__a11ygateRoutes', { value: routes });
          for (const name of ['pushState', 'replaceState'] as const) {
            const original = history[name].bind(history);
            history[name] = function (data, unused, url) {
              const result = original(data, unused, url);
              if (url != null && routes.length < 10000) routes.push(new URL(String(url), location.href).href);
              return result;
            };
          }
        });
        const response = await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
        navigating = false;
        const status = response?.status() ?? null;
        const finalUrl = page.url();
        const contentType = response?.headers()['content-type'] ?? null;
        if (auth) auth.redactor.storage(await context.storageState());
        const loginPath = /(?:^|\/)(?:login|log-in|signin|sign-in|sign_in|sso|oauth|authorize)(?:[/.]|$)/i;
        const redirectedToLogin = finalUrl !== url && loginPath.test(new URL(finalUrl).pathname);
        if (status === 401 || status === 403 || redirectedToLogin || await page.locator('input[type="password"]').count() > 0) {
          return { status, finalUrl, contentType, links: [], error: 'Not authenticated: login page or access denied; protected content was not scanned.' };
        }
        if (new URL(finalUrl).origin !== origin) return { status, finalUrl, contentType, links: [] };
        if (status !== null && status >= 400) return { status, finalUrl, contentType, links: [], error: `HTTP ${status}` };
        if (!isHtmlContentType(contentType)) return { status, finalUrl, contentType, links: [], error: `Not an HTML page (${contentType}).` };
        const links = collectLinks ? await page.evaluate(() => {
          const routes = (window as unknown as { __a11ygateRoutes?: string[] }).__a11ygateRoutes ?? [];
          return [...Array.from(document.querySelectorAll('a[href]')).slice(0, 10000).map((a) => (a as HTMLAnchorElement).href), ...routes].slice(0, 10000);
        }) : [];
        let result: import('@/lib/types').AxeResults | undefined;
        for (const id of engines) {
          if (id === 'axe' && axeEngine) {
            nativeByPage.delete(page);
            const execution = await runEngine(axeEngine, page, url);
            rawEngineResults.push({ ...execution, ...(execution.status === 'complete' ? { native: nativeByPage.get(page) } : {}), url });
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
        const detail = navigating && error instanceof Error && error.name === 'TimeoutError' ? `Page timeout after ${timeoutMs}ms.` : error instanceof Error ? error.message.split('\n')[0] : 'Navigation failed.';
        return { status: null, finalUrl: blockedNavigation ?? url, links: [], error: detail, navigationError: navigating && !blockedNavigation };
      } finally {
        signal?.removeEventListener('abort', abort);
        await page.close().catch(() => undefined);
      }
    },
    close: async () => {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
      await browserServer?.close().catch(() => undefined);
    },
  };
};

export function scanUserAgent(version: string): string {
  return `Mozilla/5.0 (compatible; A11yGate/${version}; +https://a11ygate.vercel.app) read-only accessibility scan`;
}

export async function runScan(argv: readonly string[], io: ScanIo = {}): Promise<number> {
  const redactor = io.redactor ?? new AuthRedactor();
  for (const value of secretEnvValues(io.env ?? process.env, 1)) redactor.add(value);
  const output = io.stdout ?? ((s: string) => process.stdout.write(s));
  const errors = io.stderr ?? ((s: string) => process.stderr.write(s));
  return runScanInternal(argv, { ...io, redactor, stdout: (s) => output(redactor.text(s)), stderr: (s) => errors(redactor.text(s)) });
}

async function runScanInternal(argv: readonly string[], io: ScanIo): Promise<number> {
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
  let auth: PreparedAuth;
  try { auth = await prepareAuth(options, cwd, new URL(options.url).origin, io.env ?? process.env, io.redactor); }
  catch (error) { stderr(`${(error as Error).message}\n`); return 2; }
  for (const warning of options.warnings) stderr(`${warning}\n`);

  let baseline: FingerprintBaseline | undefined;
  try {
    if (options.baseline) baseline = parseFingerprintBaseline(JSON.parse(await readFile(path.resolve(cwd, options.baseline), 'utf8')));
  } catch (error) {
    stderr(`Could not read fingerprint baseline: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }

  const userAgent = scanUserAgent(version);
  const origin = new URL(options.url).origin;
  const fetchImpl = io.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const robots = options.ignoreRobots ? { rules: null, note: 'robots.txt ignored by explicit --ignore-robots opt-out.' } : await fetchRobots(origin, userAgent, fetchImpl);
  if (!robotsAllowsUrl(robots.rules, options.url)) {
    stderr(`${options.url} is disallowed by ${origin}/robots.txt; nothing was scanned.\n`);
    return 2;
  }

  let seedUrls: string[] = [];
  try {
    if (options.sitemap) seedUrls = await fetchSitemap(options.sitemap, origin, userAgent, fetchImpl, options.timeoutMs);
  } catch (error) { stderr(`Could not read sitemap: ${(error as Error).message}\n`); return 2; }
  let engine: ScanEngine;
  try {
    engine = await (io.engine ?? playwrightEngine)({ userAgent, origin, engines: options.engines, auth, timeoutMs: options.timeoutMs });
  } catch (error) {
    stderr(error instanceof ScanSetupError ? error.message : `Could not start the browser: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }

  let result: Awaited<ReturnType<typeof crawl>>;
  try {
    result = await crawl({
      startUrl: options.url,
      pageLimit: options.pageLimit,
      maxDepth: options.maxDepth,
      include: options.include,
      exclude: options.exclude,
      concurrency: options.concurrency,
      timeoutMs: options.timeoutMs,
      seedUrls,
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
  }

  let report = buildScanReport({
    crawl: result,
    version,
    scannedAt: now().toISOString(),
    startUrl: options.url,
    failOn: options.failOn,
    maxPages: options.maxPages,
    delayMs: options.delayMs,
    userAgent,
    robotsNote: robots.note,
    crawlControls: {
      maxDepth: options.maxDepth,
      timeoutMs: options.timeoutMs,
      concurrency: options.concurrency,
      include: options.include,
      exclude: options.exclude,
      sitemap: options.sitemap,
      ignoreRobots: options.ignoreRobots,
    },
    engineResults: engine.engineResults,
    authenticated: !!(options.storageState || options.loginScript || options.cookieEnv?.length || options.headerEnv?.length),
  });
  if (baseline) report = applyFingerprintBaseline(report, baseline);
  return writeScanReport(report, options, io, engine);
}

async function writeScanReport(report: import('@/lib/scan/report').ScanReport, options: ScanOptions, io: ScanIo, engine?: ScanEngine): Promise<number> {
  const cwd = io.cwd ?? process.cwd();
  const stdout = io.stdout ?? ((s: string) => process.stdout.write(s));
  const stderr = io.stderr ?? ((s: string) => process.stderr.write(s));
  const redactor = io.redactor ?? new AuthRedactor();
  for (const value of secretEnvValues(io.env ?? process.env, 1)) redactor.add(value);
  report = redactor.object(report);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = scanMarkdown(report);

  const formatReport = formatReportFromScan(report);
  const extra: [string, string][] = [];
  if (options.outDir && options.formats.includes('junit')) {
    extra.push([path.join(options.outDir, formatFileName('scan', 'junit')), toJunit(formatReport)]);
  }
  if (options.outDir && options.formats.includes('gitlab-codequality')) {
    extra.push([path.join(options.outDir, formatFileName('scan', 'gitlab-codequality')), toGitlabCodeQuality(formatReport)]);
  }
  if (options.outDir && options.formats.includes('sarif')) {
    extra.push([path.join(options.outDir, formatFileName('scan', 'sarif')), toSarif(formatReport)]);
  }
  const targets: [string | undefined, string][] = options.outDir
    ? [
        [path.join(options.outDir, 'a11ygate-scan.json'), json],
        [path.join(options.outDir, 'a11ygate-scan.md'), markdown],
        [path.join(options.outDir, 'a11ygate-scan.html'), renderScanHtml(report, options.reportVersion)],
        ...extra,
      ]
    : [
        [options.json === '-' ? undefined : options.json, json],
        [options.markdown, markdown],
        [options.html, options.html ? renderScanHtml(report, options.reportVersion) : ''],
      ];
  try {
    if (options.baseline || io.reportInput || options.storageState || options.loginScript) {
      await assertSafeOutputs(cwd, [options.baseline, io.reportInput, options.storageState, options.loginScript].filter((f): f is string => !!f),
        [...targets.map(([file]) => file).filter((f): f is string => !!f),
          ...(options.outDir ? options.engines.map((id) => path.join(options.outDir!, 'engines', `${id}.json`)) : [])]);
    }
    if (options.outDir) await mkdir(path.resolve(cwd, options.outDir), { recursive: true });
    if (options.outDir) {
      const evidenceDir = path.resolve(cwd, options.outDir, 'engines');
      await mkdir(evidenceDir, { recursive: true });
      for (const id of options.engines) {
        const native = engine?.rawEngineResults?.filter((e) => e.engine === id);
        const evidence = native?.length ? native : id === 'axe' ? report.results : report.engineResults?.filter((e) => e.engine === id) ?? [];
        await writeFile(path.join(evidenceDir, `${id}.json`), `${JSON.stringify(redactor.object(evidence), null, 2)}\n`, 'utf8');
      }
    }
    for (const [file, content] of targets) {
      if (file) await writeFile(path.resolve(cwd, file), content, 'utf8');
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    stderr(`Could not write the scan report${code ? ` (${code})` : ''}: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }

  stdout(options.json === '-' ? json : markdown);
  if (report.verdict === 'ERROR' || report.engineResults?.some((e) => e.status === 'errored')) return 2;
  return report.verdict === 'FAIL' ? 1 : scanExitCode(report.findings, report.failOn);
}

/** Re-export a saved scan without launching a browser or touching the network. */
export async function runReport(argv: readonly string[], io: ScanIo = {}): Promise<number> {
  const redactor = io.redactor ?? new AuthRedactor();
  for (const value of secretEnvValues(io.env ?? process.env, 1)) redactor.add(value);
  const output = io.stdout ?? ((s: string) => process.stdout.write(s));
  const errors = io.stderr ?? ((s: string) => process.stderr.write(s));
  return runReportInternal(argv, { ...io, redactor, stdout: (s) => output(redactor.text(s)), stderr: (s) => errors(redactor.text(s)) });
}

async function runReportInternal(argv: readonly string[], io: ScanIo): Promise<number> {
  const stderr = io.stderr ?? ((s: string) => process.stderr.write(s));
  if (!argv[0] || argv[0].startsWith('-') || argv.includes('--help') || argv.includes('-h')) {
    ((argv.includes('--help') || argv.includes('-h')) ? io.stdout ?? ((s: string) => process.stdout.write(s)) : stderr)(
      'Usage: a11ygate report <scan.json|out-dir> [--baseline <file>] [--out-dir <dir>] [--format junit,sarif,gitlab-codequality] [--fail-on <impact>]\n');
    return (argv.includes('--help') || argv.includes('-h')) ? 0 : 2;
  }
  const parsed = parseScanArgs(['https://saved-report.invalid', ...argv.slice(1)]);
  if (!parsed.ok) { stderr(parsed.error + '\n'); return 2; }
  try {
    const cwd = io.cwd ?? process.cwd();
    let report = await readScanInput(argv[0], cwd);
    if (argv.some((a) => a === '--fail-on' || a.startsWith('--fail-on='))) {
      const failOn = parsed.options.failOn;
      const failing = scanExitCode(report.findings, failOn);
      report = { ...report, failOn, verdict: report.verdict === 'ERROR' ? 'ERROR' : failing ? 'FAIL' : 'PASS',
        reason: report.verdict === 'ERROR' ? report.reason : `${failing ? 'At least one finding is' : 'No finding is'} at or above ${failOn}.` };
    }
    if (parsed.options.baseline) report = applyFingerprintBaseline(report, parseFingerprintBaseline(JSON.parse(await readFile(path.resolve(cwd, parsed.options.baseline), 'utf8'))));
    const source = path.resolve(cwd, argv[0]);
    const reportInput = (await stat(source)).isDirectory() ? path.join(source, 'a11ygate-scan.json') : source;
    const engines = report.engines?.used ?? ['axe'];
    if (engines.some((id) => !(ENGINE_IDS as readonly string[]).includes(id))) throw new Error('Unknown engine in saved report.');
    return await writeScanReport(report, { ...parsed.options, engines: engines as EngineId[] }, { ...io, reportInput });
  } catch (error) { stderr(`Could not read report: ${error instanceof Error ? error.message : String(error)}\n`); return 2; }
}
