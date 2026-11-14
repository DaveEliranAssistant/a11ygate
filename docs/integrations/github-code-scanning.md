# GitHub code scanning (SARIF)

A11yGate can write a SARIF 2.1.0 file and upload it with [github/codeql-action/upload-sarif](https://github.com/github/codeql-action) so findings appear as code scanning alerts. This is automated testing only. Not a WCAG audit, certification or legal advice.

Copy the workflow in [`examples/github-code-scanning/sarif.yml`](../../examples/github-code-scanning/sarif.yml) into `.github/workflows/` in a repository you own or are authorized to test. The example uses `a11ygate ci --current` and a checked-in axe JSON fixture, so it does not crawl the public internet.

## What this repository will not change for you

- Repository visibility is never changed.
- GitHub Code Security / GitHub Advanced Security (required for **private** repositories) is never enabled here.
- CodeQL default setup is never turned on. Public repositories can already receive a third-party SARIF upload without that setting.
- No secrets or API keys are added.

If code scanning is not available on the target repository (typical for a private repo without GitHub Code Security), stop and ask the owner to either use a public repository or explicitly enable the paid feature. Do not toggle the setting yourself.

## Limits the exporter already honours

These come from GitHub’s documented SARIF support and upload troubleshooting pages:

| Limit | Value | Source |
| --- | --- | --- |
| Gzip-compressed file size | 10 MB | [SARIF file is too large](https://docs.github.com/en/code-security/reference/code-scanning/sarif-files/troubleshoot-sarif-uploads/file-too-large) and [SARIF support](https://docs.github.com/en/code-security/reference/code-scanning/sarif-files/sarif-support) |
| Runs per file | 20 | [Results exceed limits](https://docs.github.com/en/code-security/reference/code-scanning/sarif-files/troubleshoot-sarif-uploads/results-exceed-limit) |
| Results per run | 25,000 hard; top 5,000 kept by severity | same |
| Tags per rule | 20 (10 displayed) | same |
| Alert matching | `partialFingerprints.primaryLocationLineHash` | [SARIF support — fingerprint generation](https://docs.github.com/en/code-security/reference/code-scanning/sarif-files/sarif-support) |
| Per-engine category | `automationDetails.id` = `a11ygate/<engine>/` | [SARIF support — runAutomationDetails](https://docs.github.com/en/code-security/reference/code-scanning/sarif-files/sarif-support) |

Page URLs are written as repo-relative paths (`a11ygate-pages/<host>/…`) because GitHub code scanning rejects `https` artifact URIs (`SARIF URI scheme "https" did not match the checkout URI scheme "file"` — see [codeql-action#754](https://github.com/github/codeql-action/issues/754)). The real page URL stays in the result message, a `logicalLocations` entry, and `properties.pageUrl`. Mapped source files are left as relative paths.

The same finding on two runs produces the same `primaryLocationLineHash`, so GitHub should not open a duplicate alert. Each engine gets its own analysis category (`a11ygate/axe`, `a11ygate/htmlcs`, …). The trailing slash sets the category without a distinct run id, so daily CI stays in one category per engine.

## Permissions

The official upload action needs `security-events: write`. On a private repository it also needs `actions: read`. The workflow file in `examples/github-code-scanning/sarif.yml` sets both.

After a successful upload, alerts are listed at `https://github.com/<owner>/<repo>/security/code-scanning` and via `gh api /repos/<owner>/<repo>/code-scanning/alerts`.
