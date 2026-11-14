export function helpText(): string {
  return `a11ygate — accessibility regression gate for axe-core JSON

Usage:
  a11ygate baseline create [<scan.json|out-dir>] [--output <file>]
  a11ygate report <scan.json|out-dir> [--baseline <fingerprints.json>] [--out-dir <dir>]
  a11ygate [ci] --current <file> [--current <file>] [--baseline <file>] [options]
  a11ygate scan <url> [--crawl [n]] [--fail-on <impact>] [--out-dir <dir>] [--format <fmt>]
                       (see a11ygate scan --help)
  a11ygate evidence pack --from <scan-out-dir> [--out <file.zip>] [--commit <sha>]
                       (see a11ygate evidence --help)

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
      --format <fmt>           Output format: junit, sarif, json, or md. Repeat or comma-separate for several.
                               Requires --out-dir. Exit codes are unchanged.
      --out-dir <dir>          Write a11ygate.json and a11ygate.md here, plus any --format files
                               (a11ygate.junit.xml, a11ygate.sarif).
  -h, --help                   Show this help.
      --version                Show the version.

Exit codes:
  0  No detected new finding is at or above the threshold; existing debt/unassessed scope remain.
  1  At least one new finding is at or above the threshold.
  2  Incomplete scan coverage, unsafe outputs, invalid evidence, or unreadable arguments/JSON.

Examples:
  npx @qe-atlas/a11ygate --current axe.json --baseline a11y/baseline.json
  npx @qe-atlas/a11ygate --current home.json --current cart.json --threshold critical --json result.json
  npx @qe-atlas/a11ygate --current axe.json --update-baseline a11y/baseline.json

A file larger than 8 MB is refused. The same diff and gate as the web app are used.
This source build is unreleased; published 0.1.0 does not include these coverage/manual features.
PASS is not legal advice or certification. Baseline updates never clear the current gate result.
`;
}
