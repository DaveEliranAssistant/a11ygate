// A11Y-R79 (c): host check of the committed sample pack + negative tests of the checker (no Chromium; runs in
// npm test). e2e/samples.spec.ts runs the same checker on a fresh rebuild and on the PDF text.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createZip } from '../lib/evidence/zip';
import {
  evidencePackHostProblems, fileHostProblems, isScannedOk, jsonHostProblems, readZipEntries, SAMPLE_HOST, scannedUrls, textHostProblems, urlTokens,
  type Entry,
} from './sample-hosts';

const dir = path.join(__dirname, '..', 'docs', 'samples');
const LOCAL = `http://${SAMPLE_HOST}/`;
const PLANTED = 'https://dequeuniversity.com/';

const RULE_HELP_ITEM = '<li><a href="https://dequeuniversity.com/rules/axe/4.14/label?application=playwright">Engine rule help<span class="sr"> for label</span></a></li>';
/** RULE_HELP_ITEM-style markup wrapped in the real report-html-v2 how-to-fix → References list structure. */
const inReferences = (items: string) =>
  `<section id="how-to-fix" aria-labelledby="how-to-fix-h">\n<section id="fix-1">\n<p><strong>References:</strong></p><ul>${items}</ul>\n</section>\n</section>`;
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
  }, 30_000);

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
    // Fix round 2026-11-28: a reference link passes only in the exact generator markup (rule-help list item), not
    // as any href to a reference host.
    // Fix round 2026-11-28 rerun (judge 1): only inside the generator's reference SECTION (how-to-fix References list,
    // Markdown finding line), so the bare item / a bare "[rule guidance]" link no longer pass on their own.
    expect(textHostProblems(RULE_HELP_ITEM)).toHaveLength(1);
    expect(textHostProblems(inReferences(RULE_HELP_ITEM))).toEqual([]);
    expect(textHostProblems('<a href="https://dequeuniversity.com/rules/axe/4.14/label">x</a>')).toHaveLength(1);
    expect(textHostProblems(inReferences('<li><a href="https://dequeuniversity.com/rules/axe/4.14/label">x</a></li>'))).not.toEqual([]);
    expect(textHostProblems(`Site: ${LOCAL} [rule guidance](https://dequeuniversity.com/rules/axe/4.14/label?application=playwright)`)).toHaveLength(1);
    expect(textHostProblems(`\n## Findings by severity\n\n- [new] **label** (critical) on \`${LOCAL}\` — \`#email\` — x — [rule guidance](https://dequeuniversity.com/rules/axe/4.14/label?application=playwright)\n`)).toEqual([]);
    expect(textHostProblems(`Site: ${LOCAL} [rule guidance](https://www.w3.org/WAI/x)`)).toHaveLength(1);
    expect(textHostProblems('Site: https://example.com/')).toHaveLength(1);
    expect(textHostProblems('- https://dequeuniversity.com/ (scanned page)')).toHaveLength(1);
    expect(textHostProblems('"url": "https://dequeuniversity.com/"')).toHaveLength(1);
    expect(textHostProblems('"pageUrl": "https://www.w3.org/"')).toHaveLength(1);
    expect(textHostProblems('http://localhost:3000/')).not.toEqual([]);
  });

  // Fix round 2026-11-28 (Codex review 27.11 #2): bracketed IPv6 / other IP literals, and reference-by-context only.
  const IPV6_TARGETS = ['http://[2001:db8::1]/', '//[2001:db8::1]/', 'http://[2001:db8::1]:4173/', 'https://[::ffff:7f00:1]/', 'http://[::ffff:127.0.0.1]:4173/', 'http://[::1]:4173/'];
  const OTHER_IP_TARGETS = ['//example.com/', 'http://127.1:4173/', 'http://2130706433:4173/', 'http://0x7f.0.0.1:4173/', 'http://0x7f000001:4173/', 'http://0177.0.0.1:4173/', 'http://%31%32%37.0.0.1:4173/', 'http://127.0.0.1:4173@evil.example/'];

  it('FAILS on a bracketed IPv6 (or other non-literal IP) Start URL in report.html and in the evidence ZIP copy', async () => {
    const html = await readFile(path.join(dir, 'report.html'), 'utf8');
    const entries = await packEntries();
    for (const target of [...IPV6_TARGETS, ...OTHER_IP_TARGETS]) {
      const planted = html.replace(`Start URL: <code>${LOCAL}`, `Start URL: <code>${target}`);
      expect(planted, target).not.toBe(html);
      const problems = fileHostProblems('report.html', planted);
      expect(problems.some((p) => p.includes(target.replace(/\/$/, ''))), `${target}: ${problems.join(' | ')}`).toBe(true);
      const zipped = withEntry(entries, 'report.html', (s) => s.replace(`Start URL: <code>${LOCAL}`, `Start URL: <code>${target}`));
      expect(evidencePackHostProblems(createZip(zipped)).some((p) => p.includes('report.html')), target).toBe(true);
    }
  }, 30_000);

  it('FAILS on a bracketed IPv6 (or other non-literal IP) startUrl in the screenshot metadata JSON', async () => {
    const sidecar = JSON.parse(await readFile(path.join(dir, 'screenshot-checks.json'), 'utf8'));
    expect(fileHostProblems('screenshot-checks.json', JSON.stringify({ ...sidecar, startUrl: LOCAL }))).toEqual([]);
    for (const target of [...IPV6_TARGETS, ...OTHER_IP_TARGETS]) {
      const problems = fileHostProblems('screenshot-checks.json', JSON.stringify({ ...sidecar, startUrl: target }));
      expect(problems.some((p) => p.includes('$.startUrl')), `${target}: ${problems.join(' | ')}`).toBe(true);
      expect(isScannedOk(target), target).toBe(false);
    }
    // In scanned fields of the evidence pack too (strict extraction).
    const entries = await packEntries();
    const scan = JSON.parse(text(entries.find((e) => e.path === 'scan/a11ygate-scan.json')!));
    scan.startUrl = 'http://[2001:db8::1]/';
    const planted = entries.map((e) => (e.path === 'scan/a11ygate-scan.json' ? { path: e.path, data: Buffer.from(JSON.stringify(scan)) } : e));
    expect(evidencePackHostProblems(planted)).toContain('scanned URL not on 127.0.0.1:4173: http://[2001:db8::1]/');
  });

  it('urlTokens captures bracketed authorities (no silent skip)', () => {
    for (const target of IPV6_TARGETS) {
      const tokens = urlTokens(`Start URL: <code>${target}</code>`);
      expect(tokens.map((t) => t.host), target).toEqual([target.replace(/^(?:https?:)?\/\//, '').replace(/\/$/, '')]);
    }
    expect(textHostProblems('Site: [2001:db8::1]:4173/')).not.toEqual([]);
  });

  it('FAILS when the report Start URL is a link to a reference host ("scanned site") — host alone is not a reference', async () => {
    const html = await readFile(path.join(dir, 'report.html'), 'utf8');
    const startUrl = `Start URL: <code>${LOCAL}</code>`;
    expect(html).toContain(startUrl);
    for (const link of [
      '<a href="https://dequeuniversity.com/">scanned site</a>',
      '<a href="https://www.w3.org/">scanned site</a>',
      '<a href="https://a11ygate.vercel.app/">scanned site</a>',
      '<a href="https://dequeuniversity.com/rules/axe/4.14/label?application=playwright">scanned site</a>',
    ]) {
      const planted = html.replace(startUrl, `Start URL: ${link}`);
      expect(fileHostProblems('report.html', planted).length, link).toBeGreaterThan(0);
      const zipped = withEntry(await packEntries(), 'report.html', (s) => s.replace(startUrl, `Start URL: ${link}`));
      expect(evidencePackHostProblems(createZip(zipped)).some((p) => p.includes('report.html')), link).toBe(true);
    }
    // Same in the scan HTML / Markdown copies inside the pack.
    const md = withEntry(await packEntries(), 'scan/a11ygate-scan.md', (s) => s.replace(`\`${LOCAL}\``, '[scanned site](https://dequeuniversity.com/)'));
    expect(evidencePackHostProblems(md).some((p) => p.includes('scan/a11ygate-scan.md'))).toBe(true);
  }, 30_000);

  it('FAILS when a JSON scanned field (url / startUrl / pageUrl) is a reference host', () => {
    for (const key of ['url', 'startUrl', 'pageUrl', 'target', 'finalUrl', 'origin']) {
      for (const host of ['https://dequeuniversity.com/', 'https://www.w3.org/', 'https://a11ygate.vercel.app/', 'https://json.schemastore.org/']) {
        expect(jsonHostProblems({ [key]: host }), `${key}=${host}`).toEqual([`$.${key}: ${host}`]);
      }
    }
    expect(jsonHostProblems({ manifest: { scope: { startUrl: 'https://www.w3.org/' } } })).toHaveLength(1);
  });

  it('positive control: the real reference contexts still pass', async () => {
    const entries = await packEntries();
    const axe = JSON.parse(text(entries.find((e) => e.path === 'engines/axe.json')!));
    const helpUrl: string = axe.flatMap((r: { findings?: { helpUrl?: string }[] }) => r.findings ?? []).find((f: { helpUrl?: string }) => f.helpUrl)!.helpUrl!;
    expect(helpUrl).toMatch(/^https:\/\/dequeuniversity\.com\/rules\/axe\//);
    expect(jsonHostProblems({ url: LOCAL, helpUrl })).toEqual([]);
    const sarif = JSON.parse(text(entries.find((e) => e.path === 'scan/a11ygate-scan.sarif')!));
    expect(sarif.$schema).toBeTruthy();
    expect(jsonHostProblems({ $schema: sarif.$schema, informationUri: sarif.runs[0].tool.driver.informationUri, helpUri: sarif.runs[0].tool.driver.rules[0].helpUri })).toEqual([]);
    expect(jsonHostProblems({ userAgent: 'Mozilla/5.0 (compatible; A11yGate/0.2.0; +https://a11ygate.vercel.app) read-only accessibility scan' })).toEqual([]);
    // The UA string is a reference only in its known field (JSON userAgent); no text sample carries it, so in text it
    // is not a reference context any more (rerun after judge 1).
    expect(textHostProblems('UA: Mozilla/5.0 (compatible; A11yGate/0.2.0; +https://a11ygate.vercel.app) read-only accessibility scan')).toHaveLength(1);
    const html = await readFile(path.join(dir, 'report.html'), 'utf8');
    expect(html).toMatch(/<a href="https:\/\/dequeuniversity\.com\/rules\/axe\/[^"]+">Engine rule help<span class="sr"> for /);
    expect(html).toContain('<li><a href="https://www.w3.org/WAI/WCAG22/Understanding/');
    expect(fileHostProblems('report.html', html)).toEqual([]);
    for (const name of ['scan/a11ygate-scan.md', 'scan/a11ygate-scan.junit.xml', 'scan/a11ygate-scan.html']) {
      const entry = entries.find((e) => e.path === name)!;
      expect(text(entry), name).toMatch(/dequeuniversity\.com/);
      expect(fileHostProblems(name, entry.data), name).toEqual([]);
    }
  });

  // Fix round 2026-11-28, rerun after Codex judge 1: positive structural check of scanned fields, and reference markup
  // only inside the reference section.
  const SCHEMELESS = ['127.1:4173/', '0177.0.0.1:4173/', '2130706433:4173/', '0x7f.1:4173/', '127.0.0.1:4173/', ''];
  const START = `Start URL: <code>${LOCAL}</code>`;

  it('FAILS on a scheme-less numeric Start URL in report.html and in the evidence ZIP report', async () => {
    const html = await readFile(path.join(dir, 'report.html'), 'utf8');
    expect(html).toContain(START);
    const entries = await packEntries();
    for (const target of SCHEMELESS) {
      const planted = html.replace(START, `Start URL: <code>${target}</code>`);
      const problems = fileHostProblems('report.html', planted);
      expect(problems.some((p) => p.includes('Start URL is not')), `${target}: ${problems.join(' | ')}`).toBe(true);
      // The evidence pack's report.html lists the Start URL in its scope <ul>; the scan HTML has the report-v2 header.
      for (const name of ['report.html', 'scan/a11ygate-scan.html']) {
        const zipped = withEntry(entries, name, (s) => s.replace(`Start URL: <code>${LOCAL}</code>`, `Start URL: <code>${target}</code>`));
        const zp = evidencePackHostProblems(createZip(zipped));
        expect(zp.some((p) => p.includes(`${name}: Start URL is not`)), `${name} ${target}: ${zp.join(' | ')}`).toBe(true);
      }
    }
  }, 30_000);

  it('FAILS on a scheme-less numeric startUrl in the screenshot metadata JSON (and in any JSON string)', async () => {
    const sidecar = JSON.parse(await readFile(path.join(dir, 'screenshot-checks.json'), 'utf8'));
    for (const target of SCHEMELESS) {
      const problems = fileHostProblems('screenshot-checks.json', JSON.stringify({ ...sidecar, startUrl: target }));
      expect(problems, target).toContain(`screenshot-checks.json $.startUrl: ${target}`);
    }
    // Under a non-scanned key the generic token check still sees scheme-less numeric hosts.
    for (const target of ['127.1:4173/', '0177.0.0.1:4173/', '2130706433:4173/', '0x7f.1:4173/']) {
      expect(jsonHostProblems({ note: `scanned ${target}` }), target).not.toEqual([]);
      expect(textHostProblems(`Site: ${target}`), target).not.toEqual([]);
    }
    // Times, ratios and EN 301 549 clauses are not hosts.
    expect(textHostProblems('2026-11-26T09:00:00.000Z, 4.5:1 text, EN 301 549 9.4.1.2, 12:54 IST')).toEqual([]);
  });

  it('FAILS when a missing / empty / non-literal scanned field is in JSON or a field is missing in HTML', async () => {
    for (const key of ['url', 'startUrl', 'pageUrl', 'finalUrl', 'origin']) {
      expect(jsonHostProblems({ [key]: '' }), key).toEqual([`$.${key}: `]);
      expect(jsonHostProblems({ [key]: 'see report' }), key).toHaveLength(1);
    }
    const html = await readFile(path.join(dir, 'report.html'), 'utf8');
    expect(fileHostProblems('report.html', html.replace(START, ''))).toContain('report.html: no Start URL field found');
  });

  it('FAILS when the real rule-help markup is moved out of the References section (Start URL, header, title)', async () => {
    const html = await readFile(path.join(dir, 'report.html'), 'utf8');
    const item = html.match(/<li><a href="https:\/\/dequeuniversity\.com\/rules\/axe\/[^"]+">Engine rule help<span class="sr"> for [a-z-]+<\/span><\/a><\/li>/)![0];
    const w3c = html.match(/<li><a href="https:\/\/www\.w3\.org\/WAI\/[^"]+">W3C Understanding [^<]+<\/a><\/li>/)![0];
    const entries = await packEntries();
    for (const moved of [item, w3c, `<ul>${item}</ul>`, `<p><strong>References:</strong></p><ul>${item}</ul>`]) {
      const planted = html.replace(START, `Start URL: ${moved}`);
      expect(planted).not.toBe(html);
      const problems = fileHostProblems('report.html', planted);
      expect(problems.some((p) => p.includes('Start URL is not')), moved).toBe(true);
      expect(problems.some((p) => /dequeuniversity|w3\.org/.test(p) && !p.includes('Start URL is not')), `${moved}: ${problems.join(' | ')}`).toBe(true);
      // Inside the evidence ZIP: the report-v2 scan HTML (has a References section) and the evidence report.html.
      for (const name of ['scan/a11ygate-scan.html', 'report.html']) {
        const zipped = withEntry(entries, name, (s) => s.replace(`Start URL: <code>${LOCAL}</code>`, `Start URL: ${moved}`));
        const zp = evidencePackHostProblems(createZip(zipped)).filter((p) => p.includes(`${name}:`));
        expect(zp.some((p) => /dequeuniversity|w3\.org/.test(p) && !p.includes('Start URL is not')), `${name} ${moved}`).toBe(true);
      }
    }
    // Elsewhere outside the section: header, summary, an extra fake how-to-fix section.
    for (const planted of [
      html.replace('<h1>A11yGate accessibility scan report</h1>', `<h1>A11yGate accessibility scan report</h1><ul>${item}</ul>`),
      html.replace('<section id="by-page"', `<ul>${item}</ul><section id="by-page"`),
      html.replace('<header>', `<header>${inReferences(item)}`),
    ]) {
      expect(planted).not.toBe(html);
      expect(fileHostProblems('report.html', planted), planted.slice(0, 0)).not.toEqual([]);
    }
    // Non-reference markup inside the References list fails too (no "any href" inside the section).
    expect(fileHostProblems('report.html', html.replace('<p><strong>References:</strong></p><ul>', '<p><strong>References:</strong></p><ul><li><a href="https://dequeuniversity.com/">scanned site</a></li>'))).not.toEqual([]);
  }, 30_000);

  it('Markdown / JUnit reference links pass only in their sections', async () => {
    const entries = await packEntries();
    const md = text(entries.find((e) => e.path === 'scan/a11ygate-scan.md')!);
    const guidance = md.match(/\[rule guidance\]\(https:\/\/dequeuniversity\.com\/[^)]+\)/)![0];
    expect(textHostProblems(md.replace('**Verdict:', `${guidance} **Verdict:`))).not.toEqual([]);
    // A complete finding line (with its guidance link) above the first "## Findings by" heading is outside the section.
    const findingLine = md.match(/^- \[[a-z]+\] \*\*[a-z-]+\*\* .*\[rule guidance\]\(.*\)$/m)![0];
    expect(textHostProblems(md)).toEqual([]);
    expect(textHostProblems(md.replace('**Verdict:', `${findingLine}\n\n**Verdict:`))).not.toEqual([]);
    expect(fileHostProblems('a11ygate-scan.md', md.replace(/^(# A11yGate site scan — ).*$/m, '$1127.1:4173/'))).not.toEqual([]);
    const junit = text(entries.find((e) => e.path === 'scan/a11ygate-scan.junit.xml')!);
    const line = junit.match(/\n {2}guidance: https:\/\/dequeuniversity\.com\/[^<\n]+/)![0];
    expect(textHostProblems(junit.replace('</properties>', `</properties>${line}`))).not.toEqual([]);
    expect(fileHostProblems('x.junit.xml', junit.replace(/classname="http:\/\/127\.0\.0\.1:4173\//, 'classname="127.1:4173/'))).not.toEqual([]);
  });
});
