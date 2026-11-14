import { createHash } from 'node:crypto';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { cell } from '@/lib/export-markdown';
import { toJunit } from '@/lib/export-junit';
import { toSarif } from '@/lib/export-sarif';
import { formatReportFromScan } from '@/lib/report-formats';
import { scanHtml, scanMarkdown, type ScanReport } from '@/lib/scan/report';
import { createZip, type ZipEntry } from './zip';

export const EVIDENCE_DISCLAIMER = AUTOMATED_TESTING_DISCLAIMER;

/** Shown on every evidence-pack front page. Wording avoids any conformance or compliance claim. */
export const AUTOMATED_LIMITS = [
  'Most WCAG success criteria need human judgement. Automated rules detect only a subset of accessibility barriers, so an empty findings list is not evidence of conformance.',
  'Whether text alternatives, form labels, headings, link text and page titles are accurate and meaningful. Tools can only check that they exist.',
  'Keyboard operability across complete user journeys, logical focus order, visible focus in context and keyboard traps that appear after interaction.',
  'The experience with screen readers, magnifiers, voice control and other assistive technology.',
  'Content behind login, forms, multi-step flows, error states, menus, dialogs and other states that a read-only page load does not trigger.',
  'Pages that were not reached: not linked through same-origin a[href] links, beyond the crawl cap, disallowed by robots.txt, or failed to load.',
  'Captions, transcripts and audio description for time-based media, and whether they are correct.',
  'Cognitive and learning accessibility: plain language, consistent navigation, timing, and error prevention and recovery.',
  'Reflow, zoom, orientation and user style or contrast settings beyond what individual rules check.',
  'Documents (PDF, office files), native apps, emails and third-party services that were not rendered in the scanned pages.',
] as const;

export type PackFileSource = 'copied' | 'generated';

export type PackInputFile = { path: string; data: Uint8Array; source: PackFileSource };

export type CommitInfo =
  | { sha: string; source: 'flag' | 'git' }
  | { sha: null; source: 'unavailable'; note: string };

export const COMMIT_UNAVAILABLE_NOTE =
  'Commit SHA unavailable: it was not passed with --commit and could not be read from a git work tree. No SHA was invented.';

export type EngineManifestEntry = {
  id: string;
  status: 'complete' | 'errored' | 'unknown';
  version: string | null;
  ruleSet: { name: string; version: string | null; tags?: string[] };
};

export type EvidenceManifest = {
  tool: 'a11ygate';
  kind: 'evidence-pack';
  schemaVersion: 1;
  releaseStatus: 'released';
  toolVersion: string;
  scanToolVersion: string;
  commit: CommitInfo;
  timestamps: { timezone: 'UTC'; packedAt: string; scannedAt: string | null };
  scope: {
    startUrl: string;
    origin: string;
    pagesScanned: number;
    pagesFailed: number;
    skippedLinks: number;
    maxPages: number;
    pages: { url: string; status: number | null; scanStatus: string }[];
  };
  engines: EngineManifestEntry[];
  disclaimer: string;
  hashAlgorithm: 'sha256';
  files: { path: string; bytes: number; sha256: string; source: PackFileSource }[];
};

export const MAX_PACK_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_PACK_TOTAL_BYTES = 256 * 1024 * 1024;

export function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function toUtcIso(value: string | undefined | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const RULE_SETS: Record<string, string> = {
  axe: 'axe-core rules filtered by tags',
  htmlcs: 'HTML_CodeSniffer WCAG2AA standard',
  ibm: 'IBM Equal Access IBM_Accessibility policy (engine-bundled rules)',
  lighthouse: 'Lighthouse accessibility category',
};

function recordedEngineVersion(report: ScanReport, id: string): string | null {
  for (const result of report.engineResults ?? []) {
    if (result.engine !== id || result.status !== 'complete') continue;
    for (const finding of result.findings) {
      const version = finding.compatibility?.engineVersion;
      if (typeof version === 'string' && version) return version;
    }
  }
  return null;
}

export function engineManifest(report: ScanReport, engineFiles: readonly string[]): EngineManifestEntry[] {
  const ids = new Set<string>();
  for (const id of report.engines?.used ?? []) ids.add(id);
  for (const error of report.engines?.errored ?? []) ids.add(error.engine);
  for (const file of engineFiles) ids.add(file);
  if (ids.size === 0 && (report.axeVersion || report.results.length > 0)) ids.add('axe');
  return [...ids].sort().map((id) => {
    const errored = report.engines?.errored.some((e) => e.engine === id) ?? false;
    const used = report.engines ? report.engines.used.includes(id) : id === 'axe';
    const version = id === 'axe' ? report.axeVersion ?? recordedEngineVersion(report, id) : recordedEngineVersion(report, id);
    return {
      id,
      status: used ? 'complete' : errored ? 'errored' : 'unknown',
      version,
      ruleSet: {
        name: RULE_SETS[id] ?? `${id} rules`,
        version,
        ...(id === 'axe' ? { tags: [...report.options.tags] } : {}),
      },
    };
  });
}

// ---------- secret guard ----------

const SECRET_PATTERNS: [string, RegExp][] = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}/],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['API key', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/],
  ['npm token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['URL credentials', /\bhttps?:\/\/[^\s/:@"'<>]+:[^\s/@"'<>]+@/i],
  ['credential query parameter', /[?&](?:access_token|id_token|token|api_key|apikey|password|passwd|secret|client_secret)=[^&\s"'<>]+/i],
  ['bearer token', /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/],
];

const SECRET_ENV_NAME = /(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|API_?KEY|ACCESS_?KEY|AUTH)/i;

export type EnvLike = Record<string, string | undefined>;

/** Values of secret-looking environment variables. Used only for comparison, never written. */
export function secretEnvValues(env: EnvLike = process.env): string[] {
  return Object.entries(env)
    .filter(([name, value]) => SECRET_ENV_NAME.test(name) && typeof value === 'string' && value.length >= 8)
    .map(([, value]) => value as string);
}

function isTextPath(path: string): boolean {
  return /\.(json|md|html|xml|sarif|txt)$/i.test(path);
}

/** Returns the first problem as "<file>: <kind>" without echoing the matched value. */
export function findSecret(files: readonly { path: string; data: Uint8Array }[], envValues: readonly string[]): string | null {
  for (const file of files) {
    const text = Buffer.from(file.data).toString(isTextPath(file.path) ? 'utf8' : 'latin1');
    if (isTextPath(file.path)) {
      for (const [kind, pattern] of SECRET_PATTERNS) if (pattern.test(text)) return `${file.path}: ${kind}`;
    }
    if (envValues.some((value) => text.includes(value))) return `${file.path}: value of a secret environment variable`;
  }
  return null;
}

// ---------- front page ----------

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function code(value: string): string {
  return '`' + value.replace(/`/g, "'").replace(/[\r\n|]/g, ' ') + '`';
}

type FrontPageInput = { report: ScanReport; engines: EngineManifestEntry[]; commit: CommitInfo; contents: string[] };

function commitText(commit: CommitInfo): string {
  return commit.sha ? `${commit.sha} (${commit.source === 'flag' ? 'passed with --commit' : 'read from git'})` : 'unavailable (not recorded; none was invented)';
}

function engineText(engine: EngineManifestEntry): string {
  return `${engine.id} ${engine.version ?? '(version not recorded)'} — ${engine.ruleSet.name}${engine.ruleSet.tags ? ` [${engine.ruleSet.tags.join(', ')}]` : ''}${engine.status === 'errored' ? ' — errored' : ''}`;
}

export function frontPageMarkdown({ report, engines, commit, contents }: FrontPageInput): string {
  const severities = ['critical', 'serious', 'moderate', 'minor', 'unknown'] as const;
  return [
    `# A11yGate evidence pack — ${cell(report.startUrl)}`,
    '',
    `> ${EVIDENCE_DISCLAIMER}`,
    '',
    '## Scope scanned',
    '',
    `- Start URL: ${code(report.startUrl)}`,
    `- Origin: ${code(report.origin)}`,
    `- Scanned at (UTC): ${toUtcIso(report.scannedAt) ?? 'not recorded'}`,
    `- Commit: ${commitText(commit)}`,
    `- Pages analysed: ${report.counts.pagesScanned}; failed: ${report.counts.pagesFailed}; links not followed: ${report.counts.skippedLinks}; crawl cap: ${report.options.maxPages}`,
    `- robots.txt: ${cell(report.options.robots)}`,
    `- Engines and rule sets: ${engines.length ? engines.map(engineText).map(cell).join('; ') : 'none recorded'}`,
    '',
    '| Page | HTTP | Status | Findings |',
    '| --- | --- | --- | --- |',
    ...report.pages.map((p) => `| ${cell(p.url)} | ${p.status ?? '—'} | ${p.scanStatus}${p.error ? ' — ' + cell(p.error) : ''} | ${p.findings} |`),
    '',
    '## Automated result',
    '',
    `Verdict: **${report.verdict}** (fail on: ${report.failOn}). ${cell(report.reason)}`,
    '',
    '| Severity | Findings |',
    '| --- | --- |',
    ...severities.map((k) => `| ${k} | ${report.counts.byImpact[k]} |`),
    '',
    'Full findings: `scan/a11ygate-scan.md` and `scan/a11ygate-scan.html`.',
    '',
    '## What automated testing cannot cover',
    '',
    'This pack records what automated rules detected on the pages listed above. It does not assess:',
    '',
    ...AUTOMATED_LIMITS.map((item) => `- ${item}`),
    '',
    'Manual testing by people, including people with disabilities and assistive technology users, is needed for these areas.',
    '',
    '## Scope boundaries',
    '',
    ...report.boundaries.map((b) => `- ${cell(b)}`),
    '',
    '## Contents of this pack',
    '',
    ...contents.map((file) => `- ${code(file)}`),
    '- `manifest.json` — versions, commit, UTC timestamps and the SHA-256 of every other file',
    '',
    EVIDENCE_DISCLAIMER,
    '',
  ].join('\n');
}

export function frontPageHtml({ report, engines, commit, contents }: FrontPageInput): string {
  const severities = ['critical', 'serious', 'moderate', 'minor', 'unknown'] as const;
  const pages = report.pages
    .map((p) => `<tr><td><code>${esc(p.url)}</code></td><td>${p.status ?? '—'}</td><td>${esc(p.scanStatus)}${p.error ? ' — ' + esc(p.error) : ''}</td><td>${p.findings}</td></tr>`)
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>A11yGate evidence pack — ${esc(report.startUrl)}</title>
<style>
body{font:16px/1.5 system-ui,sans-serif;max-width:60rem;margin:0 auto;padding:1rem;color:#1a1a1a;background:#fff}
code{background:#f2f2f2;padding:0 .2em;word-break:break-all}
table{border-collapse:collapse;margin:1rem 0}th,td{border:1px solid #767676;padding:.25rem .5rem;text-align:left}
.disclaimer{border:2px solid #1a1a1a;padding:.5rem 1rem;font-weight:600}
a{color:#0b57d0}
</style>
</head>
<body>
<main>
<h1>A11yGate evidence pack</h1>
<p class="disclaimer">${esc(EVIDENCE_DISCLAIMER)}</p>
<h2>Scope scanned</h2>
<ul>
<li>Start URL: <code>${esc(report.startUrl)}</code></li>
<li>Origin: <code>${esc(report.origin)}</code></li>
<li>Scanned at (UTC): ${esc(toUtcIso(report.scannedAt) ?? 'not recorded')}</li>
<li>Commit: ${esc(commitText(commit))}</li>
<li>Pages analysed: ${report.counts.pagesScanned}; failed: ${report.counts.pagesFailed}; links not followed: ${report.counts.skippedLinks}; crawl cap: ${report.options.maxPages}</li>
<li>robots.txt: ${esc(report.options.robots)}</li>
<li>Engines and rule sets: ${engines.length ? engines.map((e) => esc(engineText(e))).join('; ') : 'none recorded'}</li>
</ul>
<table><caption>Pages</caption><thead><tr><th scope="col">Page</th><th scope="col">HTTP</th><th scope="col">Status</th><th scope="col">Findings</th></tr></thead><tbody>${pages}</tbody></table>
<h2>Automated result</h2>
<p>Verdict: <strong>${esc(report.verdict)}</strong> (fail on: ${esc(report.failOn)}). ${esc(report.reason)}</p>
<table><caption>Findings by severity</caption><thead><tr><th scope="col">Severity</th><th scope="col">Findings</th></tr></thead><tbody>${severities.map((k) => `<tr><th scope="row">${k}</th><td>${report.counts.byImpact[k]}</td></tr>`).join('')}</tbody></table>
<p>Full findings: <a href="scan/a11ygate-scan.html">detailed scan report (HTML)</a> and <code>scan/a11ygate-scan.md</code>.</p>
<h2>What automated testing cannot cover</h2>
<p>This pack records what automated rules detected on the pages listed above. It does not assess:</p>
<ul>${AUTOMATED_LIMITS.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
<p>Manual testing by people, including people with disabilities and assistive technology users, is needed for these areas.</p>
<h2>Scope boundaries</h2>
<ul>${report.boundaries.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
<h2>Contents of this pack</h2>
<ul>${contents.map((file) => `<li><code>${esc(file)}</code></li>`).join('')}<li><code>manifest.json</code> — versions, commit, UTC timestamps and the SHA-256 of every other file</li></ul>
<p>${esc(EVIDENCE_DISCLAIMER)}</p>
</main>
</body>
</html>
`;
}

// ---------- pack ----------

export type PackInput = {
  /** Text of a11ygate-scan.json. */
  scanJson: string;
  /** Optional files copied from the scan output directory, keyed by pack path. */
  files: PackInputFile[];
  toolVersion: string;
  commit: CommitInfo;
  packedAt: Date;
  envValues?: readonly string[];
};

export type PackResult = { ok: true; zip: Buffer; manifest: EvidenceManifest; entries: ZipEntry[] } | { ok: false; error: string };

export function parseScanReport(text: string): ScanReport | null {
  try {
    const parsed = JSON.parse(text) as Partial<ScanReport>;
    if (parsed?.tool !== 'a11ygate' || parsed.kind !== 'site-scan' || !Array.isArray(parsed.pages) || !Array.isArray(parsed.findings) || !parsed.counts || !parsed.options) return null;
    return parsed as ScanReport;
  } catch {
    return null;
  }
}

export function buildEvidencePack(input: PackInput): PackResult {
  const report = parseScanReport(input.scanJson);
  if (!report) return { ok: false, error: 'a11ygate-scan.json is not an A11yGate site-scan report.' };

  const files = new Map<string, PackInputFile>();
  files.set('scan/a11ygate-scan.json', { path: 'scan/a11ygate-scan.json', data: Buffer.from(input.scanJson, 'utf8'), source: 'copied' });
  for (const file of input.files) files.set(file.path, file);
  const formatReport = formatReportFromScan(report);
  const generated: [string, () => string][] = [
    ['scan/a11ygate-scan.md', () => scanMarkdown(report)],
    ['scan/a11ygate-scan.html', () => scanHtml(report)],
    ['scan/a11ygate-scan.sarif', () => toSarif(formatReport)],
    ['scan/a11ygate-scan.junit.xml', () => toJunit(formatReport)],
  ];
  for (const [path, make] of generated) {
    if (!files.has(path)) files.set(path, { path, data: Buffer.from(make(), 'utf8'), source: 'generated' });
  }

  const engineFiles = [...files.keys()].flatMap((p) => /^engines\/([a-z]+)\.json$/.exec(p)?.[1] ?? []);
  const engines = engineManifest(report, engineFiles);
  const contentPaths = ['report.md', 'report.html', ...[...files.keys()].sort()];
  const front = { report, engines, commit: input.commit, contents: contentPaths };
  files.set('report.md', { path: 'report.md', data: Buffer.from(frontPageMarkdown(front), 'utf8'), source: 'generated' });
  files.set('report.html', { path: 'report.html', data: Buffer.from(frontPageHtml(front), 'utf8'), source: 'generated' });

  const ordered = contentPaths.map((p) => files.get(p)!);
  let total = 0;
  for (const file of ordered) {
    if (file.data.length > MAX_PACK_FILE_BYTES) return { ok: false, error: `${file.path} is larger than ${MAX_PACK_FILE_BYTES / 1024 / 1024} MB.` };
    total += file.data.length;
  }
  if (total > MAX_PACK_TOTAL_BYTES) return { ok: false, error: `Evidence pack inputs exceed ${MAX_PACK_TOTAL_BYTES / 1024 / 1024} MB.` };

  const secret = findSecret(ordered, input.envValues ?? []);
  if (secret) return { ok: false, error: `Refusing to pack: ${secret} looks like a credential or environment secret. Remove it and re-run.` };

  const manifest: EvidenceManifest = {
    tool: 'a11ygate',
    kind: 'evidence-pack',
    schemaVersion: 1,
    releaseStatus: 'released',
    toolVersion: input.toolVersion,
    scanToolVersion: report.version,
    commit: input.commit,
    timestamps: { timezone: 'UTC', packedAt: input.packedAt.toISOString(), scannedAt: toUtcIso(report.scannedAt) },
    scope: {
      startUrl: report.startUrl,
      origin: report.origin,
      pagesScanned: report.counts.pagesScanned,
      pagesFailed: report.counts.pagesFailed,
      skippedLinks: report.counts.skippedLinks,
      maxPages: report.options.maxPages,
      pages: report.pages.map((p) => ({ url: p.url, status: p.status, scanStatus: p.scanStatus })),
    },
    engines,
    disclaimer: EVIDENCE_DISCLAIMER,
    hashAlgorithm: 'sha256',
    files: ordered.map((file) => ({ path: file.path, bytes: file.data.length, sha256: sha256(file.data), source: file.source })),
  };
  const manifestData = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const entries: ZipEntry[] = [{ path: 'manifest.json', data: manifestData }, ...ordered.map((f) => ({ path: f.path, data: f.data }))];
  return { ok: true, zip: createZip(entries), manifest, entries };
}
