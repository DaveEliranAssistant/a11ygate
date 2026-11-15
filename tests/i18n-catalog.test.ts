/**
 * A11Y-R58: report strings come from the message catalog (locales/en.json).
 * (a) template lint, (b) en output unchanged, (c) RTL pseudo-locale scans clean
 * with axe and sets dir=rtl, (d) every catalog key is used and none is missing.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import en from '@/locales/en.json';
import { AUTOMATED_TESTING_DISCLAIMER, DISCLAIMER, LEGAL_DISCLAIMER } from '@/lib/copy';
import { catalogFor, formatMessage, PSEUDO_REPORT_LANGS, REPORT_LANGS, translator } from '@/lib/i18n';
import { applyFingerprintBaseline, createFingerprintBaseline } from '@/lib/scan/baseline';
import { groupSharedComponents } from '@/lib/group';
import { AXE_TAGS, buildScanReport, gateEffect, reviewDecisionsHtml, type ScanReport } from '@/lib/scan/report';
import { cell } from '@/lib/export-markdown';
import { createGroupDecision, decisionLabel, decisionSummary, REVIEW_DECISION_NOTICE } from '@/lib/scan/review';
import { renderScanHtml, scanHtmlV2 } from '@/lib/scan/report-html-v2';
import { scanMarkdown } from '@/lib/scan/report-markdown';
import type { AxeResults } from '@/lib/types';
import { attribution } from '@/lib/scan/engines/dedupe';
import { parseScanArgs } from '@/packages/cli/src/scan';

const ROOT = path.resolve(__dirname, '..');
/** Report templates whose user-visible strings must come from the catalog. */
const TEMPLATES = ['lib/scan/report-html-v2.ts', 'lib/scan/report-markdown.ts'];
const source = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

type Literal = { text: string; line: number; ignored: boolean; start: number; end: number };

/**
 * Minimal TS tokenizer: returns the static text of every string and template
 * literal (template expressions replaced by \u0000), skipping comments and
 * import/export-from specifiers. A literal preceded by an i18n-ignore marker
 * comment (used for CSS) is flagged as ignored.
 */
function literals(src: string): Literal[] {
  const out: Literal[] = [];
  let i = 0;
  let pendingIgnore = false;
  const lineAt = (pos: number) => src.slice(0, pos).split('\n').length;
  function readString(quote: string): string {
    let text = '';
    i += 1;
    while (i < src.length && src[i] !== quote) {
      if (src[i] === '\\') { text += src[i + 1]; i += 2; continue; }
      text += src[i];
      i += 1;
    }
    i += 1;
    return text;
  }
  function readTemplate(): string {
    let text = '';
    i += 1;
    while (i < src.length && src[i] !== '`') {
      if (src[i] === '\\') { text += src[i + 1] === 'n' ? '\n' : src[i + 1]; i += 2; continue; }
      if (src[i] === '$' && src[i + 1] === '{') {
        i += 2;
        text += '\u0000';
        scanCode('}');
        i += 1;
        continue;
      }
      text += src[i];
      i += 1;
    }
    i += 1;
    return text;
  }
  function scanCode(until?: string): void {
    let depth = 0;
    while (i < src.length) {
      const c = src[i];
      if (until && c === until && depth === 0) return;
      if (c === '{') depth += 1;
      if (c === '}') depth -= 1;
      if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) i = src.length; continue; }
      if (c === '/' && src[i + 1] === '*') {
        const end = src.indexOf('*/', i);
        if (src.slice(i, end).includes('i18n-ignore')) pendingIgnore = true;
        i = end + 2;
        continue;
      }
      if (c === '/' && /[(,=:[!&|?{};+]$|^$/.test(src.slice(0, i).trimEnd().slice(-1))) {
        // Regex literal: skip it (it may contain quotes).
        let inClass = false;
        i += 1;
        while (i < src.length && (inClass || src[i] !== '/')) {
          if (src[i] === '\\') i += 1;
          else if (src[i] === '[') inClass = true;
          else if (src[i] === ']') inClass = false;
          i += 1;
        }
        i += 1;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') {
        const start = i;
        const ignored = pendingIgnore;
        pendingIgnore = false;
        const lineStart = src.lastIndexOf('\n', start) + 1;
        const isSpecifier = /^\s*(import|export)\b.*\bfrom\s*$/.test(src.slice(lineStart, start)) || /^\s*import\s*$/.test(src.slice(lineStart, start));
        const text = c === '`' ? readTemplate() : readString(c);
        if (!isSpecifier) out.push({ text, line: lineAt(start), ignored, start, end: i });
        continue;
      }
      i += 1;
    }
  }
  scanCode();
  return out;
}

/** Attributes whose values are user-visible (tooltips, accessible names, alt text, hints). */
const VISIBLE_ATTRS = ['aria-label', 'aria-description', 'aria-roledescription', 'aria-placeholder', 'aria-valuetext', 'title', 'alt', 'placeholder', 'label', 'value'];
const VISIBLE_ATTR = new RegExp(`(?:^|[\\s<])(${VISIBLE_ATTRS.join('|')})\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'gi');
const LETTERS = /[A-Za-z]{2,}/;

/**
 * Hard-coded user-visible text in a literal, or null. Flags:
 * - prose anywhere: two words, or a capitalised word;
 * - any word in the value of a user-visible attribute (aria-label, title, alt, placeholder, ...);
 * - any word (even a single lowercase one) in HTML text content, i.e. text next to a tag;
 * - any word after Markdown block syntax (`#`, `-`, `*`, `>`, `|`) at the start of a line.
 * Placeholders (`${...}`) and entities are not text. Other attribute values (class, id, href) are code.
 */
function hardCodedProse(literal: string): string | null {
  const strip = (text: string) => text.replace(/&#?\w+;/g, ' ').replace(/\u0000/g, ' ');
  for (const m of literal.matchAll(VISIBLE_ATTR)) {
    const value = strip(m[2] ?? m[3] ?? '');
    const word = value.match(LETTERS);
    if (word) return `${m[1]}="${word[0]}"`;
  }
  const text = strip(literal.replace(/<[^>]*>/g, '\u0001').replace(/\b[\w-]+="[^"]*"/g, ' '));
  // Two words separated by whitespace, or a capitalised word: user-facing prose.
  const prose = text.replace(/\u0001/g, ' ').match(/[A-Za-z]{2,}[ \t\n]+[A-Za-z]{2,}|\b[A-Z][a-z]{2,}\b/);
  if (prose) return prose[0];
  if (literal.includes('<') || literal.includes('>')) {
    // HTML text content: segments between tags (or a literal starting/ending at a tag boundary).
    // The first segment is text unless the literal starts inside a tag; likewise the last one.
    const segments = text.split('\u0001');
    const from = /^[^<]*>/.test(literal) ? 1 : 0;
    const to = /<[^>]*$/.test(literal) ? segments.length - 1 : segments.length;
    for (const seg of segments.slice(from, to)) {
      const word = seg.match(LETTERS);
      if (word) return word[0];
    }
  }
  const md = text.match(/(?:^|\n)[ \t]*(?:#{1,6}|[-*>]|\|)[ \t]+[^\n]*?([A-Za-z]{2,})/);
  return md ? (md[1] as string) : null;
}

function lint(src: string): string[] {
  const all = literals(src);
  return all
    .filter((l) => !l.ignored)
    .flatMap((l) => {
      let prose = hardCodedProse(l.text);
      // A bare word concatenated onto markup ('<li>' + 'none' + '</li>') is text content too.
      const idx = all.indexOf(l);
      const joined = (a: Literal | undefined, b: Literal | undefined) => !!a && !!b && /^\s*\+\s*$/.test(src.slice(a.end, b.start));
      const prev = all[idx - 1];
      const next = all[idx + 1];
      if (!prose && LETTERS.test(l.text) && !/[<>]/.test(l.text) &&
        ((joined(prev, l) && />\s*$/.test(prev!.text)) ||
         (joined(l, next) && /^\s*<\//.test(next!.text)))) {
        prose = (l.text.match(LETTERS) as RegExpMatchArray)[0];
      }
      return prose ? [`line ${l.line}: "${prose}" in ${JSON.stringify(l.text.slice(0, 80))}`] : [];
    });
}

const ORIGIN = 'https://site.test';
type Violation = AxeResults['violations'][number];
const v = (id: string, impact: Violation['impact'], tags: string[], help: string, targets: string[]): Violation => ({
  id, impact, tags, help, helpUrl: `https://dequeuniversity.com/rules/axe/4.14/${id}`, nodes: targets.map((t) => ({ target: [t], html: `<${t}>` })),
});
const IMAGE_ALT = v('image-alt', 'critical', ['wcag2a', 'wcag111'], 'Images must have alternative text', ['img']);
const CONTRAST = v('color-contrast', 'serious', ['wcag2aa', 'wcag143'], 'Elements must meet minimum color contrast ratio thresholds', ['p.faint', 'a.nav']);
const REGION = v('region', 'moderate', ['best-practice'], 'All page content should be contained by landmarks', ['div', 'section.hero', 'footer']);

function page(p: string, violations: Violation[]) {
  const url = `${ORIGIN}${p}`;
  return { url, finalUrl: url, status: 200, scanStatus: 'complete' as const, result: { url, timestamp: '2026-11-14T10:00:00.000Z', testEngine: { version: '4.14.0' }, violations, toolOptions: {}, scanConfig: {}, scanStatus: 'complete' } as AxeResults };
}

function report(pages = [page('/', [IMAGE_ALT, REGION, CONTRAST]), page('/about', [CONTRAST, REGION]), page('/contact', [REGION])]): ScanReport {
  return buildScanReport({
    crawl: { pages: [...pages, { url: `${ORIGIN}/gone`, finalUrl: `${ORIGIN}/gone`, status: 404, scanStatus: 'failed', error: 'HTTP 404' }], skipped: [{ url: `${ORIGIN}/private/`, reason: 'robots' }, { url: `${ORIGIN}/x.pdf`, reason: 'non-html' } as never] },
    version: '0.2.0', scannedAt: '2026-11-14T10:00:00.000Z', startUrl: `${ORIGIN}/`, failOn: 'serious',
    maxPages: 20, delayMs: 1000, userAgent: 'A11yGate/test', robotsNote: 'robots.txt honoured.',
  });
}

function withBaseline(): ScanReport {
  return applyFingerprintBaseline(report(), createFingerprintBaseline(report([page('/', [IMAGE_ALT])])));
}

/** R39 review decisions: active accepted-risk (expiry + reason), expired accepted-risk, false-positive and to-fix. */
function withDecisions(now = new Date('2026-11-14T12:00:00Z')): ScanReport {
  const base = report();
  const groups = groupSharedComponents(base.findings).filter((g) => g.likelySharedComponent);
  const kinds = [
    { decision: 'accepted-risk', reason: 'Third-party <widget> & "nav"', expires: '2026-12-31' },
    { decision: 'false-positive', reason: 'Name set at runtime' },
    { decision: 'to-fix' },
  ] as const;
  const decisions = groups.map((g, i) => createGroupDecision(g, { ...kinds[i % kinds.length], by: 'Reviewer <R>', now }));
  return applyFingerprintBaseline(base, { ...createFingerprintBaseline(report([])), groupDecisions: decisions }, now);
}

describe('(a) report templates take user-visible strings from the catalog', () => {
  it.each(TEMPLATES)('%s has no hard-coded prose', (file) => {
    expect(lint(source(file))).toEqual([]);
  });

  it('the lint catches hard-coded strings (self-test)', () => {
    expect(lint('const a = `<h2 id="x">Executive summary</h2>`;')).toHaveLength(1);
    expect(lint("const b = '<li>Engines used: none</li>';")).toHaveLength(1);
    expect(lint("const c = x ? ' not authenticated: ' + n : '';")).toHaveLength(1);
    expect(lint('const d = `## ${t.t(\'md.pagesHeading\')}`;')).toEqual([]);
    expect(lint("import { a } from '@/lib/some thing';\nconst e = `<p class=\"muted\">${t.t('x')}</p>`;")).toEqual([]);
    expect(lint('/* i18n-ignore */\nconst f = `a{outline:3px solid var(--link)}`;')).toEqual([]);
  });

  it('the lint catches user-visible attribute values and single lowercase words (self-test)', () => {
    // Accessible names, tooltips, alt text and hints are user-visible even though they sit in attributes.
    expect(lint('const a = `<nav aria-label="Report sections">`;')).toHaveLength(1);
    expect(lint('const a = `<nav aria-label="sections">`;')).toHaveLength(1);
    expect(lint("const b = '<abbr title=\"severity\">S</abbr>';")).toHaveLength(1);
    expect(lint('const c = `<img alt="logo" src="${src}">`;')).toHaveLength(1);
    expect(lint("const d = `<input placeholder='search'>`;")).toHaveLength(1);
    // Single lowercase words in text content, including split across concatenation.
    expect(lint('const e = `<button>save</button>`;')).toHaveLength(1);
    expect(lint("const f = '<li>' + 'none' + '</li>' + '<p>none';")).toHaveLength(2);
    expect(lint('const g = `<td>${n}</td><td>none</td>`;')).toHaveLength(1);
    expect(lint("const h = '- none';")).toHaveLength(1);
    expect(lint('const i = `## summary`;')).toHaveLength(1);
    // Code stays allowed: class/id/href values, catalog-driven attributes, tag names, keys.
    expect(lint('const j = `<nav aria-label="${t.t(\'nav.label\')}" class="muted top" id="x-y">${a}</nav>`;')).toEqual([]);
    expect(lint("const k = `<span class=\"impact ${key}\">${t.t('x')}</span>`;")).toEqual([]);
    expect(lint("const l = 'impact.critical'; const m = '<br>'; const n = `| --- | --- |`;")).toEqual([]);
  });

  it('en-XA pseudo-locale accents every catalog string in the rendered HTML', () => {
    // Verbatim English (disclaimer, legal wording, shared-component notice, limits) is marked lang="en"; drop it.
    const html = [withBaseline(), withDecisions(), withDecisions(new Date('2027-01-05T00:00:00Z'))].map((r) => scanHtmlV2(r, { lang: 'en-XA' })).join('\n').replace(/<(\w+)[^>]*\blang="en"[^>]*>[\s\S]*?<\/\1>/g, '');
    const md = [withBaseline(), withDecisions(), withDecisions(new Date('2027-01-05T00:00:00Z'))].map((r) => scanMarkdown(r, 'en-XA')).join('\n');
    for (const [key, message] of Object.entries(en)) {
      const literal = message.split(/\{\w+\}/).find((part) => /[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(part));
      if (literal) expect(key.startsWith('md.') ? md : html, message).not.toContain(literal.trim());
    }
    expect(html).toContain('[Éẋéçûţîṽé šûɱɱåŕý');
    expect(md).toContain('## [Þåĝéš');
  });

  it('criterion group headings (incl. best practice) are localized in Markdown/CLI and HTML v2', () => {
    const r = report();
    const t = translator('en-XA');
    const bestPractice = t.t('wcag.bestPracticeGroup');
    for (const lang of ['en-XA', 'ar-XB'] as const) {
      const md = scanMarkdown(r, lang);
      const html = scanHtmlV2(r, { lang });
      for (const out of [md, html]) {
        // ar-XB keeps the English letters inside bidi override marks, so only en-XA can assert absence.
        if (lang === 'en-XA') expect(out).not.toContain(en['wcag.bestPracticeGroup']);
        expect(out).toContain(translator(lang).t('wcag.bestPracticeGroup'));
      }
    }
    const md = scanMarkdown(r, 'en-XA');
    expect(md).toContain(`### ${bestPractice}`);
    // WCAG criterion groups use the catalog template; the criterion number and name are mapping data.
    expect(md).toMatch(/^### \[ŴÇÅĜ 1\.1\.1 /m);
    expect(md).not.toMatch(/^### WCAG /m);
    // en is unchanged: same headings as before the catalog.
    expect(scanMarkdown(r, 'en')).toContain(`### ${en['wcag.bestPracticeGroup']}`);
    expect(scanMarkdown(r, 'en')).toMatch(/^### WCAG 1\.1\.1 /m);
  });

  it('engine attribution is localized, and en matches the pre-catalog attribution()', () => {
    const base = report();
    const r: ScanReport = { ...base, findings: base.findings.map((f) => ({ ...f, engines: ['axe', 'htmlcs<x>'], confidence: { confirmedBy: 2, enginesRan: 3, agreement: 2 / 3 } })) };
    const english = attribution(r.findings[0]!);
    expect(english).toBe('detected by: axe, htmlcs<x>; confirmed by 2 of 3 engines');
    expect(scanMarkdown(r)).toContain(` — ${english} — `);
    expect(scanHtmlV2(r)).toContain(english.replace('<', '&lt;').replace('>', '&gt;'));
    for (const out of [scanMarkdown(r, 'en-XA'), scanHtmlV2(r, { lang: 'en-XA' })]) {
      expect(out).not.toContain('confirmed by 2 of 3');
      expect(out).toContain('ðéţéçţéð ƀý');
    }
  });

  it('templates never render the English ScanGroup.label from lib/scan/report.ts', () => {
    for (const file of TEMPLATES) expect(source(file), file).not.toMatch(/\.label\b/);
  });
});

describe('(b) en output is unchanged (v2 goldens)', () => {
  it('lang en is identical to the default render for HTML v2 and Markdown', () => {
    for (const r of [report(), withBaseline(), report([page('/', [])])]) {
      expect(scanHtmlV2(r, { lang: 'en' })).toBe(scanHtmlV2(r));
      expect(renderScanHtml(r, 2, { lang: 'en' })).toBe(renderScanHtml(r));
      expect(scanMarkdown(r, 'en')).toBe(scanMarkdown(r));
    }
    expect(scanHtmlV2(report())).toMatch(/^<!doctype html>\n<html lang="en">\n/);
  });

  it('the v2 review-decisions section in en is byte-identical to the pre-catalog renderer', () => {
    const later = new Date('2027-01-05T00:00:00Z');
    for (const r of [withDecisions(), withDecisions(later)]) {
      expect(r.findings.some((f) => f.reviewDecision)).toBe(true);
      const html = scanHtmlV2(r);
      const start = html.indexOf('<section id="review-decisions"');
      const section = html.slice(start, html.indexOf('</section>\n', html.indexOf('<p>' + AUTOMATED_TESTING_DISCLAIMER, start)) + '</section>\n'.length);
      // reviewDecisionsHtml is the frozen v1 renderer the v2 report used before A11Y-R58.
      const legacy = reviewDecisionsHtml(r);
      expect(legacy).not.toBe('');
      expect(section).toBe(`<section id="review-decisions" aria-labelledby="review-decisions-h">\n${legacy.replace('<h2>', '<h2 id="review-decisions-h">')}</section>\n`);
      // Markdown: catalog decision text equals the pre-catalog helpers in lib/scan/review.ts and lib/scan/report.ts.
      const md = scanMarkdown(r);
      for (const d of r.findings.flatMap((f) => (f.reviewDecision ? [f.reviewDecision] : []))) {
        expect(md).toContain(`Decision: ${cell(decisionSummary(d))}. Gate: ${gateEffect(d)}.`);
        expect(md).toContain(`[review: ${decisionLabel(d)}]`);
      }
    }
    expect(withDecisions(new Date('2027-01-05T00:00:00Z')).findings.some((f) => f.reviewDecision?.expired)).toBe(true);
  });

  it('--report-lang parses; en is the default and adds nothing to the options', () => {
    for (const argv of [[ORIGIN], [ORIGIN, '--report-lang', 'en']]) {
      const parsed = parseScanArgs(argv);
      expect(parsed).toMatchObject({ ok: true, options: { warnings: [] } });
      expect(parsed.ok && 'reportLang' in parsed.options).toBe(false);
    }
    expect(parseScanArgs([ORIGIN, '--report-lang=ar-XB'])).toMatchObject({ ok: true, options: { reportLang: 'ar-XB', warnings: [expect.stringContaining('pseudo-locale')] } });
    expect(parseScanArgs([ORIGIN, '--report-lang', 'de'])).toMatchObject({ ok: false, error: expect.stringContaining('--report-lang') });
  });
});

describe('(c) RTL pseudo-locale', () => {
  const html = scanHtmlV2(withBaseline(), { lang: 'ar-XB' });

  it('sets dir=rtl and keeps the disclaimer and legal wording verbatim English', () => {
    expect(html).toMatch(/<html lang="ar-XB" dir="rtl">/);
    expect(html).toContain(`<p class="disclaimer" id="disclaimer" lang="en" dir="ltr">${AUTOMATED_TESTING_DISCLAIMER}</p>`);
    expect(html).toContain('<footer lang="en" dir="ltr">');
    for (const text of [DISCLAIMER, LEGAL_DISCLAIMER]) expect(html).toContain(text.replace(/'/g, '&#39;').replace(/"/g, '&quot;'));
    expect(scanMarkdown(withBaseline(), 'ar-XB')).toContain(AUTOMATED_TESTING_DISCLAIMER);
    const decided = scanHtmlV2(withDecisions(), { lang: 'ar-XB' });
    expect(decided).toContain(`<p lang="en" dir="ltr">${REVIEW_DECISION_NOTICE.replace(/'/g, '&#39;')}</p>`);
    expect(decided).toContain(`<p lang="en" dir="ltr">${AUTOMATED_TESTING_DISCLAIMER}</p>\n</section>`);
  });

  const hasChromium = existsSync(chromium.executablePath());
  it.skipIf(!hasChromium).each(PSEUDO_REPORT_LANGS)('%s report scans clean with axe-core (light and dark)', async (lang) => {
    const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
    const browser = await chromium.launch();
    try {
      for (const colorScheme of ['light', 'dark'] as const) {
        const context = await browser.newContext({ bypassCSP: true, colorScheme, javaScriptEnabled: true });
        await context.route('**/*', (route) => route.abort());
        const tab = await context.newPage();
        await tab.setContent(scanHtmlV2(withDecisions(), { lang }));
        expect(await tab.evaluate(() => document.documentElement.dir)).toBe(lang === 'ar-XB' ? 'rtl' : '');
        await tab.addScriptTag({ content: axeSource });
        const result = await tab.evaluate(async (tags) => {
          const axe = (window as unknown as { axe: { run: (ctx: Document, opts: unknown) => Promise<{ violations: { id: string }[] }> } }).axe;
          return axe.run(document, { runOnly: { type: 'tag', values: tags } });
        }, [...AXE_TAGS]);
        expect(result.violations.map((x) => `${colorScheme}: ${x.id}`)).toEqual([]);
        await context.close();
      }
    } finally {
      await browser.close();
    }
  }, 60_000);
});

describe('(d) catalog keys: all used, none missing', () => {
  const sources = TEMPLATES.map(source).join('\n');
  const keys = Object.keys(en);

  it('every catalog key is referenced by a report template', () => {
    const statics = new Set(literals(sources).map((l) => l.text));
    const dynamicPrefixes = [...statics].filter((t) => t.endsWith('\u0000') && t.indexOf('\u0000') === t.length - 1).map((t) => t.slice(0, -1)).filter((p) => p.endsWith('.'));
    const unused = keys.filter((key) => {
      if (statics.has(key)) return false;
      const plural = key.match(/^(.*)\.(one|other)$/);
      if (plural && statics.has(plural[1] as string)) return false;
      return !dynamicPrefixes.some((p) => key.startsWith(p) && !key.slice(p.length).includes('.'));
    });
    expect(unused).toEqual([]);
  });

  it('every key a template asks for exists in the catalog', () => {
    const asked = [...sources.matchAll(/\bt\.(t|plural)\(\s*'([^']+)'/g)].flatMap(([, kind, key]) => (kind === 'plural' ? [`${key}.one`, `${key}.other`] : [key as string]));
    expect(asked.length).toBeGreaterThan(50);
    expect(asked.filter((k) => !keys.includes(k))).toEqual([]);
    expect(() => translator('en').t('no.such.key' as never)).toThrow(/Missing message key/);
  });

  it('every locale has the same keys and placeholders as en; legal wording is not in the catalog', () => {
    const vars = (m: string) => [...m.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort();
    for (const lang of REPORT_LANGS) {
      const catalog = catalogFor(lang);
      expect(Object.keys(catalog)).toEqual(keys);
      for (const key of keys) expect(vars(catalog[key as keyof typeof catalog]), `${lang} ${key}`).toEqual(vars(en[key as keyof typeof en]));
    }
    const all = Object.values(en).join('\n');
    for (const legal of [AUTOMATED_TESTING_DISCLAIMER, DISCLAIMER, LEGAL_DISCLAIMER]) expect(all).not.toContain(legal);
    expect(formatMessage('{a} and {b}', { a: 1, b: 'x' })).toBe('1 and x');
    expect(() => formatMessage('{a}', {})).toThrow(/Missing message variable/);
  });
});
