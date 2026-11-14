> Design draft — not a commitment to ship, not customer-facing, and not a compliance claim.

# Model-written fix PRs (A11Y-F2)

## 1. Goal and non-goals

Design an optional AI-assisted path that drafts small source patches for contrast, ARIA, and alt-text findings, verifies them with an axe re-scan, and presents them for human approval. A successful re-scan establishes only that the observed automated findings changed under the tested conditions. It does not establish that wording, semantics, interaction, or visual design is correct.

Neither the scanner nor the model fixes everything. This feature does not provide WCAG or EAA compliance, certification, legal assurance, or a substitute for manual accessibility testing. Broad refactors, dependency changes, autonomous merging, generating missing product requirements, and guessing an image's meaning from its filename are outside scope. This document implements no provider integration or product behavior.

## 2. Architecture and relationship to A11Y-F1

The intended flow is:

```text
axe finding at pinned source commit
  → F1 deterministic suggestion planner (default, no model)
  → optional model draft for eligible findings
  → validate patch and apply in isolated working tree
  → build/render and re-scan with the same axe rules
  → verified candidate: draft fix PR or labelled review suggestion
  → human review, any corrections, checks, human merge
```

A11Y-F1 is the rule-based GitHub suggested-changes path, in development. The checkout already contains its planner/comment plumbing in `lib/fix`, `action/suggestions.mjs`, and `action/README.md`. F1 remains the default no-model path, with its existing eligibility, diff-line mapping, placeholder warnings, and comment deduplication. F2 must not relabel an F1 suggestion as model-generated or imply F1 already applies and re-scans patches.

The orchestrator records rule ID, finding fingerprint, route and UI state, source commit, file/range, and mapping evidence. Only a unique mapping to allowed source files is eligible. Existing F1 suggestions take precedence; an optional model draft may address an eligible finding for which F1 has no adequate deterministic patch. Avoid two competing suggestions for the same finding.

A provider adapter receives a bounded, sanitized request and returns structured data: finding ID, source blob hash, allowed file/range, exact original text, replacement text, rationale, and human-review requirements. Treat all output as untrusted. Validate the schema, path, size, scope, original text, and commit before applying. Reject extra files, traversal, symlink escapes, executable payloads, scanner configuration changes, and attempts to suppress checks. Never execute model output as shell commands.

Apply each candidate independently in a disposable working tree pinned to the scanned commit, without fuzzy patch matching. A sandboxed runner builds and renders the changed tree; it must not re-scan an unchanged production deployment. A remote URL report without reproducible source mapping and a local/isolated preview cannot produce a model fix. The final combined PR diff must pass verification again if candidates are combined.

A separate publisher receives only verified diffs and sanitized evidence. It can open a draft PR, or post an explicitly labelled model review suggestion on an existing PR when draft-PR creation is unavailable or review-comment mode is selected. Both model output channels require verification. A failure/status comment may explain why drafting was skipped but must contain no rejected model patch or replacement text. Deduplicate by source commit and finding; discard stale candidates when the head changes.

### Draft schema and validator (A11Y-R2)

`lib/modelfix/validate.ts` implements the checks above. A draft (`ModelDraft`, `lib/modelfix/types.ts`) names exactly one file and one range, the ones in the request: `findingId` (fingerprint), `sourceBlobHash`, `path`, `startLine`/`endLine`, exact `original` lines, `replacement` lines, `rationale` and `humanReview` flags. Unknown fields are rejected; multi-file fields (`files`, `edits`, `diff`, …) are rejected as extra files.

- **Source blob hash:** the Git blob SHA-1 of the whole file (`git hash-object`, GitHub contents API `sha`). The draft, the request and the file content must all agree.
- **Size caps (`DRAFT_LIMITS`):** replacement ≤ 4096 UTF-8 bytes, ≤ 40 lines, ≤ 5 lines more than the original range, ≤ 1000 characters per line; rationale ≤ 1000 characters.
- **Rejected:** schema errors, another finding, any path other than the request path, `..`/absolute/backslash/null-byte/encoded paths, symlinks resolving outside the repository root (when a root is given), scanner/CI/gate/tooling config (`.a11ygate.yml`, axe/Lighthouse/pa11y config, `.github/**`, `action.yml`, `package.json`, lockfiles, test-runner and lint config), test files, range/original/blob mismatches, oversize, empty or no-op replacements, added suppressions (ignore/disable comments, `data-axe-*`, `aria-hidden`, `role="presentation|none"`, `alt=""`, `hidden`, `display:none`, …) and added executable content (scripts, event handlers, `javascript:` URLs).
- **Review flags:** the validator adds the flags it detects, whatever the adapter declared. New alt/accessible-name text or changed visible text that is not a `TODO(a11ygate)` placeholder gets `generated-accessible-name`; placeholders get `placeholder-accessible-name`. Both require tracked human acknowledgement (§7). Every validated draft still needs human review.

The validator never runs a shell and only reads file metadata for the symlink check. A rejected draft is recorded by rejection code only; its content is not applied, published or logged. The orchestrator validates every draft. Without a verifier, valid drafts are discarded too; with one (R3, see §5), they are applied in isolation and re-scanned, and only the outcome is recorded. The `stubAdapter` returns placeholder-only drafts for tests and is never a built-in adapter.

## 3. Exact no-model fallback (hard requirement)

With models disabled, no eligible provider configured, all providers failing, exhausted budgets, or no verified candidate:

1. Make no further model requests; with models disabled or none configured, make zero provider requests from the start. No provider SDK, credentials, or model dependency is required to run F1.
2. Discard temporary model patches and working trees. Do not commit model output, open a model fix PR, or publish unverified model suggestions.
3. Run the existing F1 planner against the original scan and source commit. Publish only F1-style rule-based suggestions when the existing comment/suggestion settings and permissions permit. Preserve F1 TODO markers; do not invent text to replace a failed model draft.
4. Findings unsupported or unmappable in F1 remain in the ordinary report/summary with no suggested change. If comments are disabled or posting fails, retain the report and issue a sanitized warning.
5. Keep the original accessibility gate result and exit-code semantics. Provider availability neither makes a failing scan pass nor turns an otherwise passing gate into a provider error. Actual scan/input failures retain their normal failure behavior.

Fallback is per finding when some candidates succeed, and applies to the whole run when none succeeds. Do not duplicate an already published F1 suggestion. The report may say “model drafting skipped: quota exhausted” without exposing request content or claiming a fix.

## 4. Provider order, configuration, and guardrails

Proposed order: **Groq → Gemini → Cloudflare Workers AI → explicitly configured paid fallbacks**. Skip missing credentials, unsupported models, unavailable regions, unapproved data terms, and open circuit breakers. This order is a proposal, not a quality or availability guarantee. A key alone does not prove that requests are free.

Read-only public documentation fetched on **2026-11-13**:

| Provider | Sourced observation | Limits/prices not established here |
| --- | --- | --- |
| Groq | The [official rate-limit documentation](https://console.groq.com/docs/rate-limits) describes a free plan, organization-level limits, rate-limit headers, and HTTP 429 responses. | Exact eligible-model quotas, account entitlement, and paid prices: **unverified**. No numeric Groq quota is assumed. |
| Gemini | The [official rate-limit documentation](https://ai.google.dev/gemini-api/docs/rate-limits) (redirected to [AI Studio documentation](https://aistudio.google.com/docs/rate-limits)) describes a free tier and model/project-dependent limits; active limits are account-specific and capacity is not guaranteed. | Exact eligible-model free quotas, account entitlement, and paid token prices: **unverified**. No numeric Gemini quota is assumed. |
| Cloudflare Workers AI | The [official pricing page](https://developers.cloudflare.com/workers-ai/platform/pricing/) states a free allocation of **10,000 Neurons/day**, reset at **00:00 UTC**, and paid usage above that allocation at **$0.011/1,000 Neurons** on Workers Paid. It also notes that some models require paid billing. | The selected model's eligibility and the repository account's remaining allocation: **unverified**. Neurons are not a fixed number of requests or tokens. |

All sourced observations and figures above have fetch date **2026-11-13**. Recheck documentation and account settings before implementation or changing models. No accounts were created, private dashboards accessed, or payments made. No QE Atlas pricing is needed or included.

The following names are a **proposed configuration surface**, not existing supported flags:

| Proposed setting | Meaning/default |
| --- | --- |
| `A11YGATE_MODEL_FIXES` / `--model-fixes` | Default `off`; repository-controlled opt-in is mandatory. A flag cannot override a repository denial. |
| `A11YGATE_FIX_OUTPUT` / `--fix-output` | `draft-pr` or `review-comments` for verified model candidates; never implies merge permission. |
| `A11YGATE_MODEL_PROVIDERS` | Enabled allowlist, traversed in the order above; default free-tier candidates only. |
| `A11YGATE_MODEL_<PROVIDER>_MODEL` | Explicit model ID per adapter; no silent model upgrades. |
| `GROQ_API_KEY`, `GEMINI_API_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Credentials/identifier injected by trusted CI only; never read from files for prompting or logged. Missing values skip that provider. |
| `A11YGATE_MODEL_ALLOW_PAID` | Default `false`; paid adapters also need explicit allowlisting, model/credentials, current price metadata, and a positive budget. |
| `A11YGATE_MODEL_MAX_COST_USD` | Default `0`; maximum aggregate paid inference spend per run. Unknown price means skip, not an assumed zero cost. |
| `A11YGATE_MODEL_MAX_REQUESTS`, `A11YGATE_MODEL_MAX_INPUT_TOKENS`, `A11YGATE_MODEL_MAX_OUTPUT_TOKENS`, `A11YGATE_MODEL_TIMEOUT_MS` | Required finite local caps when enabled; exact defaults to be chosen with fixtures, not inferred from provider quotas. |

Maintain repository/run and account-level request/token budgets, bounded concurrency, response-size limits, and a total wall-clock deadline. Reserve worst-case input/output cost before dispatch, including retries and concurrent jobs, then reconcile usage. These are A11yGate guardrails, not provider promises. Use dedicated free-plan credentials or enforceable provider-side billing restrictions for the free-only path. If free-only status or remaining allocation cannot be established safely, skip the provider; a local estimate alone cannot guarantee zero charges on a billed account shared with other workloads.

On a 429 or free-quota exhaustion, respect reset/Retry-After signals, open a provider cooldown, and try the next approved free candidate within the remaining run budget. Bounded jittered retries are allowed only for transient errors and within that budget. Do not wait indefinitely, rotate keys to evade quotas, upgrade an account, or silently switch to billed usage. Paid fallback occurs only after the separate explicit paid opt-in and budget checks. Otherwise return to F1. If usage is uncertain after a timeout, conservatively count the request against the budget.

## 5. Re-scan verification

Every model-produced fix must be re-scanned **before** either a draft PR or a review suggestion is proposed. Capture a fresh pre-patch reference scan at the pinned commit and a post-patch scan using the same axe version, enabled rules/tags/options, browser, routes, viewport/theme, test data, and interaction states. Do not change the baseline, lower thresholds, disable rules, or accept an empty page as a pass.

Require all of the following:

- The expected page/state and target element render; the source mapping still points to the intended element. Moving an element, changing its selector, hiding it, or removing content cannot by itself demonstrate a fix.
- The original rule violation is cleared at that element, using stable route/element correspondence as well as fingerprints. An inconclusive/incomplete axe check is not a cleared finding.
- No new findings appear relative to the pre-patch scan across the declared affected routes/states, including findings below the gate's severity threshold. Compare findings, not only aggregate counts or a passing exit code.
- Build/render checks succeed and the final published diff exactly matches the verified tree and pinned source commit.

If the original finding persists, any new finding appears, the scan fails, or results cannot be compared reliably, discard the candidate. Record a sanitized reason and use F1 on the original source. Do not publish the failed patch as “best effort.” A new revision requires a new verification cycle. Successful checks cover only tested states; PR evidence must state that limitation and retain human review requirements.

**Implementation (R3).** `lib/modelfix-verify` (kept outside `lib/modelfix` so drafting and validation stay shell-free) provides `createIsolatedVerifier`, which `planWithModelFixes` accepts as an optional `verifier`. Per run it:

1. Discards the candidate as **stale** when the scanned commit is unknown or not a full SHA, the head ref (default `HEAD`) no longer resolves to it, or the file's blob at that commit (or the checked-out text at the range) differs from the draft.
2. Creates a detached `git worktree` pinned to the scanned commit under `<tmpdir>/a11ygate-modelfix-*` (git hooks off, no CRLF conversion), re-validates each draft against the pinned file, and replaces the exact range only. No fuzzy matching.
3. Runs an optional caller-supplied local build, then scans the worktree before and after the patch with the same rescanner (same axe tags as `a11ygate scan`). The rescanner takes a directory, serves it on `127.0.0.1` with an ephemeral port and aborts every request to another origin; there is no URL input, so a production deployment cannot be re-scanned.
4. Marks the candidate **verified** only when the target (found exactly once in the pre-patch scan) is gone, is not inconclusive, still renders visibly, and no violation appears that the pre-patch scan did not have. Otherwise it is **rejected** with a sanitized reason.
5. Re-verifies every individually verified candidate **together** in one worktree with one re-scan (`ModelFixRun.combined`) before a later publisher (R4) may use them.
6. Removes the worktree and temp directory in a `finally`, including on errors.

Verified drafts are recorded (`verified-unpublished`) and never merged into the F1 plan; only the draft-only publisher (§6, R4) may publish them. A placeholder (`TODO(a11ygate)`) name can satisfy axe; it still carries `placeholder-accessible-name` and requires a person to write the wording. Automated testing only. Not a WCAG audit, certification or legal advice.

## 6. Human approval and publication

Fix PRs are always opened as **drafts**, never automatically marked ready, approved, or auto-merged. A human reviews, makes any required changes, marks ready, and merges through the repository's normal protections. The bot must not bypass checks or approve its own work. Re-run checks after human edits or a changed base/head.

Include the finding/rule, source commit, model/provider provenance, bounded rationale, before/after scan evidence, tested routes/states, remaining findings, and an explicit review checklist in the PR or review comment. Alt text, accessible names, ARIA semantics, and color choices are judgment calls. Reviewers must confirm image purpose, actual interaction behavior, brand constraints, and contrast in relevant states/themes. Clearing axe alone cannot settle those questions.

Use narrowly scoped publishing permissions in a trusted job. Keep provider credentials, GitHub write credentials, and the isolated application runtime separate; never expose secrets to fork-controlled code or use a privileged workflow to execute untrusted PR code. If safe execution or publication permissions are unavailable, retain the ordinary report/F1 behavior rather than escalating privileges.

**Implementation (R4).** `publishModelDrafts` (`lib/modelfix/publish.ts`, pure apart from an injected GitHub request function) receives only the orchestrator's `verified` candidates:

1. A candidate is eligible only when its verification is `verified` for that finding with zero new findings and a recorded tree, and, when more than one verified, the combined re-verify also passed. Rejected, stale, invalid or unverified drafts are never published.
2. The verifier records `treeHash` (the scanned commit's tree with only the patched files staged, i.e. the tree that was re-scanned) and `patchedBlobs`. The publisher rebuilds the file with the same exact replacement, checks the blob id, builds the tree through the git data API on the scanned commit's tree, and refuses (`tree-mismatch`) unless the returned tree id equals `treeHash`. File mode is assumed `100644`; any other mode mismatches and is refused.
3. Draft PR channel (default): commit with the scanned commit as parent, a deterministic `a11ygate/model-draft/<commit>-<id>` branch, then `POST /pulls` with `draft: true`. The base branch must still point at the scanned commit (otherwise `stale`). If drafts are unavailable (422) the branch is removed and, when a pull request exists, a labelled review suggestion is posted instead. Review-suggestion channel: a review comment labelled "model-drafted, needs human review" with a `suggestion` block.
4. Both bodies carry the label, rule, finding fingerprint, file/range, source commit, provider, model (`stub` for the stub adapter), review flags, re-scan evidence (verified, target cleared, new findings, combined re-verify, verified tree, sanitized summary, tested routes), the neutralized rationale, a review checklist, and the disclaimer.
5. Dedupe by a `<!-- a11ygate-model-draft:<commit>:<fingerprint> -->` marker. An open draft with the marker is left alone or updated in place (body only); one a person marked ready is not touched; a leftover branch (for example a closed draft) blocks a new PR.
6. The publisher never marks ready, approves, merges, requests reviewers or sends `draft: false`. 401/403 stops publishing and falls back to report-only with a sanitized warning; 429 stops with `quota`. The exit code is unchanged. Status lines (`buildPublishStatus`) carry reason codes and fingerprints only, never patch, replacement or rationale text.

The Action wires this behind the default-off `model-fixes` input (`model-fixes-publish`: `draft-pr` or `review-suggestion`). No verifier is wired into the Action yet, so in this phase it publishes nothing.

## 7. Alt-text and generated-content policy

Every model-drafted alt value and similar generated content (including accessible labels/descriptions) must carry a visible human-review marker. For example, place `TODO(a11ygate): AI-drafted alt; human must confirm image purpose and wording` in a syntax-correct adjacent HTML/JSX comment, and mirror it in the PR checklist with its file/range. Do not put the marker inside the accessible text announced to users. If a safe source comment is impossible, use an explicit per-value review marker in the review comment/PR and require tracked human acknowledgement before readiness.

Never silently treat generated wording as final. A blank alt is appropriate only when a person confirms the image is decorative; a model cannot make that decision solely to clear a rule. Without approved visual/context evidence, do not infer image content from a URL or filename: skip the model alt draft and use the F1 placeholder path. This initial design sends no image bytes or screenshots to providers. Human acceptance replaces/removes the TODO and confirms the wording; successful axe output must not remove the warning automatically.

## 8. Privacy, consent, and prompt boundaries

Models are off until a repository owner enables them and approves the provider allowlist and data boundary. Public repository status does not imply consent to send runtime DOM or user content externally. Opt-in applies independently of the ordinary local scan/F1 features.

Send only the rule ID and explanation, a minimal source slice around the uniquely mapped element, a minimal sanitized DOM fragment, relevant computed foreground/background styles for contrast, and approved nearby text needed for semantics. Use synthetic fixture content where possible. Do not upload the repository, full page, full scan report, browsing session, images, or screenshots. Credentials used by the adapter are sent only as authentication to the intended provider, never included in prompt data.

Before dispatch and before logging/publishing, apply path allowlists, size limits, and redaction. Deny env files (including `.env*`), credential/key files, private certificates, secret stores, `.git`, and paths outside the workspace, including symlink escapes. Strip cookies, authorization headers, session IDs, input values, hidden fields, token-bearing attributes, URL queries/fragments, private/internal URLs, personal/customer identifiers, and secret-shaped strings. Remove scripts, embedded instructions, and unrelated comments from DOM context. If redaction destroys necessary context or sensitive content cannot be reliably excluded, skip that finding. Redaction is defense in depth, not permission to send arbitrary data.

Use fixed provider endpoints; do not follow page-supplied destinations or fetch model-supplied URLs. Page/source text is untrusted data, never instructions. Delimit it separately from the trusted patch task, disable model tools/network actions, and enforce patch restrictions outside the model. Prompt wording alone is insufficient protection against injection.

Provider retention duration, training use, deletion guarantees, regional processing, and zero-retention eligibility are **unverified** in this research. Make no “no storage” or “no training” claim. Repository owners must approve applicable current terms before enabling an adapter. Retain only sanitized status/provenance and verification evidence under repository CI retention settings; raw prompts, raw responses, credentials, and rejected patches must not appear in public logs/artifacts. Working trees and transient request data are removed on success, failure, or cancellation.

## 9. Failure modes and safe behavior

Every failure below preserves the original scan result and permits only the F1 fallback described above; any next provider attempt remains subject to privacy and budget checks.

| Failure | Required safe behavior |
| --- | --- |
| Provider down or authentication rejected | Mark adapter unavailable; optionally try the next approved adapter within budget, then F1. Never log the key or request body. |
| Timeout/cancelled request | Abort local work, conservatively debit budget, ignore late responses; try next adapter only within the deadline, otherwise F1. |
| Malformed/truncated patch or unexpected fields | Reject before application; no model-directed repair commands. F1 if no independently valid candidate is available. |
| Patch applies to the wrong line or stale source | Require source commit/blob and exact original range/context, unique mapping, and intended-element checks. Reject ambiguity or a changed head; no fuzzy application. F1 on a fresh valid report. |
| Re-scan/build fails, original finding persists, or new findings appear | Discard the patch and candidate evidence of success; report verification failure and use F1. Never publish the rejected model diff. |
| Quota exceeded or cost reservation fails | Cool down/skip provider, try the next eligible free provider; paid only with explicit permission and budget, otherwise F1. |
| Unmappable finding, generated source, or missing reproducible preview | Do not ask a model to guess a file/line. Keep the finding in the report; use F1 only if its own mapping succeeds. |
| Prompt injection via page content/source | Treat it as data; no tools, secrets, or publishing authority in the model context. Reject out-of-scope output and suspicious candidates; skip to F1 if safe context cannot be prepared. |
| GitHub publication failure or branch moves | Do not escalate permissions or reuse stale evidence. Warn safely, preserve reports, clean temporary state, and deduplicate any later verified retry. |

## 10. Test plan

- Unit tests: deterministic prompt construction and data/instruction separation; strict response/patch parsing; size limits; path traversal and symlink rejection; exact original-text/blob checks; conflicting edits; redaction of env/credential files, tokens, personal data, private URLs, and malicious DOM attributes. Assert secrets never reach the stub provider or logs.
- Fixture integration tests: use a deterministic model stub, apply its patch in a disposable tree, render locally, and run real axe with pinned settings. Cover contrast, ARIA, and alt; assert original findings clear and no new findings appear before publication. Exercise alt review markers and reject “success” caused by missing content or changed selectors.
- Negative fixtures: persistent original violation, new low-severity violation, incomplete check, build failure, unavailable route, wrong-line patch, changed head, ambiguous mapping, injected instructions, invalid JSON, provider outage, timeout, all providers failing, exhausted quota, unknown cost, and exhausted budget. Assert no unverified model PR/comment is published.
- A dedicated **no provider configured** test must work without credentials or provider dependencies, assert zero outbound model calls, and assert only F1-style suggestions are produced. Unsupported findings remain report-only. Repeat with models explicitly off and with all adapters failing.
- Publisher tests use a fake GitHub API: drafts only, no ready/approve/merge calls, required human-review wording, provenance, comment deduplication, permission-denied handling, and verified-tree identity. Test combined candidates together before publication.
- Default CI uses only stubs and local fixtures; **no tests hit paid APIs by default**. Any later live-provider smoke test requires a separate manual opt-in, approved data, explicit credentials, and the same spending controls. F1 regression tests must continue to pass independently.

These are planned implementation tests; this design-only task does not add or execute model integrations.

## 11. Rough phased plan

| Phase | Deliverable and exit condition |
| --- | --- |
| **Phase 0 — F1** | Rule-based suggestions, no model; deterministic mapping, human-reviewed placeholders, and stable fallback behavior. Remains the default path while F1 development continues. |
| **Phase 1 — design (this document)** | Agree on consent, provider gating, verification, publication, and review policies; no product implementation. |
| **Phase 2 — stub/provider adapter + draft fix PRs behind a flag** | Implement the isolated orchestrator and adapter contract with stubs first, strict validation, real fixture re-scans, draft-only publisher, budgets, and no-provider fallback. Live adapters remain opt-in after terms/account checks. |
| **Phase 3 — limited rules** | Enable a small reviewed allowlist for alt (`image-alt`), contrast (`color-contrast`), and selected ARIA rules with unique source mapping and re-scan verification. Expand only on fixture evidence and human review; unsupported rules stay report-only/F1. |

No delivery dates are proposed. Unresolved implementation choices include initial local cap values, reproducible preview contracts for different repository stacks, and the exact selected provider models; none may weaken the no-model fallback, re-scan gate, or human approval requirement.
