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
import { AXE_TAGS, buildScanReport, type ScanReport } from '@/lib/scan/report';
import { renderScanHtml, scanHtmlV2 } from '@/lib/scan/report-html-v2';
import { scanMarkdown } from '@/lib/scan/report-markdown';
import type { AxeResults } from '@/lib/types';
import { parseScanArgs } from '@/packages/cli/src/scan';

const ROOT = path.resolve(__dirname, '..');
/** Report templates whose user-visible strings must come from the catalog. */
const TEMPLATES = ['lib/scan/report-html-v2.ts', 'lib/scan/report-markdown.ts'];
const source = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

type Literal = { text: string; line: number; ignored: boolean };

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
        if (!isSpecifier) out.push({ text, line: lineAt(start), ignored });
        continue;
      }
      i += 1;
    }
  }
  scanCode();
  return out;
}

/** Visible prose left in a literal once tags, attributes, entities and placeholders are removed. */
function hardCodedProse(literal: string): string | null {
  const text = literal
    .replace(/<[^>]*>/g, ' ')
    .replace(/\b[\w-]+="[^"]*"/g, ' ')
    .replace(/&#?\w+;/g, ' ')
    .replace(/\u0000/g, ' ');
  // Two words separated by whitespace, or a capitalised word: user-facing prose.
  const prose = text.match(/[A-Za-z]{2,}[ \t\n]+[A-Za-z]{2,}|\b[A-Z][a-z]{2,}\b/);
  return prose ? prose[0] : null;
}

function lint(src: string): string[] {
  return literals(src)
    .filter((l) => !l.ignored)
    .flatMap((l) => {
      const prose = hardCodedProse(l.text);
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

  it('en-XA pseudo-locale accents every catalog string in the rendered HTML', () => {
    // Verbatim English (disclaimer, legal wording, shared-component notice, limits) is marked lang="en"; drop it.
    const html = scanHtmlV2(withBaseline(), { lang: 'en-XA' }).replace(/<(\w+)[^>]*\blang="en"[^>]*>[\s\S]*?<\/\1>/g, '');
    const md = scanMarkdown(withBaseline(), 'en-XA');
    for (const [key, message] of Object.entries(en)) {
      const literal = message.split(/\{\w+\}/).find((part) => /[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(part));
      if (literal) expect(key.startsWith('md.') ? md : html, message).not.toContain(literal.trim());
    }
    expect(html).toContain('[Éẋéçûţîṽé šûɱɱåŕý');
    expect(md).toContain('## [Þåĝéš');
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
        await tab.setContent(scanHtmlV2(withBaseline(), { lang }));
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
