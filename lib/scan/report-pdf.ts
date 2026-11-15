/**
 * PDF export of HTML report v2 (A11Y-R53).
 *
 * The PDF is HTML report v2 printed by the local Chromium (`page.pdf`), with a
 * cover page (site, scan date, commit, engines, scope), a table of contents
 * with page numbers and the disclaimer on the cover and in the footer of every
 * page. This module only builds the HTML source and the footer template; the
 * CLI (`a11ygate report pdf`) does the printing.
 *
 * Rules: user-visible strings come from the message catalog (locales/en.json);
 * the disclaimer comes verbatim from lib/copy.ts and is never translated. No
 * external URL literals, no scripts, no remote assets.
 */
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { DEFAULT_REPORT_LANG, type ReportLang, type Translator } from '@/lib/i18n';
import type { ScanReport } from '@/lib/scan/report';
import { htmlTranslator, scanHtmlV2, type ScanHtmlOptions } from '@/lib/scan/report-html-v2';

export type PdfCoverMeta = {
  /** Commit SHA the scan belongs to, when known. */
  commit?: string | null;
};

export type PdfSourceOptions = ScanHtmlOptions & {
  /** Page number of each TOC entry, keyed by section id. Unknown entries print as 0 (first pass). */
  tocPages?: Readonly<Record<string, number>>;
};

export type TocEntry = { id: string; text: string };

/** Page geometry shared by the CLI and the tests, so the footer has room. */
/* i18n-ignore */
export const PDF_PAGE = { format: 'A4', margin: { top: '14mm', bottom: '22mm', left: '14mm', right: '14mm' } } as const;

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function verbatimAttrs(t: Translator): string {
  return t.lang === 'en' ? '' : ' lang="en" dir="ltr"';
}

const HEADER = /<header>\n[\s\S]*?\n<\/header>\n/;
const NAV_ITEM = /<li><a href="#([\w-]+)">([^<]*)<\/a><\/li>/g;

/** The sections of report v2, in order, taken from its own navigation (labels already escaped). */
export function tocEntries(v2Html: string): TocEntry[] {
  const header = v2Html.match(HEADER)?.[0] ?? '';
  return [...header.matchAll(NAV_ITEM)].map((m) => ({ id: m[1] as string, text: m[2] as string }));
}

function coverFacts(t: Translator, report: ScanReport, meta: PdfCoverMeta): [string, string][] {
  const engines = report.engines?.used.length
    ? esc(report.engines.used.join(', '))
    : t.t('summary.axeEngine', { version: report.axeVersion === null ? t.t('summary.notAvailable') : esc(report.axeVersion) });
  const c = report.counts;
  return [
    [t.t('pdf.cover.site'), `<code>${esc(report.startUrl)}</code>`],
    [t.t('pdf.cover.scanDate'), esc(report.scannedAt)],
    [t.t('pdf.cover.commit'), meta.commit ? `<code>${esc(meta.commit)}</code>` : t.t('pdf.cover.commitUnknown')],
    [t.t('pdf.cover.engines'), engines],
    [t.t('pdf.cover.scope'), t.t('pdf.cover.scopeValue', { pages: t.plural('plural.page', c.pagesScanned), maxPages: report.options.maxPages, failed: c.pagesFailed, skipped: c.skippedLinks, origin: `<code>${esc(report.origin)}</code>` })],
    [t.t('pdf.cover.verdict'), t.t('summary.verdict', { verdict: esc(report.verdict) })],
    [t.t('pdf.cover.tool'), t.t('summary.scannedWith', { scannedAt: esc(report.scannedAt), version: esc(report.version) })],
  ];
}

/* i18n-ignore */
const PDF_STYLE = `
@page{size:A4}
@media print{
body{font-size:10.5pt}
.cover{break-after:page;padding-top:30mm}
.cover h1{font-size:24pt;margin-bottom:12mm}
.cover dl{display:grid;grid-template-columns:auto 1fr;gap:2mm 6mm;margin:0 0 12mm}
.cover dt{font-weight:700}.cover dd{margin:0}
nav.toc{display:block;break-after:page}
.toc ol{list-style:none;padding:0}
.toc a{display:flex;gap:2mm;text-decoration:none}
.toc .fill{flex:1;border-bottom:1px dotted #000;margin-bottom:1.2mm}
.toc .num{font-variant-numeric:tabular-nums}
#summary{break-before:auto}
}`;

/**
 * Self-contained HTML that Chromium prints to PDF: report v2 with its header
 * replaced by a cover page and a table of contents.
 */
export function pdfSourceHtml(report: ScanReport, meta: PdfCoverMeta = {}, options: PdfSourceOptions = {}): string {
  const { tocPages, ...htmlOptions } = options;
  const v2 = scanHtmlV2(report, htmlOptions);
  const t = htmlTranslator(htmlOptions.lang ?? DEFAULT_REPORT_LANG);
  const facts = coverFacts(t, report, meta).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('\n');
  const toc = tocEntries(v2)
    .map((e) => `<li><a href="#${e.id}"><span>${e.text}</span><span class="fill"></span><span class="num">${t.t('pdf.toc.page', { page: tocPages?.[e.id] ?? 0 })}</span></a></li>`)
    .join('\n');
  const front = `<header class="cover">
<h1>${t.t('html.heading')}</h1>
<dl>
${facts}
</dl>
<p class="disclaimer" id="disclaimer"${verbatimAttrs(t)}>${esc(AUTOMATED_TESTING_DISCLAIMER)}</p>
</header>
<nav class="toc" aria-labelledby="toc-h">
<h2 id="toc-h">${t.t('pdf.toc.heading')}</h2>
<ol>
${toc}
</ol>
</nav>
`;
  return v2.replace(HEADER, () => front).replace('\n</style>', () => `${PDF_STYLE}\n</style>`);
}

/**
 * Chromium footer template: the disclaimer (verbatim) and "Page n of m" on
 * every page. Chromium fills `pageNumber` / `totalPages`.
 */
export function pdfFooterTemplate(lang: ReportLang = DEFAULT_REPORT_LANG): string {
  const t = htmlTranslator(lang);
  const page = t.t('pdf.footer.page', { page: '<span class="pageNumber"></span>', total: '<span class="totalPages"></span>' });
  return `<div style="font:8pt system-ui,sans-serif;color:#000;width:100%;margin:0 14mm;display:flex;justify-content:space-between;gap:6mm"${t.dir === 'rtl' ? ' dir="rtl"' : ''}><span${verbatimAttrs(t)}>${esc(AUTOMATED_TESTING_DISCLAIMER)}</span><span>${page}</span></div>`;
}

/** Empty header: Chromium otherwise prints the title and date. */
export const PDF_HEADER_TEMPLATE = '<span></span>';
