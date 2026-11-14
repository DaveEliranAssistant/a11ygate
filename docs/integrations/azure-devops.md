# Azure DevOps integration

Automated testing only. Not a WCAG audit, certification or legal advice.

A11yGate ships an Azure Pipelines **step template**, [`integrations/azure-devops/a11ygate.yml`](../../integrations/azure-devops/a11ygate.yml). It installs Node.js, installs your dependencies, scans a site you are authorized to test, publishes JUnit results to the **Tests** tab, publishes the HTML/JSON/Markdown reports, SARIF and an evidence pack as build artifacts, and fails the job according to a fail-on policy.

Sibling guides: [GitHub Action](github-action.md), [Jenkins](jenkins.md), [GitLab](../../integrations/gitlab/README.md).

## Use the template

Reference a reviewed copy of this repository (or a fork you control) as a template repository ([template syntax and `resources.repositories`](https://learn.microsoft.com/en-us/azure/devops/pipelines/process/templates)). Pin `ref` to a tag or commit you have reviewed.

```yaml
resources:
  repositories:
    - repository: a11ygate
      type: github
      name: DaveEliranAssistant/a11ygate
      endpoint: my-github-service-connection
      ref: refs/heads/main # pin to a reviewed tag or commit

pool:
  vmImage: ubuntu-latest

steps:
  - checkout: self
  # Start your application on loopback before the template runs.
  - script: |
      npm ci
      npm run build
      nohup npm run start -- --hostname 127.0.0.1 --port 3000 > app.log 2>&1 &
      npx --yes wait-on@8 http://127.0.0.1:3000/
    displayName: Start the application under test
  - template: integrations/azure-devops/a11ygate.yml@a11ygate
    parameters:
      url: 'http://127.0.0.1:3000'
      failOn: serious
      installCommand: 'npm ci'
```

Adapt the build/start commands to your application. Only set `url` to a local or explicitly authorized application. The template itself performs no login, deployment, or publishing to any registry.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `url` | `http://127.0.0.1:3000` | Start URL. Local or authorized targets only. |
| `failOn` | `serious` | `minor`, `moderate`, `serious`, `critical`, or `none`. |
| `crawl` | `1` | Maximum pages to crawl (same origin, robots.txt respected). |
| `outDir` | `a11y` | Output directory, relative to the working directory. |
| `nodeVersion` | `22.x` | Passed to `NodeTool@0` `versionSpec`. |
| `installCommand` | `npm ci` | Dependency install command. |
| `installBrowsers` | `true` | Runs `npx --no-install playwright install --with-deps chromium`. |
| `artifactName` | `a11ygate` | Name of the reports/evidence artifact. |

The consuming project's lockfile must provide the A11yGate CLI (a revision containing `scan`, `--format` and `evidence pack`, i.e. `@qe-atlas/a11ygate@next` / 0.2.0 or a vendored `packages/cli`), plus `playwright` and `@axe-core/playwright`. Every command uses `npx --no-install`, so nothing is fetched from the registry at scan time.

## What the steps do

| Step | Task / command | Source |
| --- | --- | --- |
| Use Node.js | `NodeTool@0` with `versionSource: spec`, `versionSpec` | [Node.js tool installer v0](https://learn.microsoft.com/en-us/azure/devops/pipelines/tasks/reference/node-tool-v0) |
| Install | `installCommand` | |
| Chromium | `npx --no-install playwright install --with-deps chromium` | [Playwright CI docs](https://playwright.dev/docs/ci) |
| Scan | `npx --no-install a11ygate scan "<url>" --crawl <n> --fail-on <policy> --format junit,sarif --out-dir <outDir>` | |
| Evidence pack | `npx --no-install a11ygate evidence pack --from <outDir> --out <outDir>/a11ygate-evidence.zip --commit $(Build.SourceVersion)` | |
| JUnit | `PublishTestResults@2` with `testResultsFormat: JUnit`, `testResultsFiles: <outDir>/a11ygate-scan.junit.xml` | [Publish Test Results v2](https://learn.microsoft.com/en-us/azure/devops/pipelines/tasks/reference/publish-test-results-v2) |
| Reports + evidence | `PublishBuildArtifacts@1` with `PathtoPublish: <outDir>`, `ArtifactName: <artifactName>`, `publishLocation: Container` | [Publish Build Artifacts v1](https://learn.microsoft.com/en-us/azure/devops/pipelines/tasks/reference/publish-build-artifacts-v1) |
| SARIF | `PublishBuildArtifacts@1` with `PathtoPublish: <outDir>/a11ygate-scan.sarif`, `ArtifactName: CodeAnalysisLogs` | [SARIF SAST Scans Tab](https://marketplace.visualstudio.com/items?itemName=sariftools.scans) |

Microsoft marks `NodeTool@0` as deprecated in favor of [`UseNode@1`](https://learn.microsoft.com/en-us/azure/devops/pipelines/tasks/reference/use-node-v1). The template keeps `NodeTool@0` because it still runs on current agents; switching is a one-line change (`task: UseNode@1`, input `version`).

The `$(Build.SourceVersion)` macro records the commit being built in the evidence pack manifest; Azure substitutes it before the script runs, on every agent OS.

### Fail-on policy

The scan step's exit code is the policy. Exit `1` means at least one finding is at or above `failOn`; exit `2` means a setup or scan error (bad arguments, missing browser, unreachable start page). Either fails the step and therefore the job. `failOn: none` makes findings reporting-only while setup errors still fail. The scan step has no `continueOnError`, so the job result reflects the policy.

The evidence pack and publish steps use `condition: succeededOrFailed()` ([conditions](https://learn.microsoft.com/en-us/azure/devops/pipelines/process/conditions)), so reports are uploaded even when the scan fails the job, but not when the run is canceled. `PublishTestResults@2` sets `failTaskOnFailedTests: false`: the scan step already enforces the policy, and failed JUnit test cases should not fail the job a second time.

## Viewing SARIF in Azure DevOps

Azure DevOps has no built-in SARIF viewer. Install the [SARIF SAST Scans Tab](https://marketplace.visualstudio.com/items?itemName=sariftools.scans) extension (`sariftools.scans`, published by Microsoft DevLabs) in your organization. It adds a **Scans** tab to the build result that displays any SARIF logs (`*.sarif`) found within the `CodeAnalysisLogs` artifact. That is why the template publishes `a11ygate-scan.sarif` under exactly that artifact name. Installing an extension requires organization permissions; without the extension, the SARIF file is still available for download from the `CodeAnalysisLogs` artifact.

Only one artifact per run can be named `CodeAnalysisLogs`. If another tool in the same run already publishes it, copy `a11ygate-scan.sarif` into that tool's folder before its publish step instead of publishing twice.

The HTML report (`a11ygate-scan.html`) and the evidence pack (`a11ygate-evidence.zip`) are in the `a11ygate` artifact.

## Agent notes

`script:` steps run bash on Linux and macOS and cmd.exe on Windows ([cross-platform scripting](https://learn.microsoft.com/en-us/azure/devops/pipelines/scripts/cross-platform-scripting)). The template's commands are single lines with no pipes, redirects, `&&`, environment-variable expansion or single quotes, so they behave the same in both shells. The test suite enforces this for the rendered scan and evidence commands.

**Linux (Microsoft-hosted `ubuntu-latest` or self-hosted).** `--with-deps` installs Chromium's system libraries with `apt` and needs `sudo`, which Microsoft-hosted agents have. On a self-hosted agent without `sudo`, preinstall the libraries (`npx playwright install-deps chromium` as an administrator) or use a container job with the Playwright image, and set `installBrowsers: false`.

**Windows (`windows-latest` or self-hosted).** `--with-deps` does not need extra system packages on Windows. Avoid `%` in the `url` parameter: cmd.exe expands `%VAR%` even inside double quotes. Use forward slashes in `outDir`; Node accepts them on Windows. Starting a background server differs from bash (for example `start /b npm run start`). Adapt the start step from the example above.

**macOS.** Behaves like Linux; `--with-deps` is not needed on macOS but is harmless.

Every agent OS needs network access to the npm registry for `installCommand`, and to the Playwright CDN for the browser download, unless you cache or preinstall them. The scan itself contacts only `url`.

## Local validation

No Azure DevOps organization is needed or contacted to test the template. [`tests/azure-devops.test.ts`](../../tests/azure-devops.test.ts) (part of `npm test`):

- parses the YAML and checks parameter types and defaults, task names (`NodeTool@0`, `PublishTestResults@2`, `PublishBuildArtifacts@1`) and input names against the Microsoft pages above;
- **no drift:** renders the template's own scan and evidence-pack `script:` lines (expanding `${{ parameters.* }}` and `$(Build.SourceVersion)`) and runs them in-process through the CLI with a stub browser and a network guard, for `failOn` `serious`, `critical`, and `none`. It then checks that every file the publish steps reference (JUnit, SARIF, HTML, evidence zip) exists;
- when Chromium is installed locally, also runs those same rendered lines in a real `/bin/sh` against the loopback `fixtures/scan-site` server, expecting exit 1 for `serious` and 0 for `none`;
- link-checks this page and greps it for compliance claims.

The cmd.exe path is not executed locally; it is covered only by the character restriction above. Run the template on an authorized Windows agent to close that gap.
