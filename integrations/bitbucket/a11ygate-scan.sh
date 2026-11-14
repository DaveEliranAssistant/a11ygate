#!/bin/sh
# A11yGate scan step for Bitbucket Pipelines. bitbucket-pipelines.yml runs this exact file;
# tests/bitbucket-pipelines.test.ts runs the same file locally against a loopback fixture.
# Automated testing only. Not a WCAG audit, certification or legal advice.
#
# Scan only a local or explicitly authorized application.
# Exit 0 = pass, 1 = findings at or above A11YGATE_FAIL_ON, 2 = setup or scan error.
set -u

url="${A11YGATE_URL:-http://127.0.0.1:3000}"
fail_on="${A11YGATE_FAIL_ON:-serious}"
crawl="${A11YGATE_CRAWL:-1}"
# Bitbucket reads JUnit XML automatically from ./**/test-results/**/*.xml (3 levels deep).
out_dir="${A11YGATE_OUT_DIR:-test-results/a11ygate}"
baseline="${A11YGATE_BASELINE:-}"
wait_seconds="${A11YGATE_WAIT_SECONDS:-120}"
commit="${BITBUCKET_COMMIT:-}"

case "$fail_on" in
  minor|moderate|serious|critical|none) ;;
  *) echo "A11YGATE_FAIL_ON must be minor, moderate, serious, critical or none (got: $fail_on)" >&2; exit 2 ;;
esac

# Wait for the application under test (started earlier in the step) to answer.
if ! A11YGATE_URL="$url" A11YGATE_WAIT_SECONDS="$wait_seconds" node --input-type=module -e '
  const url = process.env.A11YGATE_URL;
  const deadline = Date.now() + Number(process.env.A11YGATE_WAIT_SECONDS) * 1000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) process.exit(0); } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  process.exit(1);
'; then
  echo "Application did not respond at $url" >&2
  exit 2
fi

set -- scan "$url" --crawl "$crawl" --fail-on "$fail_on" --format junit,sarif --out-dir "$out_dir"
if [ -n "$baseline" ]; then
  if [ ! -f "$baseline" ]; then
    echo "Baseline file not found: $baseline" >&2
    exit 2
  fi
  set -- "$@" --baseline "$baseline"
fi

npx --no-install a11ygate "$@"
status=$?

# Pack evidence even when the scan failed, then report the scan's exit code.
if [ -d "$out_dir" ]; then
  if [ -n "$commit" ]; then
    npx --no-install a11ygate evidence pack --from "$out_dir" --out "$out_dir/a11ygate-evidence.zip" --commit "$commit" || echo "Evidence pack failed" >&2
  else
    npx --no-install a11ygate evidence pack --from "$out_dir" --out "$out_dir/a11ygate-evidence.zip" || echo "Evidence pack failed" >&2
  fi
fi

exit "$status"
