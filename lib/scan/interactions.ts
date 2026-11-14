import type { Page, Locator } from 'playwright';
import type { PageRecord } from './crawl';

export type InteractionStep = { action: 'click' | 'press' | 'wait'; selector: string; key?: string };
export type InteractionState = { route: string; name: string; steps: InteractionStep[] };
export type InteractionOptions = { states: InteractionState[]; auto: boolean; budget: number };
export const AUTO_SELECTOR = '[aria-expanded="false"], button[aria-haspopup]:not([aria-haspopup="false"]), [role="button"][aria-haspopup]:not([aria-haspopup="false"])';

/** Validate before starting a browser. State names are report labels, not URL navigation. */
export function parseInteractionStates(value: unknown): InteractionState[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error('Interactions must be a list of at most 100 states.');
  const names = new Set<string>();
  for (const state of value) {
    if (!state || typeof state !== 'object' || Object.keys(state).some(k => !['route', 'name', 'steps'].includes(k)) ||
      typeof state.route !== 'string' || !state.route.startsWith('/') || state.route.startsWith('//') || /[#\s]/.test(state.route) ||
      typeof state.name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(state.name) || state.name.startsWith('auto-') ||
      !Array.isArray(state.steps) || state.steps.length < 1 || state.steps.length > 100) throw new Error('Each interaction needs route (/path), unique name (letters, numbers, _ or -; auto- is reserved), and 1–100 steps.');
    const label = state.route + '#' + state.name;
    if (names.has(label)) throw new Error('Interaction state labels must be unique.');
    names.add(label);
    for (const step of state.steps) {
      if (!step || typeof step !== 'object' || Object.keys(step).some(k => !['action', 'selector', 'key'].includes(k)) ||
        !['click', 'press', 'wait'].includes(step.action) || typeof step.selector !== 'string' || !step.selector.trim() || step.selector.length > 512 ||
        (step.action === 'press' ? typeof step.key !== 'string' || !step.key.trim() || step.key.length > 80 : step.key !== undefined)) throw new Error('Interaction steps need action click/press/wait and a selector; press also needs a key.');
    }
  }
  return value as InteractionState[];
}

/** Conservative eligibility: never activate links, submit/reset controls, or editable fields. */
export async function activationReason(locator: Locator): Promise<string | null> {
  return locator.evaluate(el => {
    if (el.closest('a[href], area[href]')) return 'Links are not interaction targets.';
    if (el.closest('input, textarea, select, [contenteditable="true"]')) return 'Form inputs are not interaction targets.';
    const button = el.closest('button');
    if (button && (button.type === 'submit' || button.type === 'reset') && (button.form || button.type === 'reset')) return 'Submit/reset buttons are not interaction targets.';
    return null;
  });
}

/** Installed before every opt-in page load, including reset loads between states. */
export async function installInteractionGuards(page: Page): Promise<void> {
  await page.addInitScript(() => {
    document.addEventListener('submit', event => { event.preventDefault(); event.stopImmediatePropagation(); }, true);
    HTMLFormElement.prototype.submit = function () { throw new Error('Form submission blocked during interaction scan.'); };
    HTMLFormElement.prototype.requestSubmit = function () { throw new Error('Form submission blocked during interaction scan.'); };
    document.addEventListener('click', event => {
      const el = event.target instanceof Element ? event.target : null;
      if (el?.closest('a[href], area[href], input[type="submit"], input[type="image"]')) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    window.open = () => null;
  });
}

/** Reset before each state: an open menu/dialog cannot contaminate the next scan. Budget is per route, including failures and waits. */
export async function scanInteractionStates(page: Page, url: string, options: InteractionOptions, scan: (label: string) => Promise<import('@/lib/types').AxeResults | undefined>, active: (value: boolean) => void, timeoutMs: number): Promise<PageRecord[]> {
  const records: PageRecord[] = [];
  const route = new URL(url).pathname + new URL(url).search;
  const states = options.states.filter(s => s.route === route);
  const autoCount = options.auto ? Math.min(await page.locator(AUTO_SELECTOR).count(), options.budget) : 0;
  let used = 0;
  const run = async (name: string, steps?: InteractionStep[], index?: number) => {
    const label = new URL(url); label.hash = name;
    const record: PageRecord = { url: label.href, finalUrl: label.href, status: 200, scanStatus: 'skipped' };
    let stepNumber = 0;
    try {
      if (used >= options.budget) throw new Error('Interaction step budget exhausted.');
      active(false);
      const response = await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
      if (response && !response.ok()) throw new Error('Route reload failed before interaction.');
      const loaded = new URL(page.url()); loaded.hash = '';
      if (loaded.href !== url) throw new Error('Route changed during reload; state was not scanned.');
      active(true);
      const perform = async (locator: Locator, action: InteractionStep['action'], key?: string) => {
        stepNumber++;
        if (used >= options.budget) throw new Error('Interaction step budget exhausted.');
        used++;
        if (action === 'wait') await locator.waitFor({ state: 'visible', timeout: Math.min(timeoutMs, 5000) });
        else {
          await locator.waitFor({ state: 'visible', timeout: Math.min(timeoutMs, 5000) });
          const reason = await activationReason(locator);
          if (reason) throw new Error(reason);
          if (action === 'click') await locator.click({ timeout: Math.min(timeoutMs, 5000), noWaitAfter: true });
          else await locator.press(key!, { timeout: Math.min(timeoutMs, 5000), noWaitAfter: true });
        }
      };
      if (steps) for (const step of steps) await perform(page.locator(step.selector), step.action, step.key);
      else await perform(page.locator(AUTO_SELECTOR).nth(index!), 'click');
      // Allow synchronous handlers and queued rendering to settle; use explicit wait steps for async UI.
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      record.result = await scan(label.href);
      if (record.result) record.result.scanConfig = { ...record.result.scanConfig, readOnly: false, interactionState: name };
      record.scanStatus = 'complete';
    } catch (error) {
      record.error = `Step ${stepNumber || 1}: ${error instanceof Error ? error.message.split('\n')[0] : 'Interaction failed.'}`;
    } finally { active(true); }
    records.push(record);
  };
  for (const state of states) await run(state.name, state.steps);
  for (let i = 0; i < autoCount && used < options.budget; i++) await run(`auto-${i + 1}`, undefined, i);
  return records;
}
