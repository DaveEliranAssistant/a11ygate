import http from 'node:http';
import { readFileSync } from 'node:fs';

for (const [fixture, port] of [['bad', 4173], ['clean', 4174]]) {
  const html = readFileSync(`/opt/a11ygate/examples/jenkins/fixtures/${fixture}/index.html`);
  http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
    } else if (req.url === '/product.png') {
      // Both fixtures refer to this synthetic, one-pixel local image.
      res.writeHead(200, { 'content-type': 'image/png' }).end(Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
    } else {
      res.writeHead(404).end();
    }
  }).listen(port, '127.0.0.1', () => console.log(`${fixture}: http://127.0.0.1:${port}/`));
}
