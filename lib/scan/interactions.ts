import type { Page, Locator } from 'playwright';
import type { PageRecord } from './crawl';

export type InteractionStep = { action: 'click' | 'press' | 'wait'; selector: string; key?: string };
export type InteractionState = { route: string; name: string; steps: InteractionStep[] };
export type InteractionOptions = { states: InteractionState[]; auto: boolean | { depth?: number; maxStates?: number }; budget: number };
export const AUTO_SELECTOR = '[aria-expanded="false"], button[aria-haspopup]:not([aria-haspopup="false"]), [role="button"][aria-haspopup]:not([aria-haspopup="false"])';

export type InteractionConfig = InteractionState[] | { states?: InteractionState[]; auto?: { depth?: number; maxStates?: number } };
export function parseInteractionConfig(value: unknown): InteractionConfig {
  if (Array.isArray(value)) return parseInteractionStates(value);
  if (!value || typeof value !== 'object' || Object.keys(value).some(k => !['states', 'auto'].includes(k))) throw new Error('Interactions need a state list or a states/auto mapping.');
  const config = value as Exclude<InteractionConfig, InteractionState[]>;
  parseInteractionStates(config.states ?? []);
  if (config.auto !== undefined) {
    const auto = config.auto;
    if (!auto || typeof auto !== 'object' || Array.isArray(auto) || Object.keys(auto).some(k => !['depth', 'maxStates'].includes(k)) ||
      (auto.depth !== undefined && (!Number.isInteger(auto.depth) || auto.depth < 1 || auto.depth > 3)) ||
      (auto.maxStates !== undefined && (!Number.isInteger(auto.maxStates) || auto.maxStates < 1 || auto.maxStates > 100))) throw new Error('Auto depth must be 1–3 and maxStates 1–100.');
  }
  return config;
}

/** Validate before starting a browser. State names are report labels, not URL navigation. */
export function parseInteractionStates(value: unknown): InteractionState[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error('interactions (top level): must be a list of at most 100 states.');
  const names = new Set<string>();
  for (const [index, state] of value.entries()) {
    const at = `interactions[${index}]`;
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error(`${at}: each interaction must be an object with route, name and steps.`);
    const extra = Object.keys(state).find(k => !['route', 'name', 'steps'].includes(k));
    if (extra !== undefined) throw new Error(`${at}: unknown field ${JSON.stringify(extra.slice(0, 40))}; allowed fields are route, name and steps.`);
    if (typeof state.route !== 'string' || !state.route.startsWith('/') || state.route.startsWith('//') || /[#\s]/.test(state.route)) throw new Error(`${at}.route: must be a same-site path starting with / (no #, spaces or //).`);
    if (typeof state.name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(state.name) || state.name.startsWith('auto-')) throw new Error(`${at}.name: must be 1–80 letters, numbers, _ or - (auto- is reserved).`);
    if (!Array.isArray(state.steps) || state.steps.length < 1 || state.steps.length > 100) throw new Error(`${at}.steps: must be a list of 1–100 steps.`);
    const label = state.route + '#' + state.name;
    if (names.has(label)) throw new Error(`${at}.name: interaction state labels (route + name) must be unique.`);
    names.add(label);
    for (const [stepIndex, step] of state.steps.entries()) {
      const stepAt = `${at}.steps[${stepIndex}]`;
      if (!step || typeof step !== 'object' || Array.isArray(step)) throw new Error(`${stepAt}: each step must be an object with action and selector.`);
      const stepExtra = Object.keys(step).find(k => !['action', 'selector', 'key'].includes(k));
      if (stepExtra !== undefined) throw new Error(`${stepAt}: unknown field ${JSON.stringify(stepExtra.slice(0, 40))}; allowed fields are action, selector and key.`);
      if (!['click', 'press', 'wait'].includes(step.action)) throw new Error(`${stepAt}.action: must be click, press or wait.`);
      if (typeof step.selector !== 'string' || !step.selector.trim() || step.selector.length > 512) throw new Error(`${stepAt}.selector: must be a non-empty selector of at most 512 characters.`);
      if (step.action === 'press' ? typeof step.key !== 'string' || !step.key.trim() || step.key.length > 80 : step.key !== undefined) throw new Error(`${stepAt}.key: ${step.action === 'press' ? 'press needs a key of at most 80 characters' : 'only press steps take a key'}.`);
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
    if (/delete|remove|pay|buy|submit/i.test((el.closest('button, [role="button"]') ?? el).textContent ?? '')) return 'Destructive-looking controls are not interaction targets.';
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
  const depth = typeof options.auto === 'object' ? options.auto.depth ?? 1 : 1;
  const maxStates = typeof options.auto === 'object' ? options.auto.maxStates ?? 20 : 20;
  let autoUsed = 0;
  let used = 0;
  const run = async (name: string, steps?: InteractionStep[], index?: number, path?: AutoControl[]) => {
    let children: AutoControl[] = [];
    let visibleBefore: AutoControl[] = [];
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
      else if (path) {
        for (const control of path) {
          visibleBefore = await revealedControls(page);
          await perform(page.locator(control.selector), 'click');
          await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        }
      } else await perform(page.locator(AUTO_SELECTOR).nth(index!), 'click');
      // Allow synchronous handlers and queued rendering to settle; use explicit wait steps for async UI.
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      record.result = await scan(label.href);
      if (record.result) record.result.scanConfig = { ...record.result.scanConfig, readOnly: false, interactionState: name };
      record.scanStatus = 'complete';
      if (path && path.length < depth) children = (await revealedControls(page, path.at(-1)!)).filter(c => !visibleBefore.some(before => before.selector === c.selector));
    } catch (error) {
      record.error = `Step ${stepNumber || 1}: ${error instanceof Error ? error.message.split('\n')[0] : 'Interaction failed.'}`;
    } finally { active(true); }
    records.push(record);
    return children;
  };
  for (const state of states) await run(state.name, state.steps);
  if (depth === 1) {
    for (let i = 0; i < autoCount && used < options.budget && autoUsed < maxStates; i++, autoUsed++) await run(`auto-${i + 1}`, undefined, i);
  } else {
    // Snapshot stable DOM paths before opening anything; each branch reloads and replays its ancestors.
    active(false);
    await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
    active(true);
    const roots = options.auto ? await revealedControls(page) : [];
    const explore = async (path: AutoControl[]): Promise<void> => {
      if (autoUsed >= maxStates || used + path.length > options.budget) return;
      autoUsed++;
      const children = await run(path.map(c => c.name).join('>'), undefined, undefined, path);
      for (const child of children) await explore([...path, child]);
    };
    for (const root of roots) await explore([root]);
  }
  return records;
}

type AutoControl = { selector: string; name: string };
/** Follow aria-controls/owns (including portalled panels), or descendants of the opened control. */
async function revealedControls(page: Page, parent?: AutoControl): Promise<AutoControl[]> {
  return page.evaluate(({ selector, parent }) => {
    const owner = parent ? document.querySelector(parent.selector) : null;
    const panels = owner ? (owner.getAttribute('aria-controls') ?? owner.getAttribute('aria-owns') ?? '').split(/\s+/).map(id => document.getElementById(id)).filter(Boolean) : [];
    return [...document.querySelectorAll(selector)].flatMap((el, index) => {
      if (!(el instanceof HTMLElement) || !el.getClientRects().length || getComputedStyle(el).visibility === 'hidden' || el.getAttribute('aria-expanded') === 'true') return [];
      if (owner && (el === owner || !(owner.contains(el) || panels.some(panel => panel!.contains(el))))) return [];
      const parts: string[] = [];
      for (let node: Element | null = el; node; node = node.parentElement) {
        const siblings: Element[] = node.parentElement ? [...node.parentElement.children].filter(s => s.tagName === node!.tagName) : [node];
        parts.unshift(node.tagName.toLowerCase() + ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')');
      }
      const name = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(el.id) ? el.id : `auto-${index + 1}`;
      return [{ selector: parts.join(' > '), name }];
    });
  }, { selector: AUTO_SELECTOR, parent });
}
