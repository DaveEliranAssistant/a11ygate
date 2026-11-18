/** Whitespace-normalised text of each PDF page, via pdfjs-dist (devDependency). */
export async function pdfInfo(bytes: Uint8Array) {
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
