# Outreach template: first-touch email (EN)

> **DRAFT.** Eliran sends this himself. Review before sending.

Automated testing only. Not a WCAG audit, certification or legal advice.

**To:** the prospect, after a warm intro or when there is a clear public reason to write. Keep it short. `{{why_now}}` must be public and dated with its link in `{{why_now_source}}`; never write that their site "fails" anything unless you scanned it with their written permission (see the [owner runbook](../owner-runbook.md)).

## Message (EN)

<!-- message:start -->
Subject: Catching new accessibility regressions in {{prospect_company}}'s CI

Hi {{prospect_first_name}},

{{why_now}} (source: {{why_now_source}}).

A11yGate is a CI gate with evidence, not an overlay widget: nothing is injected into your pages. It runs automated accessibility checks (axe-core) in {{ci_system}} on each pull request, records the findings you already have as a baseline, and fails the check only when a new serious or critical finding appears. Each run keeps its scan report as a build artifact in your own CI. At the pilot milestones (kickoff, mid-pilot and the decision date) I also make an evidence pack: the reports, a scope statement, what automated testing cannot cover, and a manifest with hashes.

I'm running a free {{pilot_length_days}}-day pilot with a few teams: no payment details, nothing billed automatically. Would a 15-minute call to see if it fits be useful? A few times that work for me: {{demo_slots}}.

Best,
{{sender_name}}

Automated testing only. Not a WCAG audit, certification or legal advice.
<!-- message:end -->

## Message (HE)

[[HE: Eliran to write]] Hebrew version written by Eliran, not machine-translated. The disclaimer line stays in English, word for word.
