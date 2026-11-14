#!/bin/sh
set -eu
cd "$(dirname "$0")"
node ../../../packages/cli/dist/cli.mjs init --yes --target github \
  --url http://127.0.0.1:4311/ --crawl 0 --fail-on serious
