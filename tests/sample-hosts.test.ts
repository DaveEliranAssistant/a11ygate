// A11Y-R79 (c): host check of the committed sample pack + negative tests of the checker (no Chromium; runs in
// npm test). e2e/samples.spec.ts runs the same checker on a fresh rebuild and on the PDF text.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createZip } from '../lib/evidence/zip';
import {
  evidencePackHostProblems, fileHostProblems, isScannedOk, jsonHostProblems, readZipEntries, SAMPLE_HOST, scannedUrls, textHostProblems,
  type Entry,
} from './sample-hosts';

const dir = path.join(__dirname, '..', 'docs', 'samples');
const LOCAL = `http://${SAMPLE_HOST}/`;
const PLANTED = 'https://dequeuniversity.com/';

const packEntries = async () => readZipEntries(await readFile(path.join(dir, 'evidence-pack-sample.zip')));
const text = (e: Entry) => Buffer.from(e.data).toString('utf8');
const withEntry = (entries: Entry[], name: string, edit: (s: string) => string): Entry[] => entries.map((e) => {
  if (e.path !== name) return e;
  const next = edit(text(e));
  expect(next, `planting into ${name}`).not.toBe(text(e));
  return { path: e.path, data: Buffer.from(next) };
});

describe('sample pack host check (A11Y-R79 c)', () => {
  it('the committed evidence pack (every entry, incl. engines/axe.json) has only demo-app scanned URLs', async () => {
    const entries = await packEntries();
    expect(entries.map((e) => e.path)).toContain('engines/axe.json');
    expect(evidencePackHostProblems(entries)).toEqual([]);
    // The axe results' top-level url is extracted for every result.
    const axe = JSON.parse(text(entries.find((e) => e.path === 'engines/axe.json')!));
    expect(axe.length).toBeGreaterThan(0);
    const urls = scannedUrls(entries);
    for (const result of axe) expect(urls).toContain(result.url);
  });

  it('the committed report.html, screenshot-checks.json and README pass', async () => {
    for (const name of ['report.html', 'screenshot-checks.json', 'README.md']) {
      expect(fileHostProblems(name, await readFile(path.join(dir, name))), name).toEqual([]);
    }
  });

  it('FAILS when an axe result url in engines/axe.json is a non-local host (in memory)', async () => {
    const entries = await packEntries();
    const axe = JSON.parse(text(entries.find((e) => e.path === 'engines/axe.json')!));
    axe[0].url = axe[0].url.replace(LOCAL, PLANTED);
    expect(axe[0].url.startsWith(PLANTED)).toBe(true);
    const planted = entries.map((e) => (e.path === 'engines/axe.json' ? { path: e.path, data: Buffer.from(JSON.stringify(axe, null, 2)) } : e));
    const problems = evidencePackHostProblems(planted);
    expect(problems.some((p) => p.includes('engines/axe.json $[0].url: https://dequeuniversity.com/'))).toBe(true);
    expect(problems.some((p) => p.startsWith('scanned URL not on') && p.includes(PLANTED))).toBe(true);
    // Also through the zip bytes, as the e2e check reads it.
    expect(evidencePackHostProblems(createZip(planted))).not.toEqual([]);
  });

  it('FAILS on a textual replace of the first "http://127.0.0.1:4173/" in engines/axe.json', async () => {
    const planted = withEntry(await packEntries(), 'engines/axe.json', (s) => s.replace(`"${LOCAL}`, `"${PLANTED}`));
    expect(evidencePackHostProblems(planted)).not.toEqual([]);
  });

  it('FAILS when the axe result url is missing (no silent skip)', async () => {
    const entries = await packEntries();
    const axe = JSON.parse(text(entries.find((e) => e.path === 'engines/axe.json')!));
    delete axe[0].url;
    const planted = entries.map((e) => (e.path === 'engines/axe.json' ? { path: e.path, data: Buffer.from(JSON.stringify(axe)) } : e));
    expect(evidencePackHostProblems(planted)).toContain('missing scanned URL at engines/axe.json[0].url');
    expect(evidencePackHostProblems(entries.filter((e) => e.path !== 'engines/axe.json'))).toContain('evidence pack has no engines/axe.json');
  });

  it('FAILS on a non-local URL in a non-reference field of other sample files', async () => {
    const entries = await packEntries();
    const scan = withEntry(entries, 'scan/a11ygate-scan.json', (s) => s.replace(`"pageUrl": "${LOCAL}`, `"pageUrl": "${PLANTED}`));
    expect(evidencePackHostProblems(scan)).not.toEqual([]);
    const manifest = withEntry(entries, 'manifest.json', (s) => s.replace(`"url": "${LOCAL}`, `"url": "${PLANTED}`));
    expect(evidencePackHostProblems(manifest)).not.toEqual([]);
    const html = withEntry(entries, 'report.html', (s) => s.replace(`<code>${LOCAL}`, `<code>${PLANTED}`));
    expect(evidencePackHostProblems(html)).not.toEqual([]);
    const checks = await readFile(path.join(dir, 'screenshot-checks.json'), 'utf8');
    const sidecar = JSON.parse(checks);
    sidecar.page = 'https://www.w3.org/';
    expect(fileHostProblems('screenshot-checks.json', JSON.stringify(sidecar))).toHaveLength(1);
    // A generic `url` key is a scanned URL, never a reference link.
    expect(jsonHostProblems({ url: PLANTED })).toEqual(['$.url: https://dequeuniversity.com/']);
    expect(jsonHostProblems({ results: [{ url: LOCAL, wcagUrl: 'https://www.w3.org/WAI/x' }] })).toHaveLength(1);
  });

  // Review 3 (2026-11-27): protocol-relative URLs and loopback aliases that new URL() normalises to 127.0.0.1.
  it('FAILS on a protocol-relative //example.com/ planted as the scanned site in report.html', async () => {
    const html = await readFile(path.join(dir, 'report.html'), 'utf8');
    for (const planted of [
      html.replace(`Start URL: <code>${LOCAL}`, 'Start URL: <code>//example.com/'),
      html.replace(`<code>${LOCAL}products.html`, '<code>//example.com/products.html'),
      html.replace('</body>', '<img src="//example.com/x.png" alt=""></body>'),
      html.replace('</body>', '<img srcset="/a.png 1x, //example.com/b.png 2x" alt=""></body>'),
      html.replace('</body>', '<form action="\\\\example.com/x"></form></body>'),
      html.replace('</body>', '<div style="background:url(//example.com/bg.png)"></div></body>'),
      html.replace('</body>', '<a href="https:example.com/x">x</a></body>'),
      html.replace('</body>', '<a href="&#47;&#47;example.com/x">x</a></body>'),
      html.replace('</body>', '<script>const u = "https:\\/\\/example.com/";</script></body>'),
      html.replace('</body>', '<p>Scanned site: www.example.com</p></body>'),
      html.replace('</body>', '<p>Scanned site: example.com/checkout</p></body>'),
    ]) {
      expect(planted).not.toBe(html);
      expect(fileHostProblems('report.html', planted), planted.slice(-120)).not.toEqual([]);
    }
    // Same through the evidence pack's copy of report.html.
    const entries = withEntry(await packEntries(), 'report.html', (s) => s.replace(`Start URL: <code>${LOCAL}`, 'Start URL: <code>//example.com/'));
    expect(evidencePackHostProblems(entries).some((p) => p.includes('report.html') && p.includes('//example.com/'))).toBe(true);
  });

  it('FAILS when the axe result url in engines/axe.json is http://127.1:4173/ (or another loopback alias)', async () => {
    const entries = await packEntries();
    for (const alias of [
      'http://127.1:4173/', 'http://0x7f.0.0.1:4173/', 'http://2130706433:4173/', 'http://0177.0.0.1:4173/',
      'http://localhost:4173/', 'http://[::1]:4173/', 'http://user@127.0.0.1:4173/', 'http://127.0.0.1:4173@example.com/',
      'HTTP://127.0.0.1:4173/', 'http:\\\\127.0.0.1:4173/', 'http:/127.0.0.1:4173/', '//127.0.0.1:4173/', 'http://127.0.0.1.:4173/',
    ]) {
      const axe = JSON.parse(text(entries.find((e) => e.path === 'engines/axe.json')!));
      axe[0].url = axe[0].url.replace(LOCAL, alias);
      expect(axe[0].url.startsWith(alias), alias).toBe(true);
      const planted = entries.map((e) => (e.path === 'engines/axe.json' ? { path: e.path, data: Buffer.from(JSON.stringify(axe, null, 2)) } : e));
      const problems = evidencePackHostProblems(createZip(planted));
      expect(problems.some((p) => p.includes('engines/axe.json $[0].url')), alias).toBe(true);
      expect(problems.some((p) => p.startsWith('scanned URL not on') && p.includes(alias)), alias).toBe(true);
    }
  });

  it('isScannedOk checks the literal raw string before URL normalisation', () => {
    expect(isScannedOk(LOCAL)).toBe(true);
    expect(isScannedOk(`${LOCAL}checkout.html?x=1#y`)).toBe(true);
    expect(isScannedOk('http://127.0.0.1:4173')).toBe(true);
    for (const bad of ['http://127.1:4173/', 'http://0x7f000001:4173/', 'http://127.0.0.1:4174/', 'http://127.0.0.1/', 'https://127.0.0.1:4173/', 'http://127.0.0.1:4173\\@example.com/']) {
      expect(isScannedOk(bad), bad).toBe(false);
    }
  });

  it('the stored PDF text expectations pass the text check', async () => {
    const fixtures = path.join(__dirname, '..', 'e2e', 'fixtures', 'samples');
    for (const name of ['prospect-summary.pdf.txt', 'pilot-results.pdf.txt', 'quote-sample.pdf.txt']) {
      const stored = await readFile(path.join(fixtures, name), 'utf8');
      expect(textHostProblems(stored), name).toEqual([]);
      expect(textHostProblems(stored.replace(LOCAL, '//example.com/') + '\nSite: //example.com/'), name).not.toEqual([]);
    }
  });

  it('reference fields pass only with their reference hosts', () => {
    expect(jsonHostProblems({ url: LOCAL, helpUrl: 'https://dequeuniversity.com/rules/axe/4.14/label?application=playwright' })).toEqual([]);
    expect(jsonHostProblems({ $schema: 'https://json.schemastore.org/sarif-2.1.0.json', runs: [{ tool: { driver: { informationUri: 'https://a11ygate.vercel.app', rules: [{ helpUri: 'https://dequeuniversity.com/x' }] } } }] })).toEqual([]);
    expect(jsonHostProblems({ helpUrl: 'https://example.com/help' })).toHaveLength(1);
    expect(jsonHostProblems({ helpUrl: LOCAL })).toHaveLength(1);
    expect(jsonHostProblems({ userAgent: 'Mozilla/5.0 A11yGate (+https://a11ygate.vercel.app)' })).toEqual([]);
    expect(jsonHostProblems({ startUrl: 'https://127.0.0.1:4173/' })).toHaveLength(1);
    expect(jsonHostProblems({ startUrl: 'http://localhost:4173/' })).not.toEqual([]);
  });

  it('text samples allow reference hosts only in link context', () => {
    expect(textHostProblems('<a href="https://dequeuniversity.com/rules/axe/4.14/label">x</a>')).toEqual([]);
    expect(textHostProblems(`Site: ${LOCAL} [rule guidance](https://www.w3.org/WAI/x)`)).toEqual([]);
    expect(textHostProblems('Site: https://example.com/')).toHaveLength(1);
    expect(textHostProblems('- https://dequeuniversity.com/ (scanned page)')).toHaveLength(1);
    expect(textHostProblems('"url": "https://dequeuniversity.com/"')).toHaveLength(1);
    expect(textHostProblems('"pageUrl": "https://www.w3.org/"')).toHaveLength(1);
    expect(textHostProblems('http://localhost:3000/')).not.toEqual([]);
  });
});
