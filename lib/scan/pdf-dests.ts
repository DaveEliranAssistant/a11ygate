/**
 * Minimal reader for the named destinations Chromium (Skia/PDF) writes for
 * internal link targets. Used to put real page numbers in the PDF table of
 * contents (A11Y-R53): print once, read on which page each `#id` landed,
 * print again with those numbers.
 *
 * Supports what Skia emits: uncompressed indirect objects, a `/Dests`
 * dictionary in the catalog and a `/Pages` tree with `/Kids`. Anything else
 * yields an empty map, and callers fall back to a TOC without numbers.
 */

function objectBody(pdf: string, num: number): string | null {
  const start = new RegExp(`(?:^|[\\r\\n\\s])${num} 0 obj\\b`).exec(pdf);
  if (!start) return null;
  const end = pdf.indexOf('endobj', start.index);
  return end < 0 ? null : pdf.slice(start.index, end);
}

function ref(text: string, key: string): number | null {
  const m = new RegExp(`/${key}\\s+(\\d+)\\s+0\\s+R`).exec(text);
  return m ? Number(m[1]) : null;
}

/** Page object numbers in document order, walking the /Pages tree. */
function pageOrder(pdf: string, node: number, seen = new Set<number>()): number[] {
  if (seen.has(node)) return [];
  seen.add(node);
  const body = objectBody(pdf, node);
  if (!body) return [];
  // Strip the page content so only the dictionary is inspected.
  const dict = body.split(/\bstream\b/)[0] ?? '';
  if (/\/Type\s*\/Page\b(?!s)/.test(dict)) return [node];
  const kids = /\/Kids\s*\[([^\]]*)\]/.exec(dict);
  if (!kids) return [];
  return [...(kids[1] ?? '').matchAll(/(\d+)\s+0\s+R/g)].flatMap((m) => pageOrder(pdf, Number(m[1]), seen));
}

function decodeName(name: string): string {
  return name.replace(/#([0-9a-fA-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** Map of destination name (the HTML element id) to 1-based page number. */
export function namedDestinationPages(pdfBytes: Uint8Array): Map<string, number> {
  const out = new Map<string, number>();
  const pdf = Buffer.from(pdfBytes).toString('latin1');
  const rootNum = [...pdf.matchAll(/\/Root\s+(\d+)\s+0\s+R/g)].at(-1)?.[1];
  const catalog = rootNum ? objectBody(pdf, Number(rootNum)) : null;
  if (!catalog) return out;
  const pagesNum = ref(catalog, 'Pages');
  const pages = pagesNum === null ? [] : pageOrder(pdf, pagesNum);
  const destsNum = ref(catalog, 'Dests');
  const dests = destsNum === null ? null : objectBody(pdf, destsNum);
  if (!dests || pages.length === 0) return out;
  for (const m of dests.matchAll(/\/([^\s/[\]<>()]+)\s*\[\s*(\d+)\s+0\s+R/g)) {
    const index = pages.indexOf(Number(m[2]));
    if (index >= 0) out.set(decodeName(m[1] as string), index + 1);
  }
  return out;
}
