# Troubleshooting

Automated testing only. Not a WCAG audit, certification or legal advice.

Start with `npx a11ygate doctor`. It runs read-only preflight checks and prints one line per check: `PASS`, `FAIL`, `UNKNOWN` or `SKIPPED`, each with a link to the matching setup section of the [GitHub Action guide](integrations/github-action.md). It exits 0 by default; `doctor --strict` exits 1 when a check fails. An `UNKNOWN` check is not proof of a working setup.

The failure messages below are the text `doctor` prints. [`tests/readme-docs.test.ts`](../tests/readme-docs.test.ts) produces each failure and fails if this page no longer contains the message.

## doctor failures

### browser

> Playwright or its Chromium executable is missing. Run npm install --save-dev playwright, then npx playwright install chromium.

`scan` and model-fix verification need Playwright and its Chromium build. On a fresh Linux runner, `npx playwright install --with-deps chromium` also installs the system libraries. Gating existing axe JSON needs no browser. See [doctor-browser](integrations/github-action.md#doctor-browser).

### engines

> Requested engine peers are missing: html_codesniffer. Install the named packages before scanning.

The message names every missing package. `axe` needs `@axe-core/playwright`; opt-in engines need their own optional peers ([engine documentation](engines.md)). An unknown engine id appears as `unknown engine: <id>`. See [doctor-engines](integrations/github-action.md#doctor-engines).

### node

> Node is unsupported. Use Node 20 or newer for the CLI; use Node 22 for the Action.

See [doctor-node](integrations/github-action.md#doctor-node).

### config

`.a11ygate.yml` failed validation. The message starts with `.a11ygate.yml has N problems:`, lists each problem in plain English, and ends with:

> See schema/a11ygate.schema.json; run a11ygate config validate after fixing.

Fix the listed keys, then run `npx a11ygate config validate`. The schema is [`schema/a11ygate.schema.json`](../schema/a11ygate.schema.json). See [doctor-config](integrations/github-action.md#doctor-config).

### checkout

> The checkout differs from the pull request head. The verifier will discard model-fix candidates as stale; check out github.event.pull_request.head.sha.

Check out the pull request head SHA, as in the [example workflow](../examples/github-action/a11ygate.yml). See [doctor-checkout](integrations/github-action.md#doctor-checkout).

### permissions

> The job token lacks required workflow permissions: issues: write. Set permissions for the enabled modes; fork tokens cannot gain write scopes.

The list depends on the enabled modes: `issues: write` for the pull request comment, `pull-requests: write` for suggested changes, `security-events: write` for SARIF upload. A pull request from a fork never gets write scopes; the comment is then skipped. If the probe itself is refused, `doctor` prints:

> GitHub denied the read-only repository probe. Check the job token and workflow permissions; no write was attempted.

See [doctor-permissions](integrations/github-action.md#doctor-permissions).

### provider

> Model fixes are on but no allowlisted provider is configured. Set the provider credentials and model ID; allowlist stub explicitly only for offline demos.

Model-assisted fixes are experimental and off by default. If you did not mean to turn them on, remove `modelFixes: true` from `.a11ygate.yml` or the `model-fixes: on` input. See [doctor-provider](integrations/github-action.md#doctor-provider).

### pr-creation

> Actions PR creation is disabled. Model-fix draft PRs will fall back to report-only. Only the owner should decide whether to enable Allow GitHub Actions to create and approve pull requests.

This only applies when model-fix draft pull requests are on. See [doctor-pr-creation](integrations/github-action.md#doctor-pr-creation).

## Gate errors (exit 2)

Exit 2 means A11yGate could not produce a verdict. It is never a PASS.

| Message | Cause | Fix |
| --- | --- | --- |
| `<path>: file not found.` | A `--current` or `--baseline` path does not exist. In the Action, a path under `current` that your tests did not write. | Check the paths your tests write. For the first run, create the baseline with `--update-baseline` instead of `--baseline`. |
| `<path>: result.url must be a non-empty string` (or another field error) | The file is not axe JSON: one result object, an array of them, or `{ "results": ... }`. | Write `AxeBuilder.analyze()` output unchanged, one file per page. |
| Verdict **INCOMPLETE**: `Missing, failed or materially incomparable scan coverage prevents a regression PASS.` | The baseline was recorded with a different scan configuration or browser environment, for example with CLI 0.1.0 or on another machine. | Record the baseline on the same runner image with the same settings, then commit it. |

## CI-specific notes

- GitHub Actions: [setup requirements](integrations/github-action.md#setup-requirements).
- Jenkins: [Jenkins guide](integrations/jenkins.md).
- GitLab: [local validation](../integrations/gitlab/README.md#local-validation).
- Azure DevOps: [agent notes](integrations/azure-devops.md#agent-notes).
- CircleCI: [validation status](integrations/circleci.md#validation-status).

See also [what A11yGate does not do](what-a11ygate-does-not-do.md).
