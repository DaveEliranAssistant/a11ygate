import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { redactedScreenshot } from '@/lib/scan/screenshot';
import { loadEffectiveConfig } from '@/packages/cli/src/effective-config';
import { parseScanArgs, runScan } from '@/packages/cli/src/scan';
import { runEvidence } from '@/packages/cli/src/evidence';
import { readZip } from '@/lib/evidence/zip';
import { guardLocalhostNetwork } from './network-guard';

it('wires selectors and disables capture even when screenshots are enabled', () => {
  const config = loadEffectiveConfig('scan', ['--no-screenshots'], { env: {}, repoConfig: 'url: http://localhost/\nscreenshots: true\nredact:\n  selectors: ["#private"]\n' });
  expect(parseScanArgs(config.argv)).toMatchObject({ ok: true, options: { screenshots: true, noScreenshots: true, redactSelectors: ['#private'] } });
  expect(parseScanArgs(['http://localhost/', '--screenshots']).ok).toBe(false);
  expect(parseScanArgs(['http://localhost/', '--no-screenshots=true']).ok).toBe(false);
});

describe.skipIf(process.env.A11YGATE_BROWSER_TESTS !== '1')('local screenshot pixels', () => {
  it('masks every bounding box black, cleans up on success/failure and leaves axe findings unchanged', async () => {
    const guard = guardLocalhostNetwork();
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      await page.route('**/*', route => route.abort());
      await page.setContent('<!doctype html><html lang="en"><title>Redaction fixture</title><style>input,section{display:block;width:250px;height:40px;margin:12px}</style><main><input aria-label="Password" type="password" value="KNOWN_TOKEN_123"><input aria-label="Card" autocomplete="cc-number" value="KNOWN_TOKEN_123"><section data-a11ygate-redact>KNOWN_TOKEN_123</section><section id="private">KNOWN_TOKEN_123</section><button></button></main></html>');
      const baseline = (await new AxeBuilder({ page }).analyze()).violations;
      const boxes = await page.locator('input,section').evaluateAll(elements => elements.map(element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
      const png = await redactedScreenshot(page, ['#private']);
      const pixels = await page.evaluate(async ({ png, boxes }) => {
        const image = new Image(); image.src = 'data:image/png;base64,' + png; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
        return boxes.map(box => {
          const data = context.getImageData(box.x, box.y, box.width, box.height).data;
          for (let i = 0; i < data.length; i += 4) if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 0 || data[i + 3] !== 255) return false;
          return true;
        });
      }, { png: png.toString('base64'), boxes });
      expect(pixels).toEqual([true, true, true, true]);
      expect(await page.locator('[data-a11ygate-screenshot-mask]').count()).toBe(0);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(baseline);
      // A screenshot failure must not leave a mask behind.
      const original = page.screenshot.bind(page);
      page.screenshot = async () => { throw new Error('capture failed'); };
      await expect(redactedScreenshot(page)).rejects.toThrow('capture failed');
      page.screenshot = original;
      expect(await page.locator('[data-a11ygate-screenshot-mask]').count()).toBe(0);
      await expect(redactedScreenshot(page, ['['])).rejects.toThrow();
      expect(await page.locator('[data-a11ygate-screenshot-mask]').count()).toBe(0);
      expect(guard.attempts).toEqual([]);
    } finally { await browser.close(); guard.restore(); }
  }, 60000);

  it('captures masked PNGs, and --no-screenshots excludes even stale images from the evidence ZIP', async () => {
    const guard = guardLocalhostNetwork();
    const dir = await mkdtemp(path.join(tmpdir(), 'a11ygate-redaction-'));
    const server = createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html lang="en"><title>Fixture</title><main><input aria-label="Token" data-a11ygate-redact value="KNOWN_TOKEN_123"></main></html>'); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/`;
    const quiet = { cwd: dir, env: { NODE_ENV: 'test' as const, FIXTURE_SESSION: 'synthetic-fixture-session' }, stdout: () => {}, stderr: () => {} };
    try {
      expect(await runScan([url, '--screenshots', '--out-dir', 'images', '--ignore-robots', '--fail-on', 'none'], quiet)).toBe(0);
      expect((await readdir(path.join(dir, 'images/screenshots'))).length).toBe(1);
      await mkdir(path.join(dir, 'disabled/screenshots'), { recursive: true });
      const name = (await readdir(path.join(dir, 'images/screenshots')))[0];
      await writeFile(path.join(dir, 'disabled/screenshots/stale.png'), await readFile(path.join(dir, 'images/screenshots', name)));
      expect(await runScan([url, '--cookie-env', 'session=FIXTURE_SESSION', '--screenshots', '--no-screenshots', '--out-dir', 'disabled', '--ignore-robots', '--fail-on', 'none'], quiet)).toBe(0);
      expect(await readdir(path.join(dir, 'disabled/screenshots'))).toEqual(['stale.png']);
      expect(await runEvidence(['pack', '--from', 'disabled'], { ...quiet, gitHead: async () => null })).toBe(0);
      const entries = readZip(await readFile(path.join(dir, 'disabled/a11ygate-evidence.zip')));
      expect(entries.some(entry => /\.(png|jpe?g|webp)$/i.test(entry.path))).toBe(false);
      expect(guard.attempts).toEqual([]);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); await rm(dir, { recursive: true, force: true }); guard.restore(); }
  }, 60000);
});
