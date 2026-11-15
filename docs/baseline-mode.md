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

## Review decisions for likely shared component groups

When one likely shared component (for example a navigation link) produces the
same finding on many pages, a reviewer can record one decision for the group
instead of one per finding. Groups are heuristic: review the examples first.

```sh
# List likely shared component groups and any current decisions.
a11ygate review next-scan --baseline .a11ygate-baseline.json --list

# Record a decision for one group (ids come from --list).
a11ygate review next-scan --baseline .a11ygate-baseline.json \
  --group g-0123456789abcdef --decision accepted-risk \
  --reason "Vendor widget; tracked in TICKET-12" --expires 2027-03-31

# In a terminal, omit --list/--group to step through groups interactively.
# [r] removes a group's existing decision; Ctrl+C quits without writing anything.
# Without a terminal (CI, piped stdin) this form exits 2 and asks for --list or --group.
a11ygate review next-scan --baseline .a11ygate-baseline.json
```

- `to-fix` records intent only; findings still gate.
- `accepted-risk` needs `--reason`; `--expires` is optional and inclusive.
  After that day the decision is shown as expired and findings gate again.
- `false-positive` needs `--reason`.

Decisions are stored under `groupDecisions` in the fingerprint baseline, keyed by
the component group key, with the reviewer taken from `git config user.name` (the
command refuses to run without one) and the date. Membership is recomputed on
every `scan --baseline` / `report --baseline`, so a new page that matches the
group inherits its decision. No decision hides a finding: decided findings stay
in the standard sections, are marked `[review: …]`, and are listed again under
"Review decisions" with the reason, reviewer and date. A decision is a reviewer
judgement, not a root cause, a fix or conformance evidence. SARIF retains accepted-risk and false-positive findings with an accepted external
suppression whose justification is the review reason. JUnit exports them as skipped
cases with `message="<decision>: <reason>"`; mixed rule/page groups are split so
undecided failures remain visible. GitLab excludes those findings from the main
Code Quality report and records their finding and decision metadata in
`codequality-decided.json` alongside it (created only when active exclusions exist).
To-fix and expired decisions remain normal findings in all three formats.
Existing fingerprint-baseline behavior is unchanged.
Baselines without `groupDecisions` produce unchanged output.

### Listing, removing and pruning decisions

```sh
# List decisions; filter by kind and/or expiry; --json for machine output.
a11ygate review list --baseline .a11ygate-baseline.json [--status accepted-risk] [--expired] [--json]

# Remove one decision (group id from review list), or every expired accepted-risk one.
a11ygate review remove g-0123456789abcdef --baseline .a11ygate-baseline.json --yes
a11ygate review remove --all-expired --baseline .a11ygate-baseline.json --yes

# Remove decisions whose group has no finding in the latest scan. Check first with --dry-run.
a11ygate review prune latest-scan --baseline .a11ygate-baseline.json --dry-run
a11ygate review prune latest-scan --baseline .a11ygate-baseline.json
```

`remove` needs `--yes`, or a "y" at the confirmation prompt in a terminal.
`prune` warns when some pages in the scan did not complete, because decisions
for components only on those pages would also be pruned; use `--dry-run` first.
Every change to the baseline (record, remove, prune) is written to a temp file in
the same directory and renamed over the baseline, so a failed write leaves the
previous file intact. Each change appends an entry to `history[]` in the baseline
with `action` (`record`, `remove` or `prune`), `by` (`git config user.name`, or
`"unknown"` for remove/prune when it is not set), `at` (ISO timestamp), `group`,
the new `decision` (record) and the replaced or removed `previous` decision.
Existing entries are copied unchanged; A11yGate only appends. Baselines without
`history` still load.
