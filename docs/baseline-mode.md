# Fingerprint baseline mode

Legacy findings can remain in reports while CI gates new findings at the selected
impact threshold. Use local fixtures or sites you own or are authorized to test.

```sh
# Scan once, then accept the recorded findings as existing debt.
a11ygate scan http://localhost:3000 --out-dir scan
a11ygate baseline create scan
# Creates .a11ygate-baseline.json in the current directory.

# Later scans fail only for new findings at or above --fail-on (default serious).
a11ygate scan http://localhost:3000 --baseline .a11ygate-baseline.json \
  --out-dir next-scan --format junit,sarif

# Compare and export saved evidence without a browser or network.
a11ygate report next-scan --baseline .a11ygate-baseline.json \
  --out-dir reports --format junit,sarif
```

The initial scan can exit 1 because its findings have not yet been accepted.
`baseline create` reads the saved JSON independently of that exit code. Inputs
may be a scan JSON file, an output directory, `--from <file>`, or `--out-dir <dir>`.
With no input it reads `./a11ygate-scan.json`. `--output <file>` changes the output
name. Creation refuses incomplete/error reports and existing output files. To
review a replacement, create it under a new name, inspect its diff, and replace
the accepted baseline explicitly.

## Two separate formats

- `a11ygate [ci] --baseline <axe.json>` retains its existing axe-core document
  comparison and Action behavior. Its flags and baseline format are unchanged.
- `a11ygate scan --baseline <file>` and `a11ygate report --baseline <file>` require
  `kind: "a11ygate-fingerprint-baseline"` and `schemaVersion: 1`. Axe JSON and
  unsupported versions are rejected. The new file is not input to the axe gate.

Without a fingerprint baseline, scan JSON, Markdown, HTML, JUnit and SARIF retain
their previous serialization. Existing golden files are unchanged.

## Identity and reporting

Fingerprints use the normalized page URL and R12 locator normalization. Merged
multi-engine findings use the canonical DOM element key and success criterion;
unmapped findings retain engine/rule identity. Axe-only reports retain rule and
mapped criterion identity, with the ordered locator chain normalized. HTML
snippets, DOM attribute order, timestamps, engine versions, severity and help
text are excluded from identity. One merged R12 finding produces one baseline
entry, regardless of the number of confirming engines. Keep engine selections
and scan scope consistent when comparing runs. Findings without a usable locator
retain an occurrence index, conservatively treating shifts in their order as new.

JSON, Markdown and HTML show new, existing, fixed and unassessed counts. Only new
findings participate in the impact gate. A missing baseline entry is fixed only
when its page was successfully scanned and the baseline engines remain covered.
Unvisited/failed pages, reduced engine coverage and engine errors leave missing
entries unassessed. Baseline engine errors continue to exit 2. Fingerprint mode
tracks identity rather than changes in severity on an existing finding.

JUnit cases with only existing findings pass. If the same page/rule has new and
existing instances, the case fails with only the new instances in its failure
body. Baseline counts are included in suite properties.

SARIF includes `baselineState: "new"` or `"unchanged"`. Existing results retain
severity and receive an accepted external suppression, recording accepted debt
without claiming the underlying rule passed. New results are unsuppressed.
Fixed/unassessed totals are run properties; absent findings are not emitted as
current results. These meanings follow [SARIF 2.1.0 §3.27.24 (baselineState) and
§3.35 (suppression)](https://docs.oasis-open.org/sarif/sarif/v2.1.0/os/sarif-v2.1.0-os.html).

Automated testing only. Not a WCAG audit, certification or legal advice.
