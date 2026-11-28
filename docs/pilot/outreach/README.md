# Outreach kit (drafts)

> **DRAFT.** Eliran sends this himself. Review before sending.

Automated testing only. Not a WCAG audit, certification or legal advice.

Ready-to-edit message drafts for the first pilot conversations (warm intros in Israel and the EU). **Never send automatically.** Eliran sends every message himself, by hand, after reviewing it. Nothing in A11yGate sends email, messages or notifications, and nothing here should be wired into a mailer, CRM sequence or LinkedIn tool.

**Public repository.** These files contain placeholders only. Per-prospect copies (with names, companies, research notes or scan results) live **outside this repository**, in Eliran's own notes. Never commit a filled-in copy.

## Generate a private kit

Run `a11ygate outreach kit --prospect prospect.yml` with a local Playwright Chromium installation. Start with the [fictional example](../../../tests/fixtures/outreach/prospect.example.yml) and [profile schema](../../../schema/outreach-prospect.schema.json). Keep your filled profile, scan exports and rendered drafts in private storage. The default destination is `~/a11ygate-prospects/<company-slug>/`. An explicit `--out-dir` can point to another private directory. Git work trees are refused unless you pass `--allow-in-repo`, which writes an ignore-all rule in the output directory.

The kit includes ten drafts, a one-pager with CI starter and PDF, sample results, and a manifest with input hashes, the offer config, and the invoking Git commit when available. The guide itself stays here. Review the bracketed fields and the LinkedIn character count before sending. For `ci_system: other`, the one-pager links to the integration guides.

The kit runs offline and uses the demo fixture by default. Eliran alone may run `a11ygate prospect` for a real prospect after obtaining written approval. Add `--outreach-data` and an explicit private `--out-dir` to that URL run to save the scan JSON with its approval manifest, then pass that directory to the kit with `--scan-dir`. The optional approval fields in the profile are planning notes. The kit reads the approval record from the scan manifest. Eliran reviews and sends each message himself.

## Templates

| Step | Template | Typical timing |
| --- | --- | --- |
| 0 | [Warm intro request](warm-intro-request.md) (to a mutual contact) | Day 0 |
| 1 | [First-touch email](first-touch-email.md) or [first-touch LinkedIn message](first-touch-linkedin.md) (300 characters or fewer) | After the intro, or day 0 when there is no intro |
| 2 | [Follow-up 1](follow-up-1.md) | About 4 business days after step 1, only if there was no reply |
| 3 | [Follow-up 2 (last)](follow-up-2.md) | About a week after follow-up 1, only if there was no reply; then stop |
| 4 | [Demo invite](demo-invite.md) | As soon as the prospect agrees to a call |
| 5 | [Post-demo recap](post-demo-recap.md) | Same day as the demo |
| 6 | [Pilot proposal](pilot-proposal.md) | When the prospect wants to go ahead, usually within 2 business days of the recap |
| 7 | [Conversion email](conversion-email.md) (attach pilot results and quote) | On or right after the pilot decision date |
| any | [Objections and honest answers](objections.md) | Whenever a question comes up |

The timings are suggestions, not a schedule to automate. At most two follow-ups; a "no" or "not now" ends the sequence. Pilot steps follow the [pilot onboarding kit](../README.md) and the [owner runbook](../owner-runbook.md).

## Rules for every template

- Each file starts with the DRAFT banner "Eliran sends this himself. Review before sending." Remove the banner and the notes, and send only the text between the message markers.
- The disclaimer line "Automated testing only. Not a WCAG audit, certification or legal advice." stays in every message, in English, word for word. It is never translated.
- Hebrew versions are **not** machine-translated. Each template has a `[[HE: Eliran to write]]` stub; Eliran writes the Hebrew text himself.
- Price and pilot length are never typed by hand: use `{{price_usd_per_year}}` and `{{pilot_length_days}}`. The kit fills both from [`config/pricing.json`](../../../config/pricing.json).
- Every customer-visible piece carries the disclaimer "Automated testing only. Not a WCAG audit, certification or legal advice.", in English, word for word. Parts meant to be pasted or forwarded on their own (each answer in [objections](objections.md), the forwardable blurb in the [warm intro request](warm-intro-request.md)) sit between `copy:start` and `copy:end` HTML comment markers and end with the disclaimer: copy the whole unit, and include the disclaimer line in every reply.
- The `{{why_now}}` sentence must be public, dated and checkable, and is always followed by its link in `{{why_now_source}}`. If there is no source, delete the sentence.
- No claims that a site will meet a law or standard, no certificates, no promises of results, and no names of other vendors. The positioning is "a CI gate with evidence, not an overlay widget". Answers to hard questions come from [what A11yGate does not do](../../what-a11ygate-does-not-do.md) and [known limits](../../known-limits.md).
- Never write that a prospect's site has problems unless it was scanned with written permission from the site owner (see the [kickoff checklist](../kickoff-checklist.md)). Never invent alt text, labels or accessible names in a message.

`tests/outreach-templates.test.ts` checks the banner, the disclaimer (in every message and every copy unit), the placeholder list below, the absence of literal prices and pilot lengths, the `{{why_now}}` → `{{why_now_source}}` order, the LinkedIn length and the banned-claims and vendor-name grep.

## Placeholders

Only these placeholders may appear in the templates. The test holds the same list.

| Placeholder | Filled with |
| --- | --- |
| `{{prospect_first_name}}` | The prospect's first name |
| `{{prospect_company}}` | The prospect's company |
| `{{prospect_role}}` | The prospect's role |
| `{{contact_first_name}}` | First name of the mutual contact (warm intro) |
| `{{sender_name}}` | Sender's name and signature |
| `{{why_now}}` / `{{why_now_source}}` | A public, dated reason to write now, then the link to its source (the source always comes right after) |
| `{{price_usd_per_year}}` | `priceUsdPerYear` from `config/pricing.json` (rendered by A11Y-R78) |
| `{{pilot_length_days}}` | `pilot.lengthDays` from `config/pricing.json` (rendered by A11Y-R78) |
| `{{ci_system}}` | The prospect's CI system (GitHub Actions, GitLab CI, Azure DevOps or Jenkins) |
| `{{demo_slots}}` | A few proposed call times |
| `{{demo_date}}` | The agreed demo date and time |
| `{{meeting_link}}` | Calendar or video-call link |
| `{{observed_summary}}` | What was shown in the demo (fixture, or a scan made with written permission) |
| `{{proposed_scope}}` | Pages, flows and environments from the kickoff checklist, as a short list |
| `{{pilot_start_date}}` | Pilot start date |
| `{{decision_date}}` | Pilot decision date (`pilot.decisionDate` in the success criteria) |
| `{{kickoff_checklist_link}}` | Link to the prospect's copy of the kickoff checklist |
| `{{success_criteria_link}}` | Link to the prospect's copy of the success criteria |
| `{{pilot_results_attachment}}` | File name of the attached `pilot-results.pdf` |
| `{{quote_attachment}}` | File name of the attached draft `quote.pdf` |
| `{{payment_option}}` | The checkout link, or "invoice on request" |

Automated testing only. Not a WCAG audit, certification or legal advice.
