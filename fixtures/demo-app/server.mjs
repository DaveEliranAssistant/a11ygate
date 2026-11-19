// A11Y-R68: static server for the demo fixture app, with one toggle that introduces a single new
// serious-or-worse regression (an icon-only button with no accessible name, axe `button-name`).
// Listens on 127.0.0.1 and an ephemeral port (port 0) by default. Local fixture only.
//
//   node fixtures/demo-app/server.mjs               # existing debt only
//   node fixtures/demo-app/server.mjs --regression  # existing debt + the new regression
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SLOT = '<!-- demo-regression-slot -->';
/** The regression a developer "ships": an icon-only remove button. Deliberately unlabeled; no name is invented. */
export const REGRESSION_SNIPPET =
  '<button type="button" class="remove-item"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><path d="M3 3l10 10M13 3L3 13" stroke="#1a1a1a" stroke-width="2"/></svg></button>';
export const REGRESSION_PAGE = '/checkout.html';
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const FILES = new Set(['index.html', 'products.html', 'checkout.html', 'about.html', 'style.css', 'hero.svg']);

/**
 * Start the fixture server. Returns its base URL, a request log, a regression toggle and close().
 * @param {{ regression?: boolean, port?: number }} [options]
 */
export async function startDemoApp(options = {}) {
  let regression = options.regression === true;
  const hits = [];
  const server = createServer(async (req, res) => {
    const route = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    hits.push(`${req.method} ${route}`);
    const name = route === '/' ? 'index.html' : route.slice(1);
    if (req.method !== 'GET' && req.method !== 'HEAD') return void res.writeHead(405).end();
    if (!FILES.has(name)) return void res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    let body = await readFile(path.join(ROOT, name), 'utf8');
    if (regression && `/${name}` === REGRESSION_PAGE) body = body.replace(SLOT, REGRESSION_SNIPPET);
    res.writeHead(200, { 'content-type': TYPES[path.extname(name)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(options.port ?? 0, '127.0.0.1', resolve));
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  return {
    url: `http://127.0.0.1:${port}/`,
    hits,
    get regression() { return regression; },
    setRegression(value) { regression = value === true; },
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve(undefined)); }),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await startDemoApp({ regression: process.argv.includes('--regression') });
  process.stdout.write(`Demo app on ${app.url} (regression ${app.regression ? 'ON' : 'OFF'}). Ctrl+C to stop.\n`);
  process.stdout.write('Automated testing only. Not a WCAG audit, certification or legal advice.\n');
  const stop = () => app.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
