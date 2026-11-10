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
```

`a11ygate report` takes `--current`, `--baseline`, and `--threshold`, and writes a self-contained HTML (default), Markdown, or JSON report: scan date, commit and branch, tool versions, pages scanned, new/baselined/fixed counts, violations grouped by axe rule with impact and mapped WCAG 2.x success criteria, and the trend versus the baseline. It always carries the disclaimer *Automated checks only (axe-core). Not a WCAG conformance audit, certification, or legal advice. Automated tools detect a subset of accessibility issues.*

| Option | Meaning |
| --- | --- |
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

## License

MIT. See [LICENSE](LICENSE).
