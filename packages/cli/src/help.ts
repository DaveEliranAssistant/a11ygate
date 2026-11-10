export function helpText(): string {
  return `a11ygate — accessibility regression gate for axe-core JSON

Usage:
  a11ygate --current <file> [--current <file>] [--baseline <file>] [options]
  a11ygate report --current <file> [--baseline <file>] [--format html|md|json] [--out <file>]

Options:
  -c, --current <file>         Current axe-core JSON. Repeat for more than one file.
                               Each file is one result, an array of results, or { "results": ... }.
  -b, --baseline <file>        Baseline axe-core JSON. Repeatable. Omit to treat every current finding as new.
  -t, --threshold <impact>     minor, moderate, serious, or critical. Default: serious.
                               Exit 1 only when a new finding is at or above this impact.
  -m, --markdown <file>        Also write the Markdown summary to this file. It is always printed.
  -j, --json <file>            Write the JSON result to this file. Use - to print JSON instead of Markdown.
      --update-baseline <file> Write a proposed baseline and <file>.review.json with exact accepted findings.
      --manual-evidence <file> Import schemaVersion 1 human evidence separately from automated checks.
  -h, --help                   Show this help.
      --version                Show the version.

Evidence report (a11ygate report):
  Takes the same --current, --baseline and --threshold options, plus:
  -f, --format <format>        html (default), md, or json. Inferred from the --out extension when omitted.
  -o, --out <file>             Write the report to this file. Omit or use - to print it.
      --generated-at <iso>     Fix the report timestamp, for reproducible output. Default: now.
      --commit <sha>           Commit to record. Default: $GITHUB_SHA when set.
      --branch <name>          Branch to record. Default: $GITHUB_HEAD_REF or $GITHUB_REF_NAME when set.
  The HTML report is one self-contained file with no external assets or scripts.
  report exits 0 once the report is written, whatever the gate verdict, and 2 on errors.

Exit codes:
  0  No detected new finding is at or above the threshold; existing debt/unassessed scope remain.
  1  At least one new finding is at or above the threshold.
  2  Incomplete scan coverage, unsafe outputs, invalid evidence, or unreadable arguments/JSON.

Examples:
  npx @qe-atlas/a11ygate --current axe.json --baseline a11y/baseline.json
  npx @qe-atlas/a11ygate --current home.json --current cart.json --threshold critical --json result.json
  npx @qe-atlas/a11ygate --current axe.json --update-baseline a11y/baseline.json
  npx @qe-atlas/a11ygate report --current axe.json --baseline a11y/baseline.json --out a11y-report.html

A file larger than 8 MB is refused. The same diff and gate as the web app are used.
This source build is unreleased; published 0.1.0 does not include these coverage/manual features.
PASS is not legal advice or certification. Baseline updates never clear the current gate result.
`;
}
