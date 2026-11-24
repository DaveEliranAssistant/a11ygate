# Bitbucket Pipelines integration

Automated testing only. Not a WCAG audit, certification or legal advice.

A11yGate ships an example Bitbucket Pipelines config, [`integrations/bitbucket/bitbucket-pipelines.yml`](../../integrations/bitbucket/bitbucket-pipelines.yml), and the step's scan script, [`integrations/bitbucket/a11ygate-scan.sh`](../../integrations/bitbucket/a11ygate-scan.sh). The pipeline runs only for pull requests, in a Node + Chromium image. It starts your application on loopback, scans it, and writes JUnit where Bitbucket picks up test reports automatically. It uploads the HTML/JSON/Markdown reports, SARIF and an evidence pack as artifacts, and fails the step according to a fail-on policy. An optional fingerprint baseline gates only new findings.

Sibling guides: [GitHub Action](github-action.md), [Jenkins](jenkins.md), [Azure DevOps](azure-devops.md), [CircleCI](circleci.md), [GitLab](../../integrations/gitlab/README.md).

## Use the config

Bitbucket reads `bitbucket-pipelines.yml` from the repository root. Copy a reviewed version of the example there, and copy `a11ygate-scan.sh` to `integrations/bitbucket/a11ygate-scan.sh` in the same repository (or change the path in the step's last `script` line). Adapt the build and start commands to your application:

```yaml
script:
  - npm ci
  - npm run build
  - npm run start -- --hostname 127.0.0.1 --port 3000 &
  - A11YGATE_FAIL_ON="${A11YGATE_FAIL_ON:-serious}" sh integrations/bitbucket/a11ygate-scan.sh
```

Only point `A11YGATE_URL` at a local or explicitly authorized application. The config performs no login, deployment or publishing, uses no pipe, and needs no secured variables.

The consuming project's lockfile must provide the A11yGate CLI (a revision containing `scan`, `--format`, `baseline create` and `evidence pack`, i.e. the [pilot tarball](../pilot/quickstart.md#1-install-the-tarball-you-received-5-minutes) or a [source build](../pilot/quickstart.md#source-build-fallback) of `packages/cli`; npm serves only 0.1.0, which lacks them), plus `playwright@1.64.1` and `@axe-core/playwright`. Every A11yGate command uses `npx --no-install`, so nothing is fetched from the registry at scan time. The image `mcr.microsoft.com/playwright:v1.64.1-noble` supplies Node, Chromium and its system libraries, but not your npm packages ([Playwright Docker documentation](https://playwright.dev/docs/docker)). Keep the image tag and the installed `playwright` version aligned.

### Settings

The script reads environment variables. Set them inline on the `script` line, or as repository or deployment variables ([variables and secrets](https://support.atlassian.com/bitbucket-cloud/docs/variables-and-secrets/)):

| Variable | Default | Meaning |
| --- | --- | --- |
| `A11YGATE_URL` | `http://127.0.0.1:3000` | Start URL. Local or authorized targets only. |
| `A11YGATE_FAIL_ON` | `serious` | `minor`, `moderate`, `serious`, `critical`, or `none`. Anything else exits `2`. |
| `A11YGATE_CRAWL` | `1` | Maximum pages to crawl (same origin, robots.txt respected). |
| `A11YGATE_OUT_DIR` | `test-results/a11ygate` | Output directory. Keep it under `test-results/` (see [JUnit](#junit-test-reports)). |
| `A11YGATE_BASELINE` | empty | Optional fingerprint baseline file. Empty = gate every finding. |
| `A11YGATE_WAIT_SECONDS` | `120` | How long to wait for `A11YGATE_URL` to answer before exiting `2`. |
| `BITBUCKET_COMMIT` | set by Bitbucket | Recorded in the evidence pack's manifest. If empty, the pack uses git `HEAD`. |

If you change `A11YGATE_OUT_DIR`, change the artifact `paths` glob to match.

## What the step does

| Part | Config | Reference |
| --- | --- | --- |
| Pull requests only | `pipelines: pull-requests: '**':` and no `default`, `branches`, `tags` or `custom` | [pipeline start conditions](https://support.atlassian.com/bitbucket-cloud/docs/pipeline-start-conditions/) |
| Image | `image: mcr.microsoft.com/playwright:v1.64.1-noble` | [configuration reference](https://support.atlassian.com/bitbucket-cloud/docs/bitbucket-pipelines-configuration-reference/) |
| Install, build, start | `npm ci`, `npm run build`, `npm run start -- --hostname 127.0.0.1 --port 3000 &` | [step options](https://support.atlassian.com/bitbucket-cloud/docs/step-options/) |
| Wait | the script polls `A11YGATE_URL` with Node's `fetch` | |
| Scan | `npx --no-install a11ygate scan "<url>" --crawl <n> --fail-on <policy> --format junit,sarif --out-dir test-results/a11ygate [--baseline <file>]` | |
| Evidence pack | `npx --no-install a11ygate evidence pack --from <out-dir> --out <out-dir>/a11ygate-evidence.zip --commit "$BITBUCKET_COMMIT"`, run even when the scan failed | |
| JUnit | `test-results/a11ygate/a11ygate-scan.junit.xml`, read automatically | [test reporting](https://support.atlassian.com/bitbucket-cloud/docs/test-reporting-in-pipelines/) |
| Reports, SARIF, evidence | `artifacts: upload: - name: a11ygate-reports, capture-on: always, paths: [test-results/a11ygate/**]` | [use artifacts in steps](https://support.atlassian.com/bitbucket-cloud/docs/use-artifacts-in-steps/) |

Bitbucket's docs say pull request pipelines run "in addition to any branch and default pipelines that are defined" and that "Pull requests from a forked repository don't trigger the pipeline". If your file already has a `default` pipeline, merge the step into it deliberately; the example defines only `pull-requests`.

### JUnit test reports

[Bitbucket's test reporting page](https://support.atlassian.com/bitbucket-cloud/docs/test-reporting-in-pipelines/) says reports are read from "one of the supported default locations (with a directory depth of 3 levels)":

- `./**/surefire-reports/**/*.xml`
- `./**/failsafe-reports/**/*.xml`
- `./**/test-results/**/*.xml`
- `./**/test-reports/**/*.xml`
- `./**/TestResults/**/*.xml`

The scanner starts from the build directory, `/opt/atlassian/pipelines/agent/build`. The script therefore writes to `test-results/a11ygate/`, so `a11ygate-scan.junit.xml` matches `./**/test-results/**/*.xml` at depth 3 and needs no `test-reports` artifact. It is the only `.xml` file A11yGate writes there. The same page says the Tests tab shows only when there are failed tests, and only the first 100 failed results.

### Fail-on policy and artifacts

The script exits `1` when at least one finding is at or above `A11YGATE_FAIL_ON`, and `2` for a setup or scan error: unknown policy, app not answering, missing baseline file, missing browser, or an unreachable start page. Either fails the step. `A11YGATE_FAIL_ON=none` makes findings reporting-only while setup errors still fail.

The script runs `evidence pack` after the scan whatever the scan's result, then exits with the scan's code. The artifact uses `capture-on: always`, which the artifacts page describes as "Upload the artifact regardless of the step outcome (default)", so reports, SARIF (`a11ygate-scan.sarif`) and the evidence pack (`a11ygate-evidence.zip`) are uploaded when the scan fails the step. The same page says "Artifacts will be deleted 14 days after they are generated". Download anything you need to keep. Bitbucket has no SARIF viewer. Download the file or upload it to a code-scanning tool you use, for example [GitHub code scanning](github-code-scanning.md).

### Optional baseline

To adopt the gate on a site with existing findings, record them once as a [fingerprint baseline](../baseline-mode.md) and commit the file:

```sh
# Locally, against your own app on loopback:
npx a11ygate scan http://127.0.0.1:3000 --out-dir test-results/a11ygate
npx a11ygate baseline create test-results/a11ygate   # writes .a11ygate-baseline.json
git add .a11ygate-baseline.json
```

Then set `A11YGATE_BASELINE=.a11ygate-baseline.json` on the script line or as a repository variable. Existing findings stay in every report, but only new findings at or above the policy fail the step. Keep the scan URL, crawl scope and engines the same as when the baseline was created.

## Validation status

**No Bitbucket pipeline has run this config.** No Bitbucket account was created or contacted. Docker is not installed on the machine where this was written, so the image was not pulled or run. There is no official Bitbucket CLI that runs a pipeline locally. [`tests/bitbucket-pipelines.test.ts`](../../tests/bitbucket-pipelines.test.ts) (part of `npm test`) covers the rest:

- **Structure:** parses the YAML and checks every top-level, `pipelines`, step, `artifacts` and `upload` key against the key lists in Atlassian's published schema (`https://api.bitbucket.org/schemas/pipelines-configuration`) and the [configuration reference](https://support.atlassian.com/bitbucket-cloud/docs/bitbucket-pipelines-configuration-reference/). It also checks the `type` and `capture-on` enums, that only `pull-requests` is defined, and that the image tag matches the installed `playwright` version. That schema does not reject unknown step keys, so the test's explicit key lists are stricter than the schema.
- **JUnit path:** checks that the JUnit file matches Bitbucket's default `test-results` location within 3 levels.
- **No drift:** runs the YAML's own last `script` line, unmodified, in `dash` (the image's `/bin/sh`), so the checked-in `a11ygate-scan.sh` runs as it would in the pipeline. An `npx` shim captures the exact CLI argv, which then runs in-process through the CLI with a stub browser and a network guard. This covers `serious`, `critical` and `none`, with and without a baseline, with a missing baseline, an unknown policy and an unreachable app. The test checks that the evidence pack still runs after a failing scan, that the scan's exit code is kept, and that every uploaded file exists.
- **Fixture:** when Chromium is installed locally, runs the same line with the real CLI against the loopback `fixtures/scan-site` server. It expects exit 1 at `serious`, 0 at `none`, and 0 at `serious` after `baseline create`.
- **Docs:** link-checks this page and greps it, the YAML and the script for compliance claims.

Also on 2026-11-14, outside `npm test`, the YAML was validated against the schema at `https://api.bitbucket.org/schemas/pipelines-configuration` (SHA-256 `b37319267d9922bd9f0a5142d657551ae844e136fa205068c8660622d66bcf64`) with Ajv, and the result was valid. The schema is not vendored into this repository.

Owner action to close the gap: in a Bitbucket Cloud repository you own, with Pipelines enabled, add both files and open a pull request against your own application. To exercise the image locally first, on a machine with Docker:

```sh
docker run --rm -v "$PWD":/opt/atlassian/pipelines/agent/build -w /opt/atlassian/pipelines/agent/build \
  mcr.microsoft.com/playwright:v1.64.1-noble \
  sh -c 'npm ci && npm run build && (npm run start -- --hostname 127.0.0.1 --port 3000 &) && sh integrations/bitbucket/a11ygate-scan.sh'
```

That runs the same commands in the same image, but not Bitbucket's own step runner, test-report scanner or artifact upload.
