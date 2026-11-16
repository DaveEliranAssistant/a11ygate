# A11yGate docs index

Automated testing only. Not a WCAG audit, certification or legal advice.

Start with the [README](../README.md) (quickstart, CI matrix, troubleshooting summary). The CLI reference is [packages/cli/README.md](../packages/cli/README.md), and changes are in the [CHANGELOG](../packages/cli/CHANGELOG.md).

## Limits

- [What A11yGate does not do](what-a11ygate-does-not-do.md): manual audits, assistive-technology testing, legal advice and certification are out of scope.
- [Known limits](known-limits.md): gaps recorded for each merged task (A11Y-R23 to A11Y-R61), and tasks not included.
- [Evidence policy](CI_EVIDENCE_POLICY.md): coverage and manual-evidence limits.

## Getting started and CI

- [Starter setup with `a11ygate init`](integrations/init.md)
- [GitHub Action](integrations/github-action.md) and [GitHub code scanning (SARIF)](integrations/github-code-scanning.md)
- [Jenkins](integrations/jenkins.md)
- [GitLab](../integrations/gitlab/README.md)
- [Azure DevOps](integrations/azure-devops.md)
- [CircleCI](integrations/circleci.md)
- [Bitbucket Pipelines](integrations/bitbucket.md)
- [Framework recipes](recipes/README.md): [Next.js](recipes/nextjs.md), [Vite + React](recipes/vite-react.md), [Angular](recipes/angular.md), [Storybook](recipes/storybook.md)
- [Troubleshooting](troubleshooting.md): `doctor` messages and gate exit-2 errors

## Scanning and configuration

- [Repository configuration (`.a11ygate.yml`)](configuration.md), including [diff-aware PR scans](configuration.md#diff-aware-pr-scans-a11y-r57) and [SPA interaction states](configuration.md#opt-in-spa-interaction-states)
- [Authenticated pages](authenticated-pages.md): storage state, login scripts, sessionStorage, explicit auth checks and screenshot privacy
- [Engines](engines.md): opt-in HTML_CodeSniffer, IBM Equal Access and Lighthouse
- [Baseline mode](baseline-mode.md)
- [Incremental scans](../packages/cli/README.md#incremental-scans-a11y-r60)
- [Multi-project CI runs](../packages/cli/README.md#multi-project-ci-runs)
- [Pilot scoping dry run (`a11ygate estimate`)](../packages/cli/README.md#pilot-scoping-dry-run-a11y-r55)

## Reports, exports and evidence

- [Report languages](report-locales.md) (English shipped; pseudo-locales for layout testing)
- PDF report: `a11ygate report pdf <scan.json|out-dir> -o report.pdf` (see the [CLI reference](../packages/cli/README.md) and `a11ygate --help`)
- [Developer handoff tickets](../packages/cli/README.md#developer-handoff-tickets-a11y-r54)
- [Evidence pack](../packages/cli/README.md#evidence-pack-a11ygate-evidence-pack)
- [Trend report](trend-report.md)

## Performance

- [Chromium memory and runtime benchmark](perf/README.md)

## Releases and design

- [0.2.0 upgrade notes](releases/0.2.0-upgrade-notes.md) and [0.2.0 readiness](releases/0.2.0-readiness.md)
- [Unreleased upgrade notes](../packages/cli/CHANGELOG.md#upgrade-notes) (changes on `main` after 0.2.0)
- [Design draft: model-written fix PRs](design/model-written-fix-prs.md) (not a commitment to ship)
- [Show HN draft](outreach/show-hn-draft.md) (outreach draft)
