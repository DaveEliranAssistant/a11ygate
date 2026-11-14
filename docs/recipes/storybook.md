# storybook recipe

Automated testing only. Not a WCAG audit, certification or legal advice. Scan only sites you own or are authorized to test. These examples use localhost only.

Requires Node 20.19+ (Angular also supports Node 22.12+), npm, and the source CLI. From the repository root:

```sh
npm ci
npm run cli:build
npx playwright install chromium
npm --prefix examples/recipes/storybook ci --workspaces=false
npm --prefix examples/recipes/storybook run build
sh examples/recipes/storybook/scan.sh
```

The intentionally missing image `alt` produces `image-alt` and exit code 1. No replacement text is invented. Review the image's purpose before writing alternative text. Reports appear in `examples/recipes/storybook/scan.json`.

The following is the exact tested `examples/recipes/storybook/scan.sh` file. It starts the built app, waits for HTTP 2xx, scans every story iframe discovered through index.json (docs entries are excluded), and terminates the owned process group, including on scan failure. `--timeout-ms` bounds readiness and each page. The command is trusted shell code; do not supply untrusted input. POSIX process groups are tested on macOS/Linux.

```sh
#!/bin/sh
set -eu
cd "$(dirname "$0")"
node ../../../packages/cli/dist/cli.mjs scan http://127.0.0.1:4314/ \
  --start "npm start" --wait-on http://127.0.0.1:4314/ --storybook http://127.0.0.1:4314/index.json \
  --timeout-ms 60000 --delay-ms 0 --json scan.json
```

To generate the matching CI starter, run this exact tested `examples/recipes/storybook/init.sh` file:

```sh
#!/bin/sh
set -eu
cd "$(dirname "$0")"
node ../../../packages/cli/dist/cli.mjs init --yes --target github \
  --url http://127.0.0.1:4314/ --crawl 0 --fail-on serious
```

Run the init file from the recipe directory as shown; review generated files before committing. Init records URL, crawl and threshold; it does not build/start the app. Replace the generated CI scan step with the tested scan script and add the install/build steps above. The generated starter pins an older source scanner: update its source checkout to the commit containing these recipes before using the new flags. Storybook index discovery is supplied by scan.sh, not by init.

Dedicated validation (excluded from `npm test`):

```sh
node --test scripts/recipes.e2e.mjs storybook
```

This installs isolated example dependencies, builds, runs the exact scripts, asserts the planted finding, checks the report URL set, and asserts that the server port closes. It needs local Chromium installed and never scans third-party sites.
