// A11Y-R79 (c): host checks for the sample deliverables pack (docs/samples). Pure functions, no Chromium: used by
// e2e/samples.spec.ts on the rebuilt + committed pack and by tests/sample-hosts.test.ts (vitest, negative tests).
//
// Rule: every URL in a sample is a scanned/target URL on the demo app (http://127.0.0.1:4173/...), except URLs in
// an explicitly listed reference field/context, which may point only at that field's reference host(s).
//  - JSON entries are walked structurally; a URL is a reference only if its key is in REFERENCE_FIELDS (by key
//    name, not "any field named url") and its host is allowed for that key. Everything else must be the demo app.
//  - Text entries (HTML, Markdown, JUnit XML, PDF text, README) allow a reference URL only inside one of the exact
//    reference constructs the generators emit (REFERENCE_TEXT_CONTEXTS: the report's rule-help / W3C Understanding
//    list items, Markdown "[rule guidance](...)", JUnit "  guidance: ...", the user agent "; +https://a11ygate...").
//    The host alone never makes a URL a reference: an href to dequeuniversity.com anywhere else is a problem.
//  - IP literals other than the literal 127.0.0.1 (bracketed IPv6, IPv4-mapped IPv6, decimal/hex/octal/short IPv4,
//    percent-encoded or userinfo authorities) are problems; a token the checker cannot classify is a problem (fail
//    closed), never a skip.
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
const AXE_HELP = String.raw`https://dequeuniversity\.com/rules/axe/\d+\.\d+/[a-z0-9-]+\?application=[a-z0-9-]+`;
const W3C_UNDERSTANDING = String.raw`https://www\.w3\.org/WAI/WCAG2\d/Understanding/[a-z0-9-]+\.html`;
/**
 * The only places a text sample may contain a reference link: the exact markup the generators emit (derived from the
 * real report.html / scan HTML / Markdown / JUnit output). Capture group 1 is the reference URL; it must also be the
 * whole URL token at that position. Anything else (Start URL, page headings, <code>, any other href) is scanned data.
 */
export const REFERENCE_TEXT_CONTEXTS: readonly { name: string; re: RegExp }[] = [
  // report-html-v2 howToFixSection / report.ts pageFinding: rule help link with a screen-reader rule suffix.
  { name: 'html rule help', re: new RegExp(String.raw`<a href="(${AXE_HELP})">(?:Engine rule help|Rule guidance)<span class="sr"> for [a-z0-9-]+</span></a>`, 'g') },
  // report-html-v2 howToFixSection: W3C Understanding document for a mapped WCAG criterion.
  { name: 'html W3C Understanding', re: new RegExp(String.raw`<li><a href="(${W3C_UNDERSTANDING})">W3C Understanding \d+\.\d+\.\d+ [^<]+</a></li>`, 'g') },
  // scan Markdown finding line: "— [rule guidance](helpUrl)".
  { name: 'markdown rule guidance', re: new RegExp(String.raw`\[rule guidance\]\((${AXE_HELP})\)`, 'g') },
  // export-junit failureBody: a line "  guidance: <helpUrl>".
  { name: 'junit guidance', re: new RegExp(String.raw`(?:^|\n)  guidance: (${AXE_HELP})(?=</failure>|\n|$)`, 'g') },
  // packages/cli/src/scan.ts user agent: "(compatible; A11yGate/<version>; +https://a11ygate.vercel.app)".
  { name: 'user agent', re: /\(compatible; A11yGate\/\d+\.\d+\.\d+[0-9A-Za-z.-]*; \+(https:\/\/a11ygate\.vercel\.app)\)/g },
];
/** Start offsets → URL of every reference link in an (already decoded) text, found by context only. */
function referenceSpans(text: string): Map<number, string> {
  const spans = new Map<number, string>();
  for (const { re } of REFERENCE_TEXT_CONTEXTS) {
    for (const m of text.matchAll(re)) {
      const url = m[1]!;
      spans.set(m.index! + m[0].lastIndexOf(url), url);
    }
  }
  return spans;
}
/** IP literals that are not the literal 127.0.0.1: bracketed IPv6 (incl. IPv4-mapped) anywhere, and hex IPv4 forms. */
const IP_LITERAL = /\[[0-9a-f]*:[0-9a-f:.]*(?:%[0-9a-z%._~-]*)?\]|(?<![\w.])0x[0-9a-f]+(?:\.(?:0x[0-9a-f]+|\d+)){0,3}(?=[:/])/gi;
const ipLiteralProblems = (text: string) => [...text.matchAll(IP_LITERAL)].map((m) => `IP literal ${m[0]} (only http://${SAMPLE_HOST} may be scanned)`);
const LOOPBACK_ALIASES = /localhost|\[::1\]|0\.0\.0\.0/i;
/** The demo app origin, as a LITERAL prefix of the raw string (checked before `new URL()` can normalise 127.1,
 * 0x7f.0.0.1, 2130706433, upper case, backslashes or userinfo into it). */
const SCANNED_RAW = /^http:\/\/127\.0\.0\.1:4173(?:[/?#][^\s\\@]*)?$/;

/**
 * Every URL-like token in a string:
 *  - `scheme://authority` and protocol-relative `//authority` (also with backslashes, `\\example.com`), wherever
 *    they appear: href/src/srcset/action/poster/cite values, CSS url(...), JSON strings and plain text;
 *  - special schemes with fewer slashes, which browsers still resolve to a host (`https:example.com`, `http:/x`);
 *  - bare hostnames with a common TLD (`www.example.com`, `example.com/page`) and bare IPv4 addresses followed by a
 *    port or path (`10.0.0.1:80`, `10.0.0.1/x`, SARIF `127.0.0.1-4173/`; EN 301 549 clauses like 9.4.1.2 are not hosts).
 * `host` is the raw authority (userinfo and port included, lower-cased) so `a@b`, `127.1:4173` etc. never match an
 * allowed host by accident.
 */
// Bracketed IPv6 hosts (`[2001:db8::1]`, `user@[::1]:4173`) are part of the authority, so they are always tokens.
const AUTHORITY = '(?:[^\\s"\'<>()\\[\\]`\\\\/?#,]|\\[[^\\]\\s"\'<>]*\\]?)+';
const URL_TOKEN = new RegExp(
  [
    `\\b[a-z][a-z0-9+.-]*:[\\\\/]{2}(${AUTHORITY})`, // scheme://host (also scheme:\\\\host)
    `\\b(?:https?|wss?|ftp):[\\\\/]?(?![\\\\/])(${AUTHORITY})`, // http:host, http:/host
    `(?<![\\w:\\\\/])[\\\\/]{2}(?=[a-z0-9\\[])(${AUTHORITY})`, // //host (protocol-relative)
  ].join('|'),
  'gi',
);
const URL_REST = /[^\s"'<>)\]`\\]*/y;
const TLDS = 'com|org|net|io|dev|app|co|uk|de|fr|il|eu|us|gov|edu|info|biz|ai|me|ly|xyz|site|tech|online|cloud|page|example|test|invalid|local|internal';
const BARE_HOST = new RegExp(`(?<![\\w.-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:${TLDS})(?![\\w-])(?::\\d+)?|(?<![\\w.])\\d{1,3}(?:\\.\\d{1,3}){3}(?=[:/-]\\w)(?::\\d+)?`, 'gi');

type UrlToken = { raw: string; host: string; index: number; bare: boolean };

/** Undo the encodings a browser (or a JS string) would undo, so `&#47;&#47;host` and `https:\/\/host` are seen. */
export function decodeForHostCheck(text: string): string {
  return text
    .replace(/&#(\d+);?/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);?/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&(?:sol|solidus);/gi, '/').replace(/&colon;/gi, ':').replace(/&bsol;/gi, '\\').replace(/&period;/gi, '.')
    .replace(/\\u00(2f|3a|5c)/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\x(2f|3a|5c)/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\\//g, '/');
}

export function urlTokens(text: string): UrlToken[] {
  const tokens: UrlToken[] = [];
  const covered: [number, number][] = [];
  for (const m of text.matchAll(URL_TOKEN)) {
    URL_REST.lastIndex = m.index! + m[0].length;
    const rest = URL_REST.exec(text)?.[0] ?? '';
    const raw = m[0] + rest;
    tokens.push({ raw, host: (m[1] ?? m[2] ?? m[3])!.toLowerCase(), index: m.index!, bare: false });
    covered.push([m.index!, m.index! + raw.length]);
  }
  for (const m of text.matchAll(BARE_HOST)) {
    if (covered.some(([a, b]) => m.index! >= a && m.index! < b)) continue;
    tokens.push({ raw: m[0], host: m[0].toLowerCase(), index: m.index!, bare: true });
  }
  return tokens.sort((a, b) => a.index - b.index);
}

/** True only for http://127.0.0.1:4173/... (the normalised demo app origin), checked on the raw string. */
export function isScannedOk(url: unknown): boolean {
  if (typeof url !== 'string' || !SCANNED_RAW.test(url)) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && u.host === SAMPLE_HOST && u.username === '' && u.password === '';
  } catch {
    return false;
  }
}

/** A bare (scheme-less) host token is fine only if it is the demo app itself (e.g. SARIF `127.0.0.1-4173` paths). */
const bareOk = (host: string) => host === '127.0.0.1' || host === SAMPLE_HOST;

/** Problems in a non-JSON text sample (HTML, Markdown, XML, PDF text). */
export function textHostProblems(input: string): string[] {
  const text = decodeForHostCheck(input);
  const problems: string[] = [];
  if (LOOPBACK_ALIASES.test(text)) problems.push('mentions localhost / ::1 / 0.0.0.0');
  problems.push(...ipLiteralProblems(text));
  const references = referenceSpans(text);
  for (const t of urlTokens(text)) {
    const before = text.slice(Math.max(0, t.index - 40), t.index);
    if (t.bare ? bareOk(t.host) : isScannedOk(t.raw)) continue;
    // A reference only by WHERE it is (an exact generator construct), never because its host is a reference host.
    if (!t.bare && references.get(t.index) === t.raw) continue;
    problems.push(`${t.raw} (after "${before.slice(-25)}")`);
  }
  return [...new Set(problems)];
}

/** Problems in a parsed JSON sample: every URL outside a REFERENCE_FIELDS key must be the demo app. */
export function jsonHostProblems(value: unknown): string[] {
  const problems: string[] = [];
  const check = (text: string, path: string, key: string | undefined) => {
    if (LOOPBACK_ALIASES.test(decodeForHostCheck(text))) problems.push(`${path}: mentions localhost / ::1 / 0.0.0.0`);
    for (const p of ipLiteralProblems(decodeForHostCheck(text))) problems.push(`${path}: ${p}`);
    const allowed = key !== undefined && Object.hasOwn(REFERENCE_FIELDS, key) ? REFERENCE_FIELDS[key]! : undefined;
    for (const t of urlTokens(decodeForHostCheck(text))) {
      if (t.bare ? bareOk(t.host) : allowed ? allowed.includes(t.host) && /^https:\/\//.test(t.raw) : isScannedOk(t.raw)) continue;
      problems.push(`${path}: ${t.raw}`);
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
