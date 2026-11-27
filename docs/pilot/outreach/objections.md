# Outreach template: objections and honest answers

> **DRAFT.** Eliran sends this himself. Review before sending.

Automated testing only. Not a WCAG audit, certification or legal advice.

**Use:** copy one answer into a reply, or use it on a call. Each answer below is one copy unit that ends with the disclaimer: copy the whole unit, and include the disclaimer line in every reply, even when you paste only one answer or shorten it. Every answer comes from [what A11yGate does not do](../../what-a11ygate-does-not-do.md) and [known limits](../../known-limits.md); don't go beyond them. If a question isn't covered here, say you'll check and come back, rather than guessing. The same list, shorter, is in the [demo script](../demo-script.md#likely-objections-and-honest-answers).

## Answers (EN)

<!-- message:start -->
<!-- copy:start -->
**"Is this one of those overlay widgets?"**
No. A11yGate is a CI gate with evidence, not an overlay widget. Nothing is injected into your pages and nothing changes for your visitors. It runs in your CI on your code, before release, and fails the check when a new serious or critical finding appears.

Automated testing only. Not a WCAG audit, certification or legal advice.
<!-- copy:end -->

<!-- copy:start -->
**"If we use it, are we covered for the EAA / legally safe?"**
No. Using A11yGate does not make a site meet any law or standard on its own, and it is not legal advice. A pass means no new finding at or above the threshold was detected on the scanned pages; it does not mean the pages are accessible. Whether the European Accessibility Act applies to you, and what it requires, is a question for a qualified lawyer. Details: https://github.com/DaveEliranAssistant/a11ygate/blob/main/docs/what-a11ygate-does-not-do.md

Automated testing only. Not a WCAG audit, certification or legal advice.
<!-- copy:end -->

<!-- copy:start -->
**"Do you give us a certificate or a badge?"**
No. A11yGate issues no certificates, badges or seals, and nobody at A11yGate reviews your site. Reports are evidence of what an automated run found on the pages it scanned, at that time.

Automated testing only. Not a WCAG audit, certification or legal advice.
<!-- copy:end -->

<!-- copy:start -->
**"Does it replace a manual audit?"**
No. Automated rules detect only some WCAG failures. Alt text quality, headings and labels that make sense, focus order, helpful error messages and zoom need a person to judge them.

Automated testing only. Not a WCAG audit, certification or legal advice.
<!-- copy:end -->

<!-- copy:start -->
**"Do you test with screen readers?"**
No. A11yGate does not drive NVDA, JAWS, VoiceOver or TalkBack, and does not involve disabled users. Pair it with manual and assistive-technology testing.

Automated testing only. Not a WCAG audit, certification or legal advice.
<!-- copy:end -->

<!-- copy:start -->
**"Will it find every problem on our site?"**
No. A scan covers only the pages it loaded and the states it reached. Content behind interactions, or logins it was not given, is not checked. Authenticated scans have recorded gaps (no interactive MFA, for example). The full list: https://github.com/DaveEliranAssistant/a11ygate/blob/main/docs/known-limits.md

Automated testing only. Not a WCAG audit, certification or legal advice.
<!-- copy:end -->

<!-- copy:start -->
**"We already have hundreds of issues. Won't it just fail every build?"**
No. The existing findings are recorded as a baseline. They stay listed as existing, and a new serious or critical finding (the default threshold) fails the gate; existing ones don't. Setup or scan errors, such as an unreadable baseline, also fail it. So the check can stay on while your team works the old ones down.

Automated testing only. Not a WCAG audit, certification or legal advice.
<!-- copy:end -->

<!-- copy:start -->
**"Will it write the code changes for us?"**
Only in a limited way. Rule-based suggestions cover a few rules, and any text containing `TODO(a11ygate)` is a placeholder a person must replace. We never write alt text or labels for you.

Automated testing only. Not a WCAG audit, certification or legal advice.
<!-- copy:end -->

<!-- copy:start -->
**"Does it run in our CI?"**
GitHub Actions, GitLab CI, Azure DevOps and Jenkins have starter templates. Some CI templates have not run on a real hosted runner yet; the CI matrix in the README says what was run where.

Automated testing only. Not a WCAG audit, certification or legal advice.
<!-- copy:end -->

<!-- copy:start -->
**"Will you scan our site before we agree?"**
No. We scan only with written authorization from the site owner, naming the URLs, environments and dates.

Automated testing only. Not a WCAG audit, certification or legal advice.
<!-- copy:end -->

<!-- copy:start -->
**"What does it cost, and what happens after the pilot?"**
The pilot is free for {{pilot_length_days}} days: no payment details, nothing billed automatically. After it, the paid plan is USD {{price_usd_per_year}} per year, and it starts only on your written yes. Otherwise the pilot ends: you revoke the access you granted (we can't do that for you), and we delete any copies we hold on the retention schedule agreed at kickoff.

Automated testing only. Not a WCAG audit, certification or legal advice.
<!-- copy:end -->

<!-- copy:start -->
**"Why should we look at this now?"**
{{why_now}} (source: {{why_now_source}}). If the timing is wrong, the offer stands for later.

Automated testing only. Not a WCAG audit, certification or legal advice.
<!-- copy:end -->
<!-- message:end -->

## Answers (HE)

[[HE: Eliran to write]] Hebrew answers written by Eliran, not machine-translated. The disclaimer line stays in English, word for word.
