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
| `report` | empty | Also write an evidence report to this path. Sets the `report` output. |
| `report-format` | inferred | `html`, `md`, or `json`. Empty infers it from the `report` extension, defaulting to `html`. |
| `comment` | `false` | Post or update a single pull request comment. |
| `token` | `github.token` | Token for that comment. |

The comment is marked with `<!-- a11ygate -->` and updated in place on later runs. The job summary receives the same Markdown. The step exits with the CLI code: **0** pass, **1** new violations at or above the threshold, **2** unreadable input.

The evidence report is written by a separate `a11ygate report` run before the gate (so it compares against the baseline as committed, even with `update-baseline`). It does not change the gate's exit code, except that a report that cannot be written turns a passing run into exit 2. Upload it as an artifact:

```yaml
      - uses: DaveEliranAssistant/a11ygate/action@<ref>
        with:
          current: a11y-results/home.json
          baseline: a11y/baseline.json
          report: a11y-report.html
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: a11y-evidence-report
          path: a11y-report.html
```

Commenting needs `issues: write` so the token can create an issue comment on the pull request.

## Copy-paste workflow

Put this in the repository you are auditing. The Playwright test only writes axe JSON. A11yGate is the gate, so the test should not fail on violations itself.

```yaml
name: Accessibility
on:
  pull_request:

permissions:
  contents: read
  issues: write

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
