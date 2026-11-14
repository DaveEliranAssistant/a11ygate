# A11yGate 5-minute quickstart. Run from a checkout of this repository after `npm install`.
# tests/readme-docs.test.ts executes every line of this file and checks each "# exit N" comment.
# Automated testing only. Not a WCAG audit, certification or legal advice.

# 1. Gate the synthetic Demo Shop scan against its baseline: 2 new, 3 fixed, 5 still open, FAIL.
npx a11ygate --current fixtures/demo-shop-current.json --baseline fixtures/demo-shop-baseline.json # exit 1

# 2. Only critical findings fail at --threshold critical, so the new serious finding no longer fails.
npx a11ygate --current fixtures/demo-shop-current.json --baseline fixtures/demo-shop-baseline.json --threshold critical # exit 0

# 3. Write the current results as the next baseline. The exit code is still the gate's result.
mkdir -p a11y
npx a11ygate --current fixtures/demo-shop-current.json --baseline fixtures/demo-shop-baseline.json --update-baseline a11y/baseline.json --markdown a11y/summary.md # exit 1

# 4. Gate the same scan against the new baseline: nothing is new, PASS.
npx a11ygate --current fixtures/demo-shop-current.json --baseline a11y/baseline.json # exit 0
