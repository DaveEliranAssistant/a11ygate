# CircleCI integration

Automated testing only. Not a WCAG audit, certification or legal advice.

A11yGate ships an example CircleCI config, [`integrations/circleci/config.yml`](../../integrations/circleci/config.yml). It runs in a `cimg/node` browsers image, installs your dependencies and Chromium, starts your application on loopback, scans it, stores JUnit results in the **Tests** tab, stores the HTML/JSON/Markdown reports, SARIF and an evidence pack as job artifacts, and fails the job according to a fail-on policy. An optional fingerprint baseline gates only new findings.

Sibling guides: [GitHub Action](github-action.md), [Jenkins](jenkins.md), [Azure DevOps](azure-devops.md), [GitLab](../../integrations/gitlab/README.md).

## Use the config

CircleCI reads `.circleci/config.yml` from your repository. Copy a reviewed version of the example there (or merge its `a11ygate-scan` job into your existing config) and adapt the job parameters in the workflow:

```yaml
workflows:
  accessibility:
    jobs:
      - a11ygate-scan:
          url: 'http://127.0.0.1:3000'
          fail-on: serious
          start-command: 'npm run build && npm run start -- --hostname 127.0.0.1 --port 3000'
          # baseline: .a11ygate-baseline.json
```

Only set `url` to a local or explicitly authorized application. The config performs no login, deployment, or publishing to any registry, and it uses no orb.

| Parameter | Type | Default | Meaning |
| --- | --- | --- | --- |
| `url` | string | `http://127.0.0.1:3000` | Start URL. Local or authorized targets only. |
| `fail-on` | enum | `serious` | `minor`, `moderate`, `serious`, `critical`, or `none`. |
| `crawl` | integer | `1` | Maximum pages to crawl (same origin, robots.txt respected). |
| `out-dir` | string | `a11y` | Output directory, relative to the working directory. |
| `baseline` | string | empty | Optional fingerprint baseline file. Empty = gate every finding. |
| `install-command` | string | `npm ci` | Dependency install command. |
| `start-command` | string | builds and starts a Next.js-style app on `127.0.0.1:3000` | Runs as a background step, followed by a wait for `url`. Empty = skip both (the app is already running). |

The consuming project's lockfile must provide the A11yGate CLI (a revision containing `scan`, `--format`, `baseline create` and `evidence pack`, i.e. `@qe-atlas/a11ygate@next` / 0.2.0 or a vendored `packages/cli`), plus `playwright` and `@axe-core/playwright`. Every A11yGate command uses `npx --no-install`, so nothing is fetched from the registry at scan time.

## What the job does

| Step | Config | Reference |
| --- | --- | --- |
| Image | `docker: - image: cimg/node:22.23-browsers` | [cimg/node image](https://circleci.com/developer/images/image/cimg/node) |
| Install | `run: << parameters.install-command >>` | |
| Chromium | `npx --no-install playwright install --with-deps chromium` | [Playwright CI docs](https://playwright.dev/docs/ci) |
| Start app | `when: condition: << parameters.start-command >>` → background `run`, then a `curl` wait loop | [configuration reference](https://circleci.com/docs/reference/configuration-reference/) |
| Scan | `npx --no-install a11ygate scan "<url>" --crawl <n> --fail-on <policy> --format junit,sarif --out-dir <out-dir> [--baseline <file>]` | |
| Evidence pack | `npx --no-install a11ygate evidence pack --from <out-dir> --out <out-dir>/a11ygate-evidence.zip --commit "$CIRCLE_SHA1"` with `when: always` | |
| JUnit | `store_test_results: path: <out-dir>/a11ygate-scan.junit.xml` | [configuration reference](https://circleci.com/docs/reference/configuration-reference/) |
| Reports, SARIF, evidence | `store_artifacts: path: <out-dir>, destination: a11ygate` | [configuration reference](https://circleci.com/docs/reference/configuration-reference/) |

The `-browsers` variant of `cimg/node` includes the system libraries browsers need. The config pins a Node 22 minor tag; bump it on your own schedule (`cimg/node` publishes `22.x-browsers` tags). The Playwright `--with-deps` install uses the image's passwordless `sudo`.

### Fail-on policy

CircleCI runs `run` commands with `/bin/bash -eo pipefail` by default, so the scan command's exit code is the step's result. Exit `1` means at least one finding is at or above `fail-on`; exit `2` means a setup or scan error (bad arguments, missing browser, unreachable start page, missing baseline file). Either fails the job. `fail-on: none` makes findings reporting-only while setup errors still fail.

The evidence pack step uses `when: always`, and `store_test_results` / `store_artifacts` run even after a failed step, so reports are uploaded when the scan fails the job. None of them run if the job is canceled or hits its time limit.

The HTML report (`a11ygate-scan.html`), SARIF (`a11ygate-scan.sarif`) and evidence pack (`a11ygate-evidence.zip`) appear under the job's **Artifacts** tab with the `a11ygate/` prefix. CircleCI has no built-in SARIF viewer; download the file or upload it to a code-scanning tool you use. See [GitHub code scanning](github-code-scanning.md) for one option.

### Optional baseline

To adopt the gate on a site with existing findings, record them once as a [fingerprint baseline](../baseline-mode.md) and commit the file:

```sh
# Locally, against your own app on loopback:
npx a11ygate scan http://127.0.0.1:3000 --out-dir a11y
npx a11ygate baseline create a11y   # writes .a11ygate-baseline.json
git add .a11ygate-baseline.json
```

Then set `baseline: .a11ygate-baseline.json` on the job. Existing findings stay in every report, but only new findings at or above `fail-on` fail the job. Keep the scan URL, crawl scope and engines the same as when the baseline was created. If the file is missing, the scan step exits `2` with a clear message rather than silently gating everything.

## Validation status

**`circleci config validate` has not been run on this config.** The CircleCI CLI and Docker were not available where it was written, and no CircleCI account was created. Instead, [`tests/circleci.test.ts`](../../tests/circleci.test.ts) (part of `npm test`):

- parses the YAML and checks `version: 2.1`, top-level, job, step and `run` keys, parameter types and enum defaults, that every `<< parameters.x >>` resolves, and that the workflow passes only declared parameters (a structure check of the documented subset, not a substitute for the CLI);
- **no drift:** renders the config's own `run` commands (expanding `<< parameters.* >>`) and executes them in `bash -eo pipefail`. With an `npx` shim it captures the exact CLI argv and runs it in-process through the CLI with a stub browser and a network guard, for `fail-on` `serious`, `critical` and `none`, with and without a baseline, and with a missing baseline. It then checks that every file the store steps reference exists;
- when Chromium is installed locally, runs the wait, scan and evidence commands unmodified in bash against the loopback `fixtures/scan-site` server: exit 1 at `serious`, 0 at `none`, and 0 at `serious` after `baseline create`;
- link-checks this page and greps it and the config for compliance claims.

Owner action to close the gap, on a machine with Homebrew ([CircleCI CLI](https://cli.circleci.com/)):

```sh
brew install circleci
circleci config validate integrations/circleci/config.yml
```

If the CLI asks for authentication, run `circleci setup` with the owner's own account. Then run the job once in a CircleCI project you own against your own application.

## Orb (future owner action)

No orb is published. Publishing to the CircleCI orb registry needs a CircleCI organization, a claimed namespace (`circleci namespace create`) and an API token, which this repository does not have. Packaging the job as an orb (`circleci orb publish`) is a future owner action; until then, copy the config. See [create, test and publish an orb](https://circleci.com/docs/orbs/author/create-test-and-publish-a-registry-orb/).
