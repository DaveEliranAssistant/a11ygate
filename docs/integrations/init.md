# Initialize A11yGate

Automated testing only. Not a WCAG audit, certification or legal advice.

`a11ygate init` writes a starter config and a CI file without contacting a scan
site, installing packages, changing repository settings, or generating content
for alt text or labels. Use the current source build: published `0.1.0` does not
include `init` or `scan`.

From an A11yGate source checkout:

```sh
npm ci
npm run cli:build
node packages/cli/dist/cli.mjs init --help
```

Run that CLI by its absolute path from the project you want to configure. With a
terminal, `init` prompts for CI target, an authorized URL, crawl pages, fail-on
impact, and optional baseline creation. For a scripted pilot, use:

```sh
# Run from your project directory; replace /path/to/a11ygate with your source checkout.
node /path/to/a11ygate/packages/cli/dist/cli.mjs init --yes --target github \
  --url http://127.0.0.1:4173/ --crawl 10 --fail-on serious

node /path/to/a11ygate/packages/cli/dist/cli.mjs init --yes --target jenkins \
  --url http://127.0.0.1:4173/ --crawl 0 --fail-on critical
```

Defaults are GitHub Actions, `http://127.0.0.1:4173/`, 10 pages, and `serious`.
`--crawl 0` scans only the start URL; 1–20 crawls same-origin links. Fail-on accepts
`minor`, `moderate`, `serious`, `critical`, or `none` (report only). Only scan sites
you own or are authorized to test. URLs must use HTTP(S), without credentials or
literal whitespace, quotes, backslashes, backticks, or dollar signs; percent-encode
special URL characters. The Jenkins shared library wraps URLs in shell quotes.

| Target | Generated files |
| --- | --- |
| GitHub (`--target github`) | `.a11ygate.yml`, `.github/workflows/a11ygate.yml` |
| Jenkins (`--target jenkins`) | `.a11ygate.yml`, `Jenkinsfile` |
| Either, with `--baseline <saved-scan>` | Also `.a11ygate-baseline.json` |

The config records setup choices and the doctor engine list, with model fixes
disabled. The scanner does not read URL/crawl/fail-on defaults from config; the
CI file passes those choices explicitly. Edit the CI flags when changing them.
Existing files are skipped individually and init exits successfully. `--force`
replaces regular starter files; it refuses symlink destinations and parents.
It never replaces a fingerprint baseline, even with `--force`.

## Finish GitHub setup

The starter checks out the PR head SHA and declares the R13 permissions. It uses
`pull_request`, with a same-repository guard on SARIF upload. It builds the
scanner in `.a11ygate-tool` from a pinned A11yGate source commit with scan support,
using Node 22 and Playwright Chromium. Review that source ref when upgrading.

For a local application, add your project's install/build/start commands and a
readiness check **before** the scan step. The generated file marks the insertion
point. The placeholder URL is not a bundled server. An already-running authorized
staging URL can be supplied with `--url` instead. Reports are archived even when
the gate fails. SARIF upload needs code scanning availability; omit that upload
step if unavailable. Init never enables a GitHub feature or changes a setting.
See [GitHub Action setup requirements](github-action.md#setup-requirements) for
permission and fork details. This starter runs the CLI; it does not post comments
or propose fixes.

## Finish Jenkins setup

Configure the `a11ygate` shared library with SCM root `integrations/jenkins` as
shown in the [Jenkins guide](jenkins.md). The default starter matches the canonical
`examples/jenkins/Jenkinsfile` byte-for-byte. Provision Node 20+, the current
source CLI at `packages/cli/dist/cli.mjs` in the job workspace, the axe/Playwright
peers, and Chromium. Start the local application before the scan stage. The
`SITE_URL` and `FAIL_ON` build parameters use the init choices as defaults.
The library publishes JUnit and archives reports, maps findings to UNSTABLE,
and execution errors to FAILURE.

## Optional fingerprint baseline

Create and review an initial scan report separately, then opt in during setup:

```sh
node /path/to/a11ygate/packages/cli/dist/cli.mjs init --yes --baseline a11y-results
```

This calls `a11ygate baseline create` on the saved directory (or JSON file) and
writes `.a11ygate-baseline.json`. It does not start a browser or a live scan.
Missing or incomplete evidence fails before starter files are written. Commit
the reviewed baseline with the starter files; both generated CI targets pass it
to the scanner. Existing accepted findings remain debt; a baseline is not an audit
or conformance claim. Re-running init preserves existing baseline evidence.

## Offline verification

`npm test` covers generated-file snapshots, R13 workflow invariants, argument
validation, idempotency, baseline creation, and a bundled CLI invocation with
piped input/output. `npm run test:jenkins` executes the generated Jenkins snapshots
through JenkinsPipelineUnit with the shared library mocked at the controller DSL
boundary. No browser or scan target is used in either suite.

To lint three generated workflow variants with the real actionlint checker:

```sh
# One-time development tool installation; no runtime dependency or new CI job.
go install github.com/rhysd/actionlint/cmd/actionlint@v1.7.7
npm run cli:build
ACTIONLINT="$(go env GOPATH)/bin/actionlint" node scripts/check-init-actionlint.mjs
```

The checker itself runs offline. Variants cover defaults, custom URL/crawl/fail-on,
and an opted-in fingerprint baseline.
