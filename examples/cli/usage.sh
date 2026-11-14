# Everyday CLI calls for your own axe JSON files (paths are examples).
# tests/readme-docs.test.ts executes every line of this file against generated axe JSON and checks each "# exit N" comment.
# Automated testing only. Not a WCAG audit, certification or legal advice.
npx @qe-atlas/a11ygate --help # exit 0
mkdir -p a11y
npx @qe-atlas/a11ygate --current axe.json --update-baseline a11y/baseline.json --markdown summary.md # exit 1
npx @qe-atlas/a11ygate --current axe.json --baseline a11y/baseline.json # exit 0
npx @qe-atlas/a11ygate --current home.json --current cart.json --threshold critical --json result.json # exit 0
