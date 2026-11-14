export const HERO_HEADING =
  'Turn the axe results you already have into an accessibility regression gate and EAA evidence report';

export const DISCLAIMER =
  'Automated checks cover only part of WCAG; this is evidence, not certification.';

export const LEGAL_DISCLAIMER =
  'Informational only. Not legal advice. Not a certification of EAA compliance.';

export const AUTOMATED_TESTING_DISCLAIMER =
  'Automated testing only. Not a WCAG audit, certification or legal advice.';

export const PRIVACY_NOTE = 'Privacy: scans stay in your browser.';

export const SITE_URL = 'https://a11ygate.vercel.app';

export const SITE_DESCRIPTION =
  'Turn axe-core JSON from Playwright into an accessibility regression gate and an EU Accessibility Act evidence report. Runs in your browser.';

export const CLI_PACKAGE = '@qe-atlas/a11ygate@0.2.0';

export const RELEASE_STATUS =
  'npm has @qe-atlas/a11ygate@0.1.0. The 0.2.0 features below are merged on main, not yet released on npm; there is no next tag. The published Action v1 predates these features.';

export const MAIN_TODAY = [
  'GitHub Actions: npm test checks the example workflow and runs its gate command; the example itself is not run as a workflow.',
  'Jenkins: recorded acceptance run on Jenkins 2.580.2 LTS; other versions and agents are unverified.',
  'GitLab (Code Quality), Azure DevOps, CircleCI and Bitbucket Pipelines: templates, not yet run on the real platform.',
  'Live-site scans: a11ygate scan <url>, with optional same-origin crawl capped at 20 pages; only scan sites you own or are authorized to test.',
  'Authenticated-page scans: opt-in storage state, login scripts or environment-referenced cookies/headers; test accounts only, review reports before sharing.',
  'Multi-engine checks: axe by default; HTML_CodeSniffer, IBM and Lighthouse are opt-in and require their optional engine packages.',
  'Baseline mode: only new findings at the selected impact threshold fail the finding gate; incomplete scans and engine errors still block a pass.',
  'GitHub code-scanning SARIF export; uploads require code scanning availability and permissions (private repositories require GitHub Code Security).',
  'HTML report v2, JUnit, trend report across saved runs, and evidence pack zip with a SHA-256 manifest.',
  'Model-drafted fix PRs in the source Action: experimental, default off, repository opt-in and provider configuration required; draft PRs only, human review required.',
  'Likely shared-component finding groups with accept/ignore review decisions; grouping is heuristic and decisions record accepted debt, not fixes.',
  'Opt-in keyboard focus heuristics and opt-in SPA interaction states in authorized test environments; need human review and cover only probed states.',
  'JSON Schema for .a11ygate.yml configuration validation; this validates configuration, not accessibility.',
  'Tested local framework recipes: Next.js, Vite + React, Angular and Storybook; dedicated recipe checks are separate from npm test.',
  'Opt-in “EN 301 549 ref.” column: reference mapping only, does not indicate conformance; specialist review required.',
] as const;

export const CI_INSTALL_COMMAND = 'npm install --save-dev @playwright/test @axe-core/playwright';

export const CI_AXE_SNIPPET = `import { test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';

test('home', async ({ page }) => {
  await page.goto('https://example.com/');
  const results = await new AxeBuilder({ page }).analyze();
  await mkdir('a11y-results', { recursive: true });
  await writeFile('a11y-results/home.json', JSON.stringify(results, null, 2));
});`;

export const CI_CLI_COMMANDS = `npx playwright install chromium
npx playwright test
mkdir -p a11y
npx @qe-atlas/a11ygate --current a11y-results/home.json --update-baseline a11y/baseline.json
npx @qe-atlas/a11ygate --current a11y-results/home.json --baseline a11y/baseline.json`;

export const CI_WORKFLOW = `name: Accessibility
on:
  pull_request:

permissions:
  contents: read
  issues: write

jobs:
  a11y:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test
      - uses: DaveEliranAssistant/a11ygate-action@v1
        with:
          current: |
            a11y-results/home.json
          baseline: a11y/baseline.json
          threshold: serious
          comment: true`;

export const CI_FIRST_RUN_STEPS = `      - run: mkdir -p a11y
      - uses: DaveEliranAssistant/a11ygate-action@v1
        continue-on-error: true
        with:
          current: |
            a11y-results/home.json
          update-baseline: a11y/baseline.json
      - uses: actions/upload-artifact@v4
        with:
          name: a11y-baseline
          path: a11y/`;

/** Shown on every evidence-pack front page and in the v2 HTML scan report. Wording avoids any conformance or compliance claim. */
export const AUTOMATED_LIMITS = [
  'Most WCAG success criteria need human judgement. Automated rules detect only a subset of accessibility barriers, so an empty findings list is not evidence of conformance.',
  'Whether text alternatives, form labels, headings, link text and page titles are accurate and meaningful. Tools can only check that they exist.',
  'Keyboard operability across complete user journeys, logical focus order, visible focus in context and keyboard traps that appear after interaction.',
  'The experience with screen readers, magnifiers, voice control and other assistive technology.',
  'Login journeys, forms, multi-step flows, error states, menus, dialogs and other interactions beyond the pages explicitly scanned.',
  'Pages that were not reached: not linked through same-origin a[href] links, beyond the crawl cap, disallowed by robots.txt, or failed to load.',
  'Captions, transcripts and audio description for time-based media, and whether they are correct.',
  'Cognitive and learning accessibility: plain language, consistent navigation, timing, and error prevention and recovery.',
  'Reflow, zoom, orientation and user style or contrast settings beyond what individual rules check.',
  'Documents (PDF, office files), native apps, emails and third-party services that were not rendered in the scanned pages.',
] as const;
