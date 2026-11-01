export function helpText(): string {
  return `a11ygate — accessibility regression gate for axe-core JSON

Usage:
  a11ygate --current <file> [--current <file>] [--baseline <file>] [options]

Options:
  -c, --current <file>         Current axe-core JSON. Repeat for more than one file.
                               Each file is one result, an array of results, or { "results": ... }.
  -b, --baseline <file>        Baseline axe-core JSON. Repeatable. Omit to treat every current finding as new.
  -t, --threshold <impact>     minor, moderate, serious, or critical. Default: serious.
                               Exit 1 only when a new finding is at or above this impact.
  -m, --markdown <file>        Also write the Markdown summary to this file. It is always printed.
  -j, --json <file>            Write the JSON result to this file. Use - to print JSON instead of Markdown.
      --update-baseline <file> Write the current results as a baseline JSON file.
  -h, --help                   Show this help.
      --version                Show the version.

Exit codes:
  0  No new finding is at or above the threshold.
  1  At least one new finding is at or above the threshold.
  2  The arguments or the JSON could not be read.

Examples:
  npx a11ygate --current axe.json --baseline a11y/baseline.json
  npx a11ygate --current home.json --current cart.json --threshold critical --json result.json
  npx a11ygate --current axe.json --update-baseline a11y/baseline.json

A file larger than 8 MB is refused. The same diff and gate as the web app are used.
`;
}
