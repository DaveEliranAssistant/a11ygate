# GitLab Code Quality and JUnit

Automated testing only. Not a WCAG audit, certification or legal advice.

Copy [`a11ygate.gitlab-ci.yml`](./a11ygate.gitlab-ci.yml) into a repository you own or are authorized to test, then include the reviewed copy:

```yaml
include:
  - local: integrations/gitlab/a11ygate.gitlab-ci.yml

# Override the included job to start your application on loopback.
a11ygate:
  before_script:
    - npm ci
    - npm run build
    - npm run start -- --hostname 127.0.0.1 --port 3000 &
    # Replace / with your application's readiness endpoint when needed.
    - node -e 'const u="http://127.0.0.1:3000/"; for(let i=0;i<60;i++){try{if((await fetch(u)).ok)process.exit(0)}catch{} await new Promise(r=>setTimeout(r,1000))}process.exit(1)' --input-type=module
```

Adapt the build/start commands to your application. The template scans only `http://127.0.0.1:3000` by default, with one page (`--crawl 1`), and runs only for merge request pipelines. Only set `A11YGATE_URL` to a local or explicitly authorized application. The template performs no login, deployment, or publishing.

The consuming project's lockfile must include the A11yGate CLI **from a revision containing this format**, `playwright@1.64.1`, and `@axe-core/playwright`. The Node + Chromium image is `mcr.microsoft.com/playwright:v1.64.1-noble`; keep Playwright's package and image versions aligned. The image supplies browsers and system dependencies, but not the npm packages ([Playwright Docker documentation](https://playwright.dev/docs/docker)). The CLI version fields remain unchanged by this task; an older published `0.2.0` does not imply support for this format. Before a release, you can vendor this revision's `packages/cli` as `tools/a11ygate` and install it as a local development dependency (`npm install --save-dev ./tools/a11ygate playwright@1.64.1 @axe-core/playwright`), committing the resulting lockfile. No registry publication is required. In the A11yGate repository, the workspace CLI and its checked-in bundle already provide the binary.

The job runs `npx --no-install a11ygate`, using the installed binary without fetching a CLI at runtime. `A11YGATE_FAIL_ON` defaults to `serious`. Allowed policies are `minor`, `moderate`, `serious`, `critical`, and `none`. Exit 1 fails the job for findings meeting the policy; exit 2 indicates a setup/scan error. `none` makes findings reporting-only while setup/scan errors still fail. `allow_failure: false` preserves this policy. Reports upload even when the scan fails (`artifacts: when: always`):

| Artifact | File |
| --- | --- |
| Code Quality | `a11y/a11ygate-scan.gitlab-codequality.json` |
| JUnit | `a11y/a11ygate-scan.junit.xml` |
| Supporting evidence | `a11y/` (JSON, Markdown, HTML, engine evidence) |

GitLab compares findings with a target-branch baseline pipeline. The supplied rules are deliberately MR-only; an owner who wants new/resolved comparisons must arrange equivalent target-branch report artifacts separately. Keep the scan URL stable between comparable runs: R18 includes its normalized origin in the identity. See [GitLab Code Quality](https://docs.gitlab.com/ci/testing/code_quality/) and [artifact report syntax](https://docs.gitlab.com/ci/yaml/artifacts_reports/#artifactsreportscodequality).

## CLI output and identity

```sh
npx --no-install a11ygate scan http://127.0.0.1:3000 --format gitlab-codequality,junit --out-dir a11y
npx --no-install a11ygate report a11y --format gitlab-codequality --out-dir reexport
npx --no-install a11ygate ci --current axe.json --format gitlab-codequality --out-dir gate
```

Scan and saved-report commands write `a11ygate-scan.gitlab-codequality.json`; gate/ci writes `a11ygate.gitlab-codequality.json`. Repeated/comma-separated formats are supported and require `--out-dir`. Without the new format flag, existing report bytes and exit policies are unchanged.

Each issue has `description`, `check_name`, `fingerprint`, `severity`, and `location.path` / `location.lines.begin`, as required by [GitLab's Code Quality report format](https://docs.gitlab.com/ci/testing/code_quality/#code-quality-report-format). Output is one JSON array without a BOM. An empty scan produces `[]`, without a synthetic issue. Each finding description contains the page URL, selector, and disclaimer, because GitLab processes only its documented fields.

Fingerprints are the **exact R18 `baselineFingerprint` strings**, without a second hash or the legacy gate fingerprint. The exporter computes them even when no baseline is supplied. It preserves original selector components for frames/shadow roots and the merged-engine identity, including occurrence indices for unlocated findings. Timestamps, HTML, and impact changes do not alter R18 identity. Existing baseline findings remain in Code Quality reports so GitLab can compare them; the CLI baseline/fail-on policy determines job failure independently.

| axe / scan impact | GitLab severity |
| --- | --- |
| critical | critical |
| serious | major |
| moderate | minor |
| minor | info |
| null / unspecified | info |

`blocker` is a valid GitLab severity but is not assigned automatically: these findings are automated evidence, not a compliance verdict.

Mapped findings use their repository-relative source file and positive line number. Unmapped findings use the same virtual path convention as SARIF: `a11ygate-pages/<sanitized-host>/<page-path>/index.html` at line 1 (a URL ending in a filename retains it). Query/fragment variants receive a stable suffix. For example, `http://127.0.0.1:3000/` becomes `a11ygate-pages/127.0.0.1-3000/index.html`. These virtual paths do not claim a real source mapping and may not link to repository files or inline diffs. Use the description's URL and selector to locate the element. Invalid source mappings fall back to this convention.

## Local validation

Unit tests use a locally authored JSON schema from GitLab's documented subset (the documentation URL is cited in the schema and test), check YAML job structure, compare exact R18 identities, and snapshot the report. They use the network guard and do not launch Chromium.

```sh
npm test
npm run cli:build
# Manual integration smoke; uses installed Chromium and the existing fixtures/scan-site.
node integrations/gitlab/smoke-local.mjs
```

The smoke check executes the template's exact `script` against a loopback fixture server, validates its Code Quality artifact, checks JUnit is written, and asserts exit 1 for `serious` and exit 0 for `none`. It does not execute `npm ci` or run the container image. No GitLab account is required.

For YAML parsing/schema validation without Docker, `gitlab-ci-local --preview` can be used. On this Mac it was initially absent; the current npm release failed under Node 20 (`Set.union` unavailable). A temporary Node 22 runtime permits preview:

```sh
npm exec --yes --package=node@22 --package=gitlab-ci-local -- gitlab-ci-local --file integrations/gitlab/a11ygate.gitlab-ci.yml --preview
```

Owner installation: `brew install gitlab-ci-local` ([upstream installation instructions](https://github.com/firecow/gitlab-ci-local#installation)); then run `gitlab-ci-local --file integrations/gitlab/a11ygate.gitlab-ci.yml --preview`. Preview validates configuration only. Full image/job execution remains unverified on this Mac because Docker is unavailable; run the template in an authorized GitLab runner or a Docker-equipped development environment to close that gap.
