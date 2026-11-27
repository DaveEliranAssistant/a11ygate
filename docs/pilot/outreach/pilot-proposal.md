# Outreach template: pilot proposal

> **DRAFT.** Eliran sends this himself. Review before sending.

Automated testing only. Not a WCAG audit, certification or legal advice.

**When:** after the post-demo recap, when the prospect wants to go ahead. The scope comes from the [kickoff checklist](../kickoff-checklist.md) and the [success criteria template](../success-criteria.template.yml). The [pilot terms](../pilot-terms.template.md) are a **draft that needs Eliran/legal review**; don't attach them until a reviewed copy exists. Price and length come from [`config/pricing.json`](../../../config/pricing.json) through `{{price_usd_per_year}}` and `{{pilot_length_days}}`; never type the numbers by hand.

> **DRAFT: wording pending legal review.** The access, data and price lines below follow the [kickoff checklist](../kickoff-checklist.md) and the draft [pilot terms](../pilot-terms.template.md). The default retention period is an Eliran/legal decision (still open in the kickoff checklist and terms); don't add a number here.

## Message (EN)

<!-- message:start -->
Subject: A11yGate pilot proposal for {{prospect_company}}

Hi {{prospect_first_name}},

As discussed, here is the proposal for a free pilot. Why now: {{why_now}} (source: {{why_now_source}}).

Scope (from our kickoff checklist: {{kickoff_checklist_link}}):
{{proposed_scope}}
- CI: {{ci_system}}. The gate runs inside your CI on pull requests; your admin decides whether it becomes a required check.
- Before any scan: written authorization from the site owner naming the URLs, environments and dates.
- Access: the least needed (read access and permission to open pull requests), granted by you. Secrets stay in your CI. At the end you revoke the access you granted and remove any pilot-only tokens; we can't do that for you.
- Data: scan outputs stay in your CI by default. We keep copies (scan output, evidence packs) only if you agree, and delete them at the end of the retention period agreed at kickoff, then confirm the deletion in writing.

Dates: {{pilot_length_days}} days, from {{pilot_start_date}} to the decision date {{decision_date}}, with a 30-minute check-in each week.

Success criteria: {{success_criteria_link}}. On the decision date you get the pilot results and an evidence pack, compared with these criteria.

Price: the pilot is free. No payment details are collected and nothing is billed automatically. After the pilot, it converts to the paid plan at USD {{price_usd_per_year}} per year only if you say yes in writing. If you don't, the pilot simply ends: you revoke the access you granted, and we delete any copies we hold on the agreed retention schedule.

What it is not: automated testing only. It does not replace a manual audit or assistive-technology testing, it is not legal advice, and it issues no certificate.

If this works, reply with a yes for the pilot (not for the paid plan) and two kickoff times that suit you.

Best,
{{sender_name}}

Automated testing only. Not a WCAG audit, certification or legal advice.
<!-- message:end -->

## Message (HE)

[[HE: Eliran to write]] Hebrew version written by Eliran, not machine-translated. The disclaimer line stays in English, word for word.
