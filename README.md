# A11yGate

A11yGate turns the axe-core results a team already produces in Playwright CI into an accessibility regression gate and an EU Accessibility Act (EAA) evidence report.

It is a client-side proof of concept. You import JSON. The diff, the gate, the report, and the accessibility-statement draft are computed in the browser. There is no account, no analytics, no payment, and no API that receives scan data.

## Privacy

Nothing leaves your browser. Files you drop, JSON you paste, and the organisation name, contact email, and date you type for a statement draft stay on the page. The waitlist control is a `mailto:` link. It does not store an address.

Refreshing the tab can restore the last scan from `sessionStorage` in that tab. Clearing the scan, or closing the tab, drops it. Statement fields are not written to storage.

## Run it

```bash
npm install
npm run dev
```

Other checks:

```bash
npm run lint
npm test
npm run test:e2e
npm run build
```

`npm test` is Vitest. `npm run test:e2e` is one Playwright smoke test. The production build is a standard Next.js build (`next build`), which is what Vercel runs for a Next.js project. This repo is not wired to a deployment.

## Produce axe JSON

Run axe in the Playwright tests you already have and write the `AxeResults` object to disk. `@axe-core/playwright` is not a dependency of this app. The snippet belongs in the project you are auditing:

```ts
import { test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { writeFile } from 'node:fs/promises';

test('capture axe results', async ({ page }, testInfo) => {
  await page.goto('https://example.com');
  const results = await new AxeBuilder({ page }).analyze();
  await writeFile(testInfo.outputPath('axe.json'), JSON.stringify(results, null, 2));
});
```

Repeat for each page, or concatenate the objects into one JSON array. A11yGate reads `url`, `timestamp`, `testEngine.version`, and `violations[]` (`id`, `impact`, `tags`, `help`, `helpUrl`, `nodes[].target`, `nodes[].html`). Extra axe fields are ignored. A file that does not match that shape is rejected with a specific error.

## Baseline workflow

1. Save a run you are willing to compare against, and download it later from A11yGate as **Download new baseline JSON** once you accept the current tree.
2. Import the new run as the current run. Import the saved run as the baseline. Each slot accepts one result object or an array of page results.
3. A11yGate fingerprints every node as `rule id + normalised selector + page path`. Normalisation strips `:nth-child()` / `:nth-of-type()` indexes, generated ids (Ember, React `useId`, long hashes), and CSS-module or emotion class hashes. The query string is not part of the path.
4. The diff is **New** (current only), **Fixed** (baseline only), and **Still open** (both).
5. The gate is **FAIL** when any new finding has an impact at or above the threshold. The default threshold is `serious`, so `serious` and `critical` fail the gate. `moderate` and `minor` do not. With no baseline, every current finding is new.
6. Group the table by rule or by page. Open the evidence report to print or save a PDF from the browser.

**Load demo data** fills both slots with synthetic Demo Shop fixtures: three pages (`/`, `/products`, `/cart`) over two runs. The expected result is 2 new, 3 fixed, 5 still open, and **FAIL**, caused by one new serious `color-contrast` finding. The other new finding is a moderate `region` result below the default threshold. The files in `fixtures/` are marked `_fixture: SYNTHETIC` and are not a real audit.

## What the report contains

The `/report` view is print-friendly. It records the scope, the time the report was generated, the axe engine version, the mapped findings, and a static manual-check list for keyboard, screen reader, and focus order. Those manual checks are not run by this tool.

axe `wcag*` success-criterion tags are looked up in `lib/mapping.ts` to a WCAG 2.1/2.2 criterion (number, name, level A or AA) and an EN 301 549 clause (`9.x.x.x`). Tags that do not map to a criterion are shown as **best practice**. That table needs expert review before anyone treats it as compliance evidence.

The statement draft asks for an organisation name, a contact email, and a date, then copies Markdown. It is a draft, not a filed legal statement.

Exports, all generated locally:

- new baseline JSON
- Markdown pull-request summary
- CSV of findings

## Limits

Automated checks cover only part of WCAG; this is evidence, not certification.

Axe does not decide conformance. Fingerprints can miss an element that moved to a different stable selector, and they can collapse two elements if normalisation removes the only difference between them. The EN 301 549 clause numbers follow the usual clause 9 mirror of the WCAG number; a specialist needs to confirm the edition, especially for WCAG 2.2 additions. The manual checks are a checklist, not results.

## Out of scope

URL crawling, a backend, authentication, payments, a GitHub Action, and any model that summarises findings are intentionally absent.

## Roadmap

- A GitHub Action that posts the Markdown summary as a pull-request comment
- Saved history of runs
- White-label report packs
