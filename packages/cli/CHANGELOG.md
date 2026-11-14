# Changelog

All notable changes to `@qe-atlas/a11ygate` are recorded here.

Version **0.2.0** is the current package version on `main`. It is intended for the npm `next` tag only. The npm `latest` tag remains **0.1.0** until a separate approval.

Automated testing only. Not a WCAG audit, certification or legal advice.

## [Unreleased]

### Added

- `a11ygate ci --projects <file>` runs isolated live-scan configs sequentially or with `--parallel 1–8`, writes per-project outputs and combined JSON/Markdown/HTML/JUnit summaries, and returns the worst project exit code. Startup errors do not stop other projects. Projects schema and `config validate --projects` diagnostics are included; single-project output stays unchanged (A11Y-R56).
- Opt-in masked viewport screenshots (`--screenshots`), default and custom `redact.selectors` overlays, and `--no-screenshots` capture/evidence exclusion. Doctor recommends disabling screenshots for auth scans (A11Y-R50).

- Explicit `auth.check` probe URL, required/forbidden selectors and forbidden redirect destination replace heuristic login detection when configured. Failed checks skip engines, mark pages not authenticated and count them separately; `doctor` warns when auth has no check. Default heuristic scans and report goldens are unchanged (A11Y-R52).

- `a11ygate scan --en301549-ref` adds an opt-in "EN 301 549 ref." column, labelled "Reference mapping only; does not indicate conformance.", to HTML report v2 and SARIF rule properties; the web app adds a CSV export with the same column. The mapping table cites ETSI EN 301 549 V3.2.1 clause 9. Default off; output without the flag is unchanged (A11Y-R59).
- `a11ygate evidence pack` records `commit.committedAt` (from `git log -1 --format=%cI`) and `commit.branch` (when the commit is the checked-out branch HEAD) in `manifest.json` when run inside a git work tree; nothing is recorded otherwise. `a11ygate trend` orders runs by commit time when every pack records it, otherwise by scan time with a visible note, and takes `--order scan|commit`. Packs made before this change still load (A11Y-R48).
- `--debug` (or `A11YGATE_DEBUG=1`) on any command prints the stack trace (and cause chain) of an unexpected error and of input/setup errors that commands report themselves, such as a malformed `--storage-state`, baseline or interactions file; by default only the message is shown (A11Y-R61).
- `a11ygate review <scan> --baseline <file>` records one reviewer decision per likely shared component group: `to-fix`, `accepted-risk` (reason required, optional `--expires YYYY-MM-DD`) or `false-positive` (reason required). Non-interactive flags (`--list`, `--group`, `--decision`, `--reason`, `--expires`) or an interactive TTY prompt. Decisions are stored under `groupDecisions` in the fingerprint baseline with the reviewer from `git config user.name` and the date. Matching findings on new pages inherit the decision; expired accepted-risk decisions gate again. Decided findings stay listed and get a "Review decisions" report section. Baselines without decisions produce unchanged output (A11Y-R39).
- `a11ygate scan --recycle-every <n>` (config `recycleEvery`) opens a fresh browser context every n pages; retired contexts close only after their in-flight pages finish. Opt-in: without it the scan keeps one context, as before. `npm run bench` (not part of `npm test` or CI) records peak RSS, pages per minute and failures against a generated loopback fixture; recorded results and the sizing table are in `docs/perf/` (A11Y-R38).
- `schema/a11ygate.schema.json` describes `.a11ygate.yml` (url, crawl, failOn, engines, modelFixes, baseline, formats, outDir, delayMs, reportVersion, auth). `a11ygate config validate [file]` and a new `doctor` config check report plain-English errors such as "unknown key 'engine' — did you mean 'engines'?". `a11ygate init` adds a `# yaml-language-server: $schema=` line for editor autocomplete (A11Y-R31).

### Fixed

- Malformed input hardening, found by new fast-check property tests (A11Y-R61): `.a11ygate.yml` refuses a `__proto__` key (it previously changed the parsed object's prototype, so nested values skipped validation); evidence-pack zip reading bounds-checks every offset (corrupt zips raised a raw `RangeError`), refuses zip-slip names, duplicate, encrypted and ZIP64 entries, and rejects entries declaring more than 64 MB before inflating; `a11ygate trend` skips packs whose manifest or scan report has wrong field types instead of crashing; baseline, interactions, `--storage-state` and `--session-storage` errors now name the file and the field; `--storage-state` cookies are checked for a string `url` or `domain`/`path` pair, numeric `expires`, boolean `httpOnly`/`secure` and `sameSite` of Strict/Lax/None before the browser starts (previously Playwright rejected them later with a generic message) (for example `findings[0].selector`) without echoing values; `a11ygate review` writes the baseline via a temp file and rename. Every malformed-input error now names the file and the field: evidence-pack manifests (`commit.sha`, `files[i].sha256`, `timestamps.scannedAt`, …) and scan reports (`counts.pagesScanned`, `findings[i].wcag`, …) in `a11ygate trend`, `.a11ygate.yml` (line and key), the interactions file (`interactions[i].route`, `steps[j].key`, …; `--interactions <file>` no longer hides the reason) and top-level shape errors in the baseline and storage files. A scan report with a `null` WCAG entry no longer crashes fingerprinting with a `TypeError`.

### Changed

- Review decisions now reach SARIF (accepted external suppressions), JUnit (skipped cases), and GitLab Code Quality (active exclusions recorded in `codequality-decided.json`). To-fix and expired decisions remain normal findings; exports without decisions retain their existing bytes (A11Y-R43).
- WCAG 2.2-only success criteria (2.4.11, 2.5.7, 2.5.8, 3.2.6, 3.3.7, 3.3.8) no longer get a guessed EN 301 549 clause such as `9.2.5.8`. They now read "not in EN 301 549 V3.2.1" in standards labels and `en301549: null` in scan JSON (A11Y-R59).
- Lighthouse snapshots now use a process-wide mutex to avoid shared timing-mark collisions at scan concurrency greater than 1. Other engines and page loading keep their existing concurrency; scans selecting Lighthouse log `lighthouse serialized` once (A11Y-R47).

- `a11ygate scan` HTML report v2 is the default: executive summary (pages, totals, new vs baseline, engines used/errored), top 10 fixes ordered by impact × pages affected, findings grouped by WCAG success criterion and by page, per-rule how-to-fix with links taken only from the finding's engine help URL and the W3C Understanding table in `lib/mapping.ts`, a "what automated testing does not cover" section, print CSS and a contrast-tested dark scheme. `--report-version 1` emits the previous HTML byte-for-byte (A11Y-R28).

## [0.2.0] — 2026-11-14 (npm `next` only; `latest` unchanged)

### Added

- `a11ygate scan`: live-site scan with a same-origin crawl (hard cap 20 pages). Optional peers: `playwright` and `@axe-core/playwright`. Not present in published 0.1.0 (scan work, #12).
- `--format` / `--out-dir` on `ci` and `scan`: JUnit XML (Jenkins) and SARIF 2.1.0 (GitHub code scanning), plus JSON/Markdown (A11Y-R7, #18).
- SARIF output honours GitHub code scanning limits, emits a stable `partialFingerprints.primaryLocationLineHash`, sets `automationDetails.id` per engine (`a11ygate/<engine>/`), and rewrites page URLs to repo-relative artifact paths so `upload-sarif` is accepted (A11Y-R15, #29). Example workflow: `examples/github-code-scanning/sarif.yml`.
- Jenkins shared library step and example `Jenkinsfile`s, plus an integration guide (A11Y-R8/R9, #20/#23). A real Dockerized Jenkins acceptance job now runs in CI (A11Y-R16, #30).
- Opt-in scan engines (HTML_CodeSniffer, IBM Equal Access, Lighthouse) behind `--engines`. Default remains axe only (A11Y-R10/R11, #17/#22). Cross-engine dedupe and attribution in reports (A11Y-R12, #25).
- Optional, default-off model-assisted fix drafts (A11Y-R1–R6, #19/#21/#24/#26/#27/#28): orchestrator with exact F1 fallback, strict draft validator, isolated verifier, draft-only publisher, free-tier provider adapters (Groq, Gemini, Cloudflare), Action wiring. Requires explicit opt-in. CI uses stubs only. No API keys are shipped in the package.
- Manual, secret-gated live provider smoke workflow (`workflow_dispatch` only). Secrets are not in the package; do not add keys unattended (A11Y-R17, #33).
- Coverage-aware regression evidence and reviewable findings in the gate reports (#6).
- Rule-based GitHub suggested changes for a small set of common axe findings (F1, #15).
- GitHub Action setup requirements: required permissions, PR head-SHA checkout, fork limits, and the "Allow GitHub Actions to create and approve pull requests" setting for draft fix PRs (A11Y-R13, #31).
- `a11ygate doctor`: preflight checks (checkout SHA, permissions, Chromium, Node, optional engine peers, model-fix config). Does not fail a build unless `--strict` (A11Y-R14, #36).
- Fingerprint baselines: `a11ygate baseline create` and `scan`/`report --baseline` so a legacy site can fail only on new findings. The existing `a11ygate [ci] --baseline <axe.json>` format is unchanged (A11Y-R18, #35).
- `a11ygate init`: writes `.a11ygate.yml` and a GitHub Actions workflow or Jenkinsfile (`--yes` for non-interactive use). Does not overwrite existing files without `--force` (A11Y-R19, #37).
- `a11ygate evidence pack`: one zip per scan (HTML/MD, SARIF, JUnit, raw engine JSON, screenshots if present, and a SHA-256 manifest). The front page states what automated testing cannot cover, plus the disclaimer (A11Y-R20, #34).

### Changed

- CLI README documents the new subcommands, formats, Jenkins, GitHub code scanning, and optional engines. Gate usage (`a11ygate ci` / default command) is unchanged: it still fails only on **new** findings at or above the impact threshold when using axe JSON baselines.
- Optional engine peer dependencies are declared as optional peers. An axe-only / gate-only install does not need them.
- `a11ygate --help` no longer calls this a source-only unreleased build. JSON and evidence-pack manifests use `releaseStatus: "released"` instead of `"unreleased-source-build"`.

### Upgrade notes (from published 0.1.0)

See [upgrade notes](../../docs/releases/0.2.0-upgrade-notes.md). In short: existing `a11ygate --current … --baseline …` invocations keep working. New subcommands and flags are additive. `scan` and extra engines need their optional peers. Model-fix features stay off unless enabled. Node.js `>=20` is unchanged.

## [0.1.0] — 2026-11-01

First public npm release of the accessibility regression gate for axe-core JSON (`a11ygate ci` / default command). Packed size at publish was 10.6 kB (36.3 kB unpacked).
