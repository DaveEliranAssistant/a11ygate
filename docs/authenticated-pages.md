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

# Run trusted login code, then scan using its cookies and localStorage.
a11ygate scan http://127.0.0.1:3000/account --login-script ./test-login.mjs --login-timeout-ms 30000 --out-dir out

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
context initialized from the login context's cookies and localStorage. Session
storage, in-memory JavaScript sessions, client certificates, and interactive MFA
are not transferred/supported. No updated storage state is saved. Protect and
expire your input state file as you would a password.

A redirect to a recognizable login/SSO path, a page containing a password input,
or HTTP 401/403 is reported as **Not authenticated**, with verdict ERROR and exit
code 2 (also with `--fail-on none`). The page is not counted as scanned. This is a
conservative heuristic: password-change pages can be classified as login pages;
custom identity-provider routes without a password form can evade detection.
Check the final URL and scope in your report to confirm the intended page was
scanned. Ordinary same-origin redirects remain supported.

Cookie values, localStorage values, explicitly injected environment values,
secret-named environment variables, token fields, bearer/basic authorization,
and credential query parameters are redacted before report serialization. This
covers JSON, Markdown, HTML, SARIF, JUnit, stdout/stderr and native engine evidence.
Evidence packs keep their credential guard and refuse suspicious unsanitized
inputs. The scan does not capture screenshots. Do not add screenshots containing
credentials or personal data; the evidence pack cannot inspect image pixels.
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
