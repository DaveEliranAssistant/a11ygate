# Pilot onboarding kit

Automated testing only. Not a WCAG audit, certification or legal advice.

Customer-ready material for the free 21-day pilot of A11yGate ($0, no payment details collected, nothing bills automatically). After the pilot, the customer may choose the $990 per year subscription by explicit written acceptance. Price and pilot length come from [`config/pricing.json`](../../config/pricing.json); a test checks that the numbers in these docs match it.

| File | Use it for |
| --- | --- |
| [Quickstart](quickstart.md) | About 30 minutes from zero to a gated PR on GitHub Actions, GitLab CI, Azure DevOps or Jenkins, with output from real fixture runs. |
| [Kickoff checklist](kickoff-checklist.md) | Owner and customer checkboxes: least-privilege access, target URLs, written scan authorization from the site owner, authenticated pages, environments, contacts, weekly check-in, data retention and deletion, access revocation. |
| [Success criteria template](success-criteria.template.yml) | Machine-checkable pilot targets, validated by [`schema/pilot-success.schema.json`](../../schema/pilot-success.schema.json). |
| [Pilot terms draft](pilot-terms.template.md) | **Draft only: needs Eliran/legal review before use.** Never send it as final. |

## Pilot flow

1. Kickoff: go through the [kickoff checklist](kickoff-checklist.md). No scan before written authorization from the site owner.
2. Week 1: follow the [quickstart](quickstart.md); baseline the existing findings; make the gate a required check.
3. Weeks 2–3: weekly check-ins; new serious or critical findings get a fix or a recorded review decision.
4. Decision date: hand over an evidence pack and compare the results with the agreed success criteria. Convert, extend or stop.

See also [What A11yGate does not do](../what-a11ygate-does-not-do.md) and [Known limits](../known-limits.md).

Automated testing only. Not a WCAG audit, certification or legal advice.
