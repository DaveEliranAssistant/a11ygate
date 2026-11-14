#!/usr/bin/env node
// Chromium memory and runtime benchmark for `a11ygate scan` (A11Y-R38).
//
// Scans a generated, loopback-only fixture site with the built CLI bundle and records,
// per run: peak RSS of the Node CLI process and of its Chromium child processes, pages
// per minute, failures, and RSS growth across the scan. It never contacts third-party
// sites. It is NOT part of `npm test` or CI; run it with `npm run bench`.
//
// Usage: npm run cli:build && npm run bench -- [--pages 500] [--concurrency 1,2,4]
//          [--engines axe,all] [--recycle-every 0,50] [--out docs/perf] [--name chromium-bench]
//          [--max-run-ms 900000]
// `--recycle-every 0` means the default (one browser context for the whole scan).
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repoRoot, 'packages', 'cli', 'dist', 'cli.mjs');
const require = createRequire(import.meta.url);
const ENGINE_SETS = { axe: 'axe', all: 'axe,htmlcs,ibm,lighthouse' };

export function parseBenchArgs(argv) {
  const opts = { pages: 500, concurrency: [1, 2, 4], engines: ['axe', 'all'], recycleEvery: [0], out: 'docs/perf', name: 'chromium-bench', maxRunMs: 900_000 };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split('=', 2);
    const value = inline ?? argv[++i];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    const list = () => value.split(',').map((v) => v.trim()).filter(Boolean);
    if (flag === '--pages') opts.pages = Number(value);
    else if (flag === '--concurrency') opts.concurrency = list().map(Number);
    else if (flag === '--engines') opts.engines = list();
    else if (flag === '--recycle-every') opts.recycleEvery = list().map(Number);
    else if (flag === '--out') opts.out = value;
    else if (flag === '--name') opts.name = value;
    else if (flag === '--max-run-ms') opts.maxRunMs = Number(value);
    else throw new Error(`Unknown option ${flag}`);
  }
  if (!Number.isInteger(opts.pages) || opts.pages < 1 || opts.pages > 1000) throw new Error('--pages must be 1–1000');
  if (opts.concurrency.some((c) => !Number.isInteger(c) || c < 1 || c > 8)) throw new Error('--concurrency values must be 1–8');
  if (opts.engines.some((e) => !(e in ENGINE_SETS))) throw new Error('--engines values must be axe or all');
  if (opts.recycleEvery.some((n) => !Number.isInteger(n) || n < 0 || n > 1000)) throw new Error('--recycle-every values must be 0–1000');
  return opts;
}

/** Deterministic fixture page: a shared layout plus a few known axe violations. */
export function fixturePage(index, total) {
  const nav = Array.from({ length: 8 }, (_, i) => `<li><a href="/p/${(index + i + 1) % total || 1}">Related ${i}</a></li>`).join('');
  const rows = Array.from({ length: 20 }, (_, i) => `<tr><td>Item ${index}-${i}</td><td>${(index * 31 + i * 7) % 997}</td></tr>`).join('');
  const links = index === 0 ? `<ul>${Array.from({ length: total - 1 }, (_, i) => `<li><a href="/p/${i + 1}">Page ${i + 1}</a></li>`).join('')}</ul>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fixture page ${index}</title>
<style>body{font-family:sans-serif}.low{color:#aaa;background:#fff}</style></head>
<body><header><nav aria-label="Main"><ul>${nav}</ul></nav></header>
<main><h1>Fixture page ${index}</h1>
<p>Generated benchmark content for page ${index}. ${'Lorem ipsum dolor sit amet. '.repeat(20)}</p>
${index % 3 === 0 ? '<img src="/pixel.png">' : '<img src="/pixel.png" alt="decorative pixel">'}
${index % 4 === 0 ? '<p class="low">Low contrast note</p>' : ''}
<form><label for="q${index}">Search</label><input id="q${index}" name="q">${index % 5 === 0 ? '<input name="unlabelled">' : ''}<button>Go</button></form>
<table><caption>Data ${index}</caption><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table>
${links}</main><footer><p>Footer ${index}</p></footer></body></html>`;
}

const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

export async function startFixture(total) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('User-agent: *\nAllow: /\n'); return; }
    if (url.pathname === '/pixel.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(PIXEL); return; }
    const match = url.pathname === '/' ? 0 : /^\/p\/(\d+)$/.exec(url.pathname)?.[1];
    const index = match === undefined ? -1 : Number(match);
    if (index < 0 || index >= total) { res.writeHead(404, { 'content-type': 'text/html' }); res.end('<!doctype html><title>404</title>'); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(fixturePage(index, total));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

/** Process table snapshot: pid -> { ppid, rssBytes, command }. */
function processTable() {
  const out = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss=,comm='], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const table = new Map();
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (m) table.set(Number(m[1]), { ppid: Number(m[2]), rssBytes: Number(m[3]) * 1024, command: m[4] });
  }
  return table;
}

export function treeRss(table, rootPid) {
  const children = new Map();
  for (const [pid, info] of table) { if (!children.has(info.ppid)) children.set(info.ppid, []); children.get(info.ppid).push(pid); }
  let browser = 0; let processes = 0;
  const stack = [...(children.get(rootPid) ?? [])];
  while (stack.length) {
    const pid = stack.pop();
    browser += table.get(pid)?.rssBytes ?? 0;
    processes += 1;
    stack.push(...(children.get(pid) ?? []));
  }
  return { node: table.get(rootPid)?.rssBytes ?? 0, browser, processes };
}

const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const MB = (bytes) => Math.round(bytes / 1024 / 1024);

async function runOne({ origin, pages, engines, concurrency, recycleEvery, maxRunMs }) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'a11ygate-bench-'));
  const jsonPath = path.join(tmp, 'scan.json');
  const args = [cli, 'scan', `${origin}/`, '--max-pages', String(pages), '--concurrency', String(concurrency), '--delay-ms', '0',
    '--engines', ENGINE_SETS[engines], '--fail-on', 'none', '--json', jsonPath, '--markdown', path.join(tmp, 'scan.md'),
    ...(recycleEvery ? ['--recycle-every', String(recycleEvery)] : [])];
  const started = performance.now();
  const child = spawn(process.execPath, args, { cwd: repoRoot, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, NODE_OPTIONS: '' } });
  let started_pages = 0; let stderrTail = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    started_pages += (chunk.match(/^Scanning /gm) ?? []).length;
    stderrTail = (stderrTail + chunk).slice(-4000);
  });
  const samples = [];
  let peak = { node: 0, browser: 0, total: 0, processes: 0 };
  let timedOut = false;
  const sampler = setInterval(() => {
    try {
      const rss = treeRss(processTable(), child.pid);
      const total = rss.node + rss.browser;
      samples.push({ t: Math.round(performance.now() - started), pagesStarted: started_pages, node: rss.node, browser: rss.browser, total });
      peak = { node: Math.max(peak.node, rss.node), browser: Math.max(peak.browser, rss.browser), total: Math.max(peak.total, total), processes: Math.max(peak.processes, rss.processes) };
    } catch { /* ps can race with process exit. */ }
  }, 250);
  const killer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, maxRunMs);
  const exitCode = await new Promise((resolve) => child.once('exit', (code, signal) => resolve(code ?? signal)));
  clearInterval(sampler); clearTimeout(killer);
  const elapsedMs = performance.now() - started;
  let report;
  try { report = JSON.parse(await readFile(jsonPath, 'utf8')); } catch { report = undefined; }
  await rm(tmp, { recursive: true, force: true });
  const pageRecords = report?.pages ?? [];
  const complete = pageRecords.filter((p) => p.scanStatus === 'complete').length;
  const engineErrors = (report?.engineResults ?? []).filter((e) => e.status === 'errored');
  const errorKinds = {};
  for (const p of pageRecords.filter((p) => p.scanStatus !== 'complete')) errorKinds[p.error ?? p.scanStatus] = (errorKinds[p.error ?? p.scanStatus] ?? 0) + 1;
  for (const e of engineErrors) { const key = `${e.engine}: ${String(e.error).split('\n')[0].slice(0, 120)}`; errorKinds[key] = (errorKinds[key] ?? 0) + 1; }
  // Growth: mean browser RSS while the first vs last fifth of pages were being started.
  const fifth = Math.max(1, Math.floor(pages / 5));
  const early = samples.filter((s) => s.pagesStarted > 0 && s.pagesStarted <= fifth).map((s) => s.browser);
  const late = samples.filter((s) => s.pagesStarted > pages - fifth && s.pagesStarted <= pages).map((s) => s.browser);
  return {
    engines, engineIds: ENGINE_SETS[engines], concurrency, recycleEvery: recycleEvery || null, pagesRequested: pages,
    exitCode, timedOut, elapsedMs: Math.round(elapsedMs),
    pagesRecorded: pageRecords.length, pagesComplete: complete, pageFailures: pageRecords.length - complete, engineErrors: engineErrors.length,
    pagesPerMinute: Math.round((complete / (elapsedMs / 60_000)) * 10) / 10,
    peakRssBytes: { node: peak.node, browser: peak.browser, total: peak.total }, peakProcesses: peak.processes,
    browserRssEarlyMeanBytes: Math.round(mean(early)), browserRssLateMeanBytes: Math.round(mean(late)),
    browserRssGrowthBytes: early.length && late.length ? Math.round(mean(late) - mean(early)) : null,
    samples: samples.length, errorKinds,
    ...(report ? {} : { stderrTail: stderrTail.slice(-800) }),
  };
}

function sh(cmd, args) { try { return execFileSync(cmd, args, { encoding: 'utf8' }).trim(); } catch { return null; } }

async function machineSpec() {
  const playwright = await import('playwright');
  const browser = await playwright.chromium.launch({ headless: true });
  const chromium = browser.version();
  await browser.close();
  const pkgVersion = (name) => { try { return JSON.parse(require('fs').readFileSync(require.resolve(`${name}/package.json`), 'utf8')).version; } catch { return null; } };
  return {
    model: sh('sysctl', ['-n', 'hw.model']) ?? os.platform(),
    cpu: sh('sysctl', ['-n', 'machdep.cpu.brand_string']) ?? os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    ramBytes: os.totalmem(),
    os: process.platform === 'darwin' ? `macOS ${sh('sw_vers', ['-productVersion'])} (${sh('sw_vers', ['-buildVersion'])})` : `${os.type()} ${os.release()}`,
    node: process.version,
    chromium: `${chromium} (Playwright headless shell)`,
    playwright: pkgVersion('playwright'),
    axeCore: pkgVersion('axe-core'),
  };
}

function markdown(result) {
  const m = result.machine;
  const lines = [
    '# Chromium memory and runtime benchmark',
    '',
    `Recorded ${result.recordedAt} with \`npm run bench -- ${result.argv.join(' ')}\`. Every number below comes from that recorded run (raw data: \`${result.name}.json\`); none are estimated.`,
    '',
    '## Machine',
    '',
    `- Model: ${m.model}`,
    `- CPU: ${m.cpu} (${m.logicalCpus} logical cores)`,
    `- RAM: ${MB(m.ramBytes) / 1024} GiB`,
    `- OS: ${m.os}`,
    `- Node.js: ${m.node}`,
    `- Chromium: ${m.chromium}; Playwright ${m.playwright}; axe-core ${m.axeCore}`,
    '',
    '## Results',
    '',
    'Fixture: generated loopback site (start page linking to every other page; each page has a shared layout, a 20-row table and a few known axe violations). `--delay-ms 0`, `--fail-on none`.',
    'Peak RSS is sampled every 250 ms with `ps`: Node is the CLI process, Chromium is the sum of all its descendant processes. Growth is mean Chromium RSS while the last fifth of pages started minus the first fifth.',
    '',
    '| Engines | Concurrency | Recycle every | Pages complete / requested | Failures (pages / engine errors) | Wall time (s) | Pages/min | Peak RSS Node (MB) | Peak RSS Chromium (MB) | Peak RSS total (MB) | Chromium RSS growth (MB) |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...result.runs.map((r) => `| ${r.engineIds} | ${r.concurrency} | ${r.recycleEvery ?? '—'} | ${r.pagesComplete} / ${r.pagesRequested} | ${r.pageFailures} / ${r.engineErrors}${r.timedOut ? ' (timed out)' : ''} | ${(r.elapsedMs / 1000).toFixed(1)} | ${r.pagesPerMinute} | ${MB(r.peakRssBytes.node)} | ${MB(r.peakRssBytes.browser)} | ${MB(r.peakRssBytes.total)} | ${r.browserRssGrowthBytes === null ? 'n/a' : MB(r.browserRssGrowthBytes)} |`),
    '',
  ];
  const failing = result.runs.filter((r) => Object.keys(r.errorKinds).length);
  if (failing.length) {
    lines.push('### Failure reasons', '');
    for (const r of failing) lines.push(`- ${r.engineIds}, concurrency ${r.concurrency}${r.recycleEvery ? `, recycle ${r.recycleEvery}` : ''}: ${Object.entries(r.errorKinds).map(([k, v]) => `${v}× ${k}`).join('; ')}`);
    lines.push('');
  }
  return lines.join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const opts = parseBenchArgs(argv);
  if (!existsSync(cli)) throw new Error('Build the CLI first: npm run cli:build');
  const machine = await machineSpec();
  const { server, origin } = await startFixture(opts.pages);
  const runs = [];
  try {
    for (const engines of opts.engines) for (const concurrency of opts.concurrency) for (const recycleEvery of opts.recycleEvery) {
      process.stderr.write(`bench: ${engines} c=${concurrency} recycle=${recycleEvery || 'off'} pages=${opts.pages} ... `);
      const run = await runOne({ origin, pages: opts.pages, engines, concurrency, recycleEvery, maxRunMs: opts.maxRunMs });
      process.stderr.write(`${run.pagesComplete}/${opts.pages} in ${(run.elapsedMs / 1000).toFixed(1)}s, peak ${MB(run.peakRssBytes.total)} MB\n`);
      runs.push(run);
    }
  } finally { server.close(); }
  const result = { name: opts.name, recordedAt: new Date().toISOString(), argv, machine, fixture: { pages: opts.pages, loopback: true }, runs };
  const outDir = path.resolve(repoRoot, opts.out);
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, `${opts.name}.json`), `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(path.join(outDir, `${opts.name}.md`), markdown(result));
  process.stderr.write(`bench: wrote ${path.join(opts.out, `${opts.name}.json`)} and .md\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`bench failed: ${error.message}\n`); process.exit(1); });
}
