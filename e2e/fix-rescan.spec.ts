import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { applySuggestion, planSuggestions } from '../lib/fix';

/**
 * For each rule-based fix: axe flags the fixture, the suggestion is applied
 * exactly as GitHub's "Apply suggestion" would, and a re-scan no longer
 * reports that finding. Everything runs on local markup; network is blocked.
 */

function doc(body: string, htmlOpen = '<html lang="en">'): string {
  return `<!doctype html>\n${htmlOpen}\n<head><title>Fixture</title></head>\n<body>\n<main>\n<h1>Fixture</h1>\n${body}\n</main>\n</body>\n</html>\n`;
}

async function violations(page: Page, html: string, ruleId: string): Promise<string[]> {
  await page.setContent(html);
  const results = await new AxeBuilder({ page }).withRules([ruleId]).analyze();
  return results.violations.filter((v) => v.id === ruleId).flatMap((v) => v.nodes.map((node) => node.html));
}

const CASES: { name: string; ruleId: string; source: string; placeholder: boolean }[] = [
  { name: 'label: for/id with the visible label', ruleId: 'label', source: doc('<label>Email</label>\n<input id="email" type="email">'), placeholder: false },
  { name: 'label: wrap in the visible label', ruleId: 'label', source: doc('<p><label>Name</label> <input name="name"></p>'), placeholder: false },
  { name: 'button-name: icon file name', ruleId: 'button-name', source: doc('<button class="close"><img src="/icons/close.svg" alt=""></button>'), placeholder: false },
  { name: 'link-name: TODO placeholder', ruleId: 'link-name', source: doc('<a href="/next"><span class="arrow"></span></a>'), placeholder: true },
  { name: 'image-alt', ruleId: 'image-alt', source: doc('<img src="/hero.png">'), placeholder: true },
  { name: 'clickable div', ruleId: 'aria-prohibited-attr', source: doc('<div class="x" onclick="hide()" aria-label="Close"></div>'), placeholder: false },
  { name: 'clickable span', ruleId: 'aria-prohibited-attr', source: doc('<span onclick="hide()" aria-label="Dismiss"></span>'), placeholder: false },
  { name: 'html-has-lang', ruleId: 'html-has-lang', source: doc('<p>Hello</p>', '<html>'), placeholder: true },
];

test.describe('rule-based suggestions clear the axe finding on re-scan', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/*', (route) => route.abort());
  });

  for (const testCase of CASES) {
    test(testCase.name, async ({ page }) => {
      const before = await violations(page, testCase.source, testCase.ruleId);
      expect(before).toHaveLength(1);

      const lines = new Set(testCase.source.split('\n').map((_, index) => index + 1));
      const plan = planSuggestions(
        [{ fingerprint: 'fp', ruleId: testCase.ruleId, html: before[0], status: 'new' }],
        [{ path: 'fixture.html', content: testCase.source, diffLines: lines }],
      );
      expect(plan.skipped).toEqual([]);
      expect(plan.suggestions).toHaveLength(1);
      const suggestion = plan.suggestions[0];
      expect(suggestion.placeholder).toBe(testCase.placeholder);
      if (testCase.placeholder) expect(suggestion.replacement.join('\n')).toContain('TODO(a11ygate)');

      const fixed = applySuggestion(testCase.source, suggestion);
      expect(fixed).not.toBe(testCase.source);
      expect(await violations(page, fixed, testCase.ruleId)).toEqual([]);
    });
  }
});
