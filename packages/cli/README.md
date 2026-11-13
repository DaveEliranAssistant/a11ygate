# @qe-atlas/a11ygate

Command-line accessibility regression gate for [axe-core](https://github.com/dequelabs/axe-core) JSON. The npm package is `@qe-atlas/a11ygate` and the command name is `a11ygate`. It uses the same diff and gate as the [A11yGate](https://a11ygate.vercel.app) web app: a run fails only when a **new** finding is at or above the impact threshold.

Licensed under the [MIT License](LICENSE).

## Usage

```bash
npx @qe-atlas/a11ygate --current axe.json --baseline a11y/baseline.json
```

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
| `-h, --help` | Show help. |
| `--version` | Show the version. |

Accepted JSON shapes: one axe result object, an array of result objects, or `{ "results": <object or array> }`. Node `target` values may be strings or nested string arrays (iframes and shadow DOM). Files over 8 MB are refused.

## Evidence report

```bash
npx @qe-atlas/a11ygate report --current axe.json --baseline a11y/baseline.json --out a11y-report.html
npx @qe-atlas/a11ygate report --scan a11ygate-scan.json --previous-scan last-month-scan.json --out report.html
```

`a11ygate report` reads either the gate inputs (`--current`, `--baseline`, `--threshold`) or the JSON written by `a11ygate scan` (`--scan`, optionally `--previous-scan` for an older scan of the same site; `--scan` cannot be combined with `--current`/`--baseline`). It writes a self-contained HTML (default), Markdown, or JSON report: scan date-time, commit and branch, A11yGate and axe-core versions, current violations by severity, pages scanned, new/still-open/fixed counts, findings grouped by WCAG 2.1/2.2 success criterion (severity, page URL, selector, axe help link and how-to-fix guidance), best-practice rules listed separately, and the per-rule trend (new, fixed, still open, totals) versus the baseline or previous scan. With `--scan` it also lists the scope: start URL, page limit, pages that failed, links skipped and why, and the scanner's read-only boundaries. The HTML has inline CSS, no scripts or remote assets, and print CSS (a page break per section, rows kept whole, link URLs printed), so it can be printed to PDF.

Every format always carries this disclaimer, and no flag removes it: *Automated testing only. Not a WCAG audit, certification or legal advice. Automated axe-core checks detect only a subset of accessibility issues. They do not cover all of WCAG or the European Accessibility Act (EAA), and this report is not a claim of full compliance.* A sample built from a scan of the W3C "Before and After" demo is in [`examples/`](../../examples/README.md).

| Option | Meaning |
| --- | --- |
| `--scan <file>` | `a11ygate scan` JSON (kind `site-scan`) to report on, instead of `--current`. |
| `--previous-scan <file>` | An older `a11ygate scan` JSON to compare with. Needs `--scan`. |
| `-f, --format <format>` | `html`, `md`, or `json`. Inferred from the `--out` extension when omitted; defaults to `html`. |
| `-o, --out <file>` | Report path. Omit or use `-` to print it. |
| `--generated-at <iso>` | Fix the timestamp for reproducible output. |
| `--commit <sha>` | Commit to record. Defaults to `GITHUB_SHA`. |
| `--branch <name>` | Branch to record. Defaults to `GITHUB_HEAD_REF`, then `GITHUB_REF_NAME`. |

`report` exits 0 once the report is written, whatever the verdict, and 2 on errors. The same input always gives the same report apart from the timestamp. This command is in the source build only; published 0.1.0 does not include it.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | No new finding is at or above the threshold. |
| 1 | At least one new finding is at or above the threshold. |
| 2 | The arguments or the JSON could not be read. |

## Live-site scan (`a11ygate scan`)

Unreleased source build: published `0.1.0` does not include `scan`. It loads real pages in headless Chromium and runs axe-core with the WCAG 2.0/2.1/2.2 A and AA tags plus `best-practice`.

```bash
npm install --save-dev playwright @axe-core/playwright && npx playwright install chromium
node packages/cli/dist/cli.mjs scan https://staging.example.com/ --crawl 10 --out-dir a11y-scan
node packages/cli/dist/cli.mjs scan https://staging.example.com/pricing --fail-on critical --json scan.json --html scan.html
```

| Option | Meaning |
| --- | --- |
| `--crawl [n]` | Breadth-first crawl of same-origin `a[href]` links, at most `n` pages. Bare `--crawl` and any larger value mean 20, the hard maximum. Without it, only `<url>` is scanned. |
| `--fail-on <impact>` | `minor`, `moderate`, `serious` (default), `critical`, or `none`. |
| `--out-dir <dir>` | Write `a11ygate-scan.json`, `.md` and `.html` into `<dir>`. |
| `--json` / `--markdown` / `--html <file>` | Write individual reports instead. `--json -` prints JSON to stdout; otherwise Markdown is printed. |
| `--delay-ms <ms>` | Pause between page loads. Default 1000. |

`playwright` and `@axe-core/playwright` are optional peer dependencies, loaded only by `scan`. If they are missing, `scan` prints an install hint and exits 2. The gate mode stays dependency-free.

Exit codes: **0** no finding at or above `--fail-on`; **1** at least one is; **2** bad arguments, missing browser or dependencies, a start page that is unreachable or disallowed by robots.txt, or an unwritable output.

The JSON report has `version`, `axeVersion`, `scannedAt`, `startUrl`, `pages[]` (URL, HTTP status, finding counts), `skipped[]` (external, robots, logout, non-HTML, cap), and `findings[]` (page URL, CSS selector(s), axe rule id, impact, mapped WCAG success criteria, help text and `helpUrl`). Its `results` array holds the raw per-page axe results, so the same file is valid `--current` input for the gate, for example `a11ygate --current a11y-scan/a11ygate-scan.json --baseline a11y/baseline.json`. The Markdown and self-contained HTML summaries group findings by WCAG criterion and by severity.

**Boundaries.** Only scan sites you own or are explicitly authorized to test. The scanner is read-only: it does not log in, fill forms or click. It never leaves the start origin. It honours robots.txt `Disallow` for `User-agent: *` and `A11yGate`, and proceeds if robots.txt is unreachable. It skips logout-like and non-HTML links, waits between page loads, and identifies itself with an `A11yGate` User-Agent. This is automated testing only. axe-core finds a subset of WCAG issues, so a PASS is not conformance, certification or legal advice.

## License

MIT. See [LICENSE](LICENSE).
