import { readFile, realpath } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { AXE_TAGS } from '@/lib/scan/report';

/**
 * Local re-scan for the isolated verifier. The input is a directory on disk,
 * never a URL: it is served on 127.0.0.1 with an ephemeral port and every
 * browser request to any other origin is aborted, so a production or
 * third-party deployment cannot be scanned.
 */

export type RescanFinding = {
  route: string;
  ruleId: string;
  /** axe selector, joined with a space for nested targets. */
  selector: string;
  html: string;
  /** `incomplete` = axe could not decide. Never counts as cleared. */
  kind: 'violation' | 'incomplete';
};

export type RescanProbe = { route: string; selector: string };

export type RescanResult = {
  /** HTTP status per route. Anything but 200 is a failed render. */
  status: Record<string, number>;
  findings: RescanFinding[];
  /** Probes whose element is absent or not visible. */
  missing: RescanProbe[];
  engineVersion: string;
};

export interface Rescanner {
  /** axe tags used for every scan from this rescanner, so pre- and post-patch use the same rules. */
  readonly tags: readonly string[];
  scan(input: { root: string; routes: readonly string[]; probes?: readonly RescanProbe[] }): Promise<RescanResult>;
  close(): Promise<void>;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
};

/** Serves `root` read-only on 127.0.0.1. Paths (and symlinks) outside `root` get 403. */
export async function serveDirectory(root: string): Promise<{ origin: string; close: () => Promise<void> }> {
  const base = await realpath(root);
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (!relative || relative.endsWith('/')) relative += 'index.html';
    const send = (status: number, body: Buffer | string, type = 'text/plain; charset=utf-8') => {
      res.writeHead(status, { 'content-type': type });
      res.end(body);
    };
    realpath(path.resolve(base, relative))
      .then(async (file) => {
        if (!file.startsWith(base + path.sep)) return send(403, 'forbidden');
        return send(200, await readFile(file), TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
      })
      .catch(() => send(404, 'not found'));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

function selectorOf(target: readonly unknown[]): string {
  return target.map((part) => (Array.isArray(part) ? part.map(String).join(' ') : String(part))).join(' ');
}

type AxeNode = { target: unknown[]; html: string };
type AxeRun = { testEngine: { version: string }; violations: { id: string; nodes: AxeNode[] }[]; incomplete: { id: string; nodes: AxeNode[] }[] };

/**
 * Re-scanner backed by headless Chromium and @axe-core/playwright (optional
 * dependencies, loaded on first use). Uses the scan command's axe tags unless
 * `tags` is given; the same instance must be used before and after a patch.
 */
export type RescanModules = { playwright: typeof import('playwright'); axe: typeof import('@axe-core/playwright') };

export function createLocalAxeRescanner(options: { tags?: readonly string[]; load?: () => Promise<RescanModules> } = {}): Rescanner {
  const tags = [...(options.tags ?? AXE_TAGS)];
  const load = options.load ?? (async (): Promise<RescanModules> => ({ playwright: await import('playwright'), axe: await import('@axe-core/playwright') }));
  let browser: import('playwright').Browser | null = null;
  let AxeBuilder: typeof import('@axe-core/playwright').default | null = null;

  async function ready() {
    if (!browser || !AxeBuilder) {
      const { playwright, axe: axeModule } = await load();
      AxeBuilder = axeModule.default ?? (axeModule as unknown as { AxeBuilder: typeof axeModule.default }).AxeBuilder;
      browser = await playwright.chromium.launch({ headless: true });
    }
    return { browser, AxeBuilder };
  }

  return {
    tags,
    async scan({ root, routes, probes = [] }) {
      const { browser: chromium, AxeBuilder: Builder } = await ready();
      const server = await serveDirectory(root);
      const context = await chromium.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light', serviceWorkers: 'block' });
      const result: RescanResult = { status: {}, findings: [], missing: [], engineVersion: '' };
      try {
        await context.route('**/*', (route) => (new URL(route.request().url()).origin === server.origin ? route.continue() : route.abort()));
        for (const route of routes) {
          const page = await context.newPage();
          try {
            const response = await page.goto(new URL(route.replace(/^\/+/, ''), `${server.origin}/`).toString(), { waitUntil: 'load' });
            result.status[route] = response?.status() ?? 0;
            if (result.status[route] !== 200) continue;
            const run = (await new Builder({ page }).withTags(tags).analyze()) as unknown as AxeRun;
            result.engineVersion = run.testEngine.version;
            for (const [kind, list] of [['violation', run.violations], ['incomplete', run.incomplete]] as const) {
              for (const rule of list) {
                for (const node of rule.nodes) result.findings.push({ route, ruleId: rule.id, selector: selectorOf(node.target), html: node.html, kind });
              }
            }
            for (const probe of probes.filter((item) => item.route === route)) {
              const handle = await page.$(probe.selector).catch(() => null);
              if (!handle || !(await handle.isVisible())) result.missing.push(probe);
            }
          } finally {
            await page.close();
          }
        }
      } finally {
        await context.close();
        await server.close();
      }
      return result;
    },
    async close() {
      const open = browser;
      browser = null;
      if (open) await open.close();
    },
  };
}
