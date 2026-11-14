# Tested framework recipes

Each example plants one missing image alternative (`image-alt`). The examples are private, isolated npm projects outside the root workspace and published CLI file list.

- [Next.js App Router](nextjs.md)
- [Vite + React](vite-react.md)
- [Angular standalone app](angular.md)
- [Storybook React + Vite](storybook.md): all story iframe URLs from `index.json`, excluding docs entries.

From the repository root, build the source CLI and install Chromium before running the dedicated suite:

```sh
npm ci
npm run cli:build
npx playwright install chromium
node --test scripts/recipes.e2e.mjs
```

This suite installs and builds each app, runs its documented `scan.sh` and `init.sh`, checks the planted issue, verifies scanned routes (including every Storybook story), asserts the server port closes and observed descendants exit, and checks `npm pack --dry-run --json` isolation. Select one framework with `node --test scripts/recipes.e2e.mjs angular`. Run sequentially: recipe ports 4311–4314 must be free. Commit lockfiles and use `npm ci --workspaces=false` in CI for reproducible installs.

The ordinary `npm test` path includes only browser-free start/wait/cleanup wiring tests using a tiny local static stand-in. It does not install framework dependencies or launch Chromium. Root TypeScript excludes the isolated recipe projects; each framework build checks its own source.

`a11ygate scan --start "<trusted shell command>" --wait-on <loopback-url>` owns the started process group on macOS/Linux and cleans it up after success, findings, setup errors, readiness timeout, SIGINT or SIGTERM. `--start` requires `--wait-on`; readiness accepts HTTP 2xx without redirects and uses `--timeout-ms` (default 30 seconds). The same flag also sets the per-page analysis deadline. The start command runs in the scan's current directory; its output is suppressed. Use `npm start` directly when diagnosing build/server failures. Cleanup cannot run after SIGKILL or machine failure. Windows process-tree cleanup is not covered by this POSIX suite.

`--storybook <loopback-index-url>` fetches the current Storybook `entries` format, filters `type: story`, and scans each encoded `iframe.html?id=…&viewMode=story` URL. It supports 1–1000 unique stories and rejects crawl budgets, filters and sitemaps rather than silently omitting stories. Both URL flags require the same origin as the scan URL and a loopback hostname. Browser navigation retains the scanner's existing same-origin boundaries; these recipes use no remote assets.

Automated testing only. Not a WCAG audit, certification or legal advice. Scan only sites you own or are authorized to test. Passing automated checks does not establish compliance.
