import type { Page } from 'playwright';
import { getCriterion, understandingUrl } from '@/lib/mapping';
import type { ScanFinding } from './report';

export const KEYBOARD_DISCLAIMER = 'Keyboard checks are heuristics and need human review. Absence of findings does not confirm keyboard accessibility. Outline/box-shadow changes do not establish indicator visibility, contrast or conformance.';
export type KeyboardOptions = { budget: number; pixelThreshold?: number };
type ProbeWindow = Window & { __a11ygateKeyboard?: HTMLElement[] };

export type KeyboardObservation = { step: number; selector: string | null; domIndex: number | null; indicatorChanged: boolean | null; key?: string };
export type KeyboardResult = { url: string; steps: number; stopReason: 'cycle' | 'trap' | 'budget'; observations: KeyboardObservation[]; findings: ScanFinding[]; notAssessedFrames?: string[] };

/** Bounded keyboard heuristics. Arrow keys can change composite-widget state. */
export async function scanKeyboard(page: Page, url: string, options: KeyboardOptions): Promise<KeyboardResult> {
  if (!Number.isInteger(options.budget) || options.budget < 1 || options.budget > 1000) throw new Error('Keyboard budget must be from 1 to 1000.');
  const threshold = options.pixelThreshold ?? 0.01;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error('Keyboard pixel threshold must be from 0 to 1.');
  const candidates = await page.evaluate(() => {
    // Freshly loaded pages normally start at the document. Preserve that native
    // starting point so positive tabindex controls are included.
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) document.activeElement.blur();
    const elements: HTMLElement[] = [];
    const paths = new Map<Element, string>();
    const walk = (root: Document | ShadowRoot, prefix = '') => {
      for (const el of root.querySelectorAll<HTMLElement>('*')) {
        const parts: string[] = [];
        for (let node: Element | null = el; node; node = node.parentElement) {
          const siblings = node.parentElement?.children ?? root.children;
          parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${[...siblings].indexOf(node) + 1})`);
        }
        const selector = prefix + parts.join(' > ');
        paths.set(el, selector);
        if (el.matches('a[href],area[href],button,input:not([type="hidden"]),select,textarea,summary,[tabindex],[contenteditable="true"],[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="switch"],[role="textbox"]')) elements.push(el);
        if (el.shadowRoot) walk(el.shadowRoot, selector + ' >>> ');
        if (el.tagName === 'IFRAME') {
          try { const doc = (el as HTMLIFrameElement).contentDocument; if (doc) walk(doc, selector + ' >> frame >> '); } catch { /* Cross-origin: recorded separately. */ }
        }
      }
    };
    walk(document);
    const visible = elements.filter(el => {
      const style = el.ownerDocument.defaultView!.getComputedStyle(el);
      return !el.matches(':disabled') && !el.closest('[inert]') && el.getClientRects().length > 0 && style.visibility === 'visible' && style.display !== 'none';
    });
    (window as ProbeWindow).__a11ygateKeyboard = visible;
    return visible.map(el => {
      const style = el.ownerDocument.defaultView!.getComputedStyle(el);
      const composite = el.closest('[role="tablist"],[role="menu"],[role="listbox"],[role="grid"],[role="radiogroup"]');
      const members = composite ? visible.filter(item => composite.contains(item)) : [];
      const roving = members.length > 1 && members.filter(item => item.tabIndex === 0).length === 1;
      return { selector: paths.get(el)!, outline: `${style.outlineStyle}|${style.outlineWidth}|${style.outlineColor}`, shadow: style.boxShadow, html: el.outerHTML.slice(0, 1000),
        composite: roving ? members.map(item => visible.indexOf(item)) : [], tabIndex: el.tabIndex };
    });
  });
  const findings: ScanFinding[] = [];
  const keys = new Set<string>();
  const add = (rule: string, sc: string, index: number, message: string) => {
    const candidate = candidates[index];
    if (!candidate || keys.has(rule + index)) return;
    keys.add(rule + index);
    const criterion = getCriterion(sc)!;
    findings.push({ pageUrl: url, ruleId: `keyboard-${rule}`, impact: 'moderate', selector: candidate.selector, selectors: [candidate.selector], html: candidate.html,
      help: `Needs human review: ${message}`, helpUrl: understandingUrl(criterion)!, tags: [sc], wcag: [criterion], bestPractice: false,
      fingerprint: JSON.stringify([url, `keyboard-${rule}`, candidate.selector]), reviewStatus: 'needs human review' });
  };
  const observe = () => page.evaluate(items => {
    let el: Element | null = document.activeElement;
    while (el) {
      const inner = el.shadowRoot?.activeElement ?? (el.tagName === 'IFRAME' ? (el as HTMLIFrameElement).contentDocument?.activeElement : null);
      if (!inner || inner === inner.ownerDocument.body || inner === inner.ownerDocument.documentElement) break;
      el = inner;
    }
    if (!el || el === document.body || el === document.documentElement) return { selector: null, domIndex: null, indicatorChanged: null };
    const index = (window as ProbeWindow).__a11ygateKeyboard?.indexOf(el as HTMLElement) ?? -1;
    const style = el.ownerDocument.defaultView!.getComputedStyle(el);
    const base = items[index];
    const outline = `${style.outlineStyle}|${style.outlineWidth}|${style.outlineColor}`;
    const visibleOutline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0 && style.outlineColor !== 'rgba(0, 0, 0, 0)';
    return { selector: base?.selector ?? el.tagName.toLowerCase(), domIndex: index < 0 ? null : index,
      indicatorChanged: base ? (visibleOutline && outline !== base.outline) || (style.boxShadow !== 'none' && style.boxShadow !== base.shadow) : null };
  }, candidates);
  const observations: KeyboardObservation[] = [];
  const reached = new Set<number>();
  const tabOrder: number[] = [];
  let previous: number | null = null;
  let previousSelector: string | null = null;
  let stuck = 0;
  let stopReason: KeyboardResult['stopReason'] = 'budget';
  while (observations.length < options.budget) {
    const step = observations.length + 1;
    await page.keyboard.press('Tab');
    const observed = await observe();
    const firstVisit = observed.domIndex !== null && !reached.has(observed.domIndex);
    if (firstVisit && observed.indicatorChanged === false && typeof page.evaluateHandle === 'function') {
      observed.indicatorChanged = await pixelIndicator(page, observed.domIndex!, threshold);
    }
    observations.push({ step, ...observed });
    const index = observed.domIndex;
    if (index !== null) tabOrder.push(index);
    // A repeated document boundary is a complete forward traversal, not a trap.
    if (observed.selector === null && reached.size > 0) { stopReason = 'cycle'; break; }
    if (index !== null) {
      if (previous !== null && index < previous - 3 && !reached.has(index)) add('order-jump', 'wcag243', index, 'Focus jumped backward by more than three interactive DOM positions. Review whether the order preserves meaning.');
      if (firstVisit && observed.indicatorChanged === false) add('focus-indicator', 'wcag247', index, 'No outline, box-shadow or bounding-box pixel change above the configured threshold was observed on keyboard focus. Review the visible focus indicator.');
      reached.add(index);
      const members = candidates[index].composite ?? [];
      if (firstVisit && members.length && typeof page.evaluateHandle === 'function') {
        let moved = false;
        let attempted = 0;
        for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
          if (observations.length >= options.budget) break;
          await page.keyboard.press(key);
          attempted++;
          const arrow = await observe();
          observations.push({ step: observations.length + 1, key, ...arrow });
          if (arrow.domIndex !== null && arrow.domIndex !== index && members.includes(arrow.domIndex)) moved = true;
          // Restore the Tab entry point without activating a control.
          await page.evaluate(({ index, members, values }) => {
            const elements = (window as ProbeWindow).__a11ygateKeyboard;
            members.forEach((member, i) => { if (elements?.[member]) elements[member].tabIndex = values[i]; });
            elements?.[index].focus();
          }, { index, members, values: members.map(member => candidates[member].tabIndex) });
        }
        if (!moved && attempted === 4) add('composite', 'wcag211', index, 'No arrow-key focus movement was observed inside this roving-tabindex composite. Review keyboard operation.');
        // Roving descendants are one Tab stop; arrow operation is reported separately.
        members.forEach(member => reached.add(member));
      }
    }
    stuck = observed.selector !== null && observed.selector === previousSelector ? stuck + 1 : 0;
    if (stuck >= 3 && index !== null) { add('trap', 'wcag212', index, 'Focus stayed on the same element for three consecutive Tab presses. Review keyboard escape behavior.'); stopReason = 'trap'; break; }
    // Two complete repetitions provide evidence of a small closed focus cycle.
    const history = tabOrder;
    let cycle = false;
    for (let size = 2; size <= 5; size++) {
      const tail = history.slice(-size);
      if (history.length >= size * 3 && new Set(tail).size === size &&
        tail.every((value, i) => value === history[history.length - size * 2 + i] && value === history[history.length - size * 3 + i])) cycle = true;
    }
    if (cycle && index !== null) { add('trap', 'wcag212', index, 'Focus repeated a cycle of two to five elements without reaching the document boundary. Review keyboard escape behavior.'); stopReason = 'trap'; break; }
    previous = index; previousSelector = observed.selector;
  }
  // Budget exhaustion is incomplete evidence, not proof that a control is unreachable.
  if (stopReason === 'cycle') candidates.forEach((_, index) => {
    if (!reached.has(index)) add('unreachable', 'wcag211', index, 'This visible interactive candidate was not reached during a forward Tab traversal. Review keyboard operation and composite-widget arrow keys.');
  });
  if (stopReason === 'cycle') {
    const forward = [...tabOrder];
    for (const expected of forward.reverse()) {
      if (observations.length >= options.budget) break;
      await page.keyboard.press('Shift+Tab');
      const reverse = await observe();
      observations.push({ step: observations.length + 1, key: 'Shift+Tab', ...reverse });
      const members = candidates[expected].composite ?? [];
      if (reverse.domIndex !== expected && !(reverse.domIndex !== null && members.includes(reverse.domIndex))) {
        add('reverse-order', 'wcag243', expected, 'Shift+Tab did not retrace the forward focus order. Review whether the order preserves meaning.');
        break;
      }
    }
  }
  const notAssessedFrames = page.frames ? page.frames().filter(frame => {
    if (frame === page.mainFrame()) return false;
    try { return new URL(frame.url()).origin !== new URL(page.url()).origin && !['about:blank', 'about:srcdoc'].includes(frame.url()); } catch { return true; }
  }).map(frame => `not assessed: ${frame.url()}`) : [];
  return { url, steps: observations.length, stopReason, observations, findings, ...(notAssessedFrames.length ? { notAssessedFrames } : {}) };
}

/** Compare equal-sized PNG crops as decoded RGBA pixels, never compressed bytes.
 * Captures stay in memory; screenshots are not added to reports or disk.
 */
async function pixelIndicator(page: Page, index: number, threshold: number): Promise<boolean | null> {
  const handle = await page.evaluateHandle(i => (window as ProbeWindow).__a11ygateKeyboard?.[i], index);
  const element = handle.asElement();
  try {
    if (!element) return null;
    const box = await element.boundingBox();
    if (!box || box.width < 1 || box.height < 1) return null;
    const focused = await page.screenshot({ clip: box, animations: 'disabled' });
    await element.evaluate(el => (el as HTMLElement).blur());
    let unfocused: Buffer;
    try { unfocused = await page.screenshot({ clip: box, animations: 'disabled' }); }
    finally { await element.evaluate(el => (el as HTMLElement).focus()); }
    return await page.evaluate(async ({ a, b, threshold }) => {
      const decode = async (data: string) => {
        const image = new Image(); image.src = 'data:image/png;base64,' + data; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, image.width, image.height).data;
      };
      const [left, right] = await Promise.all([decode(a), decode(b)]);
      if (left.length !== right.length || !left.length) return false;
      let changed = 0;
      for (let i = 0; i < left.length; i += 4) if (Math.max(Math.abs(left[i] - right[i]), Math.abs(left[i + 1] - right[i + 1]), Math.abs(left[i + 2] - right[i + 2])) > 16) changed++;
      return changed > 0 && changed / (left.length / 4) >= threshold;
    }, { a: focused.toString('base64'), b: unfocused.toString('base64'), threshold });
  } catch { return null; } finally { await handle.dispose(); }
}
