# Trend report (`a11ygate trend`)

Unreleased source build. `a11ygate trend <dir>` reads every evidence pack in `<dir>` and writes a history of automated findings across runs:

- `a11ygate-trend.json`: machine-readable (`kind: "trend-report"`, `schemaVersion: 1`).
- `a11ygate-trend.html`: one self-contained page with an inline SVG chart, a table with the same numbers, no scripts and no external resources (`Content-Security-Policy: default-src 'none'`).

```bash
a11ygate evidence pack --from scan-2026-09 --out packs/2026-09.zip --commit <sha>
a11ygate evidence pack --from scan-2026-10 --out packs/2026-10.zip --commit <sha>
a11ygate trend packs --out-dir trend
```

## Inputs

- `*.zip` files produced by `a11ygate evidence pack`, or extracted pack directories that contain `manifest.json` and `scan/a11ygate-scan.json`.
- Each pack's `scan/a11ygate-scan.json` must match the SHA-256 recorded in its `manifest.json`. Packs that fail this check, and zips that are not evidence packs, are skipped with a message on stderr.
- Exit 2 if no usable pack is found or an output cannot be written.

## Ordering

Runs are ordered oldest first by `manifest.timestamps.scannedAt` (UTC), falling back to `packedAt`, then commit SHA, then file name. File names and the order on disk do not matter. The manifest records when the scan ran for a commit, not the git commit date; scan each commit when it is built if you need the two to match.

## Counting

Counting reuses the fingerprint baseline from [baseline mode](baseline-mode.md):

| Field | Meaning |
| --- | --- |
| `total` | Findings in the run after fingerprint dedupe (same as the number of entries `a11ygate baseline create` would write). |
| `new` | Fingerprints not present in the previous run. Every finding in the first run is new. |
| `existing` | Fingerprints also present in the previous run. `new + existing = total`. |
| `fixed` | Previous-run fingerprints not detected now, on a page this run scanned completely with the same engines and no engine errors. |
| `unassessed` | Previous-run fingerprints not detected now on a page that was not scanned completely, or when engines differ or errored. Absence is not evidence of a fix. |

- **Top rules over time**: findings per rule per run, top 10 by total across all runs.
- **Pages with the most regressions**: new findings per page compared with the previous run (the first run is excluded), top 10.

Fixed means a finding was not detected again; it is not proof the issue is resolved. Automated rules detect a subset of accessibility barriers; see [what A11yGate does not do](what-a11ygate-does-not-do.md).

## Tests

`tests/trend.test.ts` builds three evidence packs through the real scan and pack code (offline fake engine), then checks hand-computed per-run counts, cross-checks each total against the deduped fingerprint baseline, checks ordering by manifest timestamp, blocks all network access while the command runs, and, when Chromium is installed, scans the HTML with axe-core in light and dark color schemes.

Automated testing only. Not a WCAG audit, certification or legal advice.
