import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
};

export type FixtureServer = { origin: string; requests: { path: string; userAgent: string }[]; close: () => Promise<void> };

/** Serve a fixture directory on 127.0.0.1 with a random port. Records every request. */
export async function serveFixture(root: string): Promise<FixtureServer> {
  const requests: FixtureServer['requests'] = [];
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    requests.push({ path: url.pathname + url.search, userAgent: String(req.headers['user-agent'] ?? '') });
    const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const file = path.resolve(root, relative);
    if (!file.startsWith(path.resolve(root) + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    readFile(file).then(
      (body) => {
        res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
        res.end(body);
      },
      () => {
        res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><html lang="en"><title>Not found</title><h1>Not found</h1></html>');
      },
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
