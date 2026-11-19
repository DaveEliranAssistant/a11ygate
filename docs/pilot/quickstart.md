# Pilot quickstart: from zero to a gated PR in about 30 minutes

Automated testing only. Not a WCAG audit, certification or legal advice.

This is the hands-on path for the free 21-day pilot (see the [pilot index](README.md)). It uses only commands that exist on `main` today: `init`, `doctor`, `scan`, `baseline create` and `evidence pack`. The output snippets below are copied from a real run against this repository's fixture site (`fixtures/scan-site`, served on a loopback port chosen by the operating system, here `63570`). Long output is trimmed and every trim is marked with "…".

Before you start, complete the [kickoff checklist](kickoff-checklist.md). In particular, **only scan a site you own or have written authorization from the site owner to test.** The quickstart scans your own application started on `127.0.0.1` inside CI.

| Step | Time | What you get |
| --- | --- | --- |
| [1. Build the CLI](#1-build-the-cli-5-minutes) | 5 min | `packages/cli/dist/cli.mjs` from a source checkout |
| [2. Preflight with doctor](#2-preflight-with-doctor-2-minutes) | 2 min | Node, browser and engine checks |
| [3. First scan](#3-first-scan-5-minutes) | 5 min | `a11y/a11ygate-scan.{json,md,html}` |
| [4. Baseline the existing findings](#4-baseline-the-existing-findings-3-minutes) | 3 min | `.a11ygate-baseline.json` |
| [5. Evidence pack](#5-evidence-pack-2-minutes) | 2 min | `a11ygate-evidence.zip` |
| [6. Wire the gate into CI](#6-wire-the-gate-into-ci-10-minutes) | 10 min | A required check on every PR to `main` |
| [7. Prove the gate on a PR](#7-prove-the-gate-on-a-pr-3-minutes) | 3 min | One passing PR and, optionally, one blocked PR |

## 1. Build the CLI (5 minutes)

The published npm package `@qe-atlas/a11ygate@0.1.0` does not include `init` or `scan`. Use a source build of A11yGate, pinned to a commit you have reviewed:

```sh
git clone https://github.com/DaveEliranAssistant/a11ygate.git
cd a11ygate
npm ci
npm run cli:build
npx playwright install chromium
```

In the rest of this page, `a11ygate` means `node /path/to/a11ygate/packages/cli/dist/cli.mjs`, run from **your** project directory.

## 2. Preflight with doctor (2 minutes)

```sh
a11ygate doctor
```

From a project directory where Playwright and `@axe-core/playwright` are not installed yet, `doctor` names what is missing (trimmed). This transcript is from a fixture project that already had an `.a11ygate.yml`; in a fresh project the first line is `[SKIPPED] config: No .a11ygate.yml; defaults apply.`; that is fine, because the pilot commands below pass their URL and options as flags:

```text
A11yGate doctor
[PASS] config: .a11ygate.yml is valid against schema/a11ygate.schema.json.
…
[PASS] node: Node meets the CLI requirement (20+; the Action uses 22).
…
[FAIL] browser: Playwright or its Chromium executable is missing. Run npm install --save-dev playwright, then npx playwright install chromium.
…
[FAIL] engines: Requested engine peers are missing: @axe-core/playwright. Install the named packages before scanning.
…
Preflight findings above need attention; unknown checks are not proof of a working setup.
Automated testing only. Not a WCAG audit, certification or legal advice.
```

After `npm install --save-dev playwright @axe-core/playwright` and `npx playwright install chromium`, the same checks report:

```text
[PASS] browser: Playwright Chromium is installed.
…
[PASS] engines: All requested engine peers are installed.
```

`doctor` exits 0 by default; add `--strict` to make failed checks exit 1. See [Troubleshooting](../troubleshooting.md) for every message.

## 3. First scan (5 minutes)

Start your application on loopback (for example on port 4173), then scan it:

```sh
a11ygate scan http://127.0.0.1:4173/ --crawl 10 --fail-on serious --out-dir a11y
```

Fixture run output (trimmed; exit code 1 because existing findings are at or above `serious`):

```text
Scanning http://127.0.0.1:63570/
Scanning http://127.0.0.1:63570/about.html
Scanning http://127.0.0.1:63570/contact.html
Scanning http://127.0.0.1:63570/products.html
Scanning http://127.0.0.1:63570/about.html?ref=products
# A11yGate site scan — http://127.0.0.1:63570/

**Verdict: FAIL** (fail on: serious)

8 findings at or above serious: image-alt, color-contrast, label, target-size.

| Severity | Findings |
| --- | --- |
| critical | 2 |
| serious | 6 |
| moderate | 0 |
| minor | 0 |
| unknown | 0 |
…
## Not scanned

- http://127.0.0.1:63570/private/secret.html — disallowed by robots.txt
…
```

The crawl stays on the same origin and honours `robots.txt`. A11yGate itself does not click controls or submit forms unless you opt in to interactions (`--interactions`, `--auto-interactions`) or a login script. `scan` is **not request-restricted**, though: each page loads in a real browser and runs its own JavaScript, so any requests the page makes on load (analytics, API calls, including non-GET requests) still happen. Point it at a test or staging environment, not production, unless the site owner has agreed. Only `a11ygate prospect` blocks non-GET/HEAD requests, form submissions and popups. Pages behind a login need a Playwright storage state file (`--storage-state`); see [Authenticated pages](../authenticated-pages.md) and use a test account only.

## 4. Baseline the existing findings (3 minutes)

The pilot gate blocks **new** findings, not the existing backlog. Record what exists today as a fingerprint baseline:

```sh
a11ygate baseline create a11y --output .a11ygate-baseline.json
```

```text
Wrote fingerprint baseline .a11ygate-baseline.json
```

Re-scan with the baseline. The same findings are now "existing" debt and the gate passes (exit code 0):

```sh
a11ygate scan http://127.0.0.1:4173/ --crawl 10 --fail-on serious --baseline .a11ygate-baseline.json --out-dir a11y
```

```text
…
**Verdict: PASS** (fail on: serious)

0 new findings at or above serious.
…
Baseline: 0 new; 8 existing; 0 fixed; 0 unassessed.

Automated testing only. Not a WCAG audit, certification or legal advice.
…
```

Existing findings stay visible in every report. A baseline is a starting point for the team's backlog, not an audit result. See [Baseline mode](../baseline-mode.md).

### Replacing the baseline

`baseline create` never overwrites an existing file: if `.a11ygate-baseline.json` already exists it stops with `Could not create baseline` and exit code 2, and the old baseline stays in use. To replace a baseline (for example because CI serves the application on another URL, here `http://127.0.0.1:8080/`), scan that exact URL and crawl scope into a separate folder, write the baseline under a new name, check that a re-scan with it passes, and only then replace the old file:

```sh
rm -f .a11ygate-baseline.new.json
a11ygate scan http://127.0.0.1:8080/ --crawl 10 --fail-on serious --out-dir a11y-new
a11ygate baseline create a11y-new --output .a11ygate-baseline.new.json \
  && a11ygate scan http://127.0.0.1:8080/ --crawl 10 --fail-on serious --baseline .a11ygate-baseline.new.json --out-dir a11y-new \
  && mv .a11ygate-baseline.new.json .a11ygate-baseline.json
```

The first scan exits 1 while the existing findings are not baselined yet; that is expected. The `rm -f` removes a leftover candidate from an earlier attempt, and the `&&` chain replaces the active baseline only if the new baseline was written **and** the re-scan with it exits 0 (`0 new findings at or above serious`). If either step fails, `.a11ygate-baseline.json` is left unchanged: check that the URL and crawl scope match the first scan, then try again. Use the same URL and crawl scope in your CI file.

## 5. Evidence pack (2 minutes)

```sh
a11ygate evidence pack --from a11y --out a11ygate-evidence.zip
```

```text
Wrote a11ygate-evidence.zip (9 files, manifest SHA-256 for each).
```

The zip holds the reports, the scope statement, what automated testing cannot cover, and a manifest with versions, commit and SHA-256 hashes. See [Evidence pack](../../packages/cli/README.md#evidence-pack-a11ygate-evidence-pack).

## 6. Wire the gate into CI (10 minutes)

Pick your CI system. In each case: commit `.a11ygate-baseline.json`, start your application on loopback in the job, and make the job a **required** check for merges to `main` (that last step is a repository setting the customer's admin changes; A11yGate never changes repository settings).

**Use the same URL and crawl scope in CI as in the baseline scan.** Finding fingerprints include the page URL (host and port included), so a baseline created from `http://127.0.0.1:4173/` with `--crawl 10` only matches a CI scan of `http://127.0.0.1:4173/` with `--crawl 10`. If the job serves the application on a different port, or the CI template defaults differ (the GitLab and Azure DevOps templates default to `http://127.0.0.1:3000` and one page), every existing finding counts as new and the gate fails. Every example below uses `http://127.0.0.1:4173/` and `--crawl 10`, matching steps 3 and 4. If your CI job must use another URL, create a replacement baseline from that exact URL and crawl scope as shown in [Replacing the baseline](#replacing-the-baseline) before committing it.

**The CLI in GitLab and Azure DevOps jobs.** The GitLab and Azure DevOps templates run `npx --no-install a11ygate`, which uses an A11yGate CLI already installed in **your** project and fetches nothing at scan time. The CLI on npm (0.1.0) predates `scan` and `evidence pack`, so for the pilot vendor the source-built CLI from step 1 into your repository and install it as a local development dependency, together with the browser packages, then commit the lockfile:

```sh
mkdir -p tools && cp -R /path/to/a11ygate/packages/cli tools/a11ygate
npm install --save-dev ./tools/a11ygate playwright@1.64.1 @axe-core/playwright
npx --no-install a11ygate --help
```

The last command must print the A11yGate help in your project; then both templates' `npm ci` installs the same CLI in CI. This is the vendoring route described in the [GitLab guide](../../integrations/gitlab/README.md); keep the Playwright package version aligned with the CI image or the Chromium install step.

### GitHub Actions

`init` creates the config and the workflow, and with `--baseline` it also creates the fingerprint baseline from the saved scan and passes it to the scanner:

```sh
a11ygate init --yes --target github --url http://127.0.0.1:4173/ --crawl 10 --fail-on serious --baseline a11y
```

Because step 4 already wrote `.a11ygate-baseline.json`, `init` keeps it and only wires it into the workflow:

```text
Skipped existing .a11ygate-baseline.json (baseline creation never replaces evidence).
Wrote .a11ygate.yml
Wrote .github/workflows/a11ygate.yml
Review the starter before committing. Start your local app before scanning; only scan authorized sites.
Automated testing only. Not a WCAG audit, certification or legal advice.
```

The generated workflow runs on `pull_request`, sets `A11YGATE_URL: "http://127.0.0.1:4173/"` (the same URL as the baseline), and has this scan step:

```text
run: node .a11ygate-tool/packages/cli/dist/cli.mjs scan "$A11YGATE_URL" --crawl 10 --fail-on serious --baseline .a11ygate-baseline.json --format junit,sarif,json,md --out-dir a11y-results
```

It requests these `GITHUB_TOKEN` permissions, as generated today:

```yaml
permissions:
  contents: read
  issues: write
  pull-requests: write
  security-events: write
```

For a least-privilege pilot, reduce them before committing. No step in the generated workflow writes issues or pull requests, so `issues: write` and `pull-requests: write` can be removed. `security-events: write` is used only by the "Upload SARIF" step (GitHub code scanning). If the pilot does not use code scanning, delete that step and keep only:

```yaml
permissions:
  contents: read
```

The gate itself (the scan step's exit code) and the report artifact work with `contents: read` alone. Record the permissions you kept in the [kickoff checklist](kickoff-checklist.md).

Add your application's install/build/start commands where the workflow comment says so, then make the `a11y` check (the job id in the generated workflow, shown as `A11yGate / a11y` in the PR checks list) required in the branch protection rule (or ruleset) for `main`. Details: [GitHub Action](../integrations/github-action.md), [init](../integrations/init.md).

### GitLab CI

`init` does not generate GitLab files yet. Copy the reviewed template [`integrations/gitlab/a11ygate.gitlab-ci.yml`](../../integrations/gitlab/a11ygate.gitlab-ci.yml) into your repository by hand and include it as shown in the [GitLab guide](../../integrations/gitlab/README.md). The template defaults to `http://127.0.0.1:3000` and `--crawl 1`; in your copy, set the URL to the one the baseline was created from, raise the crawl to the same scope, and add the baseline to the scan line:

```yaml
  variables:
    A11YGATE_URL: "http://127.0.0.1:4173/"
    A11YGATE_FAIL_ON: "serious"
```

```sh
npx --no-install a11ygate scan "$A11YGATE_URL" --crawl 10 --fail-on "$A11YGATE_FAIL_ON" --baseline .a11ygate-baseline.json --format gitlab-codequality,junit --out-dir a11y
```

Start your application on port 4173 in the job before this line.

The template runs only for merge request pipelines. Turn on "Pipelines must succeed" for merge requests in the project settings so a failing scan blocks the merge.

### Azure DevOps

`init` does not generate Azure Pipelines files yet. Use the step template [`integrations/azure-devops/a11ygate.yml`](../../integrations/azure-devops/a11ygate.yml) as described in the [Azure DevOps guide](../integrations/azure-devops.md). The template has no baseline parameter, so copy it into your repository and add the baseline to its scan step:

```sh
npx --no-install a11ygate scan "${{ parameters.url }}" --crawl ${{ parameters.crawl }} --fail-on ${{ parameters.failOn }} --baseline .a11ygate-baseline.json --format junit,sarif --out-dir ${{ parameters.outDir }}
```

The template defaults to `url: 'http://127.0.0.1:3000'` and `crawl: 1`. Pass the URL and crawl scope the baseline was created from, and start your application on port 4173 in an earlier step:

```yaml
steps:
  - template: a11ygate.yml # path of your reviewed copy
    parameters:
      url: 'http://127.0.0.1:4173/'
      crawl: 10
      failOn: serious
```

The template already produces an evidence pack on every run. Add the pipeline as a **build validation** branch policy on `main` so PRs cannot complete while it fails.

### Jenkins

```sh
a11ygate init --yes --target jenkins --url http://127.0.0.1:4173/ --crawl 10 --fail-on serious --baseline a11y
```

```text
Skipped existing .a11ygate-baseline.json (baseline creation never replaces evidence).
Wrote .a11ygate.yml
Wrote Jenkinsfile
Review the starter before committing. Start your local app before scanning; only scan authorized sites.
Configure the 'a11ygate' shared library and provision Node 20+, the source CLI at packages/cli/dist/cli.mjs, and Playwright Chromium on the agent. See docs/integrations/jenkins.md.
Automated testing only. Not a WCAG audit, certification or legal advice.
```

The generated `Jenkinsfile` scans `http://127.0.0.1:4173/` with `crawl: 10` (the same URL and scope as the baseline) and passes `baseline: '.a11ygate-baseline.json'` to the `a11yGate` step. Run it from a multibranch pipeline that builds pull requests, and report the build status back to your Git host as a required check. Details: [Jenkins](../integrations/jenkins.md).

## 7. Prove the gate on a PR (3 minutes)

1. Open a PR to `main` with the starter files and the baseline. The gate should pass: no new findings.
2. Optional: open a throwaway PR that adds an image without an `alt` attribute. The gate should fail with one new `image-alt` finding. Close that PR; do not merge it. Do not write alt text for real content from this example: alt text and labels need a human who knows the content.

Then note the result (PR link, pass/fail) in your pilot notes for the weekly check-in. Your copy of [`success-criteria.template.yml`](success-criteria.template.yml) holds the agreed targets only, not results; results are compared with it at the decision date.

Automated testing only. Not a WCAG audit, certification or legal advice.
