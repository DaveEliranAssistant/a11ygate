# Show HN draft

Account: qeatlas

Title: Show HN: A11yGate – an accessibility regression gate for axe-core JSON

URL: https://a11ygate.vercel.app

First comment:

Try “Load demo data” on the site, or import current and baseline axe-core JSON files. A11yGate compares the results and reports new, fixed, and still-open findings. The default gate fails on new serious or critical violations. Missing or non-comparable scans are marked unassessed rather than fixed.

QE Atlas built A11yGate to gate accessibility regressions in code workflows. The browser tool processes scan files locally, without an account. For CI, the published CLI is @qe-atlas/a11ygate@0.1.0 and the GitHub Action is DaveEliranAssistant/a11ygate-action@v1. The CLI and Action have different baseline compatibility requirements; see setup and limitations: https://github.com/DaveEliranAssistant/a11ygate

Automated checks cover only part of accessibility. A11yGate is informational only, not legal advice or an EAA certification.

Feedback on baseline handling and where this would fit in your CI workflow would help.
