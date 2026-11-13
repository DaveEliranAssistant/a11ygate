# Accessibility evidence report — shop.example

> **Automated testing only. Not a WCAG audit, certification or legal advice. Automated axe-core checks detect only a subset of accessibility issues. They do not cover all of WCAG or the European Accessibility Act (EAA), and this report is not a claim of full compliance.**

## Scan details

| Field | Value |
| --- | --- |
| Scanned at | 2026-11-12T09:00:00.000Z |
| Previous scan | 2026-11-01T09:00:00.000Z |
| Generated | 2026-11-12T10:00:00.000Z |
| Commit | not recorded |
| Branch | not recorded |
| A11yGate | 0.1.0 |
| axe-core (current) | 4.14.0 |
| axe-core (previous scan) | 4.14.0 |
| Gate | FAIL at threshold serious — 3 new findings at or above serious: color-contrast, target-size. |
| Coverage | complete |

## Summary

| Severity | Current violations |
| --- | --- |
| Critical | 2 |
| Serious | 3 |
| Moderate | 1 |
| Minor | 0 |
| Unknown | 0 |
| Total | 6 |

| Status | Violations |
| --- | --- |
| New | 4 |
| Still open | 2 |
| Fixed | 1 |
| Unassessed (not verified fixed) | 0 |
| Current total | 6 |

Rules with current violations: 5. WCAG success criteria with findings: 4. Best-practice rules: 1.

## Scope

| Field | Value |
| --- | --- |
| Start URL | https://shop.example/ |
| Origin | https://shop.example |
| Page limit | 3 |
| Delay between pages | 1000 ms |
| robots.txt | robots.txt honoured. |
| User agent | `Mozilla/5.0 (compatible; A11yGate/0.1.0; +https://a11ygate.vercel.app) read-only accessibility scan` |
| axe-core tags | wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22a, wcag22aa, best-practice |

### Boundaries

- Only scan sites you own or are explicitly authorized to test.
- Automated testing only: axe-core detects a subset of WCAG issues. Absence of findings is not conformance, certification or legal advice.
- Read-only: pages were loaded without logging in, filling forms or clicking. Authenticated areas, interactions and dynamic states are unassessed.
- Only same-origin pages reachable through a\[href\] links \(at most 20\) were visited; robots.txt Disallow rules were honoured.

## Pages scanned

| Page | Scanned | axe-core | Scan | Violations | New | Still open | In previous scan |
| --- | --- | --- | --- | --- | --- | --- | --- |
| https://shop.example/ | 2026-11-12T09:00:00.000Z | 4.14.0 | complete | 4 | 3 | 1 | yes |
| https://shop.example/about | 2026-11-12T09:00:00.000Z | 4.14.0 | complete | 2 | 1 | 1 | yes |

### Pages not scanned

- https://shop.example/gone — failed: HTTP 404

### Links skipped and why

- Page limit reached \(--crawl cap\): 1
  - `https://shop.example/blog`
- Different origin \(not crawled\): 1
  - `https://other.example/`
- Not an http\(s\) link \(javascript:, mailto:, …\): 1
  - `mailto:hi@shop.example`
- Disallowed by robots.txt: 1
  - `https://shop.example/private/`

## Trend versus previous scan

Total violations: 3 in the previous scan, 6 now (+3): 4 new, 1 fixed, 2 still open.

| Rule | New | Fixed | Still open | Previous scan | Current | Change |
| --- | --- | --- | --- | --- | --- | --- |
| image-alt | 0 | 0 | 1 | 1 | 1 | 0 |
| label | 0 | 0 | 1 | 1 | 1 | 0 |
| color-contrast | 2 | 1 | 0 | 1 | 2 | +1 |
| region | 1 | 0 | 0 | 0 | 1 | +1 |
| target-size | 1 | 0 | 0 | 0 | 1 | +1 |
| **Total** | 4 | 1 | 2 | 3 | 6 | +3 |

## Findings by WCAG success criterion

WCAG success criteria are mapped from axe-core rule tags. The mapping needs expert review before it is relied on. A rule mapped to more than one criterion is listed under the first.

### WCAG 1.1.1 Non-text Content \(Level A, WCAG 2.1\)

Current findings: 1.

#### image-alt — critical

Images must have alternative text ([rule documentation](https://dequeuniversity.com/rules/axe/4.14/image-alt))

- How to fix: Provide contextual alternative text for informative images; use empty alt for genuinely decorative images.
- WCAG: 1.1.1 Non-text Content \(Level A, WCAG 2.1\)
- Counts: 0 new, 1 still open, 0 fixed, 0 unassessed

| Status | Severity | Page | Selector | Element |
| --- | --- | --- | --- | --- |
| Still open | critical | https://shop.example/ | `img.hero` | `<img class="hero" src="hero.jpg">` |

### WCAG 1.3.1 Info and Relationships \(Level A, WCAG 2.1\)

Current findings: 1.

#### label — critical

Form elements must have labels ([rule documentation](https://dequeuniversity.com/rules/axe/4.14/label))

- How to fix: Associate a visible label with the control and expose instructions/errors programmatically.
- WCAG: 1.3.1 Info and Relationships \(Level A, WCAG 2.1\); 4.1.2 Name, Role, Value \(Level A, WCAG 2.1\)
- Counts: 0 new, 1 still open, 0 fixed, 0 unassessed

| Status | Severity | Page | Selector | Element |
| --- | --- | --- | --- | --- |
| Still open | critical | https://shop.example/about | `#email` | `<input id="email" type="email">` |

### WCAG 1.4.3 Contrast \(Minimum\) \(Level AA, WCAG 2.1\)

Current findings: 2.

#### color-contrast — serious

Elements must meet minimum color contrast ratio thresholds ([rule documentation](https://dequeuniversity.com/rules/axe/4.14/color-contrast))

- How to fix: Adjust foreground/background colors to meet the applicable contrast ratio; include hover, focus and disabled states where relevant.
- WCAG: 1.4.3 Contrast \(Minimum\) \(Level AA, WCAG 2.1\)
- Counts: 2 new, 0 still open, 1 fixed, 0 unassessed

| Status | Severity | Page | Selector | Element |
| --- | --- | --- | --- | --- |
| New | serious | https://shop.example/ | `.price` | `<span class="price">€12</span>` |
| New | serious | https://shop.example/ | `footer a` | `<a href="/contact">Contact</a>` |
| Fixed | serious | https://shop.example/about | `.old-banner` | `<p class="old-banner">Old</p>` |

### WCAG 2.5.8 Target Size \(Minimum\) \(Level AA, WCAG 2.2\)

Current findings: 1.

#### target-size — serious

All touch targets must be 24px large, or leave sufficient space ([rule documentation](https://dequeuniversity.com/rules/axe/4.14/target-size))

- How to fix: All touch targets must be 24px large, or leave sufficient space Consult the rule guidance and review the actual component; automated advice is not a verified fix.
- WCAG: 2.5.8 Target Size \(Minimum\) \(Level AA, WCAG 2.2\)
- Counts: 1 new, 0 still open, 0 fixed, 0 unassessed

| Status | Severity | Page | Selector | Element |
| --- | --- | --- | --- | --- |
| New | serious | https://shop.example/about | `a.tiny` | `<a class="tiny" href="/terms">T</a>` |

## Best-practice rules (no WCAG success criterion)

### region — moderate

All page content should be contained by landmarks ([rule documentation](https://dequeuniversity.com/rules/axe/4.14/region))

- How to fix: All page content should be contained by landmarks Consult the rule guidance and review the actual component; automated advice is not a verified fix.
- WCAG: none mapped (best practice)
- Counts: 1 new, 0 still open, 0 fixed, 0 unassessed

| Status | Severity | Page | Selector | Element |
| --- | --- | --- | --- | --- |
| New | moderate | https://shop.example/ | `div.banner` | `<div class="banner">Sale</div>` |

## Disclaimer

Automated testing only. Not a WCAG audit, certification or legal advice. Automated axe-core checks detect only a subset of accessibility issues. They do not cover all of WCAG or the European Accessibility Act (EAA), and this report is not a claim of full compliance.
