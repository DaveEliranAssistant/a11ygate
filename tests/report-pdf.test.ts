/**
 * A11Y-R53: `a11ygate report pdf` prints report v2 to PDF with the local Chromium.
 * (a) the extracted PDF text has the disclaimer on every page plus the cover fields;
 * (b) the page count is in the expected range for the fixture;
 * (c) the PDF source HTML scans clean with A11yGate's axe setup (dogfood);
 * (d) PDF title and language metadata are set and the PDF is tagged.
 */
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { AXE_TAGS, buildScanReport, type ScanReport } from '@/lib/scan/report';
import { pdfFooterTemplate, pdfSourceHtml, tocEntries } from '@/lib/scan/report-pdf';
import { scanHtmlV2 } from '@/lib/scan/report-html-v2';
import { namedDestinationPages } from '@/lib/scan/pdf-dests';
import { parseReportPdfArgs, runReportPdf } from '@/packages/cli/src/report-pdf';
import { run } from '@/packages/cli/src/run';
import type { AxeResults } from '@/lib/types';

const ORIGIN = 'https://site.test';
const COMMIT = '0123456789abcdef0123456789abcdef01234567';
type Violation = AxeResults['violations'][number];
const v = (id: string, impact: Violation['impact'], tags: string[], help: string, targets: string[]): Violation => ({
  id, impact, tags, help, helpUrl: `https://dequeuniversity.com/rules/axe/4.14/${id}`, nodes: targets.map((t) => ({ target: [t], html: `<${t}>` })),
});
const IMAGE_ALT = v('image-alt', 'critical', ['wcag2a', 'wcag111'], 'Images must have alternative text', ['img']);
const CONTRAST = v('color-contrast', 'serious', ['wcag2aa', 'wcag143'], 'Elements must meet minimum color contrast ratio thresholds', ['p.faint', 'a.nav']);
const REGION = v('region', 'moderate', ['best-practice'], 'All page content should be contained by landmarks', ['div', 'section.hero', 'footer']);
const LABEL = v('label', 'critical', ['wcag2a', 'wcag412'], 'Form elements must have labels', ['input#q']);

function page(p: string, violations: Violation[]) {
  const url = `${ORIGIN}${p}`;
  return { url, finalUrl: url, status: 200, scanStatus: 'complete' as const, result: { url, timestamp: '2026-11-14T10:00:00.000Z', testEngine: { version: '4.14.0' }, violations, toolOptions: {}, scanConfig: {}, scanStatus: 'complete' } as AxeResults };
}

/** Fixture: 6 pages, 4 rules, one failed page and one robots-skipped link. */
function fixture(): ScanReport {
  const pages = [
    page('/', [IMAGE_ALT, REGION, CONTRAST]), page('/about', [CONTRAST, REGION]), page('/contact', [REGION, LABEL]),
    page('/shop', [IMAGE_ALT, CONTRAST, REGION]), page('/shop/cart', [LABEL, REGION]), page('/help', []),
  ];
  return buildScanReport({
    crawl: { pages: [...pages, { url: `${ORIGIN}/gone`, finalUrl: `${ORIGIN}/gone`, status: 404, scanStatus: 'failed', error: 'HTTP 404' }], skipped: [{ url: `${ORIGIN}/private/`, reason: 'robots' }] },
    version: '0.2.0', scannedAt: '2026-11-14T10:00:00.000Z', startUrl: `${ORIGIN}/`, failOn: 'serious',
    maxPages: 20, delayMs: 1000, userAgent: 'A11yGate/test', robotsNote: 'robots.txt honoured.',
  });
}

/** Whitespace-normalised text of each PDF page, via pdfjs-dist (devDependency). */
async function pdfInfo(bytes: Uint8Array) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, isEvalSupported: false }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' ').replace(/\s+/g, ' '));
  }
  const meta = await doc.getMetadata();
  const markInfo = await doc.getMarkInfo();
  const outline = await doc.getOutline();
  await doc.destroy();
  return { pages, info: meta.info as Record<string, unknown>, markInfo, outline };
}

describe('report pdf source and arguments (no browser)', () => {
  it('replaces the v2 header with a cover and TOC, keeps the rest of report v2', () => {
    const r = fixture();
    const html = pdfSourceHtml(r, { commit: COMMIT }, { tocPages: { summary: 3 } });
    const v2 = scanHtmlV2(r);
    expect(html).toContain('<header class="cover">');
    expect(html).toContain(`<p class="disclaimer" id="disclaimer">${AUTOMATED_TESTING_DISCLAIMER}</p>`);
    expect(html).toContain(`<dt>Commit</dt><dd><code>${COMMIT}</code></dd>`);
    expect(html).toContain('<span class="num">page 3</span>');
    expect(tocEntries(html)).toEqual([]);
    expect(tocEntries(v2).map((e) => e.id)).toEqual(['summary', 'top-fixes', 'shared-components', 'by-wcag', 'by-page', 'how-to-fix', 'limits']);
    expect(html.slice(html.indexOf('<main>'))).toBe(v2.slice(v2.indexOf('<main>')));
    expect(pdfSourceHtml(r)).toContain('<dt>Commit</dt><dd>not recorded</dd>');
    expect(pdfSourceHtml(r)).not.toMatch(/<script|https?:\/\/(?!site\.test|dequeuniversity\.com|www\.w3\.org)/);
    expect(pdfFooterTemplate()).toContain(AUTOMATED_TESTING_DISCLAIMER);
    expect(pdfFooterTemplate()).toContain('Page <span class="pageNumber"></span> of <span class="totalPages"></span>');
  });

  it('parses arguments', () => {
    expect(parseReportPdfArgs(['out', '-o', 'r.pdf', '--commit', 'ABCDEF1'])).toEqual({ ok: true, options: { input: 'out', out: 'r.pdf', commit: 'abcdef1', help: false, warnings: [] } });
    expect(parseReportPdfArgs(['out'])).toMatchObject({ ok: true, options: { out: 'a11ygate-report.pdf' } });
    expect(parseReportPdfArgs([])).toMatchObject({ ok: false });
    expect(parseReportPdfArgs(['out', '--commit', 'nope'])).toMatchObject({ ok: false, error: expect.stringContaining('--commit') });
    expect(parseReportPdfArgs(['out', '--report-lang', 'de'])).toMatchObject({ ok: false });
    expect(parseReportPdfArgs(['out', '--bogus'])).toMatchObject({ ok: false });
  });

  it('help and errors exit 0 and 2', async () => {
    let out = '';
    expect(await run(['report', 'pdf', '--help'], { stdout: (s: string) => { out += s; } } as never)).toBe(0);
    expect(out).toContain('a11ygate report pdf <scan.json|out-dir>');
    expect(out).toContain(AUTOMATED_TESTING_DISCLAIMER);
    let err = '';
    expect(await runReportPdf(['/no/such/dir'], { stderr: (s) => { err += s; }, gitHead: async () => null })).toBe(2);
    expect(err).toContain('Could not read report');
  });
});

const hasChromium = (() => { try { return existsSync(chromium.executablePath()); } catch { return false; } })();

describe.skipIf(!hasChromium)('a11ygate report pdf with the local Chromium', () => {
  let dir: string;
  let bytes: Buffer;
  let info: Awaited<ReturnType<typeof pdfInfo>>;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'a11ygate-pdf-'));
    await writeFile(path.join(dir, 'a11ygate-scan.json'), JSON.stringify(fixture(), null, 2));
    let out = '';
    let err = '';
    const code = await runReportPdf([dir, '-o', 'report.pdf', '--commit', COMMIT], { cwd: dir, stdout: (s) => { out += s; }, stderr: (s) => { err += s; } });
    expect(err).toBe('');
    expect(code).toBe(0);
    expect(out).toContain('Wrote report.pdf');
    expect(out).toContain(AUTOMATED_TESTING_DISCLAIMER);
    bytes = await readFile(path.join(dir, 'report.pdf'));
    info = await pdfInfo(bytes);
  }, 120_000);

  afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it('(a) the disclaimer is on every page, the cover has site, scan date, commit, engines and scope', () => {
    expect(info.pages.length).toBeGreaterThan(1);
    for (const [i, text] of info.pages.entries()) {
      expect(text, `page ${i + 1}`).toContain(AUTOMATED_TESTING_DISCLAIMER);
      expect(text, `page ${i + 1}`).toContain(`Page ${i + 1} of ${info.pages.length}`);
    }
    const cover = info.pages[0] as string;
    expect(cover).toContain('A11yGate accessibility scan report');
    expect(cover).toMatch(/Site https:\/\/site\.test\//);
    expect(cover).toContain('Scan date 2026-11-14T10:00:00.000Z');
    expect(cover).toContain(`Commit ${COMMIT}`);
    expect(cover).toMatch(/Engines axe-core 4\.14\.0/);
    expect(cover).toContain('Scope 6 pages scanned (at most 20), 1 failed, 1 links skipped; same origin as');
    // pdfjs may split monospaced runs into several items, so compare without spaces.
    expect(cover.replace(/ /g, '')).toContain('sameoriginashttps://site.testVerdict');
    // Cover is its own page; the TOC follows on page 2.
    expect(cover).not.toContain('Executive summary');
    expect(info.pages[1]).toContain('Contents');
  });

  it('(a) the table of contents page numbers point at the pages where each section starts', () => {
    const toc = info.pages[1] as string;
    const dests = namedDestinationPages(bytes);
    const headings: Record<string, string> = { summary: 'Executive summary', 'how-to-fix': 'How to fix', limits: 'What automated testing does not cover' };
    for (const [id, heading] of Object.entries(headings)) {
      const n = dests.get(id) as number;
      expect(n, id).toBeGreaterThan(2);
      expect(toc).toMatch(new RegExp(`${heading}[^]*?page ${n}\\b`));
      expect(info.pages[n - 1], `${id} on page ${n}`).toContain(heading);
    }
    expect(toc).not.toContain('page 0');
  });

  it('(b) page count is in the expected range for the fixture', () => {
    // Cover + TOC + summary/top fixes + by WCAG/page + how-to-fix (4 rules) + limits.
    expect(info.pages.length).toBeGreaterThanOrEqual(6);
    expect(info.pages.length).toBeLessThanOrEqual(14);
  });

  it('(d) title and language metadata are set, the PDF is tagged with an outline, text is not rasterised', () => {
    expect(info.info.Title).toBe('A11yGate accessibility scan report — https://site.test/');
    expect(info.info.Language).toBe('en');
    expect(info.markInfo?.Marked).toBe(true);
    expect(bytes.toString('latin1')).toContain('/StructTreeRoot');
    expect(info.outline?.length).toBeGreaterThan(0);
    // Selectable text: every page has extractable text, and no page is a single full-page image.
    expect(bytes.toString('latin1')).not.toMatch(/\/Subtype\s*\/Image/);
  });

  it('is deterministic apart from timestamps', async () => {
    await runReportPdf([dir, '-o', 'again.pdf', '--commit', COMMIT], { cwd: dir, stdout: () => {}, stderr: () => {} });
    const again = await readFile(path.join(dir, 'again.pdf'));
    const strip = (b: Buffer) => b.toString('latin1').replace(/\/(CreationDate|ModDate)\s*\([^)]*\)/g, '').replace(/<xmp:[^>]*>[^<]*<\/xmp:[^>]*>/g, '');
    expect(strip(again)).toBe(strip(bytes));
  }, 60_000);

  it('(c) the PDF source HTML scans clean with A11yGate axe (dogfood)', async () => {
    const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
    const browser = await chromium.launch();
    try {
      for (const media of ['screen', 'print'] as const) {
        const context = await browser.newContext({ bypassCSP: true, colorScheme: 'light', javaScriptEnabled: true });
        await context.route('**/*', (route) => route.abort());
        const tab = await context.newPage();
        await tab.emulateMedia({ media });
        await tab.setContent(pdfSourceHtml(fixture(), { commit: COMMIT }, { tocPages: { summary: 3 } }));
        await tab.addScriptTag({ content: axeSource });
        const result = await tab.evaluate(async (tags) => {
          const axe = (window as unknown as { axe: { run: (ctx: Document, opts: unknown) => Promise<{ violations: { id: string }[] }> } }).axe;
          return axe.run(document, { runOnly: { type: 'tag', values: tags } });
        }, [...AXE_TAGS]);
        expect(result.violations.map((x) => `${media}: ${x.id}`)).toEqual([]);
        await context.close();
      }
    } finally {
      await browser.close();
    }
  }, 60_000);
});
