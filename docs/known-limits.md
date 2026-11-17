# Known limits

Automated testing only. Not a WCAG audit, certification or legal advice.

This page collects the gaps recorded for each merged task from A11Y-R23 to A11Y-R61: the "Known gaps" notes of their pull requests and the status notes of the task list. It lists only gaps that were written down there. A gap that a later merged task closed is left out, or kept with a note naming the task that closed it. The tag after each item (for example A11Y-R60) names the task, and its pull request is linked from the [CHANGELOG](../packages/cli/CHANGELOG.md#unreleased).

For what A11yGate does not do at all (manual audits, assistive-technology testing, legal advice, certification), see [what A11yGate does not do](what-a11ygate-does-not-do.md). The [docs index](README.md) lists every guide.

Contents: [Not included](#not-included) · [CI integrations](#ci-integrations) · [Crawling and scope](#crawling-and-scope) · [Authenticated scans](#authenticated-scans) · [Interaction states](#interaction-states) · [Keyboard heuristics](#keyboard-heuristics) · [Incremental and diff-aware scans](#incremental-and-diff-aware-scans) · [Reports and exports](#reports-and-exports) · [Review decisions](#review-decisions) · [Evidence packs and trend](#evidence-packs-and-trend) · [Configuration and input handling](#configuration-and-input-handling) · [Performance and benchmarks](#performance-and-benchmarks) · [Test-suite notes](#test-suite-notes)

## Not included

- **A11Y-R34** is not on `main`: its pull request is a draft waiting for the owner.

## CI integrations

What each CI integration was and was not run on is stated row by row in the [CI matrix](../README.md#ci-matrix). In addition:

- **GitLab.** Docker was unavailable, so the template's container image and `npm ci` inside it were not executed. `gitlab-ci-local` only previews and validates the configuration. A full job run needs an authorized runner or a Docker-equipped machine (A11Y-R23).
- **Azure DevOps.** No Azure DevOps organization was used, so the template has not run on a real agent; the cmd.exe (Windows) path was not executed. Only one `CodeAnalysisLogs` artifact can exist per run; the guide says what to do when another tool already publishes one (A11Y-R24). The `nodeVersion` default is the `22.x` range, not an exact patch version (A11Y-R35). The deprecated Node.js v0 task noted in A11Y-R24 was replaced by `UseNode@1` in A11Y-R35.
- **CircleCI.** `circleci config validate` was not run (no CircleCI CLI, no Docker, no account). No orb is published; that is an owner action (A11Y-R25).
- **Bitbucket Pipelines.** No Bitbucket pipeline has run the template. Docker was unavailable, so the Playwright image was not run, and Bitbucket's test-report scanner and artifact upload are not exercised (A11Y-R40).
- **Jenkins scheduled E2E on `main`.** The scheduled Jenkins E2E job fails because its Docker image copies only `source/` and misses `schema/`, `locales/en.json` and the `docs/perf` benchmark JSON. The fix is pending with the owner. The recorded acceptance run in the CI matrix is unaffected.
- **Framework recipes.** `scan --start` process-group cleanup is tested on macOS/POSIX; Windows process-tree cleanup is not covered (A11Y-R26).

## Crawling and scope

- The crawler does not run interactions to discover history routes; routes that need an interaction to appear stay unassessed. Real scans may load third-party subresources; document navigation stays same-origin (A11Y-R30).
- `a11ygate estimate` discovers pages from static HTML only: JavaScript-only routes and authenticated content are missed, and login is reported as "unknown" when not detected. It estimates only the selected `--engines` set (no side-by-side). Its default 1000 ms delay matches no recorded benchmark row, so default output prints "no benchmark for this configuration". It quotes only the earlier R38/R47 benchmark files, not the A11Y-R49 benchmark v2 rows. A redirect into a robots-blocked path is reported as a navigation error, and any failed page fetch exits 2 (A11Y-R55).
- `ci --projects`: a project that cannot start is reported with a generic "Project could not start" message (to avoid leaking credentials). Combined summaries link to each `project-result.json`, not the full report. `--projects` accepts only its own flags; other `ci` flags are rejected. Single-project equality is checked against a direct run, not a new frozen golden (A11Y-R56).

## Authenticated scans

- Without an `auth.check`, login detection is heuristic. A11Y-R52 added the explicit check; the heuristic remains the default (A11Y-R27).
- Interactive MFA is not supported. In-memory sessions are not transferred. Login scripts are trusted Node code and are not sandboxed. Arbitrary personal data and novel credential encodings may not be recognised by the redactor. Use test accounts only (A11Y-R27). sessionStorage transfer, also missing in A11Y-R27, was added in A11Y-R36.
- sessionStorage capture needs the pages to stay open when the login script returns: closed tabs and origins navigated away from are not captured. When an origin repeats, the last captured frame is used (A11Y-R36).
- `auth.check`: a forbidden redirect destination also fails a direct visit to that path. Selector checks run at load and do not wait for late content. A failed initial probe still loads every page before marking it not authenticated. The `doctor` warning links to the generic `doctor-config` section, not an auth-specific one (A11Y-R52).
- Screenshots (opt-in since A11Y-R50; A11Y-R27 captured none): a screenshot failure, such as an invalid redact selector, errors the whole page. Screenshot file names hash the URL, so interaction states of the same URL overwrite each other. Pixel tests run only with `A11YGATE_BROWSER_TESTS=1`. The `.a11ygate-no-screenshots` marker stays in a reused out dir (intentional) (A11Y-R50).

## Interaction states

- States apply only to routes the crawl visits; they add no seeds. DOM reloads keep cookies and storage. Custom handlers can still have application side effects, including GET requests: use authorized test environments (A11Y-R37). Nested controls, which A11Y-R37 auto discovery did not explore, are covered up to depth 3 since A11Y-R45.
- There is no frozen golden for A11Y-R37 interaction output; depth 1 is checked against legacy auto mode. The destructive-word rule also applies to explicit steps on buttons (for example a `type=button` "Submit"). The default `maxStates` of 20 caps a legacy `--interaction-budget` above 20. A root reload failure at depth 2–3 propagates instead of being recorded as a skipped state (A11Y-R45).

## Keyboard heuristics

- Keyboard findings are heuristics that need human review. Contrast, obscuration, indicators outside the element's bounding box, animation timing, closed shadow roots and `aria-activedescendant` composites are not assessed. Interaction states are not keyboard-probed (A11Y-R41, A11Y-R46). Shadow DOM, same-origin frames, Shift+Tab, roving-tabindex composites and multi-element traps, listed as gaps in A11Y-R41, were added in A11Y-R46.
- `--keyboard-pixel-threshold` is a CLI flag only (no YAML key or environment variable). The pixel fallback blurs and refocuses controls, which fires page focus handlers, and decodes images in the page, so a strict CSP leaves the indicator "unknown" with no finding. Intentional modal focus traps of two to five controls are flagged as cycle traps. A selector path is built for every element, which is slow on very wide DOMs. Cross-origin frames marked "not assessed" appear in the JSON only, not in a report table (A11Y-R46).

## Incremental and diff-aware scans

- `--incremental` hashes the rendered DOM only: external CSS, images, fonts and closed shadow roots are not hashed. The "from cache" note is English only (not in the report string catalog). With `--changed-since`, a changed route set or ref invalidates all cache entries. One corrupt entry forces full scans until that URL is rescanned or the cache dir is deleted. There is no eviction. Cached pages still load; only engine time is saved (A11Y-R60).
- `--changed-since` skips the up-front robots.txt check on the start URL (per-route robots rules still apply in the crawl). When several changed files force a full scan, the reported reason depends on file order: the first unmapped or `"*"` file wins (A11Y-R57).

## Reports and exports

- HTML report v2 links W3C Understanding pages by criterion name; they were not fetched live, and 4.1.1 Parsing points to the WCAG 2.2 page that marks it obsolete. Rules without specific guidance use the generic how-to-fix text (the engine's help plus "consult the rule guidance") (A11Y-R28).
- Likely shared components are heuristics, not verified root causes: unrelated elements that look alike can group together, and structural differences can split one component (A11Y-R29).
- Report language: the combined multi-project summary is English only. Gate reasons, scope sentences, shared-component and review notices, EN 301 549 labels and skip reasons stay English as recorded data. HTML report v1 is frozen in English. The catalog lint is static over string literals in the two template files (A11Y-R58).
- `--en301549-ref` is on `scan` only, not on `ci` or in `.a11ygate.yml`. The web app's default CSV export still has no disclaimer row, kept byte-identical (A11Y-R59).
- `a11ygate report pdf`: no PDF/UA validator (veraPDF) was run. It ignores `--baseline` and `--fail-on`. A scan dir literally named `pdf` must be passed as `./pdf`. The bundled CLI's PDF path is smoke-tested with `--help` only; the full path is tested from source (A11Y-R53).
- `a11ygate export tickets`: the Jira CSV was not tried in a real Jira import. Jira priority names are the defaults. Each ticket carries one example selector and snippet. An empty Jira export holds a "do not import" notice row, which imports as one task if imported anyway. The web app has no ticket export (A11Y-R54).
- Decision exports: a stale `codequality-decided.json` may stay in a reused out dir. The `ci` gate path writes no sidecar (it has no decisions today) (A11Y-R43).

## Review decisions

- The scan JSON's `sharedComponentGroups` does not embed decisions; each finding carries its own `reviewDecision` (A11Y-R39). The other A11Y-R39 gaps were closed later: decision exports in A11Y-R43, a remove command in A11Y-R44, and a real terminal test in A11Y-R51.
- `review prune` needs the latest scan file passed explicitly. The partial-write test simulates a rename failure; no real process is killed (A11Y-R44).

## Evidence packs and trend

- In `a11ygate trend`, the first run has nothing to compare with, so all its findings count as new, and regressions leave it out. Runs with different start URLs are compared as they are, with a note in the report (A11Y-R42). The missing commit date noted in A11Y-R42 was added in A11Y-R48.
- Detached CI checkouts record no `commit.branch`: the branch comes from git only, not from CI environment variables (A11Y-R48).

## Configuration and input handling

- `modelFixes: "true"` (quoted) is reported as a wrong type with a hint to remove the quotes; consent behaviour is unchanged (A11Y-R31). The other A11Y-R31 gap, `scan` not reading `url`, `crawl` and other keys from the file, was closed by A11Y-R33.
- The projects file of `ci --projects` is not yet covered by the malformed-input property tests. Warnings from `evidence`, `doctor`, `init` and `trend` ignore `--debug`. YAML syntax errors without a key name only give the line (A11Y-R61, A11Y-R56).
- `--debug` is accepted by every command but is not listed in `--help` output (found while writing the A11Y-R62 command check).

## Performance and benchmarks

- Benchmark v2 (A11Y-R49) recorded 500 pages × {axe, all engines} × concurrency {1, 2, 4} with whole-process-tree RSS. It ran on one Mac that was not idle (Spotlight indexing; load averages are recorded per run). Each configuration ran once, so run-to-run variance was not measured. Linux runners were not measured; the sampler supports Linux `ps`, but only through a unit test. The R38 all-engines runs used a 40-page subset. Lighthouse errors at concurrency above 1, recorded in A11Y-R38, were fixed in A11Y-R47.
- The Lighthouse mutex has no cancellation: a timed-out queued snapshot still runs later and delays the queue. `lighthouse serialized` is logged even at concurrency 1. The first follow-up bench run under load was kept as 36 of 40 pages (A11Y-R47).
- See [docs/perf](perf/README.md) for the recorded numbers.

## Test-suite notes

These affect contributors, not scan results.

- The JUnit XSD used in tests was extended for `skipped@message` (A11Y-R43).
- The pseudo-terminal review test makes node-pty's macOS `spawn-helper` executable (node-pty 1.1.0 ships it non-executable), and its snapshot normalizes dates and timestamps (A11Y-R51).
- The model-fix verifier test shares the OS temp directory and can fail under parallel load; it passes alone and in CI (A11Y-R61, A11Y-R51).
- A mid-module import in `lib/scan/report.ts` deepens a report/Markdown import cycle; five internal git switches are excluded from the config-schema coverage test (A11Y-R57).

**Informational only. Not legal advice. Not a certification of EAA compliance.** Automated checks cover only part of WCAG; this is evidence, not certification.
