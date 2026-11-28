# @qe-atlas/a11ygate

Command-line accessibility regression gate for [axe-core](https://github.com/dequelabs/axe-core) JSON. The npm package is `@qe-atlas/a11ygate` and the command name is `a11ygate`. It uses the same diff and gate as the [A11yGate](https://a11ygate.vercel.app) web app: a run fails only when a **new** finding is at or above the impact threshold.

Licensed under the [MIT License](LICENSE).

See the [changelog](CHANGELOG.md) and [upgrade notes](../../docs/releases/0.2.0-upgrade-notes.md) for 0.2.0. To see which versions npm serves, run `npm view @qe-atlas/a11ygate versions dist-tags`.

## Usage

The regression gate below works with every published version, including 0.1.0:

```bash
npx @qe-atlas/a11ygate --current axe.json --baseline a11y/baseline.json
```

`--format`, `--out-dir` and every subcommand other than `ci` (for example `scan`, `init`, `doctor`, `baseline`, `report`, `evidence`, `prospect` and `pilot`) need 0.2.0 or later. Check the version you run with `a11ygate --version`, and the versions npm serves with `npm view @qe-atlas/a11ygate versions`. If npm does not serve 0.2.0 or later, install the CLI as described in the pilot quickstart.

If you installed the [pilot tarball](https://github.com/DaveEliranAssistant/a11ygate/blob/main/docs/pilot/quickstart.md#1-install-the-tarball-you-received-5-minutes) into your project's `node_modules`, run the installed CLI without fetching from the registry:

```bash
npx --no-install a11ygate ci --current axe.json --baseline a11y/baseline.json --format junit,sarif --out-dir a11y
```

If you use a [source build](https://github.com/DaveEliranAssistant/a11ygate/blob/main/docs/pilot/quickstart.md#source-build-fallback), it is not installed into `node_modules`, so run its built file with Node. Replace `<path-to-checkout>` with the path to your a11ygate checkout:

```bash
node <path-to-checkout>/packages/cli/dist/cli.mjs ci --current axe.json --baseline a11y/baseline.json --format junit,sarif --out-dir a11y
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

## Multi-project CI runs

`a11ygate ci --projects a11ygate.projects.yml --out-dir a11y-projects`
runs each project's live scan sequentially. Add `--parallel N` (1–8) to run
up to N projects at once; page concurrency remains each scan's own setting.
Only these three flags are accepted in multi-project mode.

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/DaveEliranAssistant/a11ygate/main/schema/a11ygate.projects.schema.json
projects:
  - name: storefront
    config: sites/storefront.yml
  - name: dashboard
    config: sites/dashboard.yml
```

Each config is an ordinary `.a11ygate.yml` scan configuration with its own `url`,
`auth`, fingerprint `baseline`, engines and threshold. Config paths resolve from
the projects file; baseline and auth file paths resolve from each config's directory.
Normal environment overrides still apply to each project. The coordinator overrides
`outDir` and always requests per-project JUnit. Model features remain off by default.
Names must be unique (case-insensitive), 1–64 ASCII letters/digits/underscores/hyphens,
starting with a letter or digit. Validate without scanning with
`a11ygate config validate --projects a11ygate.projects.yml`.

The default output directory is `a11ygate-projects` relative to the command's working
directory. Each `<out-dir>/<name>/` contains normal scan reports and a
`project-result.json` recording the current invocation's result, including startup
errors. `<out-dir>/a11ygate-projects.{json,md,html,junit.xml}` summarizes all projects
in file order. JUnit has one testsuite and project gate testcase per project;
individual findings remain in each project's JUnit report. Combined counts sum
observed pages and findings; errored projects can have incomplete coverage.

Exit code is the maximum project code: 0 passed, 1 violations at the configured
threshold, 2 errored. Invalid project configuration, unreachable pages or browser
startup failures do not stop other projects. Malformed projects files or unsafe
output paths stop before scanning. Existing saved reports are never read to build
the combined summary; consult `project-result.json` first when reusing output dirs,
as prior scan files may remain after startup errors. Single-project commands and
report formats are unchanged. Only scan authorized sites using test accounts.

Automated testing only. Not a WCAG audit, certification or legal advice.

## Live-site scan (`a11ygate scan`)

For tested localhost apps, see the [Next.js, Vite + React, Angular and Storybook recipes](../../docs/recipes/README.md). The source CLI supports `scan <loopback-url> --start "npm start" --wait-on <loopback-url>`: start a trusted command, wait for HTTP 2xx, then stop its process group after scanning (POSIX). `--timeout-ms` bounds readiness and each page. Use `--storybook <loopback-index.json-url>` to scan every story iframe; it cannot be combined with crawl budgets, sitemaps or filters.

Needs 0.2.0 or later. It loads real pages in headless Chromium and runs axe-core with the WCAG 2.0/2.1/2.2 A and AA tags plus `best-practice`.

```bash
npm install --save-dev playwright @axe-core/playwright && npx playwright install chromium
node packages/cli/dist/cli.mjs scan https://staging.example.com/ --crawl 10 --out-dir a11y-scan
node packages/cli/dist/cli.mjs scan https://staging.example.com/ --out-dir a11y-scan --format junit,sarif
node packages/cli/dist/cli.mjs scan https://staging.example.com/pricing --fail-on critical --json scan.json --html scan.html
```

| Option | Meaning |
| --- | --- |
| `--incremental <cache-dir>` | Opt in to rendered-DOM findings reuse; see [incremental scans](#incremental-scans-a11y-r60). |
| `--incremental-normalize <regex>` | Replace default normalizers; repeatable global/case-insensitive JavaScript regexes. |
| `--crawl [n]` | Breadth-first crawl of same-origin `a[href]` links, at most `n` pages. Bare `--crawl` and any larger value mean 20. `--max-pages` explicitly opts into a larger budget (see crawler controls below). Without it, only `<url>` is scanned. |
| `--fail-on <impact>` | `minor`, `moderate`, `serious` (default), `critical`, or `none`. |
| `--out-dir <dir>` | Write `a11ygate-scan.json`, `.md` and `.html` into `<dir>`. |
| `--format <fmt>` | Also write `junit`, `sarif`, `json`, `md`, or `gitlab-codequality` into `--out-dir` (`a11ygate-scan.junit.xml`, `a11ygate-scan.sarif`). Repeat or comma-separate. Exit codes are unchanged. |
| `--json` / `--markdown` / `--html <file>` | Write individual reports instead. `--json -` prints JSON to stdout; otherwise Markdown is printed. |
| `--en301549-ref` | Opt in: add an "EN 301 549 ref." column (ETSI EN 301 549 V3.2.1 clause 9) to HTML report v2 and to SARIF rule properties (`properties.en301549Ref`). WCAG 2.2-only criteria show "not in EN 301 549 V3.2.1". Reference mapping only; does not indicate conformance. Default off: output is unchanged without it. |
| `--report-version 1\|2` | HTML layout. `2` (default): executive summary, top 10 fixes, WCAG and page grouping, how-to-fix links, limits of automated testing, print and dark-mode CSS. `1`: the previous HTML, byte-for-byte. |
| `--report-lang <lang>` | Language for HTML report v2 and the Markdown summary. Shipped: `en` (default, unchanged output). `en-XA` and `ar-XB` (right-to-left) are pseudo-locales for layout testing only. The disclaimer and legal wording always stay in English. See [docs/report-locales.md](../../docs/report-locales.md). |
| `--delay-ms <ms>` | Pause between page loads. Default 1000. |

`playwright` and `@axe-core/playwright` are optional peer dependencies, loaded only by `scan`. If they are missing, `scan` prints an install hint and exits 2. The gate mode stays dependency-free.

Exit codes: **0** no finding at or above `--fail-on`; **1** at least one is; **2** bad arguments, missing browser or dependencies, a start page that is unreachable or disallowed by robots.txt, or an unwritable output.

The JSON report has `version`, `axeVersion`, `scannedAt`, `startUrl`, `pages[]` (URL, HTTP status, finding counts), `skipped[]` (external, robots, logout, non-HTML, cap, filters, depth, timeout, navigation errors, discovery cap), and `findings[]` (page URL, CSS selector(s), axe rule id, impact, mapped WCAG success criteria, help text and `helpUrl`). Its `results` array holds the raw per-page axe results, so the same file is valid `--current` input for the gate, for example `a11ygate --current a11y-scan/a11ygate-scan.json --baseline a11y/baseline.json`. The Markdown and self-contained HTML summaries group findings by WCAG criterion and by severity.

**Boundaries.** Only scan sites you own or are explicitly authorized to test. Page analysis is read-only. Authentication is opt-in; an explicitly configured login script may fill forms and click before analysis. Use test accounts only. It never leaves the start origin. It honours robots.txt `Disallow` for `User-agent: *` and `A11yGate`, and proceeds if robots.txt is unreachable. It skips logout-like and non-HTML links, waits between page loads, and identifies itself with an `A11yGate` User-Agent. This is automated testing only. axe-core finds a subset of WCAG issues, so a PASS is not conformance, certification or legal advice.

### Incremental scans (A11Y-R60)

`scan <url> --incremental .a11ygate-cache --out-dir a11y-scan` enables a local,
opt-in cache. Every route still loads and configured interactions still replay.
The scanner hashes each rendered state immediately before analysis, including
child frames, open shadow roots and live form values. Only successful engine
analysis is reused; keyboard heuristics and screenshots still run afresh.

By default normalization removes nonce attributes, common CSRF input/meta fields,
CSRF/timestamp data attributes and UTC ISO timestamps. Use repeatable
`--incremental-normalize <regex>` flags (or YAML `incrementalNormalize`) to
**replace** these defaults. Each regex uses JavaScript `gi` flags and replaces
matches with an empty string. For example, `--incremental-normalize 'build-[0-9]+'`
ignores changing build identifiers. Keep patterns narrow: removed content cannot
trigger a rescan. YAML `incremental: .a11ygate-cache` and environment
`A11YGATE_INCREMENTAL` also opt in; use a JSON array for
`A11YGATE_INCREMENTAL_NORMALIZE` when regexes contain commas.

Engine/adapter versions, Chromium version, CLI version, rule tags, scan settings,
auth context and normalization rules participate in cache compatibility. A change
invalidates reuse. Missing version metadata disables reuse with a warning.
Cache entries include engine versions/rule configuration, DOM/config hashes and
original scan IDs. Corrupt entries trigger a warning and a full engine rescan.
Writes use atomic replacement; an unwritable cache warns without losing results.

Cached pages in JSON, Markdown, HTML and evidence-pack front pages/manifest carry
`from cache (DOM unchanged since <scan id>)`; their original engine timestamps and
findings remain intact. Baseline decisions and gating apply again on each run.
Cache files contain findings and raw engine evidence, so keep the directory local
and out of source control, like scan outputs. Delete it to force fresh analysis.
DOM equality does not detect external CSS/image/font changes or closed shadow
roots. Use a fresh scan when those assets change. Incremental mode is off by
default; reports without it remain unchanged.

Automated testing only. Not a WCAG audit, certification or legal advice.

## Evidence pack (`a11ygate evidence pack`)

Needs 0.2.0 or later. Bundles one scan's local outputs into a single zip. It reads only files already written by `a11ygate scan --out-dir`; it does not scan, crawl or use the network.

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

## Trend report (`a11ygate trend`)

Needs 0.2.0 or later. Builds a history from a directory of evidence packs, for example one pack per monthly scan. It reads only `manifest.json` and `scan/a11ygate-scan.json` from each pack; it does not scan, crawl or use the network.

```bash
node packages/cli/dist/cli.mjs trend a11y-evidence/ --out-dir a11y-trend
```

Writes `a11ygate-trend.json` and `a11ygate-trend.html` (default `--out-dir` is the packs directory). Runs are ordered by commit time when every pack records it (packs made inside a git work tree do), otherwise by scan time with a note; `--order scan|commit` chooses explicitly. See [Trend report](../../docs/trend-report.md) for how runs are ordered and counted.

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

`a11ygate report pdf <scan.json|out-dir> -o report.pdf` prints HTML report v2 to a PDF with the local Playwright Chromium: a cover page (site, scan date, commit, engines, scope), a table of contents with page numbers, and the disclaimer on the cover and in the footer of every page. Text stays selectable and the PDF is tagged. The commit defaults to the git HEAD of the current directory (`--commit <sha>` overrides it). No network access is used. Automated testing only. Not a WCAG audit, certification or legal advice.
See [baseline mode](../../docs/baseline-mode.md) for examples and exporter behavior.
The separate `a11ygate [ci] --baseline <axe.json>` format remains unchanged.

### Prospect summary (A11Y-R67)

Run `a11ygate prospect <url> --max-pages 5 --company "Company name"` to write a
short HTML and PDF summary and `prospect-manifest.json` in `prospect-out`.
Use `--out-dir <dir>` to choose the destination. The live scan defaults to one
page and accepts a cap from 1 to 20. It uses axe, follows robots.txt and stays
on the starting origin. The command bypasses repository scan configuration,
including authentication and interaction settings.

For hosts outside [the exact allowlist](../../config/own-hosts.json), supply
`--authorized-by <name> --authorization-note <text>` before scanning. Both values
appear in the manifest and report footer. Use
`a11ygate prospect --from <scan-out-dir>` or pass the saved scan directory
positionally to generate the same artifacts offline. Both modes need Playwright
Chromium for PDF output. Use `--offer` to include the configured price and pilot.

Automated testing only. Not a WCAG audit, certification or legal advice.


### Preflight

Run `a11ygate doctor` before scanning (Node 20+; the Action uses 22). It reports
configuration problems without visiting scan targets and exits 0 by default.
Use `--strict` to exit 1 on failed checks, `--engines axe,ibm` to check requested
peers, and `--model-fixes on` to check an opted-in model provider. See the
[GitHub Action doctor guide](../../docs/integrations/github-action.md#doctor)
for read-only probes, unknown results, supported config and setup instructions.

Automated testing only. Not a WCAG audit, certification or legal advice.

## Starter CI setup (`a11ygate init`)

Run `a11ygate init` for prompts or `a11ygate init --yes --target github` for a
non-interactive starter. Other targets are `jenkins`, `gitlab`, and `azure-devops`.
Add `--pilot` for success criteria, a kickoff checklist link, and setup commands.
Existing files are skipped; `--force` replaces regular starter files. See the
[init guide](../../docs/integrations/init.md) for flags, baseline opt-in, and local
application startup prerequisites. Needs 0.2.0 or later.

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


### Repository configuration

`scan`, `ci`, `doctor`, and the GitHub Action share the [.a11ygate.yml resolver](../../docs/configuration.md): CLI flags (or explicit Action inputs) > environment > YAML > defaults. Run `a11ygate config print [scan|ci|doctor] [flags]` to see effective values, their sources and command scopes, with secrets redacted. Run `a11ygate config validate` for schema diagnostics. Missing configuration preserves the existing defaults.

### SPA interaction states (opt-in)

Use `--interactions states.json` (a JSON list of `{ "route": "/pricing",
"name": "dialog-open", "steps": [{ "action": "click", "selector": "#open-dialog" }] }`)
or the `interactions` list in `.a11ygate.yml`. Steps support `click`, `press`
(with `key`) and `wait` (visible selector). States reload the route individually
and are labelled `/pricing#dialog-open`. Repeated findings are counted once and
retain observed state URLs. Failed steps are skipped with a reason; incomplete
states exit 2.

`--auto-interactions --interaction-budget 3` opens collapsed controls and popup
buttons individually, up to the per-route step budget. Default off; default budget
10. Use `interactions.auto.depth` (1–3, default 1) and
`interactions.auto.maxStates` (1–100, default 20) in a YAML states/auto mapping
to explore newly revealed nested controls with path labels. Each branch reloads
and replays its parents; these replay steps consume the shared step budget.
The default 20-state cap also applies to legacy `--auto-interactions`, even with
`--interaction-budget 50`. Set `interactions.auto.maxStates: 50` to allow
50 auto attempts (the step budget must also allow them).
Forms, links, destructive-looking buttons and document navigation during steps are blocked. Use test
accounts in authorized test environments: custom application handlers may have
side effects. See [configuration and limits](../../docs/configuration.md#opt-in-spa-interaction-states).

Automated testing only. Not a WCAG audit, certification or legal advice.

### Screenshot privacy

Screenshots are off by default. `scan --screenshots --out-dir out` captures masked viewport PNGs. Use `--no-screenshots` for authenticated scans; it also excludes existing images from subsequent evidence packs for that output directory. Add CSS selectors with `redact.selectors` in YAML or repeat `--redact-selector`. See [authenticated scans](../../docs/authenticated-pages.md) for defaults and limitations.

Automated testing only. Not a WCAG audit, certification or legal advice.

## Developer handoff tickets (A11Y-R54)

```bash
a11ygate export tickets a11ygate-out --format jira-csv --baseline .a11ygate-baseline.json --output a11y-tickets.csv
a11ygate export tickets a11ygate-out/a11ygate-scan.json --format gh-md > a11y-issues.md
```

Reads a saved site-scan report (`a11ygate-scan.json` or its out-dir) and makes one
ticket per likely shared component group (same grouping as `review`), or one per
finding when it has no group. With `--baseline`, groups with an active
`accepted-risk` or `false-positive` decision are skipped; `to-fix` and expired
accepted-risk decisions stay in, with the decision noted. Groupings are heuristic:
review the examples before filing. Output goes to stdout unless `--output` is given.

Every ticket carries: title (the engine's rule help text, rule id and page count),
WCAG SC, EN 301 549 ref. (reference mapping only; does not indicate conformance),
impact, pages affected (count plus the first 5 URLs, sorted), the first example's
selector and HTML snippet, how-to-fix links (W3C Understanding pages from
`lib/mapping.ts`; the engine's rule page for best-practice rules) and a fingerprint
`a11ygate-g-<16 hex>`. The fingerprint is derived from the component group key
(rule, normalized selector, normalized HTML), so re-exporting the same scan, or a
later scan where the component is still failing on different pages, gives the same
value. Use it to find existing tickets before re-importing.

| Format | Shape | Disclaimer |
| --- | --- | --- |
| `csv` | UTF-8 with BOM, every field quoted, one row per ticket, multi-value cells newline-separated. Cells starting with `=`, `+`, `-`, `@`, tab or CR are prefixed with `'`. | Final row: disclaimer in the first column, other columns empty. |
| `jira-csv` | Columns `Summary`, `Issue Type` (`Bug`), `Priority` (critical→Highest, serious→High, moderate→Medium, minor→Low), `Description`, and three `Labels` columns (`accessibility`, `a11ygate`, the fingerprint), following Atlassian's [CSV import guide](https://support.atlassian.com/jira-cloud-administration/docs/import-data-from-a-csv-file/). No BOM. | Last line of every Description (a trailing row would import as an issue). With zero tickets, a single notice row (`A11yGate notice: no open findings (do not import)`, Issue Type `Task`, label `a11ygate-notice`) carries it instead. |
| `gh-md` | One `###` section per issue (heading = issue title, rest = body) with the fingerprint as a hidden HTML comment and a table row. | Footer of every issue body and of the file. |

Export only: A11yGate never calls the Jira or GitHub APIs. Map the columns in
Jira's import wizard; check priorities and issue types against your project.
Automated testing only. Not a WCAG audit, certification or legal advice.

## Pilot scoping dry run (A11Y-R55)

`a11ygate estimate <url>` fetches static HTML only, with no accessibility engines,
JavaScript execution, login script, model, or loaded project configuration. It
unions the start URL, `/sitemap.xml` (including bounded sitemap indexes), and
same-origin anchor links within the crawl limits. Use only on authorized sites.
It writes `estimate-out/estimate.md` and `estimate-out/estimate.json`, and prints
Markdown. `--out-dir` changes the destination. Exit 2 indicates invalid arguments,
output failure, or failed/skipped page fetches; consult the report's warnings and
skipped URLs for incomplete discovery (including robots, depth and page caps).

Options: `--sitemap <same-origin-url-or-path>`, `--max-pages 1-1000` (default 20),
`--max-depth 0-1000` (default 1000), `--concurrency 1-8` (default 1),
`--delay-ms 0-60000` (default 1000), `--timeout-ms 1-300000` (default 10000),
`--engines axe|all|comma-list` (default axe). Engine selection describes the future
scan configuration only; no engine runs. Robots rules apply to crawl URLs,
redirect destinations and sitemap requests. Off-origin redirects are reported,
never followed. Missing/unreachable robots files follow the existing scanner
policy: proceed with a visible note. HTML responses are bounded to 2 MiB.

Likely templates group numeric/UUID path segments as `:id`, ignoring query values;
slugs remain separate. Password forms, login redirects and HTTP 401/403 are login
signals; absence means **unknown**, not that login is unnecessary. Application
roots, module scripts and framework markers are SPA signals only. JavaScript-only
links, authenticated content, base-element links, unquoted/encoded HTML variations,
and hidden requirements can be missed. Counts reflect bounded fetched URLs,
including failures and redirect aliases, rather than the entire site's page count.

Timing is linear extrapolation from successful recorded `docs/perf` rows, with the
source file, zero-based row index, recording date and full row in both outputs.
Only exact engine-set, concurrency, no-recycling and zero-delay configurations
match available rows. The R47 successful follow-up supersedes the earlier
all-engine concurrency-4 row; failed rows are excluded. For example, axe at
concurrency 2 and delay 0 uses `chromium-bench-axe-500.json` row 1 (112.2 pages/min).
The default delay has **no benchmark for this configuration**. These local-fixture
rates are hardware/site dependent, include scan startup, and provide no measured
variance. The output never estimates price.

Automated testing only. Not a WCAG audit, certification or legal advice.

### Diff-aware PR scans (A11Y-R57)

`a11ygate scan --changed-since origin/main` selects URL paths from a `routes`
source-glob mapping in `.a11ygate.yml`. Committed changes from the merge base to
HEAD determine scope; an unmapped file or shared `"*"` mapping runs the normal
full scan. JSON, Markdown and HTML summaries record mode, reason and scanned /
skipped paths. Baselines and review decisions still apply; omitted pages remain
unassessed. Without this opt-in, reports stay unchanged. Project scan configs
also accept `changedSince`; the saved-result `ci --current` gate does not.
See [configuration and limits](../../docs/configuration.md#diff-aware-pr-scans-a11y-r57).

### Extended keyboard probes (A11Y-R46)

`scan --keyboard` follows open shadow roots and same-origin iframes, probes reverse
Tab order and roving-tabindex composite arrow keys, and detects small focus cycles.
Cross-origin frames are recorded as not assessed. `--keyboard-pixel-threshold 0.01`
sets the changed-pixel fraction (0–1) for the in-memory focus indicator fallback
after outline/box-shadow checks. This flag alone does not enable keyboard checks;
there is no new YAML key. Crops are never written to disk or attached to reports.
The shared `--keyboard-budget` bounds all Tab, Shift+Tab and arrow-key presses.
Every finding needs human review. See the root README for limitations.

Automated testing only. Not a WCAG audit, certification or legal advice.
