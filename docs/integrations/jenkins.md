# Jenkins integration

Automated testing only. Not a WCAG audit, certification or legal advice.

A11yGate can run in a Jenkins pipeline: it scans a site you are authorized to test, writes JUnit and SARIF reports, and sets the build result from the fail-on level. The step and the example pipelines live in this repository and are the files the tests include — this page links to or includes those files rather than a second, drifting copy.

## Install

### Shared library

1. Point Jenkins at this repository (or a fork) as a [Pipeline shared library](https://www.jenkins.io/doc/book/pipeline/shared-libraries/), with the library "Source Code Management" root at `integrations/jenkins` so `vars/a11yGate.groovy` is on the `vars/` path. The library name used in the examples is `a11ygate`.
2. The step is [`integrations/jenkins/vars/a11yGate.groovy`](../../integrations/jenkins/vars/a11yGate.groovy). A short library README is at [`integrations/jenkins/README.md`](../../integrations/jenkins/README.md).
3. Load it in a Pipeline with `@Library('a11ygate') _` as in the examples below.

Until a release includes `scan` and `--format`, pass `cli: 'node packages/cli/dist/cli.mjs'` (or another path to a source build). Published `@qe-atlas/a11ygate@0.1.0` does not include those flags.

### Plain `sh` step (no library)

If you cannot load a shared library, the same command, JUnit publisher, artifact archive, and fail-on policy are in [`examples/jenkins/Jenkinsfile.sh-step`](../../examples/jenkins/Jenkinsfile.sh-step):

<!-- include:examples/jenkins/Jenkinsfile.sh-step -->
```groovy
// Plain sh step without a shared library. Same CLI, JUnit, artifacts, and fail-on policy as a11yGate.
// Automated testing only. Not a WCAG audit, certification or legal advice.

pipeline {
  agent any
  stages {
    stage('Accessibility scan') {
      steps {
        script {
          def outDir = 'a11y-results'
          def status = sh(
            script: "node packages/cli/dist/cli.mjs scan 'http://127.0.0.1:4173/' --crawl 10 --fail-on serious --format junit,sarif,json,md --out-dir '${outDir}'",
            returnStatus: true
          )
          junit allowEmptyResults: true, testResults: "${outDir}/*.junit.xml"
          archiveArtifacts artifacts: "${outDir}/**", allowEmptyArchive: true
          if (status == 1) {
            unstable('A11yGate found issues at or above the fail-on level. Automated testing only. Not a WCAG audit, certification or legal advice.')
          } else if (status != 0) {
            error("A11yGate failed to run (exit ${status}).")
          }
        }
      }
    }
  }
}
```

## Example pipelines

Declarative: [`examples/jenkins/Jenkinsfile`](../../examples/jenkins/Jenkinsfile)

<!-- include:examples/jenkins/Jenkinsfile -->
```groovy
// Declarative example for A11yGate. This is the file the docs and CI tests include.
// Load integrations/jenkins as a shared library (see docs/integrations/jenkins.md once published),
// or copy vars/a11yGate.groovy into your own library.
//
// Agent: Node 20+ and, for `scan`, Playwright Chromium. Docker image alternative: image: 'node:22'.
// Automated testing only. Not a WCAG audit, certification or legal advice.

@Library('a11ygate') _

pipeline {
  agent any
  options {
    timestamps()
  }
  parameters {
    string(name: 'SITE_URL', defaultValue: 'http://127.0.0.1:4173/', description: 'Site you are authorized to test')
    choice(name: 'FAIL_ON', choices: ['serious', 'critical', 'moderate', 'minor', 'none'], description: 'Minimum impact that makes the build UNSTABLE')
  }
  stages {
    stage('Accessibility scan') {
      steps {
        a11yGate(
          url: params.SITE_URL,
          crawl: 10,
          failOn: params.FAIL_ON,
          formats: ['junit', 'sarif', 'json', 'md'],
          cli: 'node packages/cli/dist/cli.mjs',
          outDir: 'a11y-results'
        )
      }
    }
  }
  post {
    always {
      echo 'Automated testing only. Not a WCAG audit, certification or legal advice.'
    }
  }
}
```

Scripted: [`examples/jenkins/Jenkinsfile.scripted`](../../examples/jenkins/Jenkinsfile.scripted)

<!-- include:examples/jenkins/Jenkinsfile.scripted -->
```groovy
// Scripted variant of examples/jenkins/Jenkinsfile. Same step, parameters, and artifacts.
// Automated testing only. Not a WCAG audit, certification or legal advice.

@Library('a11ygate') _

node {
  timestamps {
    def siteUrl = params.SITE_URL ?: 'http://127.0.0.1:4173/'
    def failOn = params.FAIL_ON ?: 'serious'
    stage('Accessibility scan') {
      a11yGate(
        url: siteUrl,
        crawl: 10,
        failOn: failOn,
        formats: ['junit', 'sarif', 'json', 'md'],
        cli: 'node packages/cli/dist/cli.mjs',
        outDir: 'a11y-results'
      )
    }
    echo 'Automated testing only. Not a WCAG audit, certification or legal advice.'
  }
}
```

Fixture sites used by the tests: [`examples/jenkins/fixtures/bad`](../../examples/jenkins/fixtures/bad/index.html) (intentional issues) and [`examples/jenkins/fixtures/clean`](../../examples/jenkins/fixtures/clean/index.html).

## Parameters

The step is `a11yGate(url:, crawl:, failOn:, formats:, ...)`. See the header of [`integrations/jenkins/vars/a11yGate.groovy`](../../integrations/jenkins/vars/a11yGate.groovy) for the full list.

| Parameter | Meaning |
| --- | --- |
| `url` | Required. Start URL of a site you own or are authorized to test. |
| `crawl` | Optional. `true` crawls up to the CLI cap (20 pages); a number is a page count; omitted or `false` scans only the start URL. |
| `failOn` | `minor`, `moderate`, `serious` (default), `critical`, or `none`. |
| `formats` | List or comma-separated: `junit`, `sarif`, `json`, `md`. Default: all four. Requires `--out-dir`. |
| `outDir` | Report directory. Default: `a11y-results`. |
| `cli` | Command that runs the CLI. Default: `npx --yes @qe-atlas/a11ygate`. Use a source build until `scan`/`--format` are published. |
| `image` | Optional Docker image. When set, the step runs inside `docker.image(image).inside(...)`. |
| `dockerArgs` | Optional string passed to `.inside(...)`. |

## Fail-on policy

The CLI exit code is unchanged: **0** if no finding is at or above `--fail-on`, **1** if at least one is, **2** if the tool cannot run (bad arguments, missing browser, unreachable start page). The step maps those to the Jenkins build result:

- Exit 0 → **SUCCESS**
- Exit 1 → **UNSTABLE** (findings at or above the fail-on level)
- Any other exit → **FAILURE**

`failOn: 'none'` reports findings but exits 0, so the build stays SUCCESS unless the tool itself fails.

## JUnit and SARIF publishing

The step publishes `${outDir}/*.junit.xml` with the Jenkins JUnit plugin (`allowEmptyResults: true`) and archives `${outDir}/**` (JSON, Markdown, HTML, JUnit, SARIF). JUnit uses one testcase per axe rule × page; the disclaimer is a testsuite property.

To also surface SARIF in the [Warnings Next Generation](https://plugins.jenkins.io/warnings-ng/) plugin, add the fragment in [`examples/jenkins/record-issues.groovy`](../../examples/jenkins/record-issues.groovy) after the `a11yGate` step (install the plugin on the controller first):

<!-- include:examples/jenkins/record-issues.groovy -->
```groovy
// Optional: publish SARIF with the Warnings NG plugin (in addition to junit + archiveArtifacts).
recordIssues(tools: [sarif(pattern: 'a11y-results/*.sarif')])
```

## Agent requirements

- **Node 20+** on the agent (or a `image: 'node:22'` container).
- For `a11ygate scan`: `playwright` and `@axe-core/playwright`, plus Chromium (`npx playwright install chromium`). The CLI prints an install hint and exits 2 if they are missing.
- The agent must be able to reach the site under test. Only scan sites you own or are authorized to test. The scanner is read-only and same-origin; it does not log in, fill forms, or click.
- No Jenkins credentials are required for the examples. Do not point the step at an external Jenkins.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Exit 2 / "failed to run" | Node, the `cli` path, Playwright Chromium, and that the start URL is reachable and not disallowed by robots.txt. |
| Exit 1 / UNSTABLE | Findings at or above `failOn`. Open the archived Markdown/HTML or JUnit report. This is not a certification result. |
| Empty JUnit | Confirm `${outDir}/a11ygate-scan.junit.xml` (scan) or `a11ygate.junit.xml` (ci) was written; `allowEmptyResults` keeps the publisher from failing on a clean suite. |
| `scan` / `--format` unknown | You are on published `@qe-atlas/a11ygate@0.1.0`. Use a source build via `cli: 'node packages/cli/dist/cli.mjs'`. |
| SARIF not in Warnings NG | Install the Warnings NG plugin and call the [`record-issues.groovy`](../../examples/jenkins/record-issues.groovy) fragment. |
| Docker image cannot see the workspace | Pass `dockerArgs` such as a workspace mount if your agent needs it; or run on a Node agent without `image`. |

The [Dockerized Jenkins LTS + JCasC harness](../../integrations/jenkins/test/docker/run.sh) runs the example Jenkinsfile and shared library against loopback-only BAD and clean fixture sites. It checks build status and nonempty JUnit results through the Jenkins API. The [Jenkins E2E workflow](../../.github/workflows/jenkins-e2e.yml) runs on a GitHub-hosted Ubuntu runner, nightly and on integration changes. No credentials or external Jenkins are used. It exits 2 when Docker is unavailable; assertion failures exit nonzero.

Tested on Jenkins **2.580.2 LTS (Java 21)**: [green GitHub-hosted acceptance run](https://github.com/DaveEliranAssistant/a11ygate/actions/runs/43573138952) (2026-11-14, commit `bf78ede`). BAD finished **UNSTABLE** with four failing JUnit tests; clean finished **SUCCESS** with one passing test. Both reports were read back through the Jenkins API. The controller image is pinned by digest; see [image provenance and harness details](../../integrations/jenkins/test/docker/README.md).

Mac fallback: start Docker Desktop (Linux containers), then from the repository root run:

```sh
bash integrations/jenkins/test/docker/run.sh
```

Python 3 is required. Evidence is saved under `test-results/jenkins-e2e/`, including build JSON, JUnit API JSON, console logs, and archived reports. This live boot is separate from `npm test` and `npm run test:jenkins`.

## Disclaimer

Automated testing only. Not a WCAG audit, certification or legal advice. axe-core finds a subset of issues. A SUCCESS or empty JUnit report is not conformance, certification, or legal advice.
