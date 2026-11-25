# Outreach template: conversion email (pilot results and quote)

> **DRAFT.** Eliran sends this himself. Review before sending.

Automated testing only. Not a WCAG audit, certification or legal advice.

**When:** on or right after the decision date. Attach the files written by `a11ygate pilot report` (see [Close out a pilot](../README.md#close-out-a-pilot)): `pilot-results.pdf` as `{{pilot_results_attachment}}` and the draft `quote.pdf` as `{{quote_attachment}}`. Review the quote's legal and tax wording before sending (see the [owner runbook](../owner-runbook.md)). `{{payment_option}}` is the checkout link or "invoice on request".

## Message (EN)

<!-- message:start -->
Subject: {{prospect_company}} pilot results and next step

Hi {{prospect_first_name}},

The {{pilot_length_days}}-day pilot ended on {{decision_date}}. Attached:
- Pilot results, compared with the success criteria we agreed: {{pilot_results_attachment}}
- A quote for continuing: {{quote_attachment}}

Why now: {{why_now}} (source: {{why_now_source}}).

Continuing means the paid plan at USD {{price_usd_per_year}} per year. Nothing has been or will be billed automatically: it starts only if you reply with a written yes. Payment: {{payment_option}}.

If you'd rather stop, that's fine too. Please revoke the pilot access (repository and CI) and I'll confirm in writing that we deleted any copies we hold.

The results are automated testing only. They show what the scans found on the pages and states they covered, not that the site is accessible.

Best,
{{sender_name}}

Automated testing only. Not a WCAG audit, certification or legal advice.
<!-- message:end -->

## Message (HE)

[[HE: Eliran to write]] Hebrew version written by Eliran, not machine-translated. The disclaimer line stays in English, word for word.
