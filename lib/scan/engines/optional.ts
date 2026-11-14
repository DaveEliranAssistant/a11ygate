import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import type { Page } from 'playwright';
import type { Engine } from './types';
import type { NormalizedFinding } from './normalized';
import { WCAG_RULE_MAP } from './wcag-map';

export const ENGINE_IDS = ['axe', 'htmlcs', 'ibm', 'lighthouse'] as const;
export type EngineId = typeof ENGINE_IDS[number];
export type OptionalEngineContext = { page: Page; browserURL?: string };
const require = createRequire(import.meta.url);

async function localScript(packageName: string, script: string): Promise<string> {
  try {
    // Resolve at runtime; engine code is never copied into CLI/Action bundles.
    return await readFile(require.resolve(`${packageName}/${script}`), 'utf8');
  } catch {
    throw new Error(`Missing ${packageName} engine files. Install with: npm install --save-dev ${packageName}`);
  }
}

function finding(engine: EngineId, url: string, ruleId: string, selector: string, snippet: string, helpUrl: string, wcagSc?: string[]): NormalizedFinding {
  return { engine, url, ruleId, selector, snippet, helpUrl, impact: 'serious',
    wcagSc: wcagSc ?? [...(WCAG_RULE_MAP[engine]?.[ruleId] ?? [])] };
}

export function createHtmlcsEngine(): Engine<OptionalEngineContext, NormalizedFinding[]> {
  return {
    id: 'htmlcs', displayName: 'HTML_CodeSniffer',
    async run({ page }, url) {
      await page.evaluate(await localScript('html_codesniffer', 'build/HTMLCS.js'));
      const issues = await page.evaluate(async () => {
        type Message = { type: number; code: string; element: Element; msg: string };
        const htmlcs = (window as unknown as { HTMLCS: {
          process: (standard: string, document: Document, done: () => void) => void;
          getMessages: () => Message[];
        } }).HTMLCS;
        return await new Promise<{ code: string; selector: string; snippet: string }[]>((resolve) => {
          htmlcs.process('WCAG2AA', document, () => resolve(htmlcs.getMessages()
            .filter((m) => m.type === 1).map((m) => {
              const parts: string[] = [];
              let element: Element | null = m.element;
              while (element) {
                const parent: Element | null = element.parentElement;
                parts.unshift(`${element.localName}:nth-child(${parent ? Array.from(parent.children).indexOf(element) + 1 : 1})`);
                element = parent;
              }
              return { code: m.code, selector: parts.join(' > '), snippet: m.element?.outerHTML?.slice(0, 2000) ?? '' };
            })));
        });
      });
      return issues.map((i) => {
        const sc = i.code.match(/Guideline\d+_\d+\.(\d+)_(\d+)_(\d+)/);
        return finding('htmlcs', url, i.code, i.selector, i.snippet,
          'https://squizlabs.github.io/HTML_CodeSniffer/Standards/WCAG2/', sc ? [`${sc[1]}.${sc[2]}.${sc[3]}`] : []);
      });
    },
    normalize: (results) => results,
  };
}

export function createIbmEngine(): Engine<OptionalEngineContext, NormalizedFinding[]> {
  return {
    id: 'ibm', displayName: 'IBM Equal Access',
    async run({ page }, url) {
      // The official engine package contains the complete versioned rules. No checker
      // configuration, archive server, cache refresh, telemetry or CDN is involved.
      await page.evaluate(await localScript('accessibility-checker-engine', 'ace.js'));
      const issues = await page.evaluate(async () => {
        type Issue = { ruleId: string; value: string[]; path?: { dom?: string }; snippet?: string };
        const ace = (window as unknown as { ace: { Checker: new () => {
          check: (doc: Document, policies: string[]) => Promise<{ results: Issue[] }>;
        } } }).ace;
        const report = await new ace.Checker().check(document, ['IBM_Accessibility']);
        return report.results.filter((issue) => issue.value[0] === 'VIOLATION' && issue.value[1] === 'FAIL').map((i) => ({
          ruleId: i.ruleId, selector: i.path?.dom ?? '', snippet: i.snippet ?? '',
        }));
      });
      return issues.map((i) => finding('ibm', url, i.ruleId, i.selector, i.snippet,
        `https://www.ibm.com/able/requirements/checker-rule-sets#${encodeURIComponent(i.ruleId)}`));
    },
    normalize: (results) => results,
  };
}

export function createLighthouseEngine(): Engine<OptionalEngineContext, NormalizedFinding[]> {
  return {
    id: 'lighthouse', displayName: 'Lighthouse accessibility',
    async run({ page, browserURL }, url) {
      let lighthouse: typeof import('lighthouse');
      let puppeteer: typeof import('puppeteer-core');
      try {
        [lighthouse, puppeteer] = await Promise.all([import('lighthouse'), import('puppeteer-core')]);
      } catch {
        throw new Error('Missing Lighthouse engine packages. Install with: npm install --save-dev lighthouse puppeteer-core');
      }
      if (!browserURL) throw new Error('Lighthouse requires the shared Chromium debugging endpoint.');
      const browser = await puppeteer.connect({ browserURL, defaultViewport: null });
      try {
        // Match the existing Playwright target, including when several tabs share a URL.
        const cdp = await page.context().newCDPSession(page);
        const { targetInfo } = await cdp.send('Target.getTargetInfo');
        await cdp.detach();
        const target = browser.targets().find((t) => (t as unknown as { _targetId: string })._targetId === targetInfo.targetId);
        const current = await target?.page();
        if (!current) throw new Error('Could not attach Lighthouse to the existing page.');
        // Snapshot never navigates, resets storage or starts a second crawl. The Node
        // API bypasses CLI update checks, analytics and stored CLI configuration.
        const result = await lighthouse.snapshot(current, { flags: {
          onlyCategories: ['accessibility'], logLevel: 'silent', disableStorageReset: true,
          formFactor: 'desktop', screenEmulation: { disabled: true },
        } });
        if (!result) throw new Error('Lighthouse returned no report.');
        if (result.lhr.runtimeError) throw new Error(`Lighthouse: ${result.lhr.runtimeError.message}`);
        const failedAudit = Object.values(result.lhr.audits).find((a) => a.scoreDisplayMode === 'error');
        if (failedAudit) throw new Error(`Lighthouse audit ${failedAudit.id} failed: ${failedAudit.errorMessage ?? 'unknown error'}`);
        return Object.values(result.lhr.audits).filter((a) => a.score === 0).flatMap((a) => {
          const details = a.details as { items?: { node?: { selector?: string; snippet?: string }; subItems?: { items?: { node?: { selector?: string; snippet?: string } }[] } }[] } | undefined;
          const nodes = (details?.items ?? []).flatMap((i) => [i.node, ...(i.subItems?.items ?? []).map((sub) => sub.node)]).filter((n) => n !== undefined);
          return (nodes.length ? nodes : [{}]).map((n) => finding('lighthouse', url, a.id, n.selector ?? '', n.snippet ?? '',
            a.description.match(/https:\/\/[^\s)]+/)?.[0] ?? 'https://developer.chrome.com/docs/lighthouse/accessibility/'));
        });
      } finally {
        await browser.disconnect();
      }
    },
    normalize: (results) => results,
  };
}
