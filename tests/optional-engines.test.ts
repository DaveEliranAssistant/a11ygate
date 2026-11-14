import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { Socket } from 'node:net';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { createHtmlcsEngine, createIbmEngine, createLighthouseEngine } from '@/lib/scan/engines/optional';
import { runEngine } from '@/lib/scan/engines/types';

// Every resource, including the deliberately broken image, stays on this server.
const bad = '<!doctype html><html><head><title>Local BAD fixture</title></head><body><img src="/blank.svg"><input><button></button></body></html>';

describe('optional engines against an offline local BAD fixture', () => {
  let browser: Browser;
  let context: BrowserContext;
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/blank.svg' ? 'image/svg+xml' : 'text/html');
    res.end(req.url === '/blank.svg' ? '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' : bad);
  });
  let url: string;
  let browserURL: string;
  const unexpected: string[] = [];
  const originalFetch = globalThis.fetch;
  const originalConnect = Socket.prototype.connect;

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/`;
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const debugPort = (probe.address() as import('node:net').AddressInfo).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    browserURL = `http://127.0.0.1:${debugPort}`;
    // Guard all Node TCP clients as well as browser resources. CDP is loopback
    // control traffic; only the fixture origin may serve page resources.
    vi.spyOn(Socket.prototype, 'connect').mockImplementation(function (this: Socket, ...args: unknown[]) {
      const first = Array.isArray(args[0]) ? args[0][0] : args[0];
      const host = typeof first === 'object' && first !== null
        ? (first as { host?: string }).host ?? 'localhost'
        : typeof args[1] === 'string' ? args[1] : 'localhost';
      if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
        unexpected.push(host);
        throw new Error(`Unexpected engine TCP connection: ${host}`);
      }
      return Reflect.apply(originalConnect, this, args);
    } as typeof originalConnect);
    // Programmatic APIs only: no CLI update/config/telemetry paths.
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const requested = String(input instanceof Request ? input.url : input);
      if (new URL(requested).hostname !== '127.0.0.1') {
        unexpected.push(requested);
        throw new Error(`Unexpected engine network call: ${requested}`);
      }
      return originalFetch(input, init);
    });
    browser = await chromium.launch({ headless: true, args: [`--remote-debugging-port=${debugPort}`, '--remote-debugging-address=127.0.0.1'] });
    context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', async (route) => {
      if (new URL(route.request().url()).origin !== new URL(url).origin) {
        unexpected.push(route.request().url());
        await route.abort();
      } else await route.continue();
    });
  });

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.restoreAllMocks();
    expect(unexpected).toEqual([]);
  });

  it.each([
    ['htmlcs', createHtmlcsEngine, 'H37'],
    ['ibm', createIbmEngine, 'img_alt'],
    ['lighthouse', createLighthouseEngine, 'image-alt'],
  ] as const)('%s finds a known issue without navigation or external requests', async (id, create, knownRule) => {
    const page = await context.newPage();
    try {
      await page.goto(url);
      let navigations = 0;
      page.on('framenavigated', () => { navigations += 1; });
      const result = await runEngine(create(), { page, browserURL }, url);
      expect(result.status, result.status === 'errored' ? result.error : '').toBe('complete');
      if (result.status !== 'complete') throw new Error(result.error);
      expect(result.findings.some((f) => f.ruleId.includes(knownRule))).toBe(true);
      expect(result.findings.every((f) => f.engine === id && f.url === url)).toBe(true);
      expect(result.findings.some((f) => f.selector && f.snippet)).toBe(true);
      expect(navigations).toBe(0);
      expect(unexpected).toEqual([]);
    } finally { await page.close(); }
  }, 60_000);
});
