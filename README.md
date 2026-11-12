# A11yGate

A11yGate turns axe-core JSON (for example from `@axe-core/playwright` in CI) into an accessibility regression gate and an EU Accessibility Act evidence report.

The gate fails only on **new** violations compared with a baseline. Fixed and still-open findings are reported. The default impact threshold is `serious`, so `serious` and `critical` fail the gate. `moderate` and `minor` do not.

The scan tool runs in the browser at [https://a11ygate.vercel.app](https://a11ygate.vercel.app). There is no account, no payment, and scan files are not uploaded. The waitlist is the only form that sends data to the server, and only after consent. The same diff and gate power the CLI and the GitHub Action in this repository. The CLI is published on npm as `@qe-atlas/a11ygate@0.1.0`. The Action is published as `DaveEliranAssistant/a11ygate-action@v1`. The waitlist does not gate the CLI, the Action, or the browser demo.

**Informational only. Not legal advice. Not a certification of EAA compliance.** Automated checks cover only part of WCAG; this is evidence, not certification.

## Web app

```bash
npm install
npm run dev
```

Import a current axe JSON file, and optionally a baseline. Each slot accepts:

- one axe result object (`url`, `timestamp`, `testEngine.version`, `violations[]`)
- an array of those objects, one per page
- an envelope `{ "results": <object or array> }`

Extra axe fields are ignored. Node `target` values may be strings or nested string arrays, which is how axe represents iframes and shadow DOM. A file that does not match is rejected with a specific error. Empty files are rejected. Files over **8 MB** are refused, because parsing happens in the browser.

**Load demo data** fills both slots with the synthetic Demo Shop fixtures. The expected result is **2 new, 3 fixed, 5 still open, and FAIL**. One new finding is a serious `color-contrast` on `/products`. The other new finding is a moderate `region` result, below the default threshold. The files in `fixtures/` are marked `_fixture: SYNTHETIC` and are not a real audit.

The `/report` view is an evidence report you can print from the browser. It records scope, engine version, mapped findings, and a manual-check list for keyboard, screen reader, and focus order. Those manual checks are not run by this tool. The standards table needs expert review before anyone treats it as compliance evidence.

The statement draft asks for an organisation name, a contact email, and a date, then copies Markdown. It is a draft, not a filed legal statement.

Exports, all generated locally:

- new baseline JSON
- Markdown summary
- CSV of findings

Refreshing the tab can restore the last scan from `sessionStorage`. Clearing the scan, or closing the tab, drops it. Statement fields are not stored. Details are on the [Privacy](https://a11ygate.vercel.app/privacy) page.

### Waitlist

The landing page posts to `POST /api/waitlist`. Vercel runs `npm run vercel-build`, which applies `sql/waitlist.sql` and then `next build`. The migration reads `DATABASE_URL_POOLED`, then `DATABASE_URL`. If neither is set, the migration is skipped and the build continues. If a URL is set and the migration fails, the build stops and the log does not include the connection string.

`npm run build` does not migrate. Local development and GitHub Actions use that command. `npm run db:migrate` runs only the migration when a URL is already in the environment.

Without a database URL the form says the waitlist is temporarily unavailable and the API returns 503. The table stores the normalized email, optional role and company, consent, `created_at`, source (`landing`), and a user-agent hash. It does not store an IP address. Deletion requests go to dave.eliran.assistant@gmail.com.

### Produce axe JSON

`@axe-core/playwright` is a dev dependency of this repo so the app can check itself. The project you are auditing installs it separately:

```ts
import { test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';

test('home', async ({ page }) => {
  await page.goto('https://example.com/');
  const results = await new AxeBuilder({ page }).analyze();
  await mkdir('a11y-results', { recursive: true });
  await writeFile('a11y-results/home.json', JSON.stringify(results, null, 2));
});
```

Write one file per page. Parallel tests will not collide, and the CLI accepts repeated `--current` paths.

## CLI

The npm package in `packages/cli` is `@qe-atlas/a11ygate`. The command name is still `a11ygate`. `@qe-atlas/a11ygate@0.1.0` is published on npm, so `npx` runs it with no install. Inside a checkout of this repo, after `npm install`, `npx` runs the local bin instead. The `fixtures/` paths below exist only in a checkout.

```bash
npx @qe-atlas/a11ygate --help
npx @qe-atlas/a11ygate --current fixtures/demo-shop-current.json --baseline fixtures/demo-shop-baseline.json
```

That demo command exits **1** and prints **2 new, 3 fixed, 5 still open, FAIL**.

```bash
npx @qe-atlas/a11ygate --current axe.json --baseline a11y/baseline.json
npx @qe-atlas/a11ygate --current home.json --current cart.json --threshold critical --json result.json
npx @qe-atlas/a11ygate --current axe.json --update-baseline a11y/baseline.json --markdown summary.md
```

| Exit code | Meaning |
| --- | --- |
| 0 | No new finding is at or above the threshold. |
| 1 | At least one new finding is at or above the threshold. |
| 2 | The arguments or the JSON could not be read. |

`--update-baseline` writes the current results as the next baseline and still uses the gate's exit code, so a run with new violations does not pass just because the file was updated. More detail is in `packages/cli/README.md`.

### Live-site scan

The source build also has `a11ygate scan <url>`. It loads one page, or with `--crawl [n]` up to 20 same-origin pages, in headless Chromium and runs axe-core. It writes JSON, Markdown and HTML reports grouped by WCAG criterion and severity, and exits 1 when a finding meets `--fail-on` (default `serious`). It needs the optional peers `playwright` and `@axe-core/playwright`. The JSON report is also valid `--current` input for the gate. Only scan sites you own or are authorized to test. The scanner is read-only (no login, forms or clicks), honours robots.txt, paces page loads, and identifies itself as A11yGate. Automated testing only. Details are in `packages/cli/README.md`.

## GitHub Action

`action/action.yml` is a composite action. It runs the CLI, appends the Markdown summary to the job summary, and can post or update a single pull request comment (the comment contains `<!-- a11ygate -->`). The published Action is listed on the [GitHub Marketplace as A11yGate axe-core Regression Gate](https://github.com/marketplace/actions/a11ygate-axe-core-regression-gate) by DaveEliranAssistant.

```yaml
name: Accessibility
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
            a11y-results/cart.json
          baseline: a11y/baseline.json
          threshold: serious
          comment: true
```

`a11y/baseline.json` must exist before this runs, and every path under `current` must be a file your tests write. A missing file exits 2. Record the baseline on the runner. The Action at `v1` also compares scan configuration and browser environment, so a baseline from CLI 0.1.0 or from another machine stops it with INCOMPLETE and exit 2. For the first run, replace the A11yGate step with these steps, download the artifact, review it, and commit `a11y/baseline.json`:

```yaml
      - run: mkdir -p a11y
      - uses: DaveEliranAssistant/a11ygate-action@v1
        continue-on-error: true
        with:
          current: |
            a11y-results/home.json
            a11y-results/cart.json
          update-baseline: a11y/baseline.json
      - uses: actions/upload-artifact@v4
        with:
          name: a11y-baseline
          path: a11y/
```

From a checkout of this repository, `uses: ./action` points at the same action. Let the Playwright test write JSON and let A11yGate be the gate. Do not also assert `violations.length === 0` in that test, or the job fails before the summary is posted.

`issues: write` lets the token create the pull request comment. The comment is skipped, with a warning, when the workflow event has no pull request number. Full input list: `action/README.md`.

## Development

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

`npm test` is Vitest, including the CLI exit-code tests. It builds `packages/cli/dist/cli.mjs` and copies it to `action/dist/cli.mjs`. `npm run test:e2e` is Playwright against the production server, including an axe check of this app's own pages that fails on any serious or critical violation. Set `A11Y_E2E_SKIP_BUILD=1` to reuse a build you already produced.

GitHub Actions runs those commands on every pull request and push (`.github/workflows/ci.yml`).

## Limits

Fingerprints are `rule id + normalised selector + page path`. Normalisation strips `:nth-child()` / `:nth-of-type()` indexes, generated ids, and CSS-module or emotion class hashes. The query string is not part of the path. A fingerprint can miss an element that moved to a different stable selector, and it can collapse two elements if normalisation removes the only difference between them.

With no baseline, every current finding is new.

axe `wcag*` success-criterion tags are looked up in `lib/mapping.ts` to a WCAG 2.1/2.2 criterion and an EN 301 549 clause (`9.x.x.x`). Tags that do not map are **best practice**. Clause numbers follow the usual clause 9 mirror. A specialist needs to confirm the edition, especially for WCAG 2.2 additions.

## Security headers

The production response sets a Content-Security-Policy suitable for this client-only app (`default-src 'self'`, no remote script, style, or connect hosts, `frame-ancestors 'none'`), plus `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, and a Permissions-Policy that disables camera, microphone, geolocation, payment, and USB. `script-src` allows inline scripts because Next.js hydration uses them. `unsafe-eval` is added only while `next dev` is running. The e2e suite loads the production server and checks that the page still runs.

## License

[MIT](LICENSE). Copyright (c) 2026 Eliran Bar David.

[Give feedback](https://github.com/DaveEliranAssistant/a11ygate/discussions/categories/ideas).

## Coverage and manual-evidence limits

Published CLI 0.1.0 does not include coverage-aware comparison, actionable finding guidance, explicit baseline-acceptance review, or structured manual CLI evidence. See [the evidence policy](docs/CI_EVIDENCE_POLICY.md) for coverage and evidence limits.
