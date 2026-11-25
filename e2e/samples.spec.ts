// A11Y-R79: the sample deliverables pack (docs/samples). Rebuilds the pack from the local demo app into a temp
// dir (never into the worktree) and checks (a) PDF text against stored expectations, (b) disclaimer and SAMPLE
// marking on every sample and every PDF page, (c) hosts. Needs Chromium, so it lives in e2e/ and runs on CI.
// It does not use the Next server that playwright.config.ts starts.
//
// Refresh the stored text after an intended change: A11Y_UPDATE_SAMPLE_TEXT=1 npx playwright test e2e/samples.spec.ts
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { readZip } from '../lib/evidence/zip';
import { pdfInfo } from '../tests/pdf-info';

const repoRoot = path.resolve(__dirname, '..');
const committed = path.join(repoRoot, 'docs/samples');
const expectedDir = path.join(repoRoot, 'e2e/fixtures/samples');
const DISCLAIMER = 'Automated testing only. Not a WCAG audit, certification or legal advice.';
const SAMPLE_FILES = [
  'prospect-summary.pdf', 'pilot-results.pdf', 'quote-sample.pdf', 'evidence-pack-sample.zip', 'report.html',
  'screenshot-pr-gate.png', 'screenshot-report-summary.png', 'screenshot-trend.png',
];
const PDFS = ['prospect-summary.pdf', 'pilot-results.pdf', 'quote-sample.pdf'];
const banned = /fixes everything|\bcompliant\b|\bcertified\b|\bguarantees?\b|\bconformant\b|lawsuit-proof/i;
// pdf.js on Linux runners returns ligature glyphs as separate items ("certi fi cation"); rejoin them before matching.
const rejoinLigatures = (text: string) => text.replace(/ (ffi|ffl|ff|fi|fl) /g, '$1');
const squeeze = (text: string) => text.replace(/\s+/g, '');
// Footer printed on every page by build-samples.mjs, plus the rotated SAMPLE watermark (pdf.js may split its letters).
const FOOTER = new RegExp(`(?:SAMPLE)?SAMPLE·ExampleLtd·demoappdata${squeeze(DISCLAIMER).replace(/[.,]/g, '\\$&')}Page\\d+of\\d+`, 'g');
// Reference-documentation hosts the CLI links to (rule help, WCAG, A11yGate itself, SARIF schema). Nothing on them is scanned.
const REFERENCE_HOSTS = new Set(['www.w3.org', 'dequeuniversity.com', 'a11ygate.vercel.app', 'json.schemastore.org']);

type ScreenshotCheck = { bannerText: string; bannerInViewport: boolean; watermarkVisible: boolean };
const readZipEntries = (zip: Buffer) => readZip(zip).map((e) => ({ path: e.path, data: Buffer.from(e.data) }));

let outDir = '';
let screenshots: Record<string, ScreenshotCheck> = {};
let hits: string[] = [];

/** Page texts with whitespace removed; body = all pages joined with footers and watermark removed. */
async function pdfText(file: string) {
  const { pages } = await pdfInfo(await readFile(file));
  const squeezed = pages.map(squeeze);
  return { pages, squeezed, body: squeezed.map((p) => p.replace(FOOTER, '')).join('') };
}

async function sampleTexts(dir: string): Promise<{ name: string; text: string }[]> {
  const texts: { name: string; text: string }[] = [];
  for (const file of PDFS) texts.push({ name: file, text: (await pdfInfo(await readFile(path.join(dir, file)))).pages.join('\n') });
  texts.push({ name: 'report.html', text: await readFile(path.join(dir, 'report.html'), 'utf8') });
  for (const entry of readZipEntries(await readFile(path.join(dir, 'evidence-pack-sample.zip')))) {
    if (!/\.png$/i.test(entry.path)) texts.push({ name: `evidence-pack-sample.zip!/${entry.path}`, text: entry.data.toString('utf8') });
  }
  return texts;
}

test.describe.serial('sample deliverables pack (A11Y-R79)', () => {
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    outDir = await mkdtemp(path.join(os.tmpdir(), 'a11ygate-samples-e2e-'));
    const checks = path.join(outDir, '..', `${path.basename(outDir)}-checks.json`);
    const env = { ...process.env };
    delete env.SOURCE_DATE_EPOCH;
    await new Promise<void>((resolve, reject) => {
      execFile(process.execPath, [path.join(repoRoot, 'scripts/build-samples.mjs'), '--out-dir', outDir, '--checks-json', checks],
        { cwd: repoRoot, env, timeout: 220_000, maxBuffer: 16 * 1024 * 1024 },
        (error, stdout, stderr) => (error ? reject(new Error(`npm run samples failed: ${error.message}\n${stdout}\n${stderr}`)) : resolve()));
    });
    ({ screenshots, hits } = JSON.parse(await readFile(checks, 'utf8')));
    await rm(checks, { force: true });
  });
  test.afterAll(async () => {
    if (outDir) await rm(outDir, { recursive: true, force: true });
  });

  test('npm run samples writes every sample and only fetches the local demo app', async () => {
    for (const file of SAMPLE_FILES) expect(existsSync(path.join(outDir, file)), file).toBe(true);
    for (const file of [...SAMPLE_FILES, 'README.md']) expect(existsSync(path.join(committed, file)), `docs/samples/${file}`).toBe(true);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.filter((hit) => !/^(GET|HEAD) \//.test(hit))).toEqual([]);
  });

  test('(a) PDF text of rebuilt and committed samples matches the stored expectations', async () => {
    for (const file of PDFS) {
      const fresh = await pdfText(path.join(outDir, file));
      const expectedFile = path.join(expectedDir, `${file}.txt`);
      if (process.env.A11Y_UPDATE_SAMPLE_TEXT === '1') {
        const readable = fresh.pages.map((p) => rejoinLigatures(p)).join('\n');
        await writeFile(expectedFile, `${readable.trim()}\n`);
      }
      const expected = squeeze(await readFile(expectedFile, 'utf8')).split('\n').join('');
      const expectedBody = expected.replace(FOOTER, '');
      expect(fresh.body, `${file} (rebuilt)`).toBe(expectedBody);
      expect((await pdfText(path.join(committed, file))).body, `docs/samples/${file}`).toBe(expectedBody);
    }
  });

  test('(b) every sample carries the disclaimer and the SAMPLE marking', async () => {
    for (const dir of [outDir, committed]) {
      for (const file of PDFS) {
        const { pages, squeezed } = await pdfText(path.join(dir, file));
        expect(pages.length, file).toBeGreaterThan(0);
        for (const [i, page] of squeezed.entries()) {
          expect(page.match(FOOTER), `${file} page ${i + 1}: SAMPLE footer with disclaimer`).toHaveLength(1);
          expect(rejoinLigatures(pages[i]!), `${file} page ${i + 1}`).not.toMatch(banned);
        }
        expect(rejoinLigatures(pages[0]!)).toContain(`SAMPLE Example Ltd is a fictional customer. All data comes from the A11yGate demo app (fixtures/demo-app), not a customer site. ${DISCLAIMER}`);
      }
      const report = await readFile(path.join(dir, 'report.html'), 'utf8');
      expect(report).toContain(DISCLAIMER);
      expect(report).toContain('data-sample-banner><strong>SAMPLE</strong> Example Ltd is a fictional customer.');
      expect(report).toContain('<div class="a11ygate-sample-watermark" aria-hidden="true">SAMPLE</div>');
      const entries = readZipEntries(await readFile(path.join(dir, 'evidence-pack-sample.zip')));
      expect(entries.map((e) => e.path)).toEqual(expect.arrayContaining(['manifest.json', 'report.md', 'report.html', 'scan/a11ygate-scan.json']));
      for (const entry of entries.filter((e) => !/\.png$/i.test(e.path))) {
        expect(entry.data.toString('utf8'), entry.path).toContain(DISCLAIMER);
      }
      for (const name of ['report.md', 'report.html', 'scan/a11ygate-scan.md', 'scan/a11ygate-scan.html', 'manifest.json']) {
        expect(entries.find((e) => e.path === name)?.data.toString('utf8'), name).toMatch(/SAMPLE\W+.{0,20}Example Ltd is a fictional customer/);
      }
      // The manifest still describes the (marked) files it ships with.
      const manifest = JSON.parse(entries.find((e) => e.path === 'manifest.json')!.data.toString('utf8'));
      for (const file of manifest.files as { path: string; bytes: number; sha256: string }[]) {
        const data = entries.find((e) => e.path === file.path)?.data;
        expect(data?.length, file.path).toBe(file.bytes);
        expect(createHash('sha256').update(data!).digest('hex'), file.path).toBe(file.sha256);
      }
      for (const png of SAMPLE_FILES.filter((f) => f.endsWith('.png'))) {
        const bytes = await readFile(path.join(dir, png));
        expect(bytes.subarray(1, 4).toString('latin1'), png).toBe('PNG');
        expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], png).toEqual([1000, 720]);
      }
    }
    const readme = await readFile(path.join(committed, 'README.md'), 'utf8');
    expect(readme).toContain(DISCLAIMER);
    expect(readme).toContain('All data comes from our demo app');
    expect(readme).toContain('**SAMPLE**');
    expect(readme).not.toMatch(banned);
    for (const file of SAMPLE_FILES) expect(readme, file).toContain(`[${file}](${file})`);
    // PNGs: the captured viewport showed the SAMPLE banner with the disclaimer and the watermark.
    expect(Object.keys(screenshots).sort()).toEqual(SAMPLE_FILES.filter((f) => f.endsWith('.png')).sort());
    for (const [png, shot] of Object.entries(screenshots)) {
      expect(shot.bannerInViewport, png).toBe(true);
      expect(shot.watermarkVisible, png).toBe(true);
      expect(shot.bannerText, png).toContain('SAMPLE');
      expect(shot.bannerText, png).toContain(DISCLAIMER);
    }
  });

  test('(c) no scanned host other than 127.0.0.1 appears in any sample', async () => {
    for (const dir of [outDir, committed]) {
      const texts = await sampleTexts(dir);
      texts.push({ name: 'README.md', text: await readFile(path.join(committed, 'README.md'), 'utf8') });
      for (const { name, text } of texts) {
        expect(text, name).not.toMatch(/localhost|\[::1\]|0\.0\.0\.0/i);
        const hosts = [...text.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/([^/\s"'<>)\]`\\]+)/gi)].map((m) => m[1]!.toLowerCase());
        const other = [...new Set(hosts)].filter((host) => host !== '127.0.0.1:4173' && !REFERENCE_HOSTS.has(host));
        expect(other, name).toEqual([]);
      }
      // Every scanned page is on the demo app.
      const scan = readZipEntries(await readFile(path.join(dir, 'evidence-pack-sample.zip'))).find((e) => e.path === 'scan/a11ygate-scan.json')!;
      const report = JSON.parse(scan.data.toString('utf8'));
      const pageUrls = [...(report.pages ?? []).map((p: { url: string }) => p.url), ...(report.findings ?? []).map((f: { pageUrl: string }) => f.pageUrl)];
      expect(pageUrls.length).toBeGreaterThan(0);
      for (const url of pageUrls) expect(new URL(url).host, url).toBe('127.0.0.1:4173');
    }
  });
});
