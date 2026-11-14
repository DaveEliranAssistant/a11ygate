import type { Page } from 'playwright';
import type { NormalizedFinding } from './normalized';

/** Resolve unique locators in the actual document instead of guessing whether
 * CSS and XPath strings refer to the same node. Ambiguous/unsupported locators
 * retain their conservative textual identity; snippets are never identity keys.
 */
export async function resolveElementKeys(page: Page, findings: NormalizedFinding[]): Promise<NormalizedFinding[]> {
  const keys = await page.evaluate((selectors) => selectors.map((selector) => {
    try {
      let element: Element | null = null;
      if (selector.startsWith('/') || selector.startsWith('xpath=')) {
        const nodes = document.evaluate(selector.replace(/^xpath=/, ''), document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE);
        if (nodes.snapshotLength === 1) element = nodes.snapshotItem(0) as Element;
      } else {
        const nodes = document.querySelectorAll(selector);
        if (nodes.length === 1) element = nodes[0]!;
      }
      if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
      const parts: string[] = [];
      while (element) {
        const tag = element.localName;
        let index = 1;
        let sibling = element.previousElementSibling;
        while (sibling) {
          if (sibling.localName === tag) index += 1;
          sibling = sibling.previousElementSibling;
        }
        parts.unshift(`${tag}:nth-of-type(${index})`);
        element = element.parentElement;
      }
      return parts.join('>');
    } catch { return null; }
  }), findings.map((f) => f.selector));
  return findings.map((f, i) => keys[i] ? { ...f, elementKey: keys[i]! } : f);
}
