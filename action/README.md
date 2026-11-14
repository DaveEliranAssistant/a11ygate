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

This is an early skeleton of the design in [docs/design/model-written-fix-prs.md](../docs/design/model-written-fix-prs.md). Today it records how findings would be routed. It ships no provider adapter and makes no model request. A draft-only publisher exists for drafts that an isolated re-scan verified, but the action does not run that verifier yet, so it publishes no model output.

- **Default off.** It stays off unless the `model-fixes` input (or `A11YGATE_MODEL_FIXES`) is `on` **and** the repository opts in with this exact line in `.a11ygate.yml` at the repository root:

  ```yaml
  modelFixes: true
  ```

- A missing file, a missing key, `modelFixes: false`, or any other value is a repository denial. The input and env cannot override it. An explicit `off` in either the input or env always wins.
- Only `color-contrast`, `image-alt` and ARIA accessible-name findings that map to exactly one place, with no rule-based suggestion, are eligible. A rule-based suggestion always takes precedence.
- When models are off, no provider is configured, every provider fails, or the budget is used up, the action posts exactly the rule-based suggestions described above. The gate result and exit code do not change.
- Verified drafts are only ever published as a **draft** pull request (`model-fixes-publish: draft-pr`, the default) or a review comment labelled "model-drafted, needs human review" (`review-suggestion`), with provider, model, finding fingerprint, source commit and re-scan evidence. A11yGate never marks them ready, approves or merges them, and dedupes by commit and finding. Without `pull-requests: write` and `contents: write` it warns and reports only; the exit code does not change.
- Rule-based suggestions keep their `TODO(a11ygate)` placeholders. A11yGate does not invent alt, label or accessible-name text.

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
