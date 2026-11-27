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
| GitLab (`--target gitlab`) | `.a11ygate.yml`, `.gitlab-ci.a11ygate.yml`, and the root `.gitlab-ci.yml` (created, or extended with the include and `merge_request_event` rule) |
| Azure DevOps (`--target azure-devops`) | `.a11ygate.yml`, `azure-pipelines.a11ygate.yml` |
| Any target, with `--baseline <saved-scan>` | Also `.a11ygate-baseline.json` |

The config records setup choices and the doctor engine list, with model fixes
disabled. The generated CI file passes the scan choices explicitly. Edit the
CI file when changing them. GitLab, Azure DevOps, and all `--pilot` runs also
record `ciTarget`. When this key is present, `a11ygate doctor` checks that the
corresponding file exists. You can set the key in an existing config.
Existing files are skipped individually and init exits successfully. `--force`
replaces regular starter files; it refuses symlink destinations and parents.
It never replaces a fingerprint baseline, even with `--force`.

### Config schema and validation

`.a11ygate.yml` is described by
[`schema/a11ygate.schema.json`](../../schema/a11ygate.schema.json). The generated
file starts with

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/DaveEliranAssistant/a11ygate/main/schema/a11ygate.schema.json
```

so editors with the YAML language server offer autocomplete and inline errors.
Keys: `ciTarget`, `url`, `crawl`, `failOn`, `engines`, `modelFixes`, `baseline`, `formats`,
`outDir`, `delayMs`, `reportVersion`, and `auth` (`storageState`, `loginScript`,
`loginTimeoutMs`, `cookieEnv`, `headerEnv` — environment variable names only,
never credentials). Scan settings note their matching CLI flags (`x-cli`). Run
`a11ygate config validate [file]` or `a11ygate doctor` to get plain-English
errors such as `unknown key 'engine' — did you mean 'engines'?`. Validation
checks the file's shape only; it is not an accessibility assessment.

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

## Finish GitLab or Azure DevOps setup

For GitLab, init writes the job to `.gitlab-ci.a11ygate.yml` and puts a
`merge_request_event` rule directly in the root `.gitlab-ci.yml`, next to a local
include of the job file. GitLab does not use rules from `include:` files to decide
whether to create a merge request pipeline, so an `include:` entry alone is not
enough. Without a root file, init writes:

```yaml
include:
  - local: '.gitlab-ci.a11ygate.yml'

workflow:
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH'
    - if: '$CI_COMMIT_TAG'
```

The branch and tag rules keep your branch and tag pipelines running. With an
existing root file, init keeps every job, key and byte already there and only
inserts lines: the local include (a new entry in an existing `include:` list, or
an `include:` block), the `merge_request_event` rule (as the first entry of an
existing `workflow: rules` list, or the `workflow:` block above), and a comment
with the disclaimer. It skips the file when the rule and include are already
there; `--force` never replaces this file. Init works from an allowlist: it edits
the file only when it can read every line, and it re-reads its own result before
writing (one `workflow:` and one `include:`, the local include present, the
merge request rule first, every original line kept in order). For anything else,
such as an indented or flow-style root, `---` or `...` document markers, tabs, a
key repeated in any mapping (including a later `workflow: rules` entry or a flow
mapping), a quoted value or flow collection that continues on the next line, a
top-level value continued on the next line (a string `include:` must be one
line), anchors, aliases or `!reference` in `workflow:` or `include:`, a block
scalar (`|`, `>`, `|+`, `>-`, `|2`, also after `- ` or `- - `) inside
`workflow:` or `include:` or in the last top-level key when init appends, a quoted
or escaped spelling of a key init edits (`"workflow":`, `'include':`,
`"\x77orkflow":`, `'rules':`, `'local':`), a double-quoted top-level key with
escapes, or any `workflow: rules` entry (every entry is checked, not only the
first) it cannot read exactly (comments after a value or inside the entry, quoted
keys such as `'when':`, flow mappings, nested or multi-line values, an unknown
`when:`), init leaves the file unchanged, prints this snippet, and exits with
code 2. It also refuses a
`merge_request_event` rule that is not the plain first rule
(`- if: '$CI_PIPELINE_SOURCE == "merge_request_event"'`, optionally with
`when: on_success` or `when: always`), for example one with `when: never`,
`manual` or `delayed`, an extra condition, or a rule before it, because GitLab
uses the first matching rule. Then add the include and the rule (as the first `workflow: rules`
entry) yourself. A symlinked root file is refused. The job runs on merge requests and publishes Code Quality
and JUnit reports. See the [GitLab guide](../../integrations/gitlab/README.md) and
[GitLab CI in the pilot quickstart](../pilot/quickstart.md#gitlab-ci).

For Azure DevOps, register `azure-pipelines.a11ygate.yml` as a standalone
pipeline. It disables push triggers and targets PRs to `main` for supported
repository hosts. For Azure Repos Git, set a build validation policy on the target
branch. See the [Azure DevOps guide](azure-devops.md).

Both starters expect the project's lockfile to install an A11yGate CLI with
scan support. Start your authorized app before the scan step and wait for it
to be ready. Review the integration guide for browser and dependency setup.

## Pilot kickoff

Add `--pilot` to any target to generate `a11ygate-pilot/success-criteria.yml`
and `a11ygate-pilot/KICKOFF.md`. Replace the starter dates and customer
placeholder at kickoff. Init prints the doctor, scan, baseline, pull request,
and evidence-pack steps for your chosen target.

## Optional fingerprint baseline

Create and review an initial scan report separately, then opt in during setup:

```sh
node /path/to/a11ygate/packages/cli/dist/cli.mjs init --yes --baseline a11y-results
```

This calls `a11ygate baseline create` on the saved directory (or JSON file) and
writes `.a11ygate-baseline.json`. It does not start a browser or a live scan.
Missing or incomplete evidence fails before starter files are written. Commit
the reviewed baseline with the starter files; all generated CI targets pass it
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
