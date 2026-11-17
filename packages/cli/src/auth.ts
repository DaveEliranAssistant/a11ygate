import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import type { BrowserContext, BrowserContextOptions, Page } from 'playwright';
import { AuthRedactor } from '@/lib/scan/redact';
import { secretEnvValues } from '@/lib/evidence/secrets';
import { readJsonInput } from './input-file';

export type AuthCheck = { url?: string; mustHaveSelector?: string; mustNotHaveSelector?: string; mustNotRedirectTo?: string };
export type AuthOptions = {
  authCheck?: AuthCheck;
  storageState?: string;
  sessionStorage?: string;
  loginScript?: string;
  loginTimeoutMs?: number;
  cookieEnv?: string[];
  headerEnv?: string[];
};
export type SessionStorageState = { origins: { origin: string; sessionStorage: { name: string; value: string }[] }[] };

export type PreparedAuth = {
  check?: AuthCheck;
  sessionStorage?: SessionStorageState;
  state?: BrowserContextOptions['storageState'];
  /** --storage-state path as given, so later browser errors can name the file. */
  stateFile?: string;
  script?: string;
  timeout: number;
  env: NodeJS.ProcessEnv;
  cookies: { name: string; value: string; url: string }[];
  headers: Record<string, string>;
  redactor: AuthRedactor;
};

export function envMapping(value: string): { name: string; env: string } | null {
  const match = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+)=([A-Za-z_][A-Za-z0-9_]*)$/.exec(value);
  return match ? { name: match[1]!, env: match[2]! } : null;
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const isHttpOrigin = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) && url.origin === value; } catch { return false; }
};
const isHttpUrl = (value: string): boolean => { try { return /^https?:$/.test(new URL(value).protocol); } catch { return false; } };
const SAME_SITE = ['Strict', 'Lax', 'None'] as const;
const nameValues = (value: unknown, field: string): void => {
  if (!Array.isArray(value)) throw new Error(`field ${field} must be a list.`);
  value.forEach((entry, index) => { if (!isObject(entry) || typeof entry.name !== 'string' || typeof entry.value !== 'string') throw new Error(`field ${field}[${index}] needs string name and value.`); });
};

/** Shape check for a Playwright storageState file; values are never echoed. */
export function parseStorageState(value: unknown): NonNullable<BrowserContextOptions['storageState']> & object {
  if (!isObject(value)) throw new Error('field (top level) must be a JSON object with cookies and origins.');
  if (value.cookies !== undefined) {
    if (!Array.isArray(value.cookies)) throw new Error('field cookies must be a list.');
    value.cookies.forEach((cookie, index) => {
      const field = `cookies[${index}]`;
      if (!isObject(cookie) || typeof cookie.name !== 'string' || typeof cookie.value !== 'string') throw new Error(`field ${field} needs string name and value.`);
      if (cookie.name.trim() === '') throw new Error(`field ${field}.name must not be empty.`);
      if (cookie.url !== undefined && (typeof cookie.url !== 'string' || !isHttpUrl(cookie.url))) throw new Error(`field ${field}.url must be an http(s) URL.`);
      if (cookie.domain !== undefined && (typeof cookie.domain !== 'string' || cookie.domain.trim() === '')) throw new Error(`field ${field}.domain must be a non-empty string.`);
      if (cookie.path !== undefined && (typeof cookie.path !== 'string' || !cookie.path.startsWith('/'))) throw new Error(`field ${field}.path must be a string starting with /.`);
      // Playwright needs either a url or a domain/path pair to place the cookie.
      if (cookie.url === undefined && (cookie.domain === undefined || cookie.path === undefined)) throw new Error(`field ${field} needs url, or both domain and path.`);
      if (cookie.expires !== undefined && (typeof cookie.expires !== 'number' || !Number.isFinite(cookie.expires) || (cookie.expires < 0 && cookie.expires !== -1))) throw new Error(`field ${field}.expires must be -1 or a non-negative Unix time in seconds.`);
      for (const flag of ['httpOnly', 'secure'] as const) if (cookie[flag] !== undefined && typeof cookie[flag] !== 'boolean') throw new Error(`field ${field}.${flag} must be true or false.`);
      if (cookie.sameSite !== undefined && !(SAME_SITE as readonly unknown[]).includes(cookie.sameSite)) throw new Error(`field ${field}.sameSite must be one of ${SAME_SITE.join(', ')}.`);
    });
  }
  if (value.origins !== undefined) {
    if (!Array.isArray(value.origins)) throw new Error('field origins must be a list.');
    value.origins.forEach((origin, index) => {
      if (!isObject(origin) || typeof origin.origin !== 'string') throw new Error(`field origins[${index}].origin must be a string.`);
      if (origin.localStorage !== undefined) nameValues(origin.localStorage, `origins[${index}].localStorage`);
    });
  }
  return value as NonNullable<BrowserContextOptions['storageState']> & object;
}

/** Validates an --session-storage file: unique http(s) origins with name/value entries. */
export function parseSessionStorageState(value: unknown): SessionStorageState {
  if (!isObject(value)) throw new Error('field (top level) must be a JSON object with origins.');
  if (!Array.isArray(value.origins)) throw new Error('field origins must be a list.');
  const seen = new Set<string>();
  value.origins.forEach((item, index) => {
    if (!isObject(item) || !isHttpOrigin(item.origin)) throw new Error(`field origins[${index}].origin must be an http(s) origin.`);
    if (seen.has(item.origin)) throw new Error(`field origins[${index}].origin is listed twice.`);
    seen.add(item.origin);
    nameValues(item.sessionStorage, `origins[${index}].sessionStorage`);
  });
  return value as SessionStorageState;
}

/**
 * prepareAuth always returns an object (it also carries auth.check and the env redactor),
 * so `if (auth)` is always true. This is true only when a credential or session source was
 * configured: injected cookies or headers, --storage-state, --session-storage, or a login script.
 * Only then may cookies and storage the site sets during the scan be treated as secrets.
 */
export function hasAuthCredentials(auth: PreparedAuth | undefined): auth is PreparedAuth {
  return !!auth && (auth.cookies.length > 0 || Object.keys(auth.headers).length > 0 || auth.state !== undefined || auth.sessionStorage !== undefined || auth.script !== undefined);
}

export async function prepareAuth(options: AuthOptions, cwd: string, origin: string, env = process.env, redactor = new AuthRedactor()): Promise<PreparedAuth> {
  for (const value of secretEnvValues(env, 1)) redactor.add(value);
  const auth: PreparedAuth = { timeout: options.loginTimeoutMs ?? 30_000, env: { ...env }, cookies: [], headers: {}, redactor };
  if (options.authCheck) {
    auth.check = { ...options.authCheck };
    if (auth.check.url) {
      const url = new URL(auth.check.url, origin);
      if (url.origin !== origin || url.username || url.password) throw new Error('auth.check.url must be on the scan origin and contain no credentials.');
      auth.check.url = url.href;
    }
  }
  for (const [kind, mappings] of [['cookie', options.cookieEnv], ['header', options.headerEnv]] as const) {
    for (const input of mappings ?? []) {
      const mapping = envMapping(input);
      if (!mapping) throw new Error(`Invalid ${kind} mapping; use NAME=ENV_VAR_NAME.`);
      const value = env[mapping.env];
      if (!value) throw new Error(`Missing environment variable for ${kind} injection.`);
      redactor.add(value);
      const credential = /^(Bearer|Basic)\s+(.+)$/i.exec(value);
      if (kind === 'header' && credential) {
        redactor.add(credential[2]);
        if (credential[1]!.toLowerCase() === 'basic') {
          const decoded = Buffer.from(credential[2]!, 'base64').toString('utf8');
          redactor.add(decoded);
          const colon = decoded.indexOf(':');
          if (colon !== -1) redactor.add(decoded.slice(colon + 1));
        }
      }
      if (kind === 'cookie') auth.cookies.push({ name: mapping.name, value, url: origin });
      else {
        if (/^(cookie|set-cookie|host|content-length|connection|proxy-authorization)$/i.test(mapping.name)) throw new Error('Unsupported injected header; use --cookie-env for cookies.');
        if (/[\r\n]/.test(value)) throw new Error('Injected headers must not contain newlines.');
        auth.headers[mapping.name.toLowerCase()] = value;
      }
    }
  }
  if (options.storageState) {
    try { auth.state = await readJsonInput(cwd, options.storageState, parseStorageState); }
    catch (error) { throw new Error(`Could not read --storage-state: expected a Playwright storageState JSON file (${(error as Error).message.replace(/\.$/, '')}).`, { cause: error }); }
    auth.stateFile = options.storageState;
    redactor.storage(auth.state as Parameters<AuthRedactor['storage']>[0]);
  }
  if (options.sessionStorage) {
    try { auth.sessionStorage = await readJsonInput(cwd, options.sessionStorage, parseSessionStorageState); }
    catch (error) { throw new Error(`Could not read --session-storage: expected JSON with origins containing origin and sessionStorage name/value entries (${(error as Error).message.replace(/\.$/, '')}).`, { cause: error }); }
    redactor.storage(auth.sessionStorage);
  }
  if (options.loginScript) auth.script = pathToFileURL(path.resolve(cwd, options.loginScript)).href;
  return auth;
}

/** Runs before page scripts, including frames and subsequent navigations. */
export function restoreSessionStorage(state: SessionStorageState): void {
  const entries = state.origins.find(item => item.origin === window.location.origin)?.sessionStorage;
  if (entries) for (const { name, value } of entries) window.sessionStorage.setItem(name, value);
}

/** Inject only into the scan origin, including redirect hops. Never forward headers to third parties. */
export async function installAuth(context: BrowserContext, origin: string, auth: Pick<PreparedAuth, 'cookies' | 'headers' | 'sessionStorage'>): Promise<void> {
  if (auth.sessionStorage) await context.addInitScript(restoreSessionStorage, auth.sessionStorage);
  await context.addCookies(auth.cookies);
  if (Object.keys(auth.headers).length === 0) return;
  await context.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin === origin) await route.fulfill({ response: await route.fetch({ maxRedirects: 0, headers: { ...route.request().headers(), ...auth.headers } }) });
    else await route.continue();
  });
}

// An isolated worker can be terminated even if user code loops synchronously. Its stdout/stderr
// are discarded: arbitrary user script console output must never reach scan logs.
const LOGIN_WORKER = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  const { chromium } = require(workerData.playwright);
  const browser = await chromium.connect(workerData.endpoint);
  try {
    const context = await browser.newContext({ ...workerData.contextOptions, storageState: workerData.state });
    if (workerData.sessionStorage) await context.addInitScript({ content: '(' + workerData.restoreSessionStorage + ')(' + JSON.stringify(workerData.sessionStorage) + ')' });
    await context.addCookies(workerData.cookies);
    if (Object.keys(workerData.headers).length) await context.route('**/*', async route => {
      if (new URL(route.request().url()).origin === workerData.origin) await route.fulfill({ response: await route.fetch({ maxRedirects: 0, headers: { ...route.request().headers(), ...workerData.headers } }) });
      else await route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(workerData.timeout);
    page.setDefaultNavigationTimeout(workerData.timeout);
    page.on('dialog', dialog => void dialog.dismiss().catch(() => {}));
    const mod = await import(workerData.script);
    if (typeof mod.default !== 'function') throw new Error('export');
    await mod.default(page, workerData.env);
    const origins = new Map((workerData.sessionStorage?.origins ?? []).map(item => [item.origin, item]));
    for (const openPage of context.pages()) {
      for (const frame of openPage.frames()) {
        const item = await frame.evaluate(() => {
          if (!/^https?:$/.test(location.protocol)) return null;
          return { origin: location.origin, sessionStorage: Object.keys(sessionStorage).map(name => ({ name, value: sessionStorage.getItem(name) })) };
        });
        if (item) origins.set(item.origin, item);
      }
    }
    parentPort.postMessage({ state: await context.storageState(), sessionStorage: { origins: [...origins.values()] } });
    await context.close();
  } finally { await browser.close(); }
})().catch(() => parentPort.postMessage({ failed: true }));
`;

export async function runLoginScript(endpoint: string, origin: string, auth: PreparedAuth, contextOptions: BrowserContextOptions): Promise<NonNullable<BrowserContextOptions['storageState']>> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(LOGIN_WORKER, { eval: true, stdout: true, stderr: true, workerData: {
      endpoint, origin, script: auth.script, timeout: auth.timeout, env: auth.env,
      sessionStorage: auth.sessionStorage, restoreSessionStorage: restoreSessionStorage.toString(),
      state: auth.state, cookies: auth.cookies, headers: auth.headers, contextOptions,
      playwright: createRequire(import.meta.url).resolve('playwright'),
    } });
    worker.stdout.resume();
    worker.stderr.resume();
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error(`Login script timed out after ${auth.timeout} ms.`)); }, auth.timeout);
    const fail = () => { clearTimeout(timer); void worker.terminate(); reject(new Error('Login script failed. Check its default export and login steps; script output is suppressed to protect credentials.')); };
    worker.once('error', fail);
    worker.once('exit', (code) => { if (code !== 0) fail(); });
    worker.once('message', (message) => {
      clearTimeout(timer);
      if (message.failed) { fail(); return; }
      auth.redactor.storage(message.state);
      auth.redactor.storage(message.sessionStorage);
      auth.sessionStorage = message.sessionStorage;
      void worker.terminate();
      resolve(message.state);
    });
  });
}

/** Presence checks do not wait or run accessibility engines. Invalid selectors fail closed. */
export async function passesAuthCheck(page: Page, check: AuthCheck, status: number | null): Promise<boolean> {
  try {
    if (status === null || status >= 400) return false;
    if (check.mustNotRedirectTo) {
      const forbidden = new URL(check.mustNotRedirectTo, page.url());
      const actual = new URL(page.url());
      if (actual.origin === forbidden.origin && (actual.pathname === forbidden.pathname || actual.pathname.startsWith(forbidden.pathname.replace(/\/$/, '') + '/'))) return false;
    }
    if (check.mustHaveSelector && await page.locator(check.mustHaveSelector).count() === 0) return false;
    if (check.mustNotHaveSelector && await page.locator(check.mustNotHaveSelector).count() > 0) return false;
    return true;
  } catch { return false; }
}
