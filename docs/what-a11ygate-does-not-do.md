# What A11yGate does not do

Automated testing only. Not a WCAG audit, certification or legal advice.

**Informational only. Not legal advice. Not a certification of EAA compliance.** Automated checks cover only part of WCAG; this is evidence, not certification.

A11yGate runs automated rule engines (axe-core by default) and compares their results with a baseline. That is useful for catching regressions in CI. It does not replace the work below.

## It is not a manual accessibility audit

Automated rules detect only some WCAG failures. Many success criteria need a person to judge them: whether alt text describes the image, whether headings and labels make sense, whether focus order follows the content, whether error messages help, whether content works at 400% zoom. A PASS means no new finding at or above the threshold was detected on the scanned pages. It does not mean the pages are accessible.

The `/report` view lists keyboard, screen reader and focus-order checks as **manual** items. A11yGate does not run them. Manual evidence recorded with the CLI is self-reported: reviewer identity and freshness are not verified, and it does not change the automated gate. See the [evidence policy](CI_EVIDENCE_POLICY.md).

## It does not test with assistive technology

A11yGate does not drive screen readers (NVDA, JAWS, VoiceOver, TalkBack), switch access, voice control, or screen magnifiers, and it does not involve disabled users. Headless Chromium and the accessibility tree are not a substitute for testing with the assistive technology people use.

## It is not legal advice

The EU Accessibility Act evidence report, the EN 301 549 clause mapping and the accessibility statement draft are informational. The standards table needs expert review before anyone uses it as compliance evidence, and the statement draft is not a filed legal statement. Whether a product or service falls under the Act, and what it must do, is a question for a qualified lawyer.

## It does not certify anything

A11yGate does not issue certificates, conformance claims, badges or seals, and no one at A11yGate reviews your site. Reports are evidence of what an automated run found on the pages it scanned, at that time, with that configuration.

## Other limits

- **Coverage.** A scan covers only the pages it loaded (`--crawl` stops at 20 same-origin pages) in the states it reached. Content behind interactions, logins it was not given, or other viewports is not checked.
- **Fingerprints.** Findings are matched by `rule id + normalised selector + page path`. A fingerprint can miss an element that moved to a different stable selector, and can merge two elements if normalisation removes the only difference between them.
- **No baseline.** With no baseline, every current finding is new.
- **Mapping.** `wcag*` tags are mapped to WCAG 2.1/2.2 criteria and EN 301 549 clause 9 numbers in [`lib/mapping.ts`](../lib/mapping.ts). Tags that do not map are reported as best practice. A specialist needs to confirm the edition, especially for WCAG 2.2 additions.
- **Suggested changes.** Rule-based suggestions cover a few rules. Text containing `TODO(a11ygate)` is a placeholder that can make the automated check pass while the page is still not accessible.
- **Authorization.** Only scan sites you own or are authorized to test.
- **CI support.** Each CI integration is tested only as far as the [CI matrix](../README.md#ci-matrix) states.

See also [troubleshooting](troubleshooting.md).
