# A11yGate

A11yGate turns axe-core JSON (for example from `@axe-core/playwright` in CI) into an accessibility regression gate and an EU Accessibility Act evidence report.

The gate fails only on **new** violations compared with a baseline. Fixed and still-open findings are reported. The default impact threshold is `serious`, so `serious` and `critical` fail the gate. `moderate` and `minor` do not.

The scan tool runs in the browser at [https://a11ygate.vercel.app](https://a11ygate.vercel.app). There is no account, no payment, and scan files are not uploaded. The waitlist is the only form that sends data to the server, and only after consent. The same diff and gate power the CLI and the GitHub Action in this repository. The CLI is published on npm as `@qe-atlas/a11ygate@0.2.0` (the `next` tag: `npx @qe-atlas/a11ygate@next`). The `latest` tag remains 0.1.0 until a separate approval. The Action is published as `DaveEliranAssistant/a11ygate-action@v1`. The waitlist does not gate the CLI, the Action, or the browser demo.

**Informational only. Not legal advice. Not a certification of EAA compliance.** Automated checks cover only part of WCAG; this is evidence, not certification.

Contents: [5-minute quickstart](#5-minute-quickstart) · [CI matrix](#ci-matrix) · [Troubleshooting](#troubleshooting) · [What A11yGate does not do](#what-a11ygate-does-not-do) · [Reference](#web-app)

Every code block in this README is included from a file that a test runs or checks; [`tests/readme-docs.test.ts`](tests/readme-docs.test.ts) fails on drift.

## 5-minute quickstart

You need Node 20 or newer. Clone this repository, run `npm install` and `npm run cli:build`, then run the commands in [`examples/quickstart/quickstart.sh`](examples/quickstart/quickstart.sh) from the repository root. They gate the synthetic Demo Shop scan (`fixtures/`, marked `_fixture: SYNTHETIC`, not a real audit). `npm test` executes each line and checks the exit code in its comment.

<!-- include:examples/quickstart/quickstart.sh -->
```sh
# A11yGate 5-minute quickstart. Run from a checkout of this repository after `npm install`.
# tests/readme-docs.test.ts executes every line of this file and checks each "# exit N" comment.
# Automated testing only. Not a WCAG audit, certification or legal advice.

# 1. Gate the synthetic Demo Shop scan against its baseline: 2 new, 3 fixed, 5 still open, FAIL.
npx a11ygate --current fixtures/demo-shop-current.json --baseline fixtures/demo-shop-baseline.json # exit 1

# 2. Only critical findings fail at --threshold critical, so the new serious finding no longer fails.
npx a11ygate --current fixtures/demo-shop-current.json --baseline fixtures/demo-shop-baseline.json --threshold critical # exit 0

# 3. Write the current results as the next baseline. The exit code is still the gate's result.
mkdir -p a11y
npx a11ygate --current fixtures/demo-shop-current.json --baseline fixtures/demo-shop-baseline.json --update-baseline a11y/baseline.json --markdown a11y/summary.md # exit 1

# 4. Gate the same scan against the new baseline: nothing is new, PASS.
npx a11ygate --current fixtures/demo-shop-current.json --baseline a11y/baseline.json # exit 0
```

Next, point `--current` at your own axe JSON. One way to produce it is a Playwright test with `@axe-core/playwright` that writes one file per page (see [Produce axe JSON](#produce-axe-json)). Then pick your CI from the matrix below.

## CI matrix

All five integrations are merged on `main`. "Tested how" states only what a test in this repository or a recorded run shows. Nothing in this table was run in a customer pipeline.

| CI | Guide and file | Tested how | Not verified |
| --- | --- | --- | --- |
| GitHub Actions | [Guide](docs/integrations/github-action.md), [`examples/github-action/a11ygate.yml`](examples/github-action/a11ygate.yml) | `npm test` ([`tests/github-action-docs.test.ts`](tests/github-action-docs.test.ts)) runs the example workflow's gate command against its fixtures, checks its permissions, head-SHA checkout and that its inputs exist in `action/action.yml`. This repository's own CI runs `npm test` on GitHub-hosted runners. | The example workflow file is not itself run as a workflow by any test. The published `DaveEliranAssistant/a11ygate-action@v1` is not exercised by these tests. |
| Jenkins | [Guide](docs/integrations/jenkins.md), [`integrations/jenkins/`](integrations/jenkins/README.md) | Recorded run: Jenkins 2.580.2 LTS (Java 21) [acceptance run](https://github.com/DaveEliranAssistant/a11ygate/actions/runs/43573138952) on 2026-11-14 (BAD fixture UNSTABLE, clean fixture SUCCESS). Gradle unit tests (`npm run test:jenkins`) and [`tests/jenkins-docs.test.ts`](tests/jenkins-docs.test.ts). | Only the pinned LTS image in that harness; no other Jenkins versions or agents. |
| GitLab | [Guide](integrations/gitlab/README.md), [`integrations/gitlab/a11ygate.gitlab-ci.yml`](integrations/gitlab/a11ygate.gitlab-ci.yml) | [`tests/gitlab-codequality.test.ts`](tests/gitlab-codequality.test.ts) checks the job structure and Code Quality output. [`integrations/gitlab/smoke-local.mjs`](integrations/gitlab/smoke-local.mjs) runs the template's exact `script` against a loopback fixture (manual, needs Chromium). | No GitLab runner run. Docker was unavailable, so the container image and `npm ci` were not executed; `gitlab-ci-local` is not installed here and validates configuration only. |
| Azure DevOps | [Guide](docs/integrations/azure-devops.md), [`integrations/azure-devops/a11ygate.yml`](integrations/azure-devops/a11ygate.yml) | [`tests/azure-devops.test.ts`](tests/azure-devops.test.ts) checks task and input names and runs the template's rendered scan and evidence-pack lines through the CLI (and in `/bin/sh` when Chromium is installed). | No Azure DevOps organization was used; no pipeline run. The Windows cmd.exe path is not executed. |
| CircleCI | [Guide](docs/integrations/circleci.md), [`integrations/circleci/config.yml`](integrations/circleci/config.yml) | [`tests/circleci.test.ts`](tests/circleci.test.ts) checks the config against the documented key subset and, when Chromium is installed, runs its wait, scan and evidence commands in bash against a loopback fixture. | `circleci config validate` has not been run: the CircleCI CLI and Docker were not available, and no CircleCI account was used. No orb is published (coming, owner action). |

## Troubleshooting

Run `npx a11ygate doctor` first. The most common failures, with the exact messages, are in [docs/troubleshooting.md](docs/troubleshooting.md):

| Symptom | Where to look |
| --- | --- |
| `Playwright or its Chromium executable is missing.` | [browser](docs/troubleshooting.md#browser) |
| `Requested engine peers are missing: ...` | [engines](docs/troubleshooting.md#engines) |
| `Node is unsupported.` | [node](docs/troubleshooting.md#node) |
| `.a11ygate.yml has N problems: ...` | [config](docs/troubleshooting.md#config) |
| `The checkout differs from the pull request head.` | [checkout](docs/troubleshooting.md#checkout) |
| `The job token lacks required workflow permissions: ...` | [permissions](docs/troubleshooting.md#permissions) |
| `<path>: file not found.` or verdict INCOMPLETE (exit 2) | [gate errors](docs/troubleshooting.md#gate-errors-exit-2) |

## What A11yGate does not do

A11yGate is an automated regression gate. It does not do a manual accessibility audit, it does not test with assistive technology (screen readers, switch access, voice control, magnifiers), it does not give legal advice, and it does not certify anything. Details and other limits: [docs/what-a11ygate-does-not-do.md](docs/what-a11ygate-does-not-do.md).

## Web app

Run `npm install`, then `npm run dev`.

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

`@axe-core/playwright` is a dev dependency of this repo so the app can check itself. The project you are auditing installs it separately. This is [`examples/quickstart/axe-results.spec.ts`](examples/quickstart/axe-results.spec.ts), the same snippet the landing page shows; it is typechecked by `npm run typecheck` but not executed by the tests, because it loads a remote page:

<!-- include:examples/quickstart/axe-results.spec.ts -->
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

The npm package in `packages/cli` is `@qe-atlas/a11ygate`. The command name is still `a11ygate`. `@qe-atlas/a11ygate@0.2.0` is on the npm `next` tag (`npx @qe-atlas/a11ygate@next`). The `latest` tag is still 0.1.0, so bare `npx @qe-atlas/a11ygate` currently runs 0.1.0. Inside a checkout of this repo, after `npm install`, `npx` runs the local bin instead. The `fixtures/` paths in the quickstart exist only in a checkout.

The [quickstart](#5-minute-quickstart) runs the demo fixtures. For your own files, [`examples/cli/usage.sh`](examples/cli/usage.sh) (executed by `npm test` against generated axe JSON):

<!-- include:examples/cli/usage.sh -->
```sh
# Everyday CLI calls for your own axe JSON files (paths are examples).
# tests/readme-docs.test.ts executes every line of this file against generated axe JSON and checks each "# exit N" comment.
# Automated testing only. Not a WCAG audit, certification or legal advice.
npx @qe-atlas/a11ygate --help # exit 0
mkdir -p a11y
npx @qe-atlas/a11ygate --current axe.json --update-baseline a11y/baseline.json --markdown summary.md # exit 1
npx @qe-atlas/a11ygate --current axe.json --baseline a11y/baseline.json # exit 0
npx @qe-atlas/a11ygate --current home.json --current cart.json --threshold critical --json result.json # exit 0
```

| Exit code | Meaning |
| --- | --- |
| 0 | No new finding is at or above the threshold. |
| 1 | At least one new finding is at or above the threshold. |
| 2 | The arguments or the JSON could not be read. |

`--update-baseline` writes the current results as the next baseline and still uses the gate's exit code, so a run with new violations does not pass just because the file was updated. More detail is in `packages/cli/README.md`.

### Live-site scan

The source build also has `a11ygate scan <url>`. It loads one page, or with `--crawl [n]` up to 20 same-origin pages, in headless Chromium and runs axe-core. It writes JSON, Markdown and HTML reports grouped by WCAG criterion and severity, and exits 1 when a finding meets `--fail-on` (default `serious`). It needs the optional peers `playwright` and `@axe-core/playwright`. The JSON report is also valid `--current` input for the gate. Only scan sites you own or are authorized to test. Page analysis is read-only; [explicit authentication](docs/authenticated-pages.md) supports test accounts through storage state, a login script, or environment-referenced cookies/headers. The scanner honours robots.txt, paces page loads, and identifies itself as A11yGate. Automated testing only. Details are in `packages/cli/README.md`.

## GitHub Action

`action/action.yml` is a composite action. It runs the CLI, appends the Markdown summary to the job summary, and can post or update a single pull request comment (the comment contains `<!-- a11ygate -->`). The published Action is listed on the [GitHub Marketplace as A11yGate axe-core Regression Gate](https://github.com/marketplace/actions/a11ygate-axe-core-regression-gate) by DaveEliranAssistant.

This is [`examples/github-action/published-action.yml`](examples/github-action/published-action.yml). Tests check that its inputs exist in `action/action.yml`; they do not run the published Action. A copy-paste workflow whose gate command the tests run is in the [GitHub Action guide](docs/integrations/github-action.md).

<!-- include:examples/github-action/published-action.yml -->
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

<!-- include:examples/github-action/first-baseline-steps.yml -->
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

### Rule-based suggested changes

The action in this repository's `action/` directory (not yet the published `v1`) can also post GitHub "suggested changes" on pull request lines. With `comment: true` and `suggest-fixes: true` (the default), it posts a review comment with a ```` ```suggestion ```` block for a new finding when a fixed, no-model rule applies and the element maps to exactly one line inside the pull request diff. The rules cover `label` (reuse the existing visible label), `button-name` and `link-name` (`aria-label` from a `title` or icon name, otherwise a placeholder), `image-alt` (`alt=""` plus a TODO comment), clickable `div`/`span` (to `<button type="button">`), and `html-has-lang` (`lang` from `suggest-lang`, default `en`, plus a TODO comment).

A11yGate never commits. A person reviews each suggestion and clicks **Apply suggestion**. Text containing `TODO(a11ygate)` is a placeholder, not final text: it can make the automated check pass while the page is still not accessible, so replace it before merging. A11yGate never writes label, alt or aria text of its own. Findings outside the diff stay in the summary comment only. Line suggestions need `pull-requests: write` in addition to `issues: write`. A failed suggestion only logs a warning. These are automated checks of a few rules, not a full accessibility review or a compliance claim.

Experimental model-assisted fixes are **off by default** and need a repository opt-in (`modelFixes: true` in `.a11ygate.yml`) plus the action's `model-fixes: on` input; a flag cannot override a repository denial. With credentials, an explicit model ID, a provider allowlist and a request budget, it can request a draft from free-tier providers in the order Groq → Gemini → Cloudflare Workers AI. Drafts are validated and then recorded and discarded; this version never posts model output and always posts the rule-based suggestions above. Only a sanitized source snippet is sent. Rate limits put a provider on cooldown and move to the next one; nothing switches to paid usage. Environment variables, sourced free-tier notes and the privacy note are in the action README. It is not a compliance tool. See [action/README.md](action/README.md#model-assisted-fixes-experimental-default-off). Automated testing only. Not a WCAG audit, certification or legal advice.

## Development

Run `npm install`, then `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` and `npm run test:e2e`.

`npm test` is Vitest, including the CLI exit-code tests. It builds `packages/cli/dist/cli.mjs` and copies it to `action/dist/cli.mjs`. `npm run test:e2e` is Playwright against the production server, including an axe check of this app's own pages that fails on any serious or critical violation. Set `A11Y_E2E_SKIP_BUILD=1` to reuse a build you already produced.

GitHub Actions runs those commands on every pull request and push (`.github/workflows/ci.yml`).

## Fingerprint and mapping limits

See also [what A11yGate does not do](docs/what-a11ygate-does-not-do.md).

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

Scanning accepts `--engines axe` and defaults to axe only. Other engines are not enabled yet.
Automated testing only. Not a WCAG audit, certification or legal advice.

### Opt-in scan engines

Axe remains the only default engine. Enable additional engines explicitly with `--engines axe,htmlcs,ibm,lighthouse`; install commands are in the [engine documentation](docs/engines.md).

Install only the optional peers you select: `html_codesniffer` for `htmlcs`,
`accessibility-checker-engine` for `ibm`, and `lighthouse puppeteer-core` for
`lighthouse`. All use the same browser session; IBM rules are installed locally.
Opt-in reports merge matching page/element/WCAG findings with engine attribution
and agreement counts; native outputs are archived under `--out-dir/engines/`. Missing peers or engine
failures are reported as `errored` while remaining engines continue (exit 2).
See [engine documentation](https://github.com/DaveEliranAssistant/a11ygate/blob/main/docs/engines.md)
for offline behavior, licensing and the opt-in report fields.

Automated testing only. Not a WCAG audit, certification or legal advice.
