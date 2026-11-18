DRAFT — needs Eliran/legal review before use

# A11yGate free pilot terms (draft template)

Automated testing only. Not a WCAG audit, certification or legal advice.

> **Status: draft template, not final, not an offer.** Do not send, sign or rely on this text until Eliran and a qualified legal reviewer have replaced every `[[LEGAL REVIEW]]` and `[[MISSING]]` marker. The markers must stay in this file; a reviewed copy is made per customer.

## 1. Parties

- Provider: [[MISSING]] (business/legal entity name, registration number and address). [[LEGAL REVIEW]]
- Customer: [[MISSING]] (legal entity name, address, signatory).
- Pilot contacts: as listed in the [kickoff checklist](kickoff-checklist.md).

## 2. What the pilot is

- A free 21-day pilot of A11yGate: an automated accessibility regression gate that runs in the Customer's CI on PRs to the agreed branch, plus baseline, reports and an evidence pack.
- Start date: [[MISSING]]. End and decision date: [[MISSING]] (the 21st day of the pilot).
- Success criteria: agreed at kickoff using [`success-criteria.template.yml`](success-criteria.template.yml).

## 3. Price and billing

- The pilot costs $0. There is **no charge** for the pilot.
- **No payment details are collected and nothing bills automatically**, during or after the pilot. The pilot does not turn into a paid subscription by itself.
- After the pilot the Customer may choose to subscribe to A11yGate at $990 per year (USD, billed yearly). The subscription starts only on the Customer's **explicit written acceptance** (for example, a signed order or a purchase confirmed by the Customer through a hosted checkout or an invoice they request). If the Customer does nothing, the pilot simply ends.
- Taxes, invoicing entity and payment terms for a paid subscription: [[MISSING]] [[LEGAL REVIEW]]

## 4. Scope

Included:

- Setting up the gate in one repository and one CI system (GitHub Actions, GitLab CI, Azure DevOps or Jenkins).
- A fingerprint baseline of existing findings, so the gate blocks new findings only.
- Up to [[MISSING]] pages or flows, as listed in the success criteria.
- Weekly 30-minute check-ins and one evidence pack.

Excluded:

- Manual accessibility audits, assistive-technology (screen reader) testing, and usability testing with disabled users.
- Legal advice, certification, conformance statements or accessibility statements.
- Writing alt text, labels or accessible names for the Customer's content: the tool marks these for human review only.
- Fixing the Customer's code, except where separately agreed in writing.
- Scanning any site or environment that is not named in the site owner's written authorization.
- See also [What A11yGate does not do](../what-a11ygate-does-not-do.md).

## 5. Authorization to scan

- The Customer confirms in writing, before any scan, that the site owner authorizes scanning of the named URLs and environments for the pilot dates.
- Scans run read-only by default, on the same origin, honouring `robots.txt`. Authenticated pages are scanned only with test accounts the Customer controls.
- Customer responsibilities for the authorization: [[LEGAL REVIEW]]

## 6. Data handling

- Scan outputs (reports, evidence packs, optional screenshots) are created in the Customer's own CI and stay there by default.
- The Provider keeps copies only if the Customer agrees, for [[MISSING]] (retention period), and deletes them at the end of that period with a written confirmation.
- The Provider does not receive passwords. Test-account credentials stay in the Customer's CI secret store.
- Personal data, data-processing terms and cross-border transfer: [[LEGAL REVIEW]]
- Confidentiality of the Customer's code, findings and reports: [[LEGAL REVIEW]]

## 7. Access and end of pilot

- The Customer grants least-privilege access for the pilot only (see the [kickoff checklist](kickoff-checklist.md)).
- At the end of the pilot the Customer revokes that access, and the Provider confirms that retained data is deleted as in section 6.
- Either party may end the pilot early by written notice: [[LEGAL REVIEW]]

## 8. Limits of automated testing

- Automated tools find only part of the accessibility issues on a page. A passing gate does not mean a site is accessible or meets any law or standard.
- Warranties, disclaimers and limitation of liability: [[LEGAL REVIEW]]

## 9. Law and disputes

- Governing law, jurisdiction and dispute resolution: [[LEGAL REVIEW]]

## 10. Acceptance

- Signature blocks, date and method of acceptance for the pilot: [[MISSING]] [[LEGAL REVIEW]]

---

This file is a draft template. It is not final and is not an offer until reviewed and completed.

Automated testing only. Not a WCAG audit, certification or legal advice.
