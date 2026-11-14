# Changelog

All notable changes to `@qe-atlas/a11ygate` are recorded here.

The published npm version remains **0.1.0** until Eliran approves a bump and a publish through the autonomy-spec §6 gate. Entries under "Proposed 0.2.0" describe `main` as of 2026-11-14 09:53 Asia/Jerusalem (`f5dddce`).

Automated testing only. Not a WCAG audit, certification or legal advice.

## [Unreleased]

Nothing beyond the proposed 0.2.0 set below. The following agreed batch-2 tasks are **not yet on main** and are therefore not part of this proposal:

- A11Y-R14 `a11ygate doctor`
- A11Y-R16 real Dockerized Jenkins run in CI (open: https://github.com/DaveEliranAssistant/a11ygate/pull/30)
- A11Y-R17 live provider smoke workflow
- A11Y-R18 baseline mode (`a11ygate baseline` / fail only on new violations)
- A11Y-R19 `a11ygate init`
- A11Y-R20 evidence pack export

## [0.2.0] — proposed (not published)

Proposed npm version: **0.2.0**, to be published to the `next` tag only after the §6 gate is signed and Eliran authenticates npm. `package.json` `version` is still 0.1.0 in this repository.

### Added

- `a11ygate scan`: live-site scan with a same-origin crawl (hard cap 20 pages). Optional peers: `playwright` and `@axe-core/playwright`. Not present in published 0.1.0 (A11Y scan work, #12).
- `--format` / `--out-dir` on `ci` and `scan`: JUnit XML (Jenkins) and SARIF 2.1.0 (GitHub code scanning), plus JSON/Markdown (A11Y-R7, #18).
- SARIF output honours GitHub code scanning limits, emits a stable `partialFingerprints.primaryLocationLineHash`, sets `automationDetails.id` per engine (`a11ygate/<engine>/`), and rewrites page URLs to repo-relative artifact paths so `upload-sarif` is accepted (A11Y-R15, #29). Example workflow: `examples/github-code-scanning/sarif.yml`.
- Jenkins shared library step and example `Jenkinsfile`s, plus an integration guide (A11Y-R8/R9, #20/#23).
- Opt-in scan engines (HTML_CodeSniffer, IBM Equal Access, Lighthouse) behind `--engines`. Default remains axe only (A11Y-R10/R11, #17/#22). Cross-engine dedupe and attribution in reports (A11Y-R12, #25).
- Optional, default-off model-assisted fix drafts (A11Y-R1–R6, #19/#21/#24/#26/#27/#28): orchestrator with exact F1 fallback, strict draft validator, isolated verifier, draft-only publisher, free-tier provider adapters (Groq, Gemini, Cloudflare), Action wiring. Requires explicit opt-in. CI uses stubs only. No API keys are shipped in the package.
- Coverage-aware regression evidence and reviewable findings in the gate reports (#6).
- Rule-based GitHub suggested changes for a small set of common axe findings (F1, #15).
- GitHub Action setup requirements: required permissions, PR head-SHA checkout, fork limits, and the "Allow GitHub Actions to create and approve pull requests" setting for draft fix PRs (A11Y-R13, #31).

### Changed

- CLI README documents scan, formats, Jenkins, GitHub code scanning, and optional engines. Gate usage (`a11ygate ci` / default command) is unchanged: it still fails only on **new** findings at or above the impact threshold.
- Optional engine peer dependencies are declared as optional peers. An axe-only / gate-only install does not need them.

### Upgrade notes (from published 0.1.0)

See [upgrade notes](../../docs/releases/0.2.0-upgrade-notes.md). In short: existing `a11ygate --current … --baseline …` invocations keep working. New subcommands and flags are additive. `scan` and extra engines need their optional peers. Model-fix features stay off unless enabled. Node.js `>=20` is unchanged.

## [0.1.0] — 2026-11-01

First public npm release of the accessibility regression gate for axe-core JSON (`a11ygate ci` / default command). Packed size at publish was 10.6 kB (36.3 kB unpacked).
