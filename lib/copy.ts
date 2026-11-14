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

export const CLI_PACKAGE = '@qe-atlas/a11ygate@0.1.0';

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
