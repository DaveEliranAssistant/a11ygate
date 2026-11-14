# Opt-in scan engines

`a11ygate scan http://127.0.0.1:8080 --engines axe,htmlcs,ibm,lighthouse --out-dir report`

Omitting `--engines` runs only `axe`. Select any nonempty, comma-separated subset;
unknown or duplicate IDs are argument errors. There is no cross-engine deduplication.

Install Playwright and Chromium for scans, and only the engine peers you select:

```sh
npm install --save-dev playwright @axe-core/playwright
npx playwright install chromium
# htmlcs
npm install --save-dev html_codesniffer@2.5.1
# ibm (official IBM Equal Access engine, with local versioned rules)
npm install --save-dev accessibility-checker-engine@4.0.35
# lighthouse (Node 20 compatible versions checked here)
npm install --save-dev lighthouse@12.8.2 puppeteer-core@24.43.1
```

All four additional packages are optional peers of the published CLI and development
fixtures of this repository. They are absent from production dependencies. npm does
not auto-install optional peers. The CLI dynamically imports Lighthouse/Puppeteer;
HTMLCS and IBM scripts are resolved and read locally at runtime, then evaluated in the
existing page. No optional engine code or transitive dependencies are bundled into
`packages/cli/dist` or `action/dist`; the CLI build verifies that its input graph has
no `node_modules` code. Pa11y is not used, installed, or bundled.

## Execution and offline rules

One Playwright browser owns the crawl and loads each page once. HTMLCS checks
WCAG2AA using its installed `build/HTMLCS.js`, including the local standards. IBM uses
`accessibility-checker-engine/ace.js` and `IBM_Accessibility`, with the rules pinned
by the installed package version. This is the engine used by IBM's
`accessibility-checker` wrapper. The wrapper is deliberately not loaded: its archive
resolution can fetch remote rules and its dependencies include telemetry and browser
installers. No `.achecker` configuration or warm remote cache is necessary. To
update offline IBM rules, explicitly install a newer engine package after review.
Do not replace the local script with a CDN URL.

Lighthouse's programmatic `snapshot` API attaches via Puppeteer to the same Chromium
target through a loopback debugging endpoint enabled only when selected. It runs
only the accessibility category, without navigation, storage resets, CLI config,
CLI update checks, or CLI analytics. Puppeteer connects; it never launches another
browser. HTMLCS and IBM do not launch browsers either.

The local BAD-fixture tests reject non-loopback Node TCP/fetch traffic and browser
requests outside the fixture origin; the only other loopback traffic is Chromium's
CDP control connection. They need no network services, API keys, or paid services.
Package installation is separate from these offline tests.

## Results and errors

Axe-only JSON, Markdown and HTML retain their historical format. An opt-in scan adds
`engineResults` to JSON: one `{url, engine, status, findings}` or
`{url, engine, status: "errored", error}` record per selected engine/page. Markdown
and HTML list these separately. The historical `findings`, `counts`, and `results`
fields still describe axe; use `engineResults` for every selected engine's coverage.
A scan without axe has empty legacy axe results. Findings remain separate even when
several engines flag the same element. IBM selectors are XPath; HTMLCS/Lighthouse
selectors are CSS. Only definite native failures are findings (not IBM potential or
manual checks, HTMLCS warnings/notices, or Lighthouse manual/not-applicable audits).
For engines without native severity, failures are assigned `serious`; this is a gate
policy, not a claim that the tools have matching severity scales. Unmapped rules have
an empty `wcagSc` list. HTMLCS criterion IDs are extracted from its native rule codes.

Each engine has a 30-second deadline. A crash, missing peer, or timeout is recorded
as `errored`, and remaining engines continue. Timeouts do not forcibly terminate
in-page JavaScript; page/browser cleanup follows the scan. Missing peers include an
`npm install --save-dev ...` hint. Any engine error gives verdict `ERROR` and exit 2;
otherwise definite findings from all selected engines participate in `--fail-on`
(exit 1), or exit 0 when none meet it. `--fail-on none` disables finding gating but
still reports engine errors. This does not change axe-only failure behavior.

## Observed licenses

These values were read from installed `package.json` files, not inferred from tool
names. All runtime packages below remain separately licensed; the project is MIT.

| Package | Version checked | Observed SPDX license | Used by |
| --- | --- | --- | --- |
| `html_codesniffer` | 2.5.1 | BSD-3-Clause | htmlcs |
| `accessibility-checker-engine` | 4.0.35 | Apache-2.0 | ibm |
| `lighthouse` | 12.8.2 | Apache-2.0 | lighthouse |
| `puppeteer-core` | 24.43.1 | Apache-2.0 | shared Lighthouse attachment |
| `accessibility-checker` | 4.0.35 | Apache-2.0 | inspected, not depended on |

`npm run licenses:check` reads installed engine manifests and rejects missing or
changed license declarations against a narrow SPDX allowlist. It runs before tests,
the web build and the CLI/Action build. Absent optional packages are allowed; their
installed manifests cannot bypass license checking. Tests exercise rejection of
missing, GPL, LGPL and unlicensed declarations and verify optional peer metadata.
A license change requires an explicit compatibility review before changing the
allowlist. We do not redistribute Pa11y (LGPL) or bundle LGPL engine dependencies.

Automated testing only. Not a WCAG audit, certification or legal advice.
