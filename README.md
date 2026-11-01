# A11yGate

A11yGate turns axe-core JSON (for example from `@axe-core/playwright` in CI) into an accessibility regression gate and an EU Accessibility Act evidence report.

The gate fails only on **new** violations compared with a baseline. Fixed and still-open findings are reported. The default impact threshold is `serious`, so `serious` and `critical` fail the gate. `moderate` and `minor` do not.

The scan tool runs in the browser at [https://a11ygate.vercel.app](https://a11ygate.vercel.app). There is no account, no payment, and scan files are not uploaded. The waitlist is the only form that sends data to the server, and only after consent. The same diff and gate power the CLI and the GitHub Action in this repository. Neither is published yet.

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

The landing page posts to `POST /api/waitlist`. Run this once against the production database before inviting people. It is idempotent (`CREATE TABLE IF NOT EXISTS`) and reads `DATABASE_URL_POOLED`, then `DATABASE_URL`:

```bash
DATABASE_URL_POOLED='postgres://…' npm run db:migrate
```

Without either variable the form says the waitlist is temporarily unavailable and the API returns 503. The table stores the normalized email, optional role and company, consent, `created_at`, source (`landing`), and a user-agent hash. It does not store an IP address.

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

The package in `packages/cli` is named `a11ygate`. It is not on npm yet. After `npm install` in this repo the local bin is:

```bash
npx a11ygate --help
npx a11ygate --current fixtures/demo-shop-current.json --baseline fixtures/demo-shop-baseline.json
```

That demo command exits **1** and prints **2 new, 3 fixed, 5 still open, FAIL**.

```bash
npx a11ygate --current axe.json --baseline a11y/baseline.json
npx a11ygate --current home.json --current cart.json --threshold critical --json result.json
npx a11ygate --current axe.json --update-baseline a11y/baseline.json --markdown summary.md
```

| Exit code | Meaning |
| --- | --- |
| 0 | No new finding is at or above the threshold. |
| 1 | At least one new finding is at or above the threshold. |
| 2 | The arguments or the JSON could not be read. |

`--update-baseline` writes the current results as the next baseline and still uses the gate's exit code, so a run with new violations does not pass just because the file was updated. More detail is in `packages/cli/README.md`.

## GitHub Action

`action/action.yml` is a composite action. It runs the CLI, appends the Markdown summary to the job summary, and can post or update a single pull request comment (the comment contains `<!-- a11ygate -->`). It is not listed on the GitHub Marketplace.

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
      - uses: DaveEliranAssistant/a11ygate/action@<ref>
        with:
          current: |
            a11y-results/home.json
            a11y-results/cart.json
          baseline: a11y/baseline.json
          threshold: serious
          comment: true
```

From a checkout of this repository, `uses: ./action` points at the same action. `<ref>` must be a commit or branch that contains `action/`. Let the Playwright test write JSON and let A11yGate be the gate. Do not also assert `violations.length === 0` in that test, or the job fails before the summary is posted.

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
