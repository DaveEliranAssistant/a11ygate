// A11Y-R79 (c): host checks for the sample deliverables pack (docs/samples). Pure functions, no Chromium: used by
// e2e/samples.spec.ts on the rebuilt + committed pack and by tests/sample-hosts.test.ts (vitest, negative tests).
//
// Rule: every URL in a sample is a scanned/target URL on the demo app (http://127.0.0.1:4173/...), except URLs in
// an explicitly listed reference field/context, which may point only at that field's reference host(s).
//  - JSON entries are walked structurally; a URL is a reference only if its key is in REFERENCE_FIELDS (by key
//    name, not "any field named url") and its host is allowed for that key. Everything else must be the demo app.
//  - Text entries (HTML, Markdown, JUnit XML, PDF text, README) allow reference hosts only right after a link
//    context (href=", Markdown ](, the user agent "; +", "guidance: ").
//  - Scanned URLs are also extracted strictly from the evidence pack's structured outputs (axe results' `url`,
//    scan pages/findings, SARIF locations, manifest scope, JUnit). A missing entry or field is a problem, not a skip.
import { readZip } from '../lib/evidence/zip';

export const SAMPLE_HOST = '127.0.0.1:4173';

/** JSON keys that hold reference links (rule help, schema, tool/taxonomy info, UA contact URL) → allowed hosts. */
export const REFERENCE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  helpUrl: ['dequeuniversity.com'], // axe rule help (axe results, scan findings)
  helpUri: ['dequeuniversity.com'], // SARIF reportingDescriptor.helpUri
  $schema: ['json.schemastore.org'], // SARIF $schema
  informationUri: ['a11ygate.vercel.app', 'www.w3.org'], // SARIF tool.driver / taxonomies (WCAG)
  userAgent: ['a11ygate.vercel.app'], // "... A11yGate/x (+https://a11ygate.vercel.app)"
};
const REFERENCE_TEXT_HOSTS = new Set(['www.w3.org', 'dequeuniversity.com', 'a11ygate.vercel.app', 'json.schemastore.org']);
const REFERENCE_TEXT_CONTEXT = /(?:href="|\]\(|; \+|\bguidance: )$/;
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/([^/\s"'<>)\]`\\]+)[^\s"'<>)\]`\\]*/gi;
const LOOPBACK_ALIASES = /localhost|\[::1\]|0\.0\.0\.0/i;

/** True only for http://127.0.0.1:4173/... (the normalised demo app origin). */
export function isScannedOk(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && u.host === SAMPLE_HOST;
  } catch {
    return false;
  }
}

/** Problems in a non-JSON text sample (HTML, Markdown, XML, PDF text). */
export function textHostProblems(text: string): string[] {
  const problems: string[] = [];
  if (LOOPBACK_ALIASES.test(text)) problems.push('mentions localhost / ::1 / 0.0.0.0');
  for (const m of text.matchAll(URL_RE)) {
    const host = m[1]!.toLowerCase();
    if (host === SAMPLE_HOST && isScannedOk(m[0])) continue;
    const before = text.slice(Math.max(0, m.index! - 40), m.index);
    if (REFERENCE_TEXT_HOSTS.has(host) && REFERENCE_TEXT_CONTEXT.test(before)) continue;
    problems.push(`${m[0]} (after "${before.slice(-25)}")`);
  }
  return [...new Set(problems)];
}

/** Problems in a parsed JSON sample: every URL outside a REFERENCE_FIELDS key must be the demo app. */
export function jsonHostProblems(value: unknown): string[] {
  const problems: string[] = [];
  const check = (text: string, path: string, key: string | undefined) => {
    if (LOOPBACK_ALIASES.test(text)) problems.push(`${path}: mentions localhost / ::1 / 0.0.0.0`);
    for (const m of text.matchAll(URL_RE)) {
      const host = m[1]!.toLowerCase();
      const allowed = key !== undefined && Object.hasOwn(REFERENCE_FIELDS, key) ? REFERENCE_FIELDS[key]! : undefined;
      if (allowed ? allowed.includes(host) : isScannedOk(m[0])) continue;
      problems.push(`${path}: ${m[0]}`);
    }
  };
  const walk = (v: unknown, path: string, key: string | undefined) => {
    if (typeof v === 'string') check(v, path, key);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, key));
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        check(k, `${path} (key)`, undefined);
        walk(x, `${path}.${k}`, k);
      }
    }
  };
  walk(value, '$', undefined);
  return [...new Set(problems)];
}

/** Host problems of one named sample file / zip entry. JSON is checked structurally; everything else as text. */
export function fileHostProblems(name: string, data: Uint8Array | string): string[] {
  const text = typeof data === 'string' ? data : Buffer.from(data).toString(/\.png$/i.test(name) ? 'latin1' : 'utf8');
  if (/\.(json|sarif)$/i.test(name)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      return [`${name}: not valid JSON (${(error as Error).message})`];
    }
    return jsonHostProblems(parsed).map((p) => `${name} ${p}`);
  }
  return textHostProblems(text).map((p) => `${name}: ${p}`);
}

export type Entry = { path: string; data: Uint8Array };

/** `any[]` for arrays, [] otherwise (JSON from the CLI is untyped). */
const arr = (v: unknown) => (Array.isArray(v) ? v : []);

export const readZipEntries = (zip: Uint8Array): { path: string; data: Buffer }[] =>
  readZip(zip).map((e) => ({ path: e.path, data: Buffer.from(e.data) }));

/** Every scanned page / target URL in the evidence pack's structured outputs. Throws if an expected part is missing. */
export function scannedUrls(entries: readonly Entry[]): string[] {
  const get = (name: string) => {
    const entry = entries.find((e) => e.path === name);
    if (!entry) throw new Error(`evidence pack has no ${name}`);
    return Buffer.from(entry.data).toString('utf8');
  };
  const urls: unknown[] = [];
  const need = (value: unknown, where: string) => {
    if (typeof value !== 'string' || value.length === 0) throw new Error(`missing scanned URL at ${where}`);
    urls.push(value);
  };

  // axe results: the top-level `url` of each result is the scanned page (plus native/finding urls).
  const axe = JSON.parse(get('engines/axe.json'));
  if (!Array.isArray(axe) || axe.length === 0) throw new Error('engines/axe.json has no axe results');
  axe.forEach((result, i) => {
    need(result?.url, `engines/axe.json[${i}].url`);
    if (result.native !== undefined) need(result.native?.url, `engines/axe.json[${i}].native.url`);
    arr(result.findings).forEach((f, j) => {
      need(f?.url, `engines/axe.json[${i}].findings[${j}].url`);
      if (f.compatibility?.url !== undefined) need(f.compatibility.url, `engines/axe.json[${i}].findings[${j}].compatibility.url`);
    });
  });

  const scan = JSON.parse(get('scan/a11ygate-scan.json'));
  need(scan.startUrl, 'scan.startUrl');
  need(scan.origin, 'scan.origin');
  arr(scan.pages).forEach((p, i) => {
    need(p?.url, `scan.pages[${i}].url`);
    if (p.finalUrl !== undefined) need(p.finalUrl, `scan.pages[${i}].finalUrl`);
  });
  arr(scan.findings).forEach((f, i) => need(f?.pageUrl ?? f?.url, `scan.findings[${i}].pageUrl`));
  arr(scan.results).forEach((r, i) => need(r?.url, `scan.results[${i}].url`));
  for (const g of scan.sharedComponentGroups ?? []) {
    for (const p of g.pages ?? []) urls.push(p);
    for (const ex of g.examples ?? []) urls.push(ex.pageUrl);
  }

  const sarif = JSON.parse(get('scan/a11ygate-scan.sarif'));
  for (const run of sarif.runs ?? []) {
    if (run.properties?.startUrl !== undefined) urls.push(run.properties.startUrl);
    for (const r of run.results ?? []) {
      if (r.properties?.pageUrl !== undefined) urls.push(r.properties.pageUrl);
      for (const l of r.locations ?? []) {
        // SARIF artifact paths are a11ygate-pages/<host>-<port>/<path>; map back to the page's origin.
        const uri: unknown = l.physicalLocation?.artifactLocation?.uri;
        const local = typeof uri === 'string' ? uri.match(/^a11ygate-pages\/([^/]+)-(\d+)\/(.*)$/) : null;
        if (uri !== undefined) urls.push(local ? `http://${local[1]}:${local[2]}/${local[3]}` : uri);
        for (const logical of l.logicalLocations ?? []) if (logical.kind === 'url') urls.push(logical.fullyQualifiedName);
      }
    }
    for (const a of run.artifacts ?? []) urls.push(a.location?.uri);
  }

  for (const m of get('scan/a11ygate-scan.junit.xml').matchAll(/(?:name|classname|value)="([a-z][a-z0-9+.-]*:\/\/[^"]+)"/gi)) urls.push(m[1]!);
  for (const name of ['scan/a11ygate-scan.md', 'report.md']) {
    for (const line of get(name).split('\n')) if (/^\s*[-*|]/.test(line)) for (const m of line.matchAll(/(?<!\]\()\bhttps?:\/\/[^\s)|`]+/g)) urls.push(m[0]);
  }
  const manifest = JSON.parse(get('manifest.json'));
  need(manifest.scope?.startUrl, 'manifest.scope.startUrl');
  for (const p of manifest.scope?.pages ?? []) urls.push(p.url);
  return urls.map((u) => (typeof u === 'string' ? u : `<non-string ${JSON.stringify(u)}>`));
}

/** All host problems of an evidence pack: every entry (incl. engines/axe.json) plus strict scanned-URL extraction. */
export function evidencePackHostProblems(zip: Uint8Array | readonly Entry[]): string[] {
  const entries = zip instanceof Uint8Array ? readZipEntries(zip) : zip;
  if (entries.length === 0) return ['evidence pack has no entries'];
  const problems = entries.flatMap((e) => fileHostProblems(`evidence-pack-sample.zip!/${e.path}`, e.data));
  try {
    const urls = scannedUrls(entries);
    if (urls.length < 5) problems.push(`only ${urls.length} scanned URLs extracted`);
    for (const u of urls) if (!isScannedOk(u)) problems.push(`scanned URL not on ${SAMPLE_HOST}: ${u}`);
  } catch (error) {
    problems.push((error as Error).message);
  }
  return problems;
}
