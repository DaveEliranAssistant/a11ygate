# Scanning authenticated pages

Use **test accounts only**, with the least access needed, on sites you own or are
explicitly authorized to test. Authenticated pages can contain personal data.
Review reports before sharing them. Automated testing only. Not a WCAG audit,
certification or legal advice. Automated testing finds only a subset of issues;
a PASS is not a compliance claim.

Build the CLI with `npm run cli:build`. Authentication is opt-in:

```sh
# Read an existing Playwright storageState file. Never write it into the repo.
a11ygate scan http://127.0.0.1:3000/account --storage-state /secure/test-state.json --out-dir out

# Run trusted login code, then scan using its cookies, localStorage and sessionStorage.
a11ygate scan http://127.0.0.1:3000/account --login-script ./test-login.mjs --login-timeout-ms 30000 --out-dir out

# Read sessionStorage from a secure file (format below).
a11ygate scan http://127.0.0.1:3000/account --session-storage /secure/test-session.json --out-dir out

# Inject values from your shell/CI secret store; only variable names go in arguments.
a11ygate scan http://127.0.0.1:3000/account --cookie-env session=A11YGATE_TEST_SESSION --out-dir out
a11ygate scan http://127.0.0.1:3000/account --header-env Authorization=A11YGATE_TEST_AUTHORIZATION --out-dir out
```

`--cookie-env NAME=ENV_VAR_NAME` and `--header-env NAME=ENV_VAR_NAME` are repeatable.
Missing or empty variables fail with exit code 2. The authorization variable must
contain the complete header, including its scheme (for example, Bearer). Never
put credential values in arguments, config, scripts, `.env` files in the repo,
or checked-in storage state. Supply them through your CI secret store or an
existing shell environment. Header injection is scoped to the requested origin,
including redirect hops; cookies use browser origin/path rules. Robots checks
remain unauthenticated and are honored. `Cookie` headers must use `--cookie-env`.

A login script is a JavaScript module (`.mjs`, or `.js` using your Node module
configuration) with a default function that receives **page, env**:

```js
export default async function login(page, env) {
  await page.goto('http://127.0.0.1:3000/login');
  await page.getByLabel('Email').fill(env.A11YGATE_TEST_EMAIL);
  await page.getByLabel('Password').fill(env.A11YGATE_TEST_PASSWORD);
  await Promise.all([
    page.waitForURL('**/account'),
    page.getByRole('button', { name: 'Log in' }).click(),
  ]);
}
```

Use selectors matching your actual login form; do not invent labels or alt text
for the page being tested. The script starts on a blank page. It may interact
with login forms and must finish with an authenticated browser context. Only run
scripts you trust: the worker is a timeout mechanism, **not a security sandbox**;
scripts have Node filesystem and network access and receive the environment.
Their stdout/stderr are discarded to prevent credential logging. Exceptions
produce a generic “Login script failed” diagnostic; review the script locally
without logging credentials. The deadline includes module loading and is 30
seconds by default, configurable from 1 to 300000 milliseconds. Even synchronous
infinite loops are terminated, and the browser is closed on failure.

Authentication methods can be combined: storage state loads first, injected
cookies/headers apply next, and the login script runs last. The scan uses a new
context initialized from the login context's cookies, localStorage and sessionStorage.
In-memory JavaScript sessions, client certificates, and interactive MFA are not
transferred/supported. No updated storage state is saved. Protect and expire your
input state file as you would a password.

A redirect to a recognizable login/SSO path, a page containing a password input,
or HTTP 401/403 is reported as **Not authenticated**, with verdict ERROR and exit
code 2 (also with `--fail-on none`). The page is not counted as scanned. This is a
conservative heuristic: password-change pages can be classified as login pages;
custom identity-provider routes without a password form can evade detection.
Check the final URL and scope in your report to confirm the intended page was
scanned. Ordinary same-origin redirects remain supported.

`--session-storage` is a per-run CLI input and accepts JSON with this shape (placeholder values only):

```json
{"origins":[{"origin":"https://test.example","sessionStorage":[{"name":"session","value":"PLACEHOLDER"}]}]}
```

Use test accounts only. Keep this file outside the repo. Origins must be exact HTTP(S)
origins, including the port, with no path or trailing slash. Duplicate origins and
non-string entries are rejected without echoing input. Values are installed by an
init script before application scripts on every page load and frame navigation,
only when the document origin matches. Other origins receive none of these values.
The input also initializes the login context. After login, sessionStorage is captured
from frames in pages still open when the script returns; for repeated origins the
last captured frame wins and replaces that origin's input entries. Leave authenticated
pages open until return. Closed tabs and origins navigated away from cannot be captured.
No sessionStorage file is written back or included in reports.

Cookie values, localStorage values, sessionStorage values, explicitly injected environment values,
secret-named environment variables, token fields, bearer/basic authorization,
and credential query parameters are redacted before report serialization. This
covers JSON, Markdown, HTML, SARIF, JUnit, stdout/stderr and native engine evidence.
Evidence packs keep their credential guard and refuse suspicious unsanitized
inputs. Screenshots remain off by default. Lighthouse internal full-page capture is disabled;
its accessibility analysis still runs on the original page. Opt in with `--screenshots --out-dir out` for
viewport PNGs after each page/state analysis. Before capture, the scanner places
solid black overlays over `input[type=password]`, `[autocomplete*="cc-"]`,
`[data-a11ygate-redact]` and additional CSS selectors in `redact.selectors`.
It removes overlays after capture, including on failure; engines run before masks.
Open shadow roots are searched; frames are covered wholesale. Invalid selectors
fail capture rather than saving an unmasked image. The screenshot is limited to
the viewport to avoid full-page scrolling moving fixed or sticky content.

Configure additional application-specific secrets with `.a11ygate.yml`:

```yaml
redact:
  selectors: ["#account-token", ".personal-details"]
```

Or repeat `--redact-selector <css>`. Selectors add to the built-in defaults.
Use `--no-screenshots` for authenticated scans to disable capture even if
`screenshots: true` is configured. With `--out-dir`, it writes an exclusion marker
that makes subsequent evidence packs omit all images, including stale images
already in that directory. The marker persists: use a fresh output directory to
resume including screenshots. Existing image files are not deleted. `doctor`
recommends this option when authentication is configured.

Masking cannot identify secrets outside matching element rectangles (including
pseudo-elements, canvas drawings, closed shadow roots, or rapidly changing content).
Review images before sharing. The evidence pack cannot inspect image pixels;
externally supplied images have not passed through these masks.
Redaction cannot identify arbitrary personal data or an application's novel
encoding of a credential. Review outputs and avoid real accounts.

Run the local-only browser checks separately from unit tests:

```sh
npm run cli:build
npx playwright test --config playwright.auth.config.ts
```

These checks exercise a login-form fixture with each method, failed/expired
sessions, script exceptions, async and CPU timeouts, and byte-search every report,
log, re-export, native archive and decompressed ZIP entry for generated secrets.

### Explicit authentication checks

Set `auth.check` to replace heuristic login detection. `mustHaveSelector` requires
at least one matching element; `mustNotHaveSelector` requires none. These are cheap
presence checks after each page loads, with no selector waiting. Invalid selectors
fail the check. All configured conditions must pass. Password fields and login-like
paths no longer imply failure by themselves when an explicit check is configured.
HTTP errors still fail verification.

An optional `url` (absolute or relative to the scan origin) is loaded once after
authentication, before crawling. It must stay on the scan origin; off-origin
redirects are blocked. The same selectors and forbidden destination check apply
to that probe. A failed probe marks requested pages as not authenticated. Without
a probe URL, the first requested page is the initial check. Every requested page
is checked before any accessibility engine runs; the probe is never scanned.

`mustNotRedirectTo` is an absolute URL or path: its origin and pathname must not
match the final page URL or a child path. Query strings and fragments are ignored.
It also rejects direct visits to that destination. It is a literal path check,
not a regular expression or glob. For example, use your application's existing
member marker as `mustHaveSelector` and its actual login path as
`mustNotRedirectTo`; A11yGate does not infer a marker or accessible name.

Failed pages have `scanStatus: "not-authenticated"`, no engine results, and a
separate `counts.pagesNotAuthenticated` count in JSON and report summaries. They
make the verdict ERROR (exit 2), including with `failOn: none`; they are never a
pass. Without `auth.check`, existing heuristics and report output are unchanged.
`doctor` warns when authentication is configured without an explicit check.
The corresponding optional CLI flags are `--auth-check-url`,
`--auth-check-must-have-selector`, `--auth-check-must-not-have-selector`, and
`--auth-check-must-not-redirect-to`.

Automated testing only. Not a WCAG audit, certification or legal advice.

The screenshot pixel/cleanup and authenticated evidence exclusion fixtures run with
`A11YGATE_BROWSER_TESTS=1 npx vitest run tests/screenshot-redaction.test.ts`.
They use only local content and a loopback server with the existing network guard.
