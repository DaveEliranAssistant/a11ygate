import type { Page } from 'playwright';

export const REDACTION_COLOR = '#000000';
export const DEFAULT_REDACT_SELECTORS = ['input[type="password"]', '[autocomplete*="cc-"]', '[data-a11ygate-redact]'];

/** Capture only after all masks are installed; always remove them, including on failure. */
export async function redactedScreenshot(page: Page, selectors: readonly string[] = []): Promise<Buffer> {
  // A closed shadow root keeps page CSS from making masks transparent. A manual popover
  // top-layer host covers even dialogs/popovers, without changing target styles.
  const host = await page.evaluateHandle((selectors) => {
    const targets = new Set<Element>();
    const collect = (root: Document | ShadowRoot) => {
      for (const selector of selectors) for (const element of root.querySelectorAll(selector)) targets.add(element);
      // Cover frames wholesale, including frames inside open shadow roots.
      for (const frame of root.querySelectorAll('iframe, frame')) targets.add(frame);
      for (const element of root.querySelectorAll('*')) if (element.shadowRoot) collect(element.shadowRoot);
    };
    collect(document); // Invalid selectors throw before any screenshot is taken.
    const rectangles = [...targets].flatMap(element => [...element.getClientRects()].map(rect => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })));
    const host = document.createElement('div');
    host.setAttribute('popover', 'manual');
    host.setAttribute('aria-hidden', 'true');
    host.setAttribute('data-a11ygate-screenshot-mask', '');
    host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;margin:0!important;padding:0!important;border:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;background:transparent!important;pointer-events:none!important;opacity:1!important;';
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = ':host::backdrop{background:transparent!important}';
    root.append(style);
    for (const rect of rectangles) {
      const mask = document.createElement('div');
      const left = Math.floor(rect.x), top = Math.floor(rect.y);
      mask.style.cssText = `position:fixed;left:${left}px;top:${top}px;width:${Math.ceil(rect.x + rect.width) - left}px;height:${Math.ceil(rect.y + rect.height) - top}px;background:#000;opacity:1;`;
      root.append(mask);
    }
    document.documentElement.append(host);
    try { host.showPopover(); }
    catch (error) { host.remove(); throw error; }
    return host;
  }, [...DEFAULT_REDACT_SELECTORS, ...selectors]);
  try {
    // Viewport capture avoids full-page scrolling changing fixed/sticky positions.
    return await page.screenshot({ type: 'png', caret: 'hide' });
  } finally {
    await host.evaluate(element => element.remove()).finally(() => host.dispose());
  }
}
