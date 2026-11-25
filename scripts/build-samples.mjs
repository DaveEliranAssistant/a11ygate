#!/usr/bin/env node
// A11Y-R79: sample deliverables pack for prospects, built only from the local demo app (fixtures/demo-app).
//
//   npm run samples                       # writes docs/samples/
//   npm run samples -- --out-dir <dir>    # writes somewhere else (tests use a temp dir)
//   ... --checks-json <file>              # also writes what each screenshot captured + the fixture request log (tests)
//
// Runs the R68 demo flow on 127.0.0.1 (ephemeral port): kickoff scan -> baseline -> mid-pilot scan ->
// regression -> gate scan -> evidence packs -> prospect --offer -> pilot report + draft quote -> trend.
// The CLI's own HTML is then post-processed here (the CLI and its default output are unchanged):
// customer "Example Ltd", a "SAMPLE" watermark on every page, the port rewritten to 127.0.0.1:4173 and dates
// fixed from SOURCE_DATE_EPOCH, and PDFs printed with Playwright Chromium like report-pdf.ts does.
// Nothing is fetched from anywhere except the local fixture server.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { REGRESSION_PAGE, startDemoApp } from '../fixtures/demo-app/server.mjs';

export const DISCLAIMER = 'Automated testing only. Not a WCAG audit, certification or legal advice.';
export const SAMPLE_CUSTOMER = 'Example Ltd';
export const SAMPLE_MARK = 'SAMPLE';
/** Fixed host:port written into the samples instead of the ephemeral fixture port. */
export const SAMPLE_ORIGIN_HOST = '127.0.0.1:4173';
/** 2026-11-26T00:00:00Z. Override with SOURCE_DATE_EPOCH (seconds). */
export const DEFAULT_SOURCE_DATE_EPOCH = 1795651200;
export const SAMPLE_FILES = [
  'prospect-summary.pdf', 'pilot-results.pdf', 'quote-sample.pdf', 'evidence-pack-sample.zip', 'report.html',
  'screenshot-pr-gate.png', 'screenshot-report-summary.png', 'screenshot-trend.png',
];
export const SAMPLE_NOTE = `${SAMPLE_MARK}: ${SAMPLE_CUSTOMER} is a fictional customer. All data comes from the A11yGate demo app (fixtures/demo-app), not a customer site.`;

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const CLI = path.join(repoRoot, 'packages/cli/dist/cli.mjs');
const CLOCK = pathToFileURL(path.join(repoRoot, 'scripts/samples-clock.mjs')).href;
const DAY = 86_400_000;
const TEXT_EXT = /\.(json|md|html|xml|sarif|txt|csv|yml)$/i;
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function runCli(args, cwd, now) {
  return new Promise((resolve) => {
    const nodeArgs = now ? ['--import', CLOCK] : [];
    execFile(process.execPath, [...nodeArgs, CLI, ...args], {
      cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: '1', A11YGATE_CHECKOUT_URL: '', A11YGATE_SAMPLES_NOW: now ?? '' },
    }, (error, stdout, stderr) => resolve({ code: error ? (typeof error.code === 'number' ? error.code : 2) : 0, stdout, stderr }));
  });
}

async function cli(args, cwd, expect, now) {
  const result = await runCli(args, cwd, now);
  if (result.code !== expect) throw new Error(`a11ygate ${args.join(' ')}: exit ${result.code}, expected ${expect}\n${result.stdout}\n${result.stderr}`);
  return result;
}

/** Rewrite the ephemeral port and every ISO timestamp in a scan output directory (recursively). */
async function normaliseScanDir(dir, port, stamp) {
  for (const name of await readdir(dir)) {
    const file = path.join(dir, name);
    const info = await stat(file);
    if (info.isDirectory()) { await normaliseScanDir(file, port, stamp); continue; }
    if (!info.isFile() || !TEXT_EXT.test(name)) continue;
    const text = await readFile(file, 'utf8');
    await writeFile(file, normaliseText(text, port, stamp));
  }
}

function normaliseText(text, port, stamp) {
  return text.split(`127.0.0.1:${port}`).join(SAMPLE_ORIGIN_HOST).replace(ISO, stamp);
}

const WATERMARK_CSS = `
.a11ygate-sample-banner{margin:0 0 12px;padding:8px 12px;border:2px solid #8a1c1c;background:#fff4f4;color:#5c0f0f;font:600 13px/1.4 system-ui,sans-serif}
.a11ygate-sample-banner strong{letter-spacing:.08em}
.a11ygate-sample-watermark{position:fixed;top:42%;left:0;right:0;text-align:center;font:800 110px/1 system-ui,sans-serif;letter-spacing:.12em;color:rgba(138,28,28,.12);transform:rotate(-28deg);pointer-events:none;z-index:2147483647}`;

/** Add the SAMPLE banner (with the disclaimer) at the top and a fixed SAMPLE watermark that prints on every page. */
export function watermarkHtml(html) {
  const banner = `<p class="a11ygate-sample-banner" data-sample-banner><strong>${SAMPLE_MARK}</strong> ${esc(SAMPLE_NOTE.slice(SAMPLE_MARK.length + 2))} ${esc(DISCLAIMER)}</p>`;
  const mark = `<div class="a11ygate-sample-watermark" aria-hidden="true">${SAMPLE_MARK}</div>`;
  let out = html.replace('</head>', `<style>${WATERMARK_CSS}</style></head>`);
  out = out.replace(/<body[^>]*>/, (tag) => `${tag}${banner}${mark}`);
  if (out === html || !out.includes('data-sample-banner')) throw new Error('Could not watermark HTML.');
  return out;
}

const FOOTER = `<div style="width:100%;margin:0 14mm;font:8px/1.3 system-ui,sans-serif;color:#333;display:flex;gap:8px;justify-content:space-between">`
  + `<span><b>${SAMPLE_MARK}</b> · ${SAMPLE_CUSTOMER} · demo app data</span><span>${DISCLAIMER}</span>`
  + `<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;

async function printPdf(browser, html, stamp) {
  const context = await browser.newContext({ javaScriptEnabled: false, colorScheme: 'light' });
  try {
    await context.route('**/*', (route) => route.abort());
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const pdf = await page.pdf({
      format: 'A4', margin: { top: '14mm', bottom: '22mm', left: '14mm', right: '14mm' }, printBackground: true,
      tagged: true, outline: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: FOOTER,
    });
    // Same trick as report-pdf.ts: fixed CreationDate/ModDate in place keeps xref offsets valid.
    const digits = stamp.slice(0, 19).replace(/\D/g, '');
    return Buffer.from(pdf.toString('latin1').replace(/(\/(?:CreationDate|ModDate) \(D:)\d{14}[+-]\d{2}'\d{2}'(?=\))/g, (_m, p) => `${p}${digits}+00'00'`), 'latin1');
  } finally {
    await context.close();
  }
}

/** Screenshot the top of a page and report what the captured viewport shows (for the tests). */
async function screenshot(browser, html, file) {
  const context = await browser.newContext({ javaScriptEnabled: false, colorScheme: 'light', viewport: { width: 1000, height: 720 }, deviceScaleFactor: 1 });
  try {
    await context.route('**/*', (route) => route.abort());
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.screenshot({ path: file, type: 'png' });
    const banner = page.locator('[data-sample-banner]');
    const box = await banner.boundingBox();
    return { bannerText: (await banner.innerText()).replace(/\s+/g, ' '), bannerInViewport: !!box && box.y >= 0 && box.y + box.height <= 720, watermarkVisible: await page.locator('.a11ygate-sample-watermark').isVisible() };
  } finally {
    await context.close();
  }
}

// --- zip (same format as lib/evidence/zip.ts: fixed 1980-01-01 DOS time, no extras) ---
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (data) => { let crc = 0xffffffff; for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; };

export function readZipEntries(zip) {
  const entries = [];
  let at = 0;
  while (zip.readUInt32LE(at) === 0x04034b50) {
    const method = zip.readUInt16LE(at + 8);
    const size = zip.readUInt32LE(at + 18);
    const nameLength = zip.readUInt16LE(at + 26);
    const extra = zip.readUInt16LE(at + 28);
    const name = zip.subarray(at + 30, at + 30 + nameLength).toString('utf8');
    const body = zip.subarray(at + 30 + nameLength + extra, at + 30 + nameLength + extra + size);
    entries.push({ path: name, data: method === 8 ? inflateRawSync(body) : Buffer.from(body) });
    at += 30 + nameLength + extra + size;
  }
  return entries;
}

function createZip(entries) {
  const local = []; const central = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    const raw = Buffer.from(entry.data);
    const store = /\.(png|jpe?g|webp|gif)$/i.test(entry.path);
    const body = store ? raw : deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6); header.writeUInt16LE(store ? 0 : 8, 8);
    header.writeUInt16LE(0, 10); header.writeUInt16LE(33, 12); header.writeUInt32LE(crc, 14); header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(raw.length, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, body);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(store ? 0 : 8, 10); record.writeUInt16LE(0, 12); record.writeUInt16LE(33, 14); record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(body.length, 20); record.writeUInt32LE(raw.length, 24); record.writeUInt16LE(name.length, 28); record.writeUInt32LE(offset, 42);
    central.push(record, name);
    offset += 30 + name.length + body.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBuffer, end]);
}

/**
 * Mark the evidence pack as a sample: banner in report.html, a SAMPLE line in report.md, and the
 * manifest's byte counts and SHA-256 updated so the pack stays internally consistent.
 */
async function sampleEvidencePack(zipFile) {
  const entries = readZipEntries(await readFile(zipFile));
  const note = `**${SAMPLE_MARK}**: ${SAMPLE_NOTE.slice(SAMPLE_MARK.length + 2)}\n\n`;
  const changed = new Map();
  for (const entry of entries) {
    const text = entry.data.toString('utf8');
    if (entry.path === 'report.html' || entry.path === 'scan/a11ygate-scan.html') entry.data = Buffer.from(watermarkHtml(text));
    else if (entry.path === 'report.md' || entry.path === 'scan/a11ygate-scan.md') entry.data = Buffer.from(note + text);
    else continue;
    changed.set(entry.path, entry.data);
  }
  const manifest = entries.find((e) => e.path === 'manifest.json');
  if (!manifest) throw new Error('evidence pack has no manifest.json');
  const json = JSON.parse(manifest.data.toString('utf8'));
  for (const file of json.files ?? []) {
    const data = changed.get(file.path);
    if (data) { file.bytes = data.length; file.sha256 = createHash('sha256').update(data).digest('hex'); }
  }
  json.sample = SAMPLE_NOTE;
  manifest.data = Buffer.from(`${JSON.stringify(json, null, 2)}\n`);
  return createZip(entries);
}

function gatePage(markdown, exitCode) {
  return watermarkHtml(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>PR check: a11ygate gate (sample)</title>
<style>body{margin:0;padding:20px;font:14px/1.5 system-ui,sans-serif;color:#1a1a1a;background:#f6f8fa}
.check{background:#fff;border:1px solid #d0d7de;border-radius:6px;padding:12px 16px}
.fail{color:#a40e26;font-weight:700}pre{white-space:pre-wrap;background:#fff;border:1px solid #d0d7de;border-radius:6px;padding:12px;font:12px/1.45 ui-monospace,monospace}</style></head>
<body><main><div class="check"><span class="fail">✕ a11ygate / accessibility gate: failing</span> · exit code ${exitCode} · one new finding on ${esc(REGRESSION_PAGE)} since the baseline</div>
<h1 style="font-size:16px">Markdown summary (PR comment) from a11ygate scan --baseline</h1><pre>${esc(markdown)}</pre></main></body></html>`);
}

/**
 * Build the pack into outDir. Returns what each screenshot captured, for the tests.
 * @param {{ outDir: string, epoch?: number, log?: (line: string) => void }} options
 */
export async function buildSamples({ outDir, epoch = DEFAULT_SOURCE_DATE_EPOCH, log = () => {} }) {
  if (!existsSync(CLI)) throw new Error(`Built CLI not found at ${CLI}. Run npm run cli:build first.`);
  const decision = new Date(epoch * 1000);
  const start = new Date(decision.getTime() - 20 * DAY);
  const at = (date, hour) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour)).toISOString();
  const stamps = { kickoff: at(start, 9), mid: at(new Date(start.getTime() + 7 * DAY), 9), latest: at(decision, 9) };
  const work = await mkdtemp(path.join(os.tmpdir(), 'a11ygate-samples-'));
  const app = await startDemoApp();
  const port = new URL(app.url).port;
  try {
    const scope = [app.url, '--crawl', '10', '--delay-ms', '0'];
    log(`Demo app on ${app.url} (fixtures/demo-app). Work dir ${work}`);
    await cli(['scan', ...scope, '--out-dir', 'kickoff'], work, 1);
    await cli(['baseline', 'create', 'kickoff', '--output', 'a11y-baseline.json'], work, 0, stamps.kickoff);
    await cli(['scan', ...scope, '--baseline', 'a11y-baseline.json', '--out-dir', 'mid'], work, 0);
    app.setRegression(true);
    const gate = await cli(['scan', ...scope, '--baseline', 'a11y-baseline.json', '--out-dir', 'latest'], work, 1);
    for (const run of ['kickoff', 'mid', 'latest']) {
      await normaliseScanDir(path.join(work, run), port, stamps[run]);
      await cli(['evidence', 'pack', '--from', run, '--out', `packs/${run}.zip`], work, 0, stamps[run]);
    }
    log('Scans and evidence packs done.');
    const template = await readFile(path.join(repoRoot, 'docs/pilot/success-criteria.template.yml'), 'utf8');
    const criteria = template
      .replace('customer: "[[MISSING]]"', `customer: "${SAMPLE_CUSTOMER}"`)
      .replace(/startDate: "[^"]*"/, `startDate: "${stamps.kickoff.slice(0, 10)}"`)
      .replace(/decisionDate: "[^"]*"/, `decisionDate: "${stamps.latest.slice(0, 10)}"`)
      .replace('min: 5', 'min: 4');
    await writeFile(path.join(work, 'success-criteria.yml'), criteria);
    await cli(['pilot', 'report', '--kickoff', 'packs/kickoff.zip', '--latest', 'packs/latest.zip', '--packs', 'packs',
      '--criteria', 'success-criteria.yml', '--customer', SAMPLE_CUSTOMER, '--out-dir', 'pilot-report'], work, 0, stamps.latest);
    await cli(['prospect', '--from', 'latest', '--company', SAMPLE_CUSTOMER, '--out-dir', 'prospect-out', '--offer'], work, 0, stamps.latest);
    await cli(['trend', 'packs', '--out-dir', 'trend'], work, 0, stamps.latest);
    log('Prospect summary, pilot report, quote and trend done.');

    await mkdir(outDir, { recursive: true });
    const read = (file) => readFile(path.join(work, file), 'utf8');
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    let screenshots;
    try {
      for (const [source, target] of [
        ['prospect-out/prospect-summary.html', 'prospect-summary.pdf'],
        ['pilot-report/pilot-results.html', 'pilot-results.pdf'],
        ['pilot-report/quote.html', 'quote-sample.pdf'],
      ]) await writeFile(path.join(outDir, target), await printPdf(browser, watermarkHtml(await read(source)), stamps.latest));
      const report = watermarkHtml(await read('latest/a11ygate-scan.html'));
      await writeFile(path.join(outDir, 'report.html'), report);
      const gateMd = normaliseText(gate.stdout.trimEnd(), port, stamps.latest);
      screenshots = {
        'screenshot-pr-gate.png': await screenshot(browser, gatePage(gateMd, gate.code), path.join(outDir, 'screenshot-pr-gate.png')),
        'screenshot-report-summary.png': await screenshot(browser, report, path.join(outDir, 'screenshot-report-summary.png')),
        'screenshot-trend.png': await screenshot(browser, watermarkHtml(await read('trend/a11ygate-trend.html')), path.join(outDir, 'screenshot-trend.png')),
      };
    } finally {
      await browser.close();
    }
    await writeFile(path.join(outDir, 'evidence-pack-sample.zip'), await sampleEvidencePack(path.join(work, 'packs/latest.zip')));
    log(`Wrote ${SAMPLE_FILES.length} samples to ${outDir}`);
    return { outDir, screenshots, hits: [...app.hits] };
  } finally {
    await app.close();
    await rm(work, { recursive: true, force: true });
  }
}

async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`Usage: npm run samples [-- --out-dir <dir>]\nBuilds the sample deliverables pack from the local demo app. Default --out-dir: docs/samples.\n${DISCLAIMER}\n`);
    return 0;
  }
  const i = argv.indexOf('--out-dir');
  const outDir = path.resolve(i >= 0 && argv[i + 1] ? argv[i + 1] : path.join(repoRoot, 'docs/samples'));
  const raw = process.env.SOURCE_DATE_EPOCH;
  const epoch = raw ? Number(raw) : DEFAULT_SOURCE_DATE_EPOCH;
  if (!Number.isInteger(epoch) || epoch <= 0) { process.stderr.write('SOURCE_DATE_EPOCH must be a positive integer (seconds).\n'); return 2; }
  try {
    const result = await buildSamples({ outDir, epoch, log: (line) => process.stdout.write(`${line}\n`) });
    const j = argv.indexOf('--checks-json');
    if (j >= 0 && argv[j + 1]) await writeFile(path.resolve(argv[j + 1]), `${JSON.stringify({ screenshots: result.screenshots, hits: result.hits }, null, 2)}\n`);
    process.stdout.write(`${DISCLAIMER}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

// No top-level await: the e2e spec and vitest import this module.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
