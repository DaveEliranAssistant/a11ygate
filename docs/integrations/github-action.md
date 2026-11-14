# GitHub Action integration

Automated testing only. Not a WCAG audit, certification or legal advice.

The A11yGate GitHub Action gates a pull request on new axe-core findings, writes a job summary, and can post one pull request comment, rule-based suggested changes and SARIF for code scanning. Inputs, outputs and the experimental model-fix path are described in the [action README](../../action/README.md). The sibling guide for Jenkins is [Jenkins integration](jenkins.md).

The workflow below is [`examples/github-action/a11ygate.yml`](../../examples/github-action/a11ygate.yml). This page and the action README include that file rather than a second, drifting copy, and the tests run its gate command.

## Setup requirements

<!-- This section is identical in action/README.md and docs/integrations/github-action.md. tests/github-action-docs.test.ts fails on drift. -->

Check these four items before you turn on comments, SARIF or model-fix drafts. The copy-paste workflow below shows all of them.

### 1. "Allow GitHub Actions to create and approve pull requests" (model-fix draft PRs only)

Model-fix **draft** pull requests need the repository setting **Settings → Actions → General → Workflow permissions → "Allow GitHub Actions to create and approve pull requests"** ([GitHub Docs: Preventing GitHub Actions from creating or approving pull requests](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository#preventing-github-actions-from-creating-or-approving-pull-requests)). The **Workflow permissions** section is documented under [Setting the permissions of the GITHUB_TOKEN for your repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository#setting-the-permissions-of-the-github_token-for-your-repository). New personal repositories have it off; organization repositories inherit the organization setting.

- When it is off, GitHub refuses the pull request (403). A11yGate stops publishing and falls back to **report-only**: the gate result, job summary, comment and rule-based suggestions are unchanged, and no draft PR is opened. The exit code does not change.
- **OWNER ACTION.** Turning this setting on is a decision for the repository or organization owner. A11yGate and its maintainers never change it for you. It is not needed for the gate, the comment, suggested changes or SARIF.

### 2. `permissions:` per mode

Set the job token's scopes in the workflow `permissions:` block ([GitHub Docs: workflow syntax, `permissions`](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions); [Modifying the permissions for the GITHUB_TOKEN](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token#modifying-the-permissions-for-the-github_token)). Grant only what the mode needs:

| Mode | `contents` | `issues` | `pull-requests` | `security-events` |
| --- | --- | --- | --- | --- |
| Gate and job summary only | `read` | — | — | — |
| `comment: true` (summary comment) | `read` | `write` | — | — |
| Suggested changes (`suggest-fixes`) | `read` | `write` | `write` | — |
| Model-fix draft PRs (`model-fixes: on`) | `write` | `write` | `write` | — |
| SARIF upload to code scanning | `read` | — | — | `write` |

SARIF upload with `github/codeql-action/upload-sarif` needs `security-events: write` ([GitHub Docs: Uploading a SARIF file to GitHub](https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/integrate-with-existing-tools/upload-sarif-file#uploading-a-code-scanning-analysis-with-github-actions)). Without the write scopes, A11yGate warns and reports only.

### 3. Check out the pull request head commit

Use `actions/checkout` with `ref: ${{ github.event.pull_request.head.sha }}`. On `pull_request` events, `GITHUB_SHA` and the default checkout are the merge commit of the pull request merge branch, not the head commit ([GitHub Docs: `pull_request` event](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request); [actions/checkout README: Checkout pull request HEAD commit instead of merge commit](https://github.com/actions/checkout#checkout-pull-request-head-commit-instead-of-merge-commit)).

- Why: the isolated verifier applies each model draft in a disposable worktree pinned to the scanned commit, the pull request head SHA, and suggestions map findings to lines in that commit.
- Otherwise: with the merge-commit checkout, the scanned tree does not match the head commit. Model-fix candidates are discarded as stale, nothing is published, and the action logs a warning. The gate result and exit code do not change.

### 4. Fork pull requests

For `pull_request` workflows from forks, the `GITHUB_TOKEN` is read-only and secrets from the base repository are not passed to the runner ([GitHub Docs: Workflows in forked repositories](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflows-in-forked-repositories); [Using secrets in GitHub Actions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)).

- On fork pull requests the gate and job summary still run. Comments, suggested changes and SARIF upload need write scopes. A comment that cannot be posted fails the step (exit 1), so the example sets `comment` only for same-repository pull requests and skips the SARIF upload for forks. Model-provider keys are not available, and model-fix draft PRs are never opened for forks.
- Do not switch to `pull_request_target` to get a write token for fork code. Keep `pull_request`.

Automated testing only. Not a WCAG audit, certification or legal advice.

## Copy-paste workflow

Copy it to `.github/workflows/a11ygate.yml`. It reads committed axe JSON for `http://127.0.0.1:4173/`; replace the fixture paths with your own scan output, and `uses: ./action` with `DaveEliranAssistant/a11ygate/action@<ref>` outside this repository.

<!-- include:examples/github-action/a11ygate.yml -->
```yaml
# A11yGate GitHub Action example. This is the file docs/integrations/github-action.md and
# action/README.md include, and tests/github-action-docs.test.ts runs its gate command.
# Copy it to .github/workflows/a11ygate.yml. It reads committed local axe JSON for
# http://127.0.0.1:4173/ only; replace the fixture paths with your own scan output.
# Automated testing only. Not a WCAG audit, certification or legal advice.
name: A11yGate

on:
  pull_request:

permissions:
  contents: read # checkout; use write only for model-fix draft PRs
  issues: write # the summary comment on the pull request
  pull-requests: write # suggested changes; model-fix draft PRs
  security-events: write # SARIF upload to code scanning

jobs:
  a11y:
    runs-on: ubuntu-latest
    steps:
      # Check out the pull request head commit, not the default merge commit.
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm run cli:build
      - name: Write SARIF from the local fixtures
        run: node packages/cli/dist/cli.mjs --current examples/github-action/fixtures/current.json --baseline examples/github-action/fixtures/baseline.json --threshold serious --format sarif --out-dir a11y-results
      # Fork pull requests get a read-only token, so only upload from same-repository pull requests.
      - name: Upload SARIF
        if: ${{ !cancelled() && github.event.pull_request.head.repo.full_name == github.repository }}
        uses: github/codeql-action/upload-sarif@v4
        with:
          sarif_file: a11y-results/a11ygate.sarif
          category: a11ygate
      # Outside this repository use DaveEliranAssistant/a11ygate/action@<ref>.
      - uses: ./action
        with:
          current: examples/github-action/fixtures/current.json
          baseline: examples/github-action/fixtures/baseline.json
          threshold: serious
          # A comment that cannot be posted fails the step, so only comment on same-repository pull requests.
          comment: ${{ github.event.pull_request.head.repo.full_name == github.repository }}
```
