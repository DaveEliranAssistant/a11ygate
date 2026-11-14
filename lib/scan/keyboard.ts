import type { Page } from 'playwright';
import { getCriterion, understandingUrl } from '@/lib/mapping';
import type { ScanFinding } from './report';

export const KEYBOARD_DISCLAIMER = 'Keyboard checks are heuristics and need human review. Absence of findings does not confirm keyboard accessibility. Outline/box-shadow changes do not establish indicator visibility, contrast or conformance.';
export type KeyboardOptions = { budget: number };
export type KeyboardObservation = { step: number; selector: string | null; domIndex: number | null; indicatorChanged: boolean | null };
export type KeyboardResult = { url: string; steps: number; stopReason: 'cycle' | 'trap' | 'budget'; observations: KeyboardObservation[]; findings: ScanFinding[] };

/** A bounded forward-Tab probe. It never activates controls or enters text. */
export async function scanKeyboard(page: Page, url: string, options: KeyboardOptions): Promise<KeyboardResult> {
  if (!Number.isInteger(options.budget) || options.budget < 1 || options.budget > 1000) throw new Error('Keyboard budget must be from 1 to 1000.');
  const candidates = await page.evaluate(() => {
    // Freshly loaded pages normally start at the document. Preserve that native
    // starting point so positive tabindex controls are included.
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) document.activeElement.blur();
    const elements = [...document.querySelectorAll<HTMLElement>('a[href],area[href],button,input:not([type="hidden"]),select,textarea,summary,[tabindex],[contenteditable="true"],[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="switch"],[role="textbox"]')];
    return elements.filter(el => {
      const style = getComputedStyle(el);
      return !el.matches(':disabled') && !el.closest('[inert]') && el.getClientRects().length > 0 && style.visibility === 'visible' && style.display !== 'none';
    }).map(el => {
      const parts: string[] = [];
      for (let node: Element | null = el; node; node = node.parentElement) {
        const parent: Element | null = node.parentElement;
        parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${parent ? [...parent.children].indexOf(node) + 1 : 1})`);
      }
      const style = getComputedStyle(el);
      return { selector: parts.join(' > '), outline: `${style.outlineStyle}|${style.outlineWidth}|${style.outlineColor}`, shadow: style.boxShadow, html: el.outerHTML.slice(0, 1000) };
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
  const observations: KeyboardObservation[] = [];
  const reached = new Set<number>();
  let previous: number | null = null;
  let previousSelector: string | null = null;
  let stuck = 0;
  let stopReason: KeyboardResult['stopReason'] = 'budget';
  for (let step = 1; step <= options.budget; step++) {
    await page.keyboard.press('Tab');
    const observed = await page.evaluate(items => {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return { selector: null, domIndex: null, indicatorChanged: null };
      const index = items.findIndex(item => document.querySelector(item.selector) === el);
      const style = getComputedStyle(el);
      const base = items[index];
      const outline = `${style.outlineStyle}|${style.outlineWidth}|${style.outlineColor}`;
      const visibleOutline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0 && style.outlineColor !== 'rgba(0, 0, 0, 0)';
      return { selector: base?.selector ?? el.tagName.toLowerCase(), domIndex: index < 0 ? null : index,
        indicatorChanged: base ? (visibleOutline && outline !== base.outline) || (style.boxShadow !== 'none' && style.boxShadow !== base.shadow) : null };
    }, candidates);
    observations.push({ step, ...observed });
    const index = observed.domIndex;
    // A repeated document boundary is a complete forward traversal, not a trap.
    if (observed.selector === null && reached.size > 0) { stopReason = 'cycle'; break; }
    if (index !== null) {
      if (previous !== null && index < previous - 3 && !reached.has(index)) add('order-jump', 'wcag243', index, 'Focus jumped backward by more than three interactive DOM positions. Review whether the order preserves meaning.');
      if (!reached.has(index) && observed.indicatorChanged === false) add('focus-indicator', 'wcag247', index, 'No computed outline or box-shadow change was observed on keyboard focus. Review the visible focus indicator.');
      reached.add(index);
    }
    stuck = observed.selector !== null && observed.selector === previousSelector ? stuck + 1 : 0;
    if (stuck >= 3 && index !== null) { add('trap', 'wcag212', index, 'Focus stayed on the same element for three consecutive Tab presses. Review keyboard escape behavior.'); stopReason = 'trap'; break; }
    previous = index; previousSelector = observed.selector;
  }
  // Budget exhaustion is incomplete evidence, not proof that a control is unreachable.
  if (stopReason === 'cycle') candidates.forEach((_, index) => {
    if (!reached.has(index)) add('unreachable', 'wcag211', index, 'This visible interactive candidate was not reached during a forward Tab traversal. Review keyboard operation and composite-widget arrow keys.');
  });
  return { url, steps: observations.length, stopReason, observations, findings };
}
