# Pilot onboarding kit

Automated testing only. Not a WCAG audit, certification or legal advice.

Customer-ready material for the free 21-day pilot of A11yGate ($0, no payment details collected, nothing bills automatically). After the pilot, the customer may choose the $990 per year subscription by explicit written acceptance. Price and pilot length come from [`config/pricing.json`](../../config/pricing.json); a test checks that the numbers in these docs match it.

| File | Use it for |
| --- | --- |
| [Quickstart](quickstart.md) | About 30 minutes from zero to a gated PR on GitHub Actions, GitLab CI, Azure DevOps or Jenkins, with output from real fixture runs. |
| [Kickoff checklist](kickoff-checklist.md) | Owner and customer checkboxes: least-privilege access, target URLs, written scan authorization from the site owner, authenticated pages, environments, contacts, weekly check-in, data retention and deletion, access revocation. |
| [Success criteria template](success-criteria.template.yml) | Machine-checkable pilot targets, validated by [`schema/pilot-success.schema.json`](../../schema/pilot-success.schema.json). |
| [Pilot terms draft](pilot-terms.template.md) | **Draft only: needs Eliran/legal review before use.** Never send it as final. |
| [Outreach kit](outreach/README.md) | **Drafts only: Eliran sends every message himself.** Warm intro, first touch, follow-ups, demo invite, recap, pilot proposal, conversion email and honest answers to objections, with placeholders for price and pilot length. |

See the [sample deliverables](../samples/README.md) (built from our demo app, marked SAMPLE) for what a pilot produces.

## Pilot flow

1. Kickoff: go through the [kickoff checklist](kickoff-checklist.md). No scan before written authorization from the site owner.
2. Week 1: follow the [quickstart](quickstart.md); baseline the existing findings; make the gate a required check.
3. Weeks 2–3: weekly check-ins; new serious or critical findings get a fix or a recorded review decision.
4. Decision date: hand over an evidence pack and compare the results with the agreed success criteria. Convert, extend or stop.

## Close out a pilot

Run `a11ygate pilot report --kickoff kickoff.zip --latest latest.zip --packs evidence --criteria a11ygate-pilot/success-criteria.yml` with local Playwright Chromium installed. The command writes `pilot-results.html`, `pilot-results.pdf`, `quote.html` and `quote.pdf` to `pilot-report`. Use `--out-dir` to choose another destination and `--customer` to override the name in the criteria file. The optional `--packs` directory adds runs to the timeline. The timeline orders by commit time when every pack records it and uses scan times otherwise.

Coverage uses completed pages and recorded interaction states in the latest scan. Name specific targets with paths such as `/checkout`, page URLs, or recorded interaction names or URLs. Other operational criteria need records from CI, the repository or the handoff. To include them, place `a11ygate-pilot-evidence.json` in a scan output directory before running `a11ygate evidence pack`. Record observations only when you have the supporting records. Include `schemaVersion: 1` and use the optional fields in the [pilot evidence schema](../../schema/pilot-evidence.schema.json).

- `baselineCommitted` records whether a fingerprint baseline is committed to the pilot repository.
- `gate` records the target branch, inclusive UTC dates, whether the check was required throughout the window, counts of distinct PRs, and counts of distinct PRs with a gate run. The success criterion uses the full kickoff-to-decision window.
- `postWeekTwoMerges` records the target branch, inclusive UTC dates from day 15 through the decision date, and the count of new serious or critical findings merged without a recorded review decision in that window.
- `evidenceDeliveredOn` records the UTC date an evidence pack was actually handed to the customer.

Include the observations for the criteria in the latest pack. The report also shows the PR-gate records from the other supplied packs. Missing, partial or invalid history can leave a criterion marked **Not measurable**.

The draft quote uses the repository pricing config at build time. At runtime, a valid HTTPS checkout URL in `A11YGATE_CHECKOUT_URL` appears on the payment line. Otherwise the quote reads “invoice on request.” Eliran reviews the quote, legal and tax wording, invoice issuer details and buyer details before sending.

See also [What A11yGate does not do](../what-a11ygate-does-not-do.md) and [Known limits](../known-limits.md).

Automated testing only. Not a WCAG audit, certification or legal advice.
