# a11ygate

Command-line accessibility regression gate for [axe-core](https://github.com/dequelabs/axe-core) JSON. It uses the same diff and gate as the [A11yGate](https://a11ygate.vercel.app) web app: a run fails only when a **new** finding is at or above the impact threshold.

This package is not published to npm yet. The license is **TBD** until the repository owner chooses one. `npm publish` is blocked on purpose.

## Usage

```bash
npx a11ygate --current axe.json --baseline a11y/baseline.json
```

From a checkout of this repository, after `npm install`:

```bash
npx a11ygate --help
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

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | No new finding is at or above the threshold. |
| 1 | At least one new finding is at or above the threshold. |
| 2 | The arguments or the JSON could not be read. |

## License

TBD. See `LICENSE`. Do not publish until the owner replaces `UNLICENSED` and removes the `prepublishOnly` guard in `package.json`.
