# Repository configuration

A11yGate loads `.a11ygate.yml` from the working directory (the checked-out
`GITHUB_WORKSPACE` in the Action). The shared resolver applies each setting in
this order: explicit CLI flag / Action input > environment variable > YAML >
default. Missing files preserve existing defaults. Invalid files or environment
values fail scan/ci before starting a browser or writing reports; doctor reports
them as failed configuration checks and continues independent diagnostics.

```sh
a11ygate config validate
a11ygate config print
a11ygate config print scan --fail-on critical
a11ygate config print ci --threshold minor
a11ygate config print doctor --engines axe,ibm
```

`config print` emits JSON with a value, source and applicable commands for each
schema leaf, plus the automated-testing disclaimer. It does not scan, execute a
login script, open storage-state files or call a provider. Cookie/header settings
remain environment-variable references: their credential values are never
serialized. Referenced values (even unusually named environment variables) and
other secret-named environment values are redacted if copied into any setting.
URL query values and fragments are conservatively redacted too. Invalid-option
errors do not echo supplied values. Sources identify flags or environment names,
never credential values.

Environment names are `A11YGATE_` plus the uppercase schema path in snake case:
`timeoutMs` → `A11YGATE_TIMEOUT_MS`, `auth.storageState` →
`A11YGATE_AUTH_STORAGE_STATE`. Integers use decimal text, booleans accept
`true/false`, `on/off`, `yes/no`, or `1/0`. Lists accept JSON arrays or
comma/newline-separated strings (use JSON for globs containing commas).
An empty environment value means unset. CLI list flags replace the lower source's
entire list; repeatable flags still collect within the CLI source.

| Schema key | Effective option / consumer | Environment | Default |
| --- | --- | --- | --- |
| `url` | scan URL; positional URL or `--url` wins | `A11YGATE_URL` | required for scan |
| `crawl` | scan page budget; 0 means start page only | `A11YGATE_CRAWL` | 0 |
| `maxPages` | scan explicit page budget, overrides `crawl` at any source | `A11YGATE_MAX_PAGES` | 1; derived from crawl/sitemap when selected |
| `maxDepth` | scan link depth | `A11YGATE_MAX_DEPTH` | unlimited |
| `timeoutMs` | scan whole-page deadline | `A11YGATE_TIMEOUT_MS` | 30000 |
| `concurrency` | scan active-page limit | `A11YGATE_CONCURRENCY` | 1 |
| `recycleEvery` | scan browser-context recycling every n pages ([sizing](perf/README.md)) | `A11YGATE_RECYCLE_EVERY` | absent: one context per scan |
| `sitemap` | scan same-origin sitemap URL/path | `A11YGATE_SITEMAP` | absent; when set, 20 pages unless crawl/maxPages is explicit |
| `include` | scan include globs | `A11YGATE_INCLUDE` | [] |
| `exclude` | scan exclude globs | `A11YGATE_EXCLUDE` | [] |
| `ignoreRobots` | scan robots opt-out | `A11YGATE_IGNORE_ROBOTS` | false |
| `failOn` | scan `failOn`; ci/Action `threshold` | `A11YGATE_FAIL_ON` | serious |
| `engines` | scan engine selection; doctor peer checks | `A11YGATE_ENGINES` | [axe] |
| `modelFixes` | doctor / Action model suggestions, subject to consent below | `A11YGATE_MODEL_FIXES` | false |
| `baseline` | scan fingerprint baseline; ci/Action axe JSON baseline | `A11YGATE_BASELINE` | absent |
| `formats` | scan/ci/Action extra report formats; needs `outDir` | `A11YGATE_FORMATS` | [] |
| `outDir` | scan/ci/Action report directory | `A11YGATE_OUT_DIR` | absent |
| `delayMs` | scan global crawl start delay | `A11YGATE_DELAY_MS` | 1000 |
| `reportVersion` | scan HTML layout | `A11YGATE_REPORT_VERSION` | 2 |
| `interactions` | scan route state list; `--interactions <file>` reads JSON | `A11YGATE_INTERACTIONS` (JSON) | [] |
| `autoInteractions` | scan `--auto-interactions` | `A11YGATE_AUTO_INTERACTIONS` | false |
| `interactionBudget` | scan `--interaction-budget` per route | `A11YGATE_INTERACTION_BUDGET` | 10 |
| `auth` | container for the five live-scan auth settings below | — | absent |
| `auth.storageState` | Playwright storage-state file | `A11YGATE_AUTH_STORAGE_STATE` | absent |
| `auth.loginScript` | isolated login worker script | `A11YGATE_AUTH_LOGIN_SCRIPT` | absent |
| `auth.loginTimeoutMs` | login worker deadline | `A11YGATE_AUTH_LOGIN_TIMEOUT_MS` | 30000 |
| `auth.cookieEnv` | cookie → environment variable mappings | `A11YGATE_AUTH_COOKIE_ENV` | [] |
| `auth.headerEnv` | header → environment variable mappings | `A11YGATE_AUTH_HEADER_ENV` | [] |

There are no unwired or CLI-only schema keys. Command scopes are deliberate:
ci and the Action gate consume saved axe JSON, so they do not navigate URLs,
crawl, run interactions, inject authentication, choose engines, or render scan HTML. Doctor
preflights engines and model setup; it does not run a scan or write scan reports.
`scan` and `ci` do not generate model fixes. The Action's optional suggestion
stage consumes `modelFixes`. Per-run inputs such as `--current`, output paths
`--json`/`--markdown`, and local-server `--start` remain command flags rather than
schema keys. The existing init starter text still describes explicit flags;
those generated flags remain valid and take precedence over YAML.

The Action's legacy environment aliases `A11Y_THRESHOLD`, `A11Y_BASELINE` and
`A11Y_MODEL_FIXES` are accepted by the resolver. Canonical `A11YGATE_*` variables
win over aliases. Explicit Action inputs are passed as flags and win over both.
Omitted `threshold` / `model-fixes` inputs no longer inject defaults over YAML.

`modelFixes` is a consent boundary: the validated repository must contain the
boolean `modelFixes: true`. A missing/false value cannot be overridden by a flag
or environment variable. With consent present, the regular precedence applies;
`off` disables the feature. Provider allowlists, credentials and budgets remain
separate runtime requirements; opting in does not supply them. No model fixes
are published merely by printing configuration.

`failOn: none` disables failures caused by finding impact in scan and ci; it
does not turn incomplete coverage into a PASS. List flags and existing output
formats otherwise preserve their previous behavior. Credentials belong only in
environment variables and private storage-state files, never in committed YAML.

Automated testing only. Not a WCAG audit, certification or legal advice.

## Opt-in SPA interaction states

Configure states for routes that the scan visits (states do not add crawl seeds):

```yaml
interactions:
  - route: /pricing
    name: dialog-open
    steps:
      - action: click
        selector: "#open-dialog"
      - action: wait
        selector: "dialog[open]"
  - route: /pricing
    name: details-tab
    steps:
      - action: press
        selector: "#details-tab"
        key: Enter
interactionBudget: 10
# autoInteractions: true
```

Or save the list as JSON and run:

```sh
a11ygate scan http://127.0.0.1:3000/pricing --interactions states.json
a11ygate scan http://127.0.0.1:3000/pricing --auto-interactions --interaction-budget 3
```

Routes match pathname plus query exactly. State names use letters, numbers,
underscores and hyphens; `auto-` is reserved. Each state starts from a fresh
route load, executes its ordered `click`, `press` (Playwright key syntax) or
`wait` (visible selector) steps, then runs the selected engines. Selectors must
identify one target for clicks/keypresses. Use explicit waits for async content;
step waits/actions time out after at most five seconds, within the whole-page
deadline. Native browser dialogs are dismissed; HTML dialogs can be opened.

State evidence and page rows use labels such as `/pricing#dialog-open` (full URL
in JSON). Raw engine results remain separate. Repeated findings across states
are deduplicated before totals, gate decisions and shared-component grouping;
the highest impact wins and `findings[].states` retains observed state URLs.
A failed step or exhausted explicit-state budget produces a skipped state with
a step number and reason, and an ERROR (exit 2), so incomplete states cannot PASS.
Per-state page counts describe observations and should not be summed as unique
finding totals. Saved reports retain state rows and deduplicated findings.

Auto mode snapshots collapsed controls (`aria-expanded="false"`) and popup
buttons (`aria-haspopup` other than `false`) in DOM order. Each candidate starts
from a fresh route load; labels are `#auto-1`, `#auto-2`, etc. It is a bounded
heuristic, not exhaustive exploration. Explicit states run first. Every attempted
step, including waits and rejected unsafe targets, consumes the shared per-route
budget (default 10, maximum 100). Auto mode stops when the budget is spent.

Links, submit/reset controls and editable inputs are rejected. Interaction scans
block form submission, new windows, document navigation during steps and non-read
HTTP methods during steps. Sites may perform side effects in custom handlers,
including GET requests; use authorized local/test environments and test accounts.
Reloading resets DOM state, but cookies and storage persist in the browser context.
For nested exploration, use an `interactions` mapping instead of the legacy list:

```yaml
interactions:
  states: []
  auto:
    depth: 2
    maxStates: 20
```

The mapping also works in a local JSON file passed to `--interactions`, or JSON
in `A11YGATE_INTERACTIONS`. Presence of `auto` opts in. Depth defaults to 1 and
accepts 1–3; maxStates defaults to 20 and accepts 1–100. The state cap counts
auto attempts (including rejected targets), per route, excluding the base page
and explicit states. The shared step budget still applies; replaying ancestors
consumes steps. Legacy `--auto-interactions --interaction-budget 50` is also
capped at 20 auto attempts by default; configure `interactions.auto.maxStates: 50`
to raise the state cap alongside the step budget. Depth 1 retains R37 `auto-N` labels and ordering.
At depth 2–3, visible root controls are explored in DOM order, depth first.
Newly visible expandable descendants inside the opened control or its
`aria-controls`/`aria-owns` panel are explored after a fresh load and ancestor
replay. Labels use existing safe element IDs (otherwise `auto-N`), for example
`/app#menu>submenu-2` (URL fields encode `>` as `%3E`). Unrelated controls, shadow roots and arbitrary state
combinations are not explored. Use explicit steps for unsupported relationships
or asynchronous reveals. Buttons whose text contains the whole words delete/remove/pay/buy/submit
(case insensitive, including targets inside buttons) are rejected at every depth, including explicit steps. No labels or alternative text are generated or changed.

Without interaction settings the existing scan output is unchanged.
Automated testing only. Not a WCAG audit, certification or legal advice.
