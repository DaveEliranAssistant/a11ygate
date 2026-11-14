# @qe-atlas/a11ygate

Command-line accessibility regression gate for [axe-core](https://github.com/dequelabs/axe-core) JSON. The npm package is `@qe-atlas/a11ygate` and the command name is `a11ygate`. It uses the same diff and gate as the [A11yGate](https://a11ygate.vercel.app) web app: a run fails only when a **new** finding is at or above the impact threshold.

Licensed under the [MIT License](LICENSE).

See the [changelog](CHANGELOG.md) and [upgrade notes](../../docs/releases/0.2.0-upgrade-notes.md) for 0.2.0. The npm `latest` tag remains 0.1.0 until a separate approval; 0.2.0 is intended for the `next` tag only.

## Usage

```bash
npx @qe-atlas/a11ygate --current axe.json --baseline a11y/baseline.json
npx @qe-atlas/a11ygate ci --current axe.json --baseline a11y/baseline.json --format junit,sarif --out-dir a11y
```

`a11ygate ci` is the same gate as the default command. `--format` writes machine-readable reports for CI systems (JUnit XML for Jenkins, SARIF 2.1.0 for GitHub code scanning). Every report includes this disclaimer: "Automated testing only. Not a WCAG audit, certification or legal advice."

From a checkout of this repository, after `npm install`:

```bash
npx @qe-atlas/a11ygate --help
node packages/cli/dist/cli.mjs --current fixtures/demo-shop-current.json --baseline fixtures/demo-shop-baseline.json
```

The Demo Shop fixtures exit **1** with **2 new, 3 fixed, 5 still open**, and verdict **FAIL**, at the default `serious` threshold.

## Options

| Option | Meaning |
| --- | --- |
| `-c, --current <file>` | Current axe JSON. Repeat for several files. |
| `-b, --baseline <file>` | Baseline axe JSON. Repeatable. Omit to treat every current finding as new. |
| `-t, --threshold <impact>` | `minor`, `moderate`, `serious` (default), or `critical`. |
| `-m, --markdown <file>` | Also write the Markdown summary to a file. It is always printed. |
| `-j, --json <file>` | Write the JSON result. Use `-` to print JSON instead of Markdown. |
| `--update-baseline <file>` | Write the current results as a baseline file. The exit code is still the gate. |
| `--format <fmt>` | `junit`, `sarif`, `json`, `md`, or `gitlab-codequality`. Repeat the flag or comma-separate to write several. Requires `--out-dir`. Does not change the exit code. |
| `--out-dir <dir>` | Write `a11ygate.json` and `a11ygate.md` here, plus any `--format` files (`a11ygate.junit.xml`, `a11ygate.sarif`). |
| `-h, --help` | Show help. |
| `--version` | Show the version. |

Accepted JSON shapes: one axe result object, an array of result objects, or `{ "results": <object or array> }`. Node `target` values may be strings or nested string arrays (iframes and shadow DOM). Files over 8 MB are refused.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | No new finding is at or above the threshold. |
| 1 | At least one new finding is at or above the threshold. |
| 2 | The arguments or the JSON could not be read. |

## Live-site scan (`a11ygate scan`)

For tested localhost apps, see the [Next.js, Vite + React, Angular and Storybook recipes](../../docs/recipes/README.md). The source CLI supports `scan <loopback-url> --start "npm start" --wait-on <loopback-url>`: start a trusted command, wait for HTTP 2xx, then stop its process group after scanning (POSIX). `--timeout-ms` bounds readiness and each page. Use `--storybook <loopback-index.json-url>` to scan every story iframe; it cannot be combined with crawl budgets, sitemaps or filters.

Unreleased source build: published `0.1.0` does not include `scan`. It loads real pages in headless Chromium and runs axe-core with the WCAG 2.0/2.1/2.2 A and AA tags plus `best-practice`.

```bash
npm install --save-dev playwright @axe-core/playwright && npx playwright install chromium
node packages/cli/dist/cli.mjs scan https://staging.example.com/ --crawl 10 --out-dir a11y-scan
node packages/cli/dist/cli.mjs scan https://staging.example.com/ --out-dir a11y-scan --format junit,sarif
node packages/cli/dist/cli.mjs scan https://staging.example.com/pricing --fail-on critical --json scan.json --html scan.html
```

| Option | Meaning |
| --- | --- |
| `--crawl [n]` | Breadth-first crawl of same-origin `a[href]` links, at most `n` pages. Bare `--crawl` and any larger value mean 20. `--max-pages` explicitly opts into a larger budget (see crawler controls below). Without it, only `<url>` is scanned. |
| `--fail-on <impact>` | `minor`, `moderate`, `serious` (default), `critical`, or `none`. |
| `--out-dir <dir>` | Write `a11ygate-scan.json`, `.md` and `.html` into `<dir>`. |
| `--format <fmt>` | Also write `junit`, `sarif`, `json`, `md`, or `gitlab-codequality` into `--out-dir` (`a11ygate-scan.junit.xml`, `a11ygate-scan.sarif`). Repeat or comma-separate. Exit codes are unchanged. |
| `--json` / `--markdown` / `--html <file>` | Write individual reports instead. `--json -` prints JSON to stdout; otherwise Markdown is printed. |
| `--report-version 1\|2` | HTML layout. `2` (default): executive summary, top 10 fixes, WCAG and page grouping, how-to-fix links, limits of automated testing, print and dark-mode CSS. `1`: the previous HTML, byte-for-byte. |
| `--delay-ms <ms>` | Pause between page loads. Default 1000. |

`playwright` and `@axe-core/playwright` are optional peer dependencies, loaded only by `scan`. If they are missing, `scan` prints an install hint and exits 2. The gate mode stays dependency-free.

Exit codes: **0** no finding at or above `--fail-on`; **1** at least one is; **2** bad arguments, missing browser or dependencies, a start page that is unreachable or disallowed by robots.txt, or an unwritable output.

The JSON report has `version`, `axeVersion`, `scannedAt`, `startUrl`, `pages[]` (URL, HTTP status, finding counts), `skipped[]` (external, robots, logout, non-HTML, cap, filters, depth, timeout, navigation errors, discovery cap), and `findings[]` (page URL, CSS selector(s), axe rule id, impact, mapped WCAG success criteria, help text and `helpUrl`). Its `results` array holds the raw per-page axe results, so the same file is valid `--current` input for the gate, for example `a11ygate --current a11y-scan/a11ygate-scan.json --baseline a11y/baseline.json`. The Markdown and self-contained HTML summaries group findings by WCAG criterion and by severity.

**Boundaries.** Only scan sites you own or are explicitly authorized to test. Page analysis is read-only. Authentication is opt-in; an explicitly configured login script may fill forms and click before analysis. Use test accounts only. It never leaves the start origin. It honours robots.txt `Disallow` for `User-agent: *` and `A11yGate`, and proceeds if robots.txt is unreachable. It skips logout-like and non-HTML links, waits between page loads, and identifies itself with an `A11yGate` User-Agent. This is automated testing only. axe-core finds a subset of WCAG issues, so a PASS is not conformance, certification or legal advice.

## Evidence pack (`a11ygate evidence pack`)

Unreleased source build. Bundles one scan's local outputs into a single zip. It reads only files already written by `a11ygate scan --out-dir`; it does not scan, crawl or use the network.

```bash
node packages/cli/dist/cli.mjs evidence pack --from a11y-scan --out a11y-evidence.zip --commit "$(git rev-parse HEAD)"
```

| Path in zip | Contents |
| --- | --- |
| `manifest.json` | Tool version, commit SHA (or `"sha": null, "source": "unavailable"` with a note; none is invented), engines with versions and rule sets, UTC timestamps (`packedAt`, `scannedAt`), scope, and the SHA-256 and size of every other file. |
| `report.md`, `report.html` | Front page: scope scanned, automated result, **what automated testing cannot cover**, and the disclaimer. |
| `scan/a11ygate-scan.{json,md,html,sarif,junit.xml}` | Copied from `--from`; SARIF/JUnit/MD/HTML are regenerated from the JSON when absent (marked `"source": "generated"`). |
| `engines/<axe\|htmlcs\|ibm\|lighthouse>.json` | Per-engine raw JSON, when present. |
| `screenshots/*.png\|jpg\|webp` | When present; only real image files. |

Only these allowlisted files are read, so `.env` files, credentials and other files in the directory are never packed. Packing exits 2 without writing if an included file looks like it holds a credential (tokens, private keys, URL credentials) or the value of a secret-named environment variable. Re-packing the same inputs gives identical files; only `manifest.json` timestamps change. Default `--out` is `<from>/a11ygate-evidence.zip`.

Automated testing only. Not a WCAG audit, certification or legal advice.

## Jenkins

See [Jenkins integration](../../docs/integrations/jenkins.md) for the shared library step, example `Jenkinsfile`s, JUnit/SARIF publishing, and agent requirements.

## GitHub code scanning

See [GitHub code scanning](../../docs/integrations/github-code-scanning.md) for uploading `a11ygate.sarif` with `github/codeql-action/upload-sarif`. The exporter sets stable `partialFingerprints`, a per-engine `automationDetails.id`, and honours GitHub's documented size and result limits. Copy [`examples/github-code-scanning/sarif.yml`](../../examples/github-code-scanning/sarif.yml) into `.github/workflows/` of a repository you own. Public repositories can receive the upload without enabling CodeQL default setup; do not change visibility or turn on paid GitHub Code Security unless the owner asks.

## License

MIT. See [LICENSE](LICENSE).

Scanning accepts `--engines axe` and defaults to axe only. Other engines are not enabled yet.
Automated testing only. Not a WCAG audit, certification or legal advice.

### Opt-in scan engines

Axe remains the only default engine. Enable additional engines explicitly:

```sh
npm install --save-dev html_codesniffer accessibility-checker-engine lighthouse puppeteer-core
npx a11ygate scan http://127.0.0.1:8080 --engines axe,htmlcs,ibm,lighthouse --out-dir report
```

Install only the optional peers you select: `html_codesniffer` for `htmlcs`,
`accessibility-checker-engine` for `ibm`, and `lighthouse puppeteer-core` for
`lighthouse`. All use the same browser session; IBM rules are installed locally.
Opt-in results are listed separately without deduplication. Missing peers or engine
failures are reported as `errored` while remaining engines continue (exit 2).
See [engine documentation](https://github.com/DaveEliranAssistant/a11ygate/blob/main/docs/engines.md)
for offline behavior, licensing and the opt-in report fields.

Automated testing only. Not a WCAG audit, certification or legal advice.

## Fingerprint baselines

Use `a11ygate baseline create <scan.json|out-dir>` to record existing findings,
then `a11ygate scan <url> --baseline .a11ygate-baseline.json` to gate new findings.
Saved scans can be compared with `a11ygate report <scan.json|out-dir> --baseline <file>`.
See [baseline mode](../../docs/baseline-mode.md) for examples and exporter behavior.
The separate `a11ygate [ci] --baseline <axe.json>` format remains unchanged.


### Preflight

Run `a11ygate doctor` before scanning (Node 20+; the Action uses 22). It reports
configuration problems without visiting scan targets and exits 0 by default.
Use `--strict` to exit 1 on failed checks, `--engines axe,ibm` to check requested
peers, and `--model-fixes on` to check an opted-in model provider. See the
[GitHub Action doctor guide](../../docs/integrations/github-action.md#doctor)
for read-only probes, unknown results, supported config and setup instructions.

Automated testing only. Not a WCAG audit, certification or legal advice.

## Starter CI setup (source build)

Run `a11ygate init` for prompts or `a11ygate init --yes --target github` for a
non-interactive starter. Use `--target jenkins` for the shared-library pipeline.
Existing files are skipped; `--force` replaces regular starter files. See the
[init guide](../../docs/integrations/init.md) for flags, baseline opt-in, and local
application startup prerequisites. Published 0.1.0 does not include this command.

### GitLab Code Quality

Use `--format gitlab-codequality,junit --out-dir a11y` to write GitLab Code Quality and JUnit artifacts. Scan/report write `a11ygate-scan.gitlab-codequality.json`; ci/gate writes `a11ygate.gitlab-codequality.json`. See the [includable GitLab CI template and format conventions](../../integrations/gitlab/README.md), including exact R18 fingerprints, severity mapping, and virtual locations for unmapped pages.

Automated testing only. Not a WCAG audit, certification or legal advice.

### Authenticated pages

Use test accounts only. Scan with `--storage-state <file>`, a trusted
`--login-script <file>` exporting `async (page, env)`, or repeatable
`--cookie-env name=ENV_VAR_NAME` / `--header-env name=ENV_VAR_NAME`. Only environment
variable names belong in arguments or configuration. Credentials are redacted
from reports, native evidence, and logs; login failures/timeouts exit 2.
See [authenticated page setup and limitations](../../docs/authenticated-pages.md).
Automated testing only. Not a WCAG audit, certification or legal advice.

### Crawler safety controls (A11Y-R30)

Defaults remain one page, one active browser page, a 1000 ms delay, a 30 second
whole-page deadline, same-origin document navigation, and robots.txt enabled.
`--crawl [n]` retains its existing 20-page hard cap. To explicitly authorize a
larger scan, use `--max-pages <n>` (1–1000); this overrides `--crawl` regardless of
argument order. Failed or timed-out attempts count against the page budget;
one retry of a navigation error does not count as another page. HTTP errors,
analysis errors and timeouts are not retried.

```sh
node packages/cli/dist/cli.mjs scan http://127.0.0.1:3000/ \
  --sitemap /sitemap.xml --max-pages 500 --max-depth 3 \
  --include '/**' --exclude '/account/**' --exclude '/logout' \
  --concurrency 2 --delay-ms 1000 --timeout-ms 30000 --out-dir a11y-scan
```

- `--sitemap <url-or-path>` adds sitemap URLs as depth-zero seeds after the start
  URL and enables crawling (20 pages unless a page budget is supplied). Supports
  URL sets, XML entities, CDATA and same-origin sitemap indexes. Metadata requests
  have a 5 second deadline (sitemaps use `--timeout-ms` when supplied), a 512 KiB
  response limit, at most five same-origin redirect hops, and at most ten sitemap
  documents / 10000 seed URLs. DTDs and entity declarations are rejected.
- `--include <glob>` and `--exclude <glob>` are repeatable (up to 32 of each,
  512 characters per glob). Paths include the query string; patterns containing
  `://` match the entire normalized URL. `*` matches within a segment, `**` crosses
  `/`, and `?` matches one non-slash character. All other characters are literal.
  Excludes win. Filters apply to the start URL, sitemap seeds and discovered links.
- `--max-depth <n>` allows link depths 0–1000; default unlimited. The start URL
  and sitemap seeds have depth zero. Breadth-first batches keep report order
  deterministic even with multiple active pages.
- `--timeout-ms <ms>` bounds navigation and analysis together (1–300000).
  Timed-out browser pages close and appear in `skipped[]` with reason `timeout`.
- `--concurrency <n>` permits 1–8 active pages. The default is 1. `--delay-ms`
  is global spacing between every start, including retries, rather than a delay
  per worker. Concurrency never increases the page budget.
- robots.txt is respected by default. `--ignore-robots` explicitly opts out for an
  authorized scan and records that choice in the report. As before, an unavailable
  robots.txt means proceed without rules. A disallowed start URL exits 2.

Document redirects are checked before every network hop, including redirects to
another origin. Third-party page subresources can still load in real scans.
The scanner observes `history.pushState` and `history.replaceState` calls during
page load and discovers their URL arguments alongside `a[href]` links. It does
not click controls or execute event handlers to enumerate routes; interaction-only
routes and states remain unassessed.

Discovery and skipped-record storage are each bounded at 10000 entries. A
`discovery-cap` reason identifies truncated discovery. JSON records configured crawler controls and all retained
skip reasons; Markdown preserves the existing `Not scanned` section for robots
and page caps and adds `Skipped pages` for other reasons. HTML adds the expanded
section when those other reasons are present, preserving legacy report goldens.
The existing automated-testing disclaimer and limitations still apply.

Crawler tests use only a guarded local fixture server. `npm test` runs the
500-page HTTP-transport budget/RSS test without Chromium. To additionally run
browser route, redirect and cancellation checks explicitly:

```sh
A11YGATE_CRAWL_BROWSER_TESTS=1 npx vitest run tests/crawl-hardening.test.ts --disableConsoleIntercept
```

The benchmark records peak **Node process RSS**, growth from its baseline and
elapsed time; it enforces 15 seconds and less than 128 MiB growth. It does not
measure Chromium process RSS or axe execution across 500 pages.

### Likely shared components

The v2 HTML report includes **Likely shared components** with affected page counts,
finding counts and up to three example pages, selectors and HTML snippets. Scan JSON
includes `sharedComponentGroups` (including singleton groups) and
`sharedComponentDisclaimer`; CI JSON includes groups for current new/still-open findings.
SARIF keeps individual results and stable fingerprints, adding other affected pages
as `relatedLocations` with the group page count in result properties. Related locations
respect the configured SARIF location cap; any omitted count is recorded.

Grouping matches the rule, normalized selector path (including frame/shadow path
boundaries) and normalized HTML. Generated IDs, CSS hashes and positional selectors
use the existing fingerprint normalization. HTML ignores text content and href/src/value
values, normalizes attribute order and whitespace, and retains structure and semantic
attributes. Missing HTML or an empty selector cannot establish a cross-page match.

These are **likely** shared components, not verified root causes: unrelated elements
can look alike, and structural or semantic changes can split a real component into
multiple groups. Review examples before deciding whether one fix applies. Finding
totals, severity counts, baseline identities and gate decisions are unchanged.
`--report-version 1` retains the frozen HTML layout.

Automated testing only. Not a WCAG audit, certification or legal advice.
