# A11yGate GitHub Action

Composite action that runs the A11yGate CLI, appends the Markdown summary to the job summary, and can post or update one pull request comment.

It is not published to the GitHub Marketplace. Use it from this repository:

```yaml
- uses: DaveEliranAssistant/a11ygate/action@<ref>
```

Or from a checkout of this repository:

```yaml
- uses: ./action
```

`<ref>` is a commit or branch that contains this action. Licensed under MIT. See the repository [LICENSE](../LICENSE).

## Inputs

| Input | Default | Purpose |
| --- | --- | --- |
| `current` | required | Axe JSON paths, one per line. |
| `baseline` | empty | Baseline JSON paths, one per line. |
| `threshold` | `serious` | `minor`, `moderate`, `serious`, or `critical`. |
| `markdown` | temp file | Where to write the Markdown summary. |
| `json` | temp file | Where to write the JSON result. |
| `update-baseline` | empty | Path to overwrite with the current results. |
| `comment` | `false` | Post or update a single pull request comment. |
| `suggest-fixes` | `true` | With `comment: true`, also post rule-based suggested changes on lines in the pull request diff. |
| `suggest-lang` | `en` | Language code for the `html-has-lang` suggestion. |
| `model-fixes` | `off` | Experimental model-assisted fix routing. Needs repository opt-in; see [Model-assisted fixes](#model-assisted-fixes-experimental-default-off). |
| `model-fixes-publish` | `draft-pr` | How verified model drafts are published: `draft-pr` or `review-suggestion`. Never ready, approved or merged. |
| `token` | `github.token` | Token for the comment and the suggested changes. |

The comment is marked with `<!-- a11ygate -->` and updated in place on later runs. The job summary receives the same Markdown. The step exits with the CLI code: **0** pass, **1** new violations at or above the threshold, **2** unreadable input.

Commenting needs `issues: write` so the token can create an issue comment on the pull request.

## Suggested changes

When `comment` and `suggest-fixes` are both true, the action also posts pull request review comments with a ```` ```suggestion ```` block. It does this only for **new** findings, only for these rule-based fixes, and only when the element maps to exactly one line inside the pull request diff:

| axe rule | Suggestion |
| --- | --- |
| `label` | Connect the control to its existing visible `<label>` with `for`/`id` (`htmlFor` in JSX), or wrap the control in that label. No suggestion when there is no visible label text. |
| `button-name`, `link-name` | Add `aria-label` from the control's `title` or the name of an icon inside it (image file name, icon name, icon component). Otherwise `aria-label="TODO(a11ygate): add accessible name"`. |
| `image-alt` | Add `alt=""` and a `TODO(a11ygate)` comment asking a person to write a description or confirm the image is decorative. |
| any rule on a `div`/`span` with `onclick` | Change the tag to `<button type="button">`, keeping every attribute and the handler. |
| `html-has-lang` | Add `lang` from `suggest-lang` and a `TODO(a11ygate)` comment to confirm it. |

- A11yGate never commits. A person reviews the suggestion and clicks **Apply suggestion**.
- Text containing `TODO(a11ygate)` is a placeholder, not final text. It may make the automated check pass while the page is still inaccessible. Replace it before merging.
- A11yGate never writes label, alt or aria text of its own.
- The action reads changed files from the checkout (`GITHUB_WORKSPACE`), so run `actions/checkout` first. It matches the HTML that axe reports to source tags in changed `.html`, `.htm`, `.js`, `.mjs`, `.jsx` and `.tsx` files. An element that also matches somewhere else is skipped as ambiguous.
- Findings outside the diff, or with no safe fix, appear only in the summary comment.
- Each review comment contains `<!-- a11ygate-suggestion:<fingerprint> -->`. Later runs update or skip it instead of posting a duplicate.
- Suggested changes need `pull-requests: write`. If posting one fails, the step logs a warning and keeps the gate's exit code.
- This is an automated check of a few rules. It is not a full accessibility review and not a compliance certification.

## Model-assisted fixes (experimental, default off)

This is an early slice of the design in [docs/design/model-written-fix-prs.md](../docs/design/model-written-fix-prs.md). It can ask free-tier model providers (Groq, Gemini, Cloudflare Workers AI) for a draft when provider env vars are set. Every draft is treated as untrusted and validated. When the model path is on, the action runs the isolated verifier: each validated draft is applied in a disposable git worktree pinned to the pull request head commit, the pages that were scanned are re-scanned locally on 127.0.0.1 with headless Chromium and axe, and only a draft that clears its finding without new findings can be published. Logs show only the sanitized outcome (for example `unverified-discarded`, `verify-rejected`, `adapters-failed`).

- **Default off.** It stays off unless the `model-fixes` input (or `A11YGATE_MODEL_FIXES`) is `on` **and** the repository opts in with this exact line in `.a11ygate.yml` at the repository root:

  ```yaml
  modelFixes: true
  ```

- A missing file, a missing key, `modelFixes: false`, or any other value is a repository denial. The input and env cannot override it. An explicit `off` in either the input or env always wins.
- Only `color-contrast`, `image-alt` and ARIA accessible-name findings that map to exactly one place, with no rule-based suggestion, are eligible. A rule-based suggestion always takes precedence.
- When models are off, no provider is configured, every provider fails, or the budget is used up, the action posts exactly the rule-based suggestions described above. The gate result and exit code do not change.
- Verified drafts are only ever published as a **draft** pull request (`model-fixes-publish: draft-pr`, the default) or a review comment labelled "model-drafted, needs human review" (`review-suggestion`), with provider, model, finding fingerprint, source commit and re-scan evidence. A11yGate never marks them ready, approves or merges them, and dedupes by commit and finding. Without `pull-requests: write` and `contents: write` it warns and reports only; the exit code does not change.
- Rule-based suggestions keep their `TODO(a11ygate)` placeholders. A11yGate does not invent alt, label or accessible-name text.

### Isolated re-scan in the action

- **Routes** come from the `url` of each `current` axe JSON file (for example `http://127.0.0.1:4173/cart.html` → `cart.html`), served from the checkout on 127.0.0.1. The original URL is never fetched. Axe tags come from the inputs' `toolOptions.runOnly` when they all agree, otherwise the CLI scan tags. Pages that need a build step or a click to show a finding (for example an open dialog) are not covered yet.
- **Checkout:** the workspace must be at the pull request head commit, for example `actions/checkout@v4` with `ref: ${{ github.event.pull_request.head.sha }}`. The default merge-commit checkout is skipped with a warning and drafts are discarded.
- **Chromium:** `playwright` and `@axe-core/playwright` are resolved from the consumer's checkout (`npm ci`), and Playwright Chromium must already be installed (`npx playwright install --with-deps chromium`) before the action runs. If either is missing, verification fails closed: a sanitized warning is logged, nothing is published, and the exit code does not change.
- **Permissions:** opening a draft fix PR needs `contents: write` and `pull-requests: write` on the job. Without them (403) or on a rate limit (429) the action reports only.
- Draft fix PRs target the scanned head branch of same-repository pull requests only (never forks). GitHub does not offer draft pull requests on every plan; when it refuses one, the draft is posted as a labelled review suggestion instead.

### Offline stub provider (demo and development only)

`A11YGATE_MODEL_PROVIDERS=stub` registers an offline stub adapter so the full path (route → draft → validate → re-scan → draft PR) can be demonstrated without provider keys. It makes no network request and only inserts `TODO(a11ygate)` placeholders (for example `aria-label="TODO(a11ygate): name this control"`), or a TODO review comment for contrast; it never writes real alt, label or name text. It is never registered unless `stub` is listed explicitly, still needs `modelFixes: true`, `model-fixes: on` and a request budget and timeout, and is not meant for production use.

```yaml
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}
      # npm ci and npx playwright install --with-deps chromium, then your axe scan
      - uses: DaveEliranAssistant/a11ygate-action@v1
        env:
          A11YGATE_MODEL_PROVIDERS: stub        # demo/dev only
          A11YGATE_MODEL_MAX_REQUESTS: '5'
          A11YGATE_MODEL_TIMEOUT_MS: '10000'
        with:
          current: a11y-results/index.json
          comment: true
          model-fixes: on
```

### Providers, order and environment variables

Providers are tried in this order: **Groq → Gemini → Cloudflare Workers AI → rule-based (F1) suggestions**. A provider is skipped when it is not in the allowlist, its credentials or model ID are missing, the model ID is not in the expected format, or it already failed in this run. Nothing is called unless every item below is set.

| Variable | Purpose |
| --- | --- |
| `A11YGATE_MODEL_FIXES` / `model-fixes` input | `on` to request model drafts. Default off. Still needs `modelFixes: true` in `.a11ygate.yml`. |
| `A11YGATE_MODEL_PROVIDERS` | Allowlist, for example `groq,gemini,cloudflare`. Order of trial is always the order above. Empty means no provider. |
| `A11YGATE_MODEL_MAX_REQUESTS` | Request budget per run, 1–100. Default 0: no requests. Retries count against it. When it is used up, no further model call is made. |
| `A11YGATE_MODEL_TIMEOUT_MS` | Per-request deadline, 1–120000. Default 0: no requests. A timed-out request still counts against the budget. |
| `A11YGATE_MODEL_MAX_OUTPUT_TOKENS` | Optional output-token cap per request, up to 4096. Default 1024. |
| `GROQ_API_KEY`, `A11YGATE_MODEL_GROQ_MODEL` | Groq credentials and an explicit model ID. No default model. |
| `GEMINI_API_KEY`, `A11YGATE_MODEL_GEMINI_MODEL` | Gemini API key (sent in the `x-goog-api-key` header, never in the URL) and an explicit model ID. |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `A11YGATE_MODEL_CLOUDFLARE_MODEL` | Workers AI token, 32-hex account ID and an explicit `@cf/...` model ID. |
| `A11YGATE_MODEL_ALLOW_PAID`, `A11YGATE_MODEL_MAX_COST_USD` | Separate paid opt-in. Default `false` and `0`. No paid adapter ships in this version, so these have no effect on the built-in providers. |

Pass credentials as repository or organization secrets in the workflow `env:` only. Never commit them or put them in `.a11ygate.yml`.

### Rate limits and quotas

- On HTTP 429 or a free-quota signal, A11yGate reads `Retry-After` and provider reset signals (Groq `x-ratelimit-reset-*`, Gemini `RetryInfo`, Cloudflare's daily reset at 00:00 UTC), puts that provider on cooldown, and moves to the next allowed provider. It does not wait for the cooldown. Without a reset signal, the provider stays off for the rest of the run.
- Transient errors (5xx, network) get at most 2 retries with jittered backoff of up to 2 seconds, inside the request budget. Auth errors, unknown models, unsupported regions and timeouts are not retried; the provider is skipped for the rest of the run.
- A11yGate does not rotate keys, upgrade accounts or move to paid usage. When every provider is cooling or failed, it returns to rule-based suggestions.
- A key alone does not prove that requests are free. Use dedicated free-plan credentials or provider-side billing limits. If an account has billing enabled, usage above the free allowance may be charged by the provider.

Free-tier notes. Only the Cloudflare figures are sourced; recheck before relying on any of them:

- **Cloudflare Workers AI:** 10,000 Neurons/day free, reset at 00:00 UTC. Usage above that is $0.011 per 1,000 Neurons on Workers Paid, and some models require paid billing. Source: <https://developers.cloudflare.com/workers-ai/platform/pricing/> (fetched 2026-11-13). Neurons do not map to a fixed number of requests.
- **Groq:** has a free plan with organization-level rate limits and HTTP 429 responses (<https://console.groq.com/docs/rate-limits>, fetched 2026-11-13). Exact quotas: **unverified**.
- **Gemini:** has a free tier with model- and project-dependent limits (<https://ai.google.dev/gemini-api/docs/rate-limits>, fetched 2026-11-13). Exact quotas: **unverified**.

### What is sent, and privacy

- **Sent:** the rule ID (for example `color-contrast`), the file extension, the line count and the exact mapped source lines of one element (at most 4 KB), plus fixed instructions. Credentials go only in the authentication header to the fixed provider endpoint.
- **Not sent:** file paths, repository names, commits, finding IDs, full files, the page, the scan report, screenshots or images.
- **Skipped entirely (no request):** snippets that contain secret-shaped strings or credential words, `value=` attributes or hidden inputs, URLs with query strings or fragments, private or internal hosts, email addresses or phone-like numbers, scripts or event handlers, and files such as `.env*`, `.git`, `.npmrc`, keys and certificates. Those findings get rule-based output only.
- Replies are untrusted. They are size-capped, must be JSON, and go through the same draft validator as any other draft (path, range, blob hash, no scripts, no check suppression). A reply that writes alt, label or accessible-name text instead of a `TODO(a11ygate)` placeholder is rejected.
- Raw prompts, replies and error bodies are not logged. Provider retention, training use and regional processing are **unverified** here. A11yGate makes no "no storage" or "no training" claim. Repository owners must check and accept each provider's current terms before enabling it.

A manual live check, `scripts/modelfix-live-smoke.mjs`, is not run by CI or any npm script. It sends one synthetic fixture snippet per provider and needs `A11YGATE_LIVE_SMOKE=1` plus your own credentials.

Automated testing only. Not a WCAG audit, certification or legal advice.

## Copy-paste workflow

Put this in the repository you are auditing. The Playwright test only writes axe JSON. A11yGate is the gate, so the test should not fail on violations itself.

```yaml
name: Accessibility
on:
  pull_request:

permissions:
  contents: read
  issues: write
  pull-requests: write # only for suggested changes

jobs:
  a11y:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test
      - uses: DaveEliranAssistant/a11ygate/action@<ref>
        with:
          current: |
            a11y-results/home.json
            a11y-results/cart.json
          baseline: a11y/baseline.json
          threshold: serious
          comment: true
```

```ts
import { test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';

test('home', async ({ page }) => {
  await page.goto('https://example.com/');
  const results = await new AxeBuilder({ page }).analyze();
  await mkdir('a11y-results', { recursive: true });
  await writeFile('a11y-results/home.json', JSON.stringify(results, null, 2));
});

test('cart', async ({ page }) => {
  await page.goto('https://example.com/cart');
  const results = await new AxeBuilder({ page }).analyze();
  await mkdir('a11y-results', { recursive: true });
  await writeFile('a11y-results/cart.json', JSON.stringify(results, null, 2));
});
```

`@axe-core/playwright` belongs in the project under test. It is not a runtime dependency of the A11yGate web app.

To accept the current tree as the next baseline, run the action with `update-baseline: a11y/baseline.json` and commit the file. The gate still exits 1 when the current run has new violations, including on the run that writes the file.
