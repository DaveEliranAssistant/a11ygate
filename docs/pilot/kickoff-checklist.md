# Pilot kickoff checklist

Automated testing only. Not a WCAG audit, certification or legal advice.

Use this checklist in the kickoff call for the free 21-day pilot. Copy it into the pilot's shared notes and tick items as they are done. "Owner" means the A11yGate operator (Eliran); "Customer" means the customer's named pilot contact. No scan of a customer site runs until every item in section 1 is ticked.

## 1. Authorization (before any scan)

- [ ] Customer: **written scan authorization from the site owner** for each target URL (email or signed note naming the URLs, the environments and the pilot dates). A11yGate must not scan a site without it.
- [ ] Owner: authorization stored with the pilot notes, with the date it was received.
- [ ] Customer: confirms the targets are their own application, or a staging or preview environment they control.
- [ ] Owner and Customer: agree that scans run against loopback or staging inside the customer's CI, not against production, unless the site owner's authorization names production.

## 2. Repository and CI access (least privilege)

- [ ] Customer: names the repository and the CI system (GitHub Actions, GitLab CI, Azure DevOps or Jenkins).
- [ ] Customer: grants the owner the **least access needed**: read access to the repository and permission to open PRs or merge requests. No admin, no organization-wide access, no production deploy rights.
- [ ] Customer: CI secrets stay with the customer. If authenticated pages need a test account, the customer stores it in their CI secret store; the owner never receives passwords.
- [ ] Customer's admin: makes the A11yGate job a required check for PRs to `main` (A11yGate never changes repository settings).
- [ ] Owner: records the access granted (who, what, when) in the pilot notes.

## 3. Scope

- [ ] Target URLs and start pages listed (local, preview or staging).
- [ ] Pages and flows to cover listed; the count goes into `pagesOrFlowsCovered.min` in the success criteria.
- [ ] Authenticated pages: covered through a Playwright storage state file (`--storage-state`) created with a **test account**, following [Authenticated pages](../authenticated-pages.md). Real user accounts are out of scope.
- [ ] Environments listed (for example: PR preview, staging). Production only if named in the written authorization.
- [ ] Fail-on level agreed (default `serious`).
- [ ] Out-of-scope items read together: [What A11yGate does not do](../what-a11ygate-does-not-do.md) (manual audit, assistive-technology testing, legal advice, certification).

## 4. People and cadence

- [ ] Customer: primary contact (name, role, email) and a backup contact.
- [ ] Owner: primary contact for the pilot.
- [ ] Weekly check-in booked (30 minutes, same slot each week, three sessions).
- [ ] Decision date booked: the last day of the pilot. Recorded as `pilot.decisionDate` in the success criteria.
- [ ] Success criteria filled in from [`success-criteria.template.yml`](success-criteria.template.yml) and agreed by both sides.

## 5. Data handling

- [ ] Agreed where scan outputs live (customer CI artifacts by default; the owner keeps copies only if the customer agrees).
- [ ] Screenshots stay off unless the customer opts in; if on, sensitive regions are masked (`--redact-selector`).
- [ ] Retention period for any copies the owner holds: [[MISSING]] (agree at kickoff; see the [pilot terms draft](pilot-terms.template.md)).
- [ ] Deletion method agreed: the owner deletes all copies of scan outputs, evidence packs and notes containing customer data at the end of the retention period, and confirms deletion in writing.

## 6. End of pilot

- [ ] Final evidence pack produced (`a11ygate evidence pack`) and handed to the customer.
- [ ] Decision recorded: convert, extend or stop. Conversion to a paid plan happens only on the customer's explicit written acceptance; nothing bills automatically.
- [ ] Customer: **revokes the owner's repository and CI access** granted in section 2, and removes any pilot-only tokens or service connections.
- [ ] Owner: confirms access is gone (for example, the repository no longer appears in their account).
- [ ] Owner: deletes retained data per section 5 and sends the written deletion confirmation.

Automated testing only. Not a WCAG audit, certification or legal advice.
