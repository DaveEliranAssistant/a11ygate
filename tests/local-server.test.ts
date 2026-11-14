import { describe, expect, it } from 'vitest';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { withLocalServer, storyUrls } from '@/packages/cli/src/local-server';
import { parseScanArgs, runScan, type ScanEngineFactory } from '@/packages/cli/src/scan';

async function unusedPort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
const standIn: ScanEngineFactory = async () => ({
  async visit(url) {
    const response = await fetch(url);
    const html = await response.text();
    return { status: response.status, finalUrl: url, links: [], result: { url, timestamp: new Date().toISOString(), testEngine: { version: 'stand-in' }, toolOptions: {}, scanConfig: {}, scanStatus: 'complete', violations: html.includes('<img') ? [{ id: 'image-alt', impact: 'critical', tags: ['wcag2a', 'wcag111'], help: 'Missing alt', helpUrl: 'https://example.invalid/image-alt', nodes: [{ target: ['img'], html: '<img src="x">' }] }] : [] } };
  }, async close() {},
});

describe('local recipe lifecycle (no browser)', () => {
  for (const framework of ['nextjs', 'vite-react', 'angular', 'storybook']) {
    it(`${framework}: start/wait/scan wiring against static stand-in and process cleanup`, async () => {
      const cwd = await mkdtemp(path.join(tmpdir(), 'recipe-'));
      const port = await unusedPort();
      const url = `http://127.0.0.1:${port}/`;
      const source = `require('node:fs').writeFileSync('pid',String(process.pid));require('node:http').createServer((q,s)=>s.end('<img src="x">')).listen(${port},'127.0.0.1')`;
      await writeFile(path.join(cwd, 'server.cjs'), source);
      try {
        const code = await runScan([url, '--start', `${process.execPath} server.cjs`, '--wait-on', url, '--delay-ms', '0'], { cwd, engine: standIn, stdout() {}, stderr() {} });
        expect(code).toBe(1);
        const pid = Number(await readFile(path.join(cwd, 'pid'), 'utf8'));
        expect(() => process.kill(pid, 0)).toThrow();
        await expect(fetch(url)).rejects.toThrow();
      } finally { await rm(cwd, { recursive: true, force: true }); }
    });
  }
  it('cleans up when work throws', async () => {
    const port = await unusedPort();
    const url = `http://127.0.0.1:${port}/`;
    await expect(withLocalServer({ start: `${process.execPath} -e 'require("node:http").createServer((q,s)=>s.end("ready")).listen(${port},"127.0.0.1")'`, waitOn: url }, process.cwd(), process.env, async () => { throw new Error('scan error'); })).rejects.toThrow('scan error');
    await expect(fetch(url)).rejects.toThrow();
  });
  it('bounds readiness and reports early command exits', async () => {
    const url = `http://127.0.0.1:${await unusedPort()}/`;
    await expect(withLocalServer({ start: `${process.execPath} -e 'setInterval(()=>{},1000)'`, waitOn: url, timeoutMs: 150 }, process.cwd(), process.env, async () => 0)).rejects.toThrow('Timed out');
    await expect(withLocalServer({ start: 'exit 7', waitOn: url }, process.cwd(), process.env, async () => 0)).rejects.toThrow('exited before readiness');
  });
  it('validates local URL boundaries and required pairs', () => {
    expect(parseScanArgs(['http://localhost:1234', '--start', 'npm start'])).toMatchObject({ ok: false });
    expect(parseScanArgs(['https://example.com', '--wait-on', 'https://example.com'])).toMatchObject({ ok: false });
    expect(parseScanArgs(['http://localhost:1234', '--wait-on', 'http://localhost:5678'])).toMatchObject({ ok: false });
    expect(parseScanArgs(['http://localhost:1234', '--storybook', 'http://localhost:1234/index.json', '--crawl', '2'])).toMatchObject({ ok: false });
  });
  it('discovers only story iframe URLs, encodes IDs, and rejects empty indexes', () => {
    expect(storyUrls({ entries: { a: { id: 'one--a', type: 'story' }, b: { id: 'two&x', type: 'story' }, c: { id: 'docs', type: 'docs' } } }, 'http://localhost:1234/index.json')).toEqual(['http://localhost:1234/iframe.html?id=one--a&viewMode=story', 'http://localhost:1234/iframe.html?id=two%26x&viewMode=story']);
    expect(() => storyUrls({ entries: {} }, 'http://localhost:1234')).toThrow();
  });
});
