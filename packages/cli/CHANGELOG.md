# Changelog

All notable changes to `@qe-atlas/a11ygate` are recorded here.

Version **0.2.0** is the current package version on `main`. It is intended for the npm `next` tag only. The npm `latest` tag remains **0.1.0** until a separate approval.

Automated testing only. Not a WCAG audit, certification or legal advice.

## [Unreleased]

### Added

- `schema/a11ygate.schema.json` describes `.a11ygate.yml` (url, crawl, failOn, engines, modelFixes, baseline, formats, outDir, delayMs, reportVersion, auth). `a11ygate config validate [file]` and a new `doctor` config check report plain-English errors such as "unknown key 'engine' — did you mean 'engines'?". `a11ygate init` adds a `# yaml-language-server: $schema=` line for editor autocomplete (A11Y-R31).

### Changed

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
