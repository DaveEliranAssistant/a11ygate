import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import type { EvidenceManifest } from '@/lib/evidence/pack';
import { applyFingerprintBaseline, createFingerprintBaseline, type FingerprintBaseline } from '@/lib/scan/baseline';
import type { ScanReport } from '@/lib/scan/report';
import { normalizeUrl } from '@/lib/scan/url';

/**
 * Trend report across evidence packs (A11Y-R42). Pure and offline: callers pass
 * already-read manifests and scan reports. Counting reuses the R18 fingerprint
 * baseline: each run is deduped by baseline fingerprint, then compared with the
 * previous run as if that run were the baseline.
 */

export type TrendRunInput = { source: string; manifest: EvidenceManifest; report: ScanReport };

export type TrendRun = {
  /** File or directory name of the evidence pack, relative to the trend input directory. */
  source: string;
  /** Ordering key: manifest.timestamps.scannedAt, falling back to packedAt (UTC). */
  timestamp: string;
  commit: string | null;
  startUrl: string;
  verdict: ScanReport['verdict'];
  pagesScanned: number;
  /** Findings after R18 fingerprint dedupe. Always equals new + existing. */
  total: number;
  /** Not present in the previous run. On the first run every finding is new. */
  new: number;
  existing: number;
  /** Present in the previous run, absent now, on a page this run scanned completely with comparable engines. */
  fixed: number;
  /** Present in the previous run, absent now, but not assessable (page not scanned completely or engines differ/errored). */
  unassessed: number;
  /** Source of the previous run, or null for the first run. */
  comparedWith: string | null;
};

export type TrendRule = { ruleId: string; total: number; perRun: number[] };
export type TrendPage = { pageUrl: string; regressions: number; runsWithRegressions: number };

export type TrendReport = {
  tool: 'a11ygate';
  kind: 'trend-report';
  schemaVersion: 1;
  disclaimer: string;
  orderedBy: 'manifest.timestamps.scannedAt (fallback packedAt), then commit SHA, then source';
  runs: TrendRun[];
  topRules: TrendRule[];
  regressionPages: TrendPage[];
  notes: string[];
};

export const TREND_TOP_LIMIT = 10;

function runTimestamp(manifest: EvidenceManifest): string {
  return manifest.timestamps.scannedAt ?? manifest.timestamps.packedAt;
}

/** Stable ordering by manifest timestamp; ties broken by commit SHA then source name. */
export function orderTrendInputs(inputs: readonly TrendRunInput[]): TrendRunInput[] {
  const key = (input: TrendRunInput) => Date.parse(runTimestamp(input.manifest));
  return [...inputs].sort((a, b) =>
    key(a) - key(b)
    || Date.parse(a.manifest.timestamps.packedAt) - Date.parse(b.manifest.timestamps.packedAt)
    || (a.manifest.commit.sha ?? '').localeCompare(b.manifest.commit.sha ?? '')
    || a.source.localeCompare(b.source));
}

function pageKey(url: string): string {
  return normalizeUrl(url) ?? url;
}

export function buildTrend(inputs: readonly TrendRunInput[]): TrendReport {
  const ordered = orderTrendInputs(inputs);
  const runs: TrendRun[] = [];
  const ruleCounts = new Map<string, number[]>();
  const pages = new Map<string, { regressions: number; runs: number }>();
  let previous: { source: string; baseline: FingerprintBaseline } | null = null;

  ordered.forEach((input, index) => {
    const baseline = createFingerprintBaseline(input.report);
    const current = baseline.findings;
    for (const entry of current) {
      const counts = ruleCounts.get(entry.ruleId) ?? new Array<number>(ordered.length).fill(0);
      counts[index]! += 1;
      ruleCounts.set(entry.ruleId, counts);
    }
    let added = current.length;
    let fixed = 0;
    let unassessed = 0;
    if (previous) {
      const known = new Set(previous.baseline.findings.map((f) => f.fingerprint));
      const fresh = current.filter((f) => !known.has(f.fingerprint));
      added = fresh.length;
      // R18 decides fixed vs unassessed; reuse it rather than re-deriving the rule.
      const summary = applyFingerprintBaseline(input.report, previous.baseline).baseline!;
      fixed = summary.fixed;
      unassessed = summary.unassessed;
      const perPage = new Map<string, number>();
      for (const f of fresh) perPage.set(pageKey(f.pageUrl), (perPage.get(pageKey(f.pageUrl)) ?? 0) + 1);
      for (const [url, count] of perPage) {
        const page = pages.get(url) ?? { regressions: 0, runs: 0 };
        page.regressions += count;
        page.runs += 1;
        pages.set(url, page);
      }
    }
    runs.push({
      source: input.source,
      timestamp: runTimestamp(input.manifest),
      commit: input.manifest.commit.sha,
      startUrl: input.report.startUrl,
      verdict: input.report.verdict,
      pagesScanned: input.report.counts.pagesScanned,
      total: current.length,
      new: added,
      existing: current.length - added,
      fixed,
      unassessed,
      comparedWith: previous?.source ?? null,
    });
    previous = { source: input.source, baseline };
  });

  const topRules = [...ruleCounts]
    .map(([ruleId, perRun]) => ({ ruleId, total: perRun.reduce((a, b) => a + b, 0), perRun }))
    .sort((a, b) => b.total - a.total || a.ruleId.localeCompare(b.ruleId))
    .slice(0, TREND_TOP_LIMIT);
  const regressionPages = [...pages]
    .map(([pageUrl, p]) => ({ pageUrl, regressions: p.regressions, runsWithRegressions: p.runs }))
    .sort((a, b) => b.regressions - a.regressions || a.pageUrl.localeCompare(b.pageUrl))
    .slice(0, TREND_TOP_LIMIT);

  const notes = ['The first run has no earlier run to compare with, so every finding in it counts as new and none as fixed.',
    'Regressions count findings that were new compared with the previous run; the first run is excluded.'];
  if (new Set(runs.map((r) => r.startUrl)).size > 1) notes.push('Runs have different start URLs; counts compare whatever each run scanned.');

  return {
    tool: 'a11ygate', kind: 'trend-report', schemaVersion: 1, disclaimer: AUTOMATED_TESTING_DISCLAIMER,
    orderedBy: 'manifest.timestamps.scannedAt (fallback packedAt), then commit SHA, then source',
    runs, topRules, regressionPages, notes,
  };
}

// ---------- HTML ----------

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, 7) : 'no commit';
}

function runLabel(run: TrendRun): string {
  return run.timestamp.slice(0, 10);
}

/** Stacked bars (existing + new) per run. Inline SVG, no scripts; native <title> tooltips. */
function chartSvg(runs: readonly TrendRun[]): string {
  const width = 640;
  const height = 260;
  const left = 44;
  const right = 12;
  const top = 16;
  const bottom = 48;
  const plotH = height - top - bottom;
  const plotW = width - left - right;
  const rawMax = Math.max(1, ...runs.map((r) => r.total));
  const step = Math.max(1, Math.ceil(rawMax / 4));
  const max = step * 4;
  const slot = plotW / Math.max(1, runs.length);
  const barW = Math.min(48, slot * 0.6);
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const grid = [0, 1, 2, 3, 4].map((i) => {
    const v = i * step;
    return `<line class="grid" x1="${left}" x2="${width - right}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${left - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  }).join('');
  const bars = runs.map((run, i) => {
    const x = left + slot * i + (slot - barW) / 2;
    const tip = `${runLabel(run)} (${shortSha(run.commit)}): ${run.total} findings — ${run.new} new, ${run.existing} existing, ${run.fixed} fixed`;
    const existingH = (run.existing / max) * plotH;
    const newH = (run.new / max) * plotH;
    const gap = existingH > 0 && newH > 0 ? 2 : 0;
    const existing = existingH > 0 ? `<rect class="s-existing" x="${x}" y="${y(run.existing)}" width="${barW}" height="${existingH}"/>` : '';
    const added = newH > 0 ? `<rect class="s-new" x="${x}" y="${y(run.total)}" width="${barW}" height="${Math.max(0, newH - gap)}"/>` : '';
    return `<g><title>${esc(tip)}</title>${existing}${added}<rect class="hit" x="${left + slot * i}" y="${top}" width="${slot}" height="${plotH}"/>`
      + `<text class="value" x="${x + barW / 2}" y="${y(run.total) - 4}" text-anchor="middle">${run.total}</text>`
      + `<text class="axis" x="${x + barW / 2}" y="${height - bottom + 16}" text-anchor="middle">${esc(runLabel(run))}</text>`
      + `<text class="axis" x="${x + barW / 2}" y="${height - bottom + 30}" text-anchor="middle">${esc(shortSha(run.commit))}</text></g>`;
  }).join('');
  return `<svg role="img" aria-labelledby="chart-title chart-desc" viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMinYMin meet">`
    + `<title id="chart-title">Findings per run</title><desc id="chart-desc">Stacked bars of existing and new findings for each run, oldest first. The same numbers are in the table below.</desc>`
    + `${grid}${bars}</svg>`;
}

export function renderTrendHtml(trend: TrendReport): string {
  const runs = trend.runs;
  const runRows = runs.map((r) => `<tr><th scope="row">${esc(r.timestamp)}</th><td><code>${esc(shortSha(r.commit))}</code></td><td>${esc(r.source)}</td><td>${r.total}</td><td>${r.new}</td><td>${r.existing}</td><td>${r.fixed}</td><td>${r.unassessed}</td><td>${esc(r.verdict)}</td></tr>`).join('');
  const ruleHead = runs.map((r) => `<th scope="col">${esc(runLabel(r))} <span class="muted">${esc(shortSha(r.commit))}</span></th>`).join('');
  const ruleRows = trend.topRules.map((rule) => `<tr><th scope="row"><code>${esc(rule.ruleId)}</code></th>${rule.perRun.map((n) => `<td>${n}</td>`).join('')}<td>${rule.total}</td></tr>`).join('');
  const pageRows = trend.regressionPages.map((p) => `<tr><th scope="row"><code>${esc(p.pageUrl)}</code></th><td>${p.regressions}</td><td>${p.runsWithRegressions}</td></tr>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>A11yGate trend report</title>
<style>
:root{color-scheme:light;--surface:#fcfcfb;--text:#0b0b0b;--muted:#52514e;--grid:#e4e3df;--border:#767676;--existing:#2a78d6;--new:#eb6834;--code:#f0efec}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--surface:#1a1a19;--text:#f0efec;--muted:#c3c2b7;--grid:#3a3a37;--border:#8f8e88;--existing:#3987e5;--new:#d95926;--code:#2a2a28}}
body{font:16px/1.5 system-ui,sans-serif;max-width:64rem;margin:0 auto;padding:1rem;color:var(--text);background:var(--surface)}
code{background:var(--code);padding:0 .2em;word-break:break-all}
table{border-collapse:collapse;margin:1rem 0}th,td{border:1px solid var(--border);padding:.25rem .5rem;text-align:left}
caption{text-align:left;font-weight:600}
.disclaimer{border:2px solid var(--text);padding:.5rem 1rem;font-weight:600}
.muted{color:var(--muted);font-weight:400}
.legend{display:flex;gap:1.5rem;list-style:none;padding:0;margin:.5rem 0}
.sw-existing{background:var(--existing)}.sw-new{background:var(--new)}
.swatch{display:inline-block;width:.9em;height:.9em;border-radius:2px;margin-right:.4em;vertical-align:-.1em}
svg .grid{stroke:var(--grid);stroke-width:1}svg .axis{fill:var(--muted);font-size:11px}svg .value{fill:var(--text);font-size:12px}
svg .s-existing{fill:var(--existing)}svg .s-new{fill:var(--new)}svg .hit{fill:transparent}
.scroll{overflow-x:auto}
</style>
</head>
<body>
<main>
<h1>A11yGate trend report</h1>
<p class="disclaimer">${esc(trend.disclaimer)}</p>
<p>${runs.length} run${runs.length === 1 ? '' : 's'}, oldest first, ordered by the scan timestamp recorded in each evidence pack manifest (UTC).</p>
<h2>Findings per run</h2>
<ul class="legend"><li><span class="swatch sw-existing"></span>Existing (also in the previous run)</li><li><span class="swatch sw-new"></span>New since the previous run</li></ul>
<figure>${chartSvg(runs)}</figure>
<div class="scroll"><table><caption>Runs</caption><thead><tr><th scope="col">Scanned at (UTC)</th><th scope="col">Commit</th><th scope="col">Evidence pack</th><th scope="col">Findings</th><th scope="col">New</th><th scope="col">Existing</th><th scope="col">Fixed</th><th scope="col">Unassessed</th><th scope="col">Verdict</th></tr></thead><tbody>${runRows}</tbody></table></div>
<h2>Top rules over time</h2>
${trend.topRules.length ? `<div class="scroll"><table><caption>Findings per rule, per run (top ${TREND_TOP_LIMIT})</caption><thead><tr><th scope="col">Rule</th>${ruleHead}<th scope="col">All runs</th></tr></thead><tbody>${ruleRows}</tbody></table></div>` : '<p>No findings were recorded in any run.</p>'}
<h2>Pages with the most regressions</h2>
${trend.regressionPages.length ? `<div class="scroll"><table><caption>New findings compared with the previous run (top ${TREND_TOP_LIMIT})</caption><thead><tr><th scope="col">Page</th><th scope="col">New findings</th><th scope="col">Runs with new findings</th></tr></thead><tbody>${pageRows}</tbody></table></div>` : '<p>No page had new findings compared with its previous run.</p>'}
<h2>How to read this</h2>
<ul>${trend.notes.map((n) => `<li>${esc(n)}</li>`).join('')}<li>Findings are deduplicated with the same fingerprints as <code>a11ygate baseline create</code>. Fixed means a finding from the previous run was not detected on a page this run scanned completely; it is not proof the issue is resolved.</li></ul>
<p>${esc(trend.disclaimer)}</p>
</main>
</body>
</html>
`;
}
