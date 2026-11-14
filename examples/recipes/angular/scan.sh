#!/bin/sh
set -eu
cd "$(dirname "$0")"
node ../../../packages/cli/dist/cli.mjs scan http://127.0.0.1:4313/ \
  --start "npm start" --wait-on http://127.0.0.1:4313/ \
  --timeout-ms 60000 --delay-ms 0 --json scan.json
