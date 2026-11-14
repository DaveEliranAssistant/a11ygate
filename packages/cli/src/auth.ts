import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import type { BrowserContext, BrowserContextOptions } from 'playwright';
import { AuthRedactor } from '@/lib/scan/redact';
import { secretEnvValues } from '@/lib/evidence/secrets';

export type AuthOptions = {
  storageState?: string;
  loginScript?: string;
  loginTimeoutMs?: number;
  cookieEnv?: string[];
  headerEnv?: string[];
};
export type PreparedAuth = {
  state?: BrowserContextOptions['storageState'];
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

export async function prepareAuth(options: AuthOptions, cwd: string, origin: string, env = process.env, redactor = new AuthRedactor()): Promise<PreparedAuth> {
  for (const value of secretEnvValues(env, 1)) redactor.add(value);
  const auth: PreparedAuth = { timeout: options.loginTimeoutMs ?? 30_000, env: { ...env }, cookies: [], headers: {}, redactor };
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
    try {
      const state = JSON.parse(await readFile(path.resolve(cwd, options.storageState), 'utf8'));
      redactor.storage(state);
      auth.state = state;
    } catch { throw new Error('Could not read --storage-state: expected a Playwright storageState JSON file.'); }
  }
  if (options.loginScript) auth.script = pathToFileURL(path.resolve(cwd, options.loginScript)).href;
  return auth;
}

/** Inject only into the scan origin, including redirect hops. Never forward headers to third parties. */
export async function installAuth(context: BrowserContext, origin: string, auth: Pick<PreparedAuth, 'cookies' | 'headers'>): Promise<void> {
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
    parentPort.postMessage({ state: await context.storageState() });
    await context.close();
  } finally { await browser.close(); }
})().catch(() => parentPort.postMessage({ failed: true }));
`;

export async function runLoginScript(endpoint: string, origin: string, auth: PreparedAuth, contextOptions: BrowserContextOptions): Promise<NonNullable<BrowserContextOptions['storageState']>> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(LOGIN_WORKER, { eval: true, stdout: true, stderr: true, workerData: {
      endpoint, origin, script: auth.script, timeout: auth.timeout, env: auth.env,
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
      void worker.terminate();
      resolve(message.state);
    });
  });
}
