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
| `auth` | container for the five live-scan auth settings below | — | absent |
| `auth.storageState` | Playwright storage-state file | `A11YGATE_AUTH_STORAGE_STATE` | absent |
| `auth.loginScript` | isolated login worker script | `A11YGATE_AUTH_LOGIN_SCRIPT` | absent |
| `auth.loginTimeoutMs` | login worker deadline | `A11YGATE_AUTH_LOGIN_TIMEOUT_MS` | 30000 |
| `auth.cookieEnv` | cookie → environment variable mappings | `A11YGATE_AUTH_COOKIE_ENV` | [] |
| `auth.headerEnv` | header → environment variable mappings | `A11YGATE_AUTH_HEADER_ENV` | [] |

There are no unwired or CLI-only schema keys. Command scopes are deliberate:
ci and the Action gate consume saved axe JSON, so they do not navigate URLs,
crawl, inject authentication, choose engines, or render scan HTML. Doctor
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
