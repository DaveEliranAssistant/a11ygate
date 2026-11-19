# 10-minute demo: the gate catching a regression

Automated testing only. Not a WCAG audit, certification or legal advice.

A repeatable live demo for warm intros. It shows A11yGate doing its one job: a CI gate with evidence, not an overlay. Existing debt is accepted as a baseline, the gate passes, a developer ships one unlabeled button, and the gate fails on exactly that one new finding, with an evidence pack and a one-page summary to hand over.

Everything runs locally against a fictional shop in [`fixtures/demo-app/`](../../fixtures/demo-app/) served on `127.0.0.1` with an ephemeral port. Nothing outside the laptop is scanned.

## Before the call

- Run `npm ci`, `npm run cli:build` and `npx playwright install chromium` once.
- Rehearse with `node scripts/demo.mjs --ci` (about 13 s on the machine in the [run log](#run-log)). It exits 0 only when every step behaved as expected.
- For the call, use `node scripts/demo.mjs --pause`: it shows the full CLI output and waits for Enter before each step. Outputs are kept in a temporary directory; the script prints its path at the end.
- To click through the shop yourself, `node fixtures/demo-app/server.mjs` serves it without the regression and `node fixtures/demo-app/server.mjs --regression` with it.

## What the fixture contains

| Page | Seeded existing debt (marked `TODO(demo debt)` in the HTML) | Rule (impact) |
| --- | --- | --- |
| `/` | Hero image with no `alt` attribute | `image-alt` (critical) |
| `/products.html` | Light grey price on white | `color-contrast` (serious) |
| `/checkout.html` | Email input with no label | `label` (critical) |
| `/about.html` | Heading jumps from h1 to h4 | `heading-order` (moderate) |

The regression toggle adds one icon-only "remove item" button with no accessible name to `/checkout.html` (`button-name`, critical, which is at or above the default `serious` threshold). No alt text, label text or accessible name is written for any of these: fixing them needs a person who knows the content.

## Talk track (under 10 minutes)

| Step | Time | On screen | Say |
| --- | --- | --- | --- |
| 0. Frame | 1:00 | Title, the disclaimer line | "This is a CI gate with evidence, not an overlay. Nothing is injected into your pages. It runs in your pipeline, compares each build with the debt you already have, and fails only when something new and serious appears. It is automated testing only; it does not replace an audit." |
| 1. Scan | 1:30 | `a11ygate scan <url> --crawl 10 --delay-ms 0 --out-dir scan-1-debt` exits 1 with 3 findings at or above serious | "This is a typical site: it already has debt. A naive gate fails every build from day one, so teams switch it off. That's the problem we solve." |
| 2. Baseline | 1:00 | `a11ygate baseline create scan-1-debt --output a11y-baseline.json` | "We record today's findings as the baseline. They don't disappear; they stay listed as existing, and you work them down on your own schedule." |
| 3. Re-scan | 1:00 | Same scan with `--baseline a11y-baseline.json` exits 0: "0 new; 4 existing" | "Same URL, same pages, same baseline. Nothing new, so the build is green, and the report still shows the four existing issues." |
| 4. Regression | 0:30 | The added `<button>` with only an SVG icon | "A developer ships an icon-only button. Looks fine, but a screen reader announces just 'button'." |
| 5. Gate | 1:30 | Same scan exits 1: "1 new finding at or above serious", `[new] button-name` on `/checkout.html` | "The gate fails on exactly one finding: the new one, with page, selector and rule guidance. The old debt doesn't block the merge. This is what lands in the pull request." Optionally open `scan-3-gate/a11ygate-scan.html`. |
| 6. Evidence | 1:00 | `a11ygate evidence pack --from scan-3-gate --out a11ygate-evidence.zip --commit <sha>` | "Every run can be bundled: reports, the engine versions, the commit and a SHA-256 for each file. It is a record of what an automated run found, at that time, on those pages." |
| 7. Summary | 1:00 | `a11ygate prospect --from scan-3-gate --company '<name>' --out-dir prospect-out --offer`, open `prospect-summary.pdf` | "This one-pager is what I'd leave with you. The offer block comes from our pricing config; today that's a 21-day pilot at no cost, then $990 a year." |
| 8. Questions | 1:30 | [Objections](#likely-objections-and-honest-answers) | Answer from the limits pages; don't stretch. |

Total: 10 minutes of talk (the per-step minutes above add up to 10:00); the scripted commands themselves take under 15 seconds on the worker Mac. The CI runner time is printed as `demo kit total <ms>` in the e2e log (`e2e/demo-kit.spec.ts`).

## Likely objections and honest answers

Answers come from [what A11yGate does not do](../what-a11ygate-does-not-do.md) and [known limits](../known-limits.md). Don't go beyond them.

- **"If the gate passes, are we accessible / covered for the EAA?"** No. A PASS means no new finding at or above the threshold was detected on the scanned pages. Automated rules detect only some WCAG failures; alt text quality, focus order, error messages and zoom need a person. A11yGate is not legal advice and issues no certificates or seals. See [what A11yGate does not do](../what-a11ygate-does-not-do.md).
- **"Do you test with screen readers?"** No. A11yGate does not drive NVDA, JAWS, VoiceOver or TalkBack and does not involve disabled users. Pair it with manual and assistive-technology testing.
- **"Why not just fix everything the scan finds?"** You should fix it, but the existing debt rarely gets fixed in one sprint. The baseline keeps the gate useful meanwhile: it blocks new problems and shows the old ones as existing.
- **"How is this different from an overlay widget?"** Nothing runs on your users' pages. It runs in CI on your code, before release, and produces evidence your team can act on. It does not change the page for the visitor.
- **"Will it find everything on our site?"** No. A scan covers only the pages it loaded (`--crawl` stops at 20 same-origin pages by default) in the states it reached. Content behind interactions or logins it was not given is unassessed. Authenticated and interaction scans exist but have recorded gaps (MFA is not supported, for example); see [known limits](../known-limits.md#authenticated-scans).
- **"Will moving a component break the baseline?"** It can. Fingerprints use rule, normalised selector and page; an element that moves to a different stable selector can show as new, and two elements can merge if normalisation removes their only difference. See [Other limits](../what-a11ygate-does-not-do.md#other-limits).
- **"Does it run in our CI?"** GitHub Actions and Jenkins have starter templates via `a11ygate init`; GitLab, Azure DevOps, CircleCI and Bitbucket have documented templates. What each one was and wasn't run on is in the [CI matrix](../../README.md#ci-matrix) and [known limits](../known-limits.md#ci-integrations); several have not run on a real hosted runner yet.
- **"Can it write the fixes?"** Suggested changes cover only a few rules, and text containing `TODO(a11ygate)` is a placeholder that a person must replace. Model-written fixes are a design draft, off by default.
- **"Can you scan our site right now?"** Only with your permission recorded first. Scanning sites outside our own properties needs explicit authorization.

## Run log

Recorded by running `node scripts/demo.mjs --ci` on the worker Mac (Intel Core i9-9880H, macOS 15.7.4, Node v20.19.6), 2026-11-19, on branch `a11y-r68-demo-kit` based on `main` at `0f59f36`. Wall clock measured with `/usr/bin/time -p`: **real 12.98 s** (user 14.33 s, sys 3.57 s). The port and temporary path differ per run; the temporary path is trimmed to "…".

```text
A11yGate demo: CI gate with evidence, not an overlay.
Automated testing only. Not a WCAG audit, certification or legal advice.
Fixture app: http://127.0.0.1:49834/ (fixtures/demo-app, local only). Work dir: …

=== 1. Scan the existing site (no baseline: existing debt fails a naive gate)
$ a11ygate scan http://127.0.0.1:49834/ --crawl 10 --delay-ms 0 --out-dir scan-1-debt
**Verdict: FAIL** (fail on: serious)
3 findings at or above serious: image-alt, color-contrast, label.
-> exit 1 (expected 1) in 3.9s

=== 2. Accept today's debt as the baseline
$ a11ygate baseline create scan-1-debt --output a11y-baseline.json
Wrote fingerprint baseline a11y-baseline.json
-> exit 0 (expected 0) in 0.1s

=== 3. Re-scan with the baseline (nothing new: the gate passes)
$ a11ygate scan http://127.0.0.1:49834/ --crawl 10 --delay-ms 0 --baseline a11y-baseline.json --out-dir scan-2-pass
**Verdict: PASS** (fail on: serious)
0 new findings at or above serious.
Baseline: 0 new; 4 existing; 0 fixed; 0 unassessed.
-> exit 0 (expected 0) in 3.8s

=== 4. Apply the regression (a developer ships an icon-only button on /checkout.html)
+ <button type="button" class="remove-item"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><path d="M3 3l10 10M13 3L3 13" stroke="#1a1a1a" stroke-width="2"/></svg></button>

=== 5. Gate the change (same scope, same baseline)
$ a11ygate scan http://127.0.0.1:49834/ --crawl 10 --delay-ms 0 --baseline a11y-baseline.json --out-dir scan-3-gate
**Verdict: FAIL** (fail on: serious)
1 new finding at or above serious.
Baseline: 1 new; 4 existing; 0 fixed; 0 unassessed.
- [new] **button-name** (critical) on `http://127.0.0.1:49834/checkout.html` — `.remove-item` — Buttons must have discernible text — [rule guidance](https://dequeuniversity.com/rules/axe/4.14/button-name?application=playwright)
-> exit 1 (expected 1) in 3.8s
New findings in the gate run: 1 -> button-name (critical) on /checkout.html .remove-item

=== 6. Bundle the evidence
$ a11ygate evidence pack --from scan-3-gate --out a11ygate-evidence.zip --commit 0f59f3604a6ccefa434f6149e096bffeba310436
Wrote a11ygate-evidence.zip (9 files, manifest SHA-256 for each).
-> exit 0 (expected 0) in 0.2s

=== 7. One-page summary for the buyer, with the pilot offer
$ a11ygate prospect --from scan-3-gate --company 'Northwind Outdoor (demo)' --out-dir prospect-out --offer
Wrote prospect-summary.html, prospect-summary.pdf and prospect-manifest.json to prospect-out
-> exit 0 (expected 0) in 1.0s

=== Done in 12.9s
  ok   exit 1    3.9s  Scan the existing site (no baseline: existing debt fails a naive gate)
  ok   exit 0    0.1s  Accept today's debt as the baseline
  ok   exit 0    3.8s  Re-scan with the baseline (nothing new: the gate passes)
  ok   exit 0    0.0s  Apply the regression
  ok   exit 1    3.8s  Gate the change (same scope, same baseline)
  ok   exit 0    0.2s  Bundle the evidence
  ok   exit 0    1.0s  One-page summary for the buyer, with the pilot offer
Automated testing only. Not a WCAG audit, certification or legal advice.
DEMO_SUMMARY {"ok":true,"failures":[], …}
```

The CI-runner timing is not recorded here: `tests/demo-kit.test.ts` runs the same script in `npm test`, fails if it takes 3 minutes or more, and prints `demo kit total <ms>` in the CI log.

## Optional: the same flow on our own site (manual, not run in tests)

Manual, not run in tests. Only for `a11ygate.vercel.app`, which is our own property. It scans the live site over the network, so keep the default page delay. There is no regression toggle on the live site; show steps 1–3 and 6–7, then switch to the local fixture for the regression.

```sh
a11ygate scan https://a11ygate.vercel.app/ --crawl 5 --out-dir live-1
a11ygate baseline create live-1 --output live-baseline.json
a11ygate scan https://a11ygate.vercel.app/ --crawl 5 --baseline live-baseline.json --out-dir live-2
a11ygate evidence pack --from live-2 --out live-evidence.zip
a11ygate prospect --from live-2 --company 'A11yGate (own site)' --out-dir live-prospect --offer
```

Use the same URL and `--crawl` value for the baseline and every later scan; a different scope makes the comparison meaningless. Page scanning loads pages without logging in or submitting forms, but only `prospect` in URL mode applies its stricter request restrictions.

Automated testing only. Not a WCAG audit, certification or legal advice.
