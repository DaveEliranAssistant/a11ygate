import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(process.argv[2]);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
createServer(async (req, res) => {
  const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname), '');
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  try {
    const target = file === root ? path.join(root, 'index.html') : file;
    const body = await readFile(target);
    res.writeHead(200, { 'Content-Type': types[path.extname(target)] ?? 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(Number(process.argv[3]), '127.0.0.1');
