# Accessibility evidence report — demo.shop

> Automated checks only (axe-core). Not a WCAG conformance audit, certification, or legal advice. Automated tools detect a subset of accessibility issues.

**SYNTHETIC evidence — not a real audit or customer assessment.**

## Scan details

| Field | Value |
| --- | --- |
| Generated | 2026-11-10T09:00:00.000Z |
| Commit | `0123456789abcdef0123456789abcdef01234567` |
| Branch | `feat/checkout` |
| A11yGate | 0.1.0 |
| axe-core (current) | 4.10.2 |
| axe-core (baseline) | 4.10.2 |
| Gate | FAIL at threshold serious — 1 new finding at or above serious: color-contrast. |
| Coverage | unverified |

## Summary

| Status | Violations |
| --- | --- |
| New | 2 |
| Baselined (still open) | 5 |
| Fixed | 3 |
| Unassessed (not verified fixed) | 0 |
| Current total | 7 |

Rules with current violations: 7.

## Pages scanned

| Page | Scanned | axe-core | Scan | Violations | New | Baselined | In baseline |
| --- | --- | --- | --- | --- | --- | --- | --- |
| https://demo.shop/ | 2026-10-15T09:00:00.000Z | 4.10.2 | complete | 2 | 0 | 2 | yes |
| https://demo.shop/cart | 2026-10-15T09:00:10.000Z | 4.10.2 | complete | 2 | 1 | 1 | yes |
| https://demo.shop/products | 2026-10-15T09:00:05.000Z | 4.10.2 | complete | 3 | 1 | 2 | yes |

### Coverage issues

- configuration-unrecorded on `/`: Rule selection, exclusions, viewport and authentication context were not fully recorded; equivalence is unverified.
- configuration-unrecorded on `/cart`: Rule selection, exclusions, viewport and authentication context were not fully recorded; equivalence is unverified.
- configuration-unrecorded on `/products`: Rule selection, exclusions, viewport and authentication context were not fully recorded; equivalence is unverified.

## Trend versus baseline

Total violations: 8 in the baseline, 7 now (-1).

| Rule | Baseline | Current | Change |
| --- | --- | --- | --- |
| aria-required-attr | 1 | 0 | -1 |
| document-title | 1 | 0 | -1 |
| button-name | 1 | 1 | 0 |
| color-contrast | 1 | 1 | 0 |
| html-has-lang | 1 | 1 | 0 |
| image-alt | 1 | 1 | 0 |
| label | 1 | 1 | 0 |
| link-name | 1 | 1 | 0 |
| region | 0 | 1 | +1 |

## Violations by rule

WCAG success criteria are mapped from axe-core rule tags. The mapping needs expert review before it is relied on.

### button-name — critical

Buttons must have discernible text ([rule documentation](https://dequeuniversity.com/rules/axe/4.10/button-name))

- WCAG: 4.1.2 Name, Role, Value \(Level A, WCAG 2.1\)
- Counts: 0 new, 1 baselined, 0 fixed, 0 unassessed

| Status | Impact | Page | Selector | Element |
| --- | --- | --- | --- | --- |
| Baselined | critical | https://demo.shop/products | `#ember9901 > button.add-to-cart` | `<button class="add-to-cart" id="ember9901"></button>` |

### color-contrast — serious

Elements must have sufficient color contrast ([rule documentation](https://dequeuniversity.com/rules/axe/4.10/color-contrast))

- WCAG: 1.4.3 Contrast \(Minimum\) \(Level AA, WCAG 2.1\)
- Counts: 1 new, 0 baselined, 1 fixed, 0 unassessed

| Status | Impact | Page | Selector | Element |
| --- | --- | --- | --- | --- |
| New | serious | https://demo.shop/products | `.product-card .price-tag` | `<span class="price-tag" style="color:#c8c4bd">€12</span>` |
| Fixed | serious | https://demo.shop/ | `.legacy-banner` | `<div class="legacy-banner">Sale ends Sunday</div>` |

### html-has-lang — serious

&lt;html&gt; element must have a lang attribute ([rule documentation](https://dequeuniversity.com/rules/axe/4.10/html-has-lang))

- WCAG: 3.1.1 Language of Page \(Level A, WCAG 2.1\)
- Counts: 0 new, 1 baselined, 0 fixed, 0 unassessed

| Status | Impact | Page | Selector | Element |
| --- | --- | --- | --- | --- |
| Baselined | serious | https://demo.shop/products | `html` | `<html>` |

### image-alt — serious

Images must have alternative text ([rule documentation](https://dequeuniversity.com/rules/axe/4.10/image-alt))

- WCAG: 1.1.1 Non-text Content \(Level A, WCAG 2.1\)
- Counts: 0 new, 1 baselined, 0 fixed, 0 unassessed

| Status | Impact | Page | Selector | Element |
| --- | --- | --- | --- | --- |
| Baselined | serious | https://demo.shop/ | `#main:nth-child(5) > img.hero-photo:nth-child(2)` | `<img class="hero-photo" src="/hero.jpg">` |

### label — serious

Form elements must have labels ([rule documentation](https://dequeuniversity.com/rules/axe/4.10/label))

- WCAG: 1.3.1 Info and Relationships \(Level A, WCAG 2.1\); 3.3.2 Labels or Instructions \(Level A, WCAG 2.1\)
- Counts: 0 new, 1 baselined, 0 fixed, 0 unassessed

| Status | Impact | Page | Selector | Element |
| --- | --- | --- | --- | --- |
| Baselined | serious | https://demo.shop/cart | `input.quantity` | `<input class="quantity" type="number" value="1">` |

### link-name — moderate

Links must have discernible text ([rule documentation](https://dequeuniversity.com/rules/axe/4.10/link-name))

- WCAG: 2.4.4 Link Purpose \(In Context\) \(Level A, WCAG 2.1\); 4.1.2 Name, Role, Value \(Level A, WCAG 2.1\)
- Counts: 0 new, 1 baselined, 0 fixed, 0 unassessed

| Status | Impact | Page | Selector | Element |
| --- | --- | --- | --- | --- |
| Baselined | moderate | https://demo.shop/ | `a.footer-promo` | `<a class="footer-promo" href="/sale"><img src="/sale.png"></a>` |

### region — moderate

All page content should be contained by landmarks ([rule documentation](https://dequeuniversity.com/rules/axe/4.10/region))

- WCAG: none mapped (best practice)
- Counts: 1 new, 0 baselined, 0 fixed, 0 unassessed

| Status | Impact | Page | Selector | Element |
| --- | --- | --- | --- | --- |
| New | moderate | https://demo.shop/cart | `body` | `<body>` |

### aria-required-attr — critical

Required ARIA attributes must be provided ([rule documentation](https://dequeuniversity.com/rules/axe/4.10/aria-required-attr))

- WCAG: 4.1.2 Name, Role, Value \(Level A, WCAG 2.1\)
- Counts: 0 new, 0 baselined, 1 fixed, 0 unassessed

| Status | Impact | Page | Selector | Element |
| --- | --- | --- | --- | --- |
| Fixed | critical | https://demo.shop/products | `[role="slider"]` | `<div role="slider"></div>` |

### document-title — serious

Documents must have &lt;title&gt; element to aid in navigation ([rule documentation](https://dequeuniversity.com/rules/axe/4.10/document-title))

- WCAG: 2.4.2 Page Titled \(Level A, WCAG 2.1\)
- Counts: 0 new, 0 baselined, 1 fixed, 0 unassessed

| Status | Impact | Page | Selector | Element |
| --- | --- | --- | --- | --- |
| Fixed | serious | https://demo.shop/cart | `html` | `<html lang="en">` |

## Disclaimer

Automated checks only (axe-core). Not a WCAG conformance audit, certification, or legal advice. Automated tools detect a subset of accessibility issues.
