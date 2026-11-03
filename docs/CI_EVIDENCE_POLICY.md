# Accessibility regression evidence (unreleased source build)

This increment is not in published `@qe-atlas/a11ygate@0.1.0` or Action `v1.0.1`. Review the pinned source builds; no package/tag release or main merge is implied. The browser, CLI and bundled CLI reuse the existing parser, fingerprinting and diff engine through `compareScans`. Native JSON is v2; shared qe-result v1 is unchanged.

## What the gate means

- PASS: no **detected new** finding reaches the selected threshold. Existing findings, lower-severity new findings, manual failures and unassessed scope remain visible. This is neither legal advice nor certification.
- FAIL / exit 1: a known new threshold finding. This dominates simultaneous coverage gaps; missing coverage never hides the known failure.
- INCOMPLETE / exit 2: missing baseline pages, failed scans, duplicate page evidence, or material recorded configuration differences prevent a regression PASS. Invalid inputs/unsafe paths also exit 2, without a valid native result. The Action emits a shared ERROR, never reuses old PASS artifacts.
- Shared PASS/FAIL preserve those bounded native outcomes. Manual scope limitations do not become execution errors; coverage/debt/manual counts and full native detail remain visible.

## Coverage is evidence, not a census

Comparison includes normalized page path **plus query/hash state**, axe engine version, `toolOptions`, caller-provided `scanConfig` and `testEnvironment`. Origins are intentionally ignored for equivalent local CI hosts; the caller must establish equivalent environments. Multiple results for one path/query/hash are ambiguous: compare states separately or encode distinct states in URLs. Configuration object key ordering is irrelevant; array ordering is conservatively significant.

Record scan inclusion/exclusion context, disabled/rule/tag options, viewport, locale and authentication/feature state in `scanConfig` when the collector knows them. Capture failures as a normal result with `scanStatus: "failed"`, nonempty `scanError`, URL, timestamp, engine and violations array. Do not replace a failed scan with a fabricated clean result. Error text alongside absent/complete status is rejected as contradictory. Unobserved pages that never appeared in the baseline remain undiscoverable; this tool cannot prove the collector actually ran axe.

`coverage.status: complete` means the supplied page/state records and **recorded** configuration compare, not that all pages, interactions, rules, exclusion context or WCAG requirements were assessed. If both legacy inputs omit configuration, the result is explicitly **unverified**, with warnings, rather than an equivalence claim. Legacy missing metadata is nonblocking for backward compatibility. A caller requiring strict evidence must collect and review the full context. Recorded differences or metadata present on only one side block affected comparisons.

A previous finding is never fixed merely because its page is missing, failed or incomparable. It becomes `unassessed`. A changed selector with another occurrence of the same rule/page remains an unverified resolution, not a confirmed fix; normalized dynamic-selector matches remain open. Fingerprint matching is heuristic and can collapse generated-ID/nth-child occurrences; it is not verified element identity or a complete occurrence count. `fixed` means not reobserved within the comparable supplied scope, not a human-verified remediation. axe `incomplete` evidence remains needs-review and is never a confirmed fix for that rule.

## Actionable details and baseline acceptance

Each finding includes the affected selector and escaped HTML, observed impact, contextual user-impact explanation, rule-based remediation and concrete automated/manual verification steps. Guidance is not a diagnosis or a verified repair; unknown rules get explicit contextual-review guidance.

The browser displays every finding a proposed baseline would accept, including fingerprints, rule, impact, URL, element and newly accepted versus retained debt. Download the acceptance review alongside the proposed raw baseline. Coverage loss blocks baseline export. The CLI's explicit `--update-baseline proposed.json` writes `proposed.json.review.json` **before** the proposal; it does not change the current gate result. Review both files in a separate PR; no CI job commits or approves them. The Action requires distinct proposal/input paths. Symlink/hardlink collisions and dangling symlinks are rejected before mutation. These guards assume a trusted local filesystem, not protection against concurrent hostile filesystem substitution. A crash may leave a review sidecar without a proposal; do not approve an incomplete pair.

## Structured manual evidence

Use the local form or `--manual-evidence manual.json` / Action `manual-evidence`:

```json
{"schemaVersion":1,"checks":[{"id":"keyboard-checkout","scope":"/checkout; desktop; signed out","check":"Keyboard traversal","reviewer":"Example reviewer","date":"2026-11-03","status":"not-assessed","notes":"Example template only; no human review performed."}]}
```

Statuses are `passed`, `failed`, `not-assessed`. IDs are unique; reviewer, real calendar date, scope, check and notes are required and bounded. Empty, invalid or invented statuses are not passes. Records are self-reported and editable, not signed, identity-verified, automatically scoped or freshness-verified. They are separate from axe findings and never improve its gate. A human failure does not disappear merely because the automated regression gate passes. The browser keeps records only in this tab's session storage and explicit downloads; new current imports clear old manual records to avoid silently carrying them into a different scan. No new upload/backend/telemetry is introduced. Review HTML snippets, URLs and reviewer notes for sensitive data before intentionally publishing CI artifacts/comments.

## Proposed metrics — no customer measurements

- Installation success: first valid report/artifact and intended comment-or-fork fallback per attempted installation; count permission/setup/input failures separately. Denominator and attempts must be recorded, not inferred from a green proof job.
- Remediation time: first actionable triage to verified absence under comparable scope, plus relevant human verification; report median/distribution only after recording real events. Baseline acceptance is not remediation.
- Misleading-result reports: reported false fixes, lost coverage, false clearance/certification impressions or incorrect guidance; record confirmed/unconfirmed reports, severity, resolution and denominator where known. No reports collected means unmeasured, not 0%.

The qe-dogfood examples are explicitly hypothetical mutations of frozen synthetic-app scan evidence, not fresh scans, user research or customer improvements. Original baseline bytes, application/A-B intent and assertions remain unchanged. Existing dependency audit: 16 moderate advisories; this increment is not a dependency remediation or production qualification.
