# Accessibility evidence report — www.w3.org

> **Automated testing only. Not a WCAG audit, certification or legal advice. Automated tools such as axe-core detect only a subset of accessibility issues.**

## Scan details

| Field | Value |
| --- | --- |
| Scanned at | 2026-11-12T12:25:34.378Z |
| Previous scan | none supplied |
| Generated | 2026-11-12T13:00:00.000Z |
| Commit | not recorded |
| Branch | not recorded |
| A11yGate | 0.1.0 |
| axe-core (current) | 4.14.0 |
| axe-core (previous scan) | no previous scan |
| Gate | FAIL at threshold serious — 42 new findings at or above serious: aria-allowed-attr, aria-prohibited-attr, button-name, color-contrast, html-has-lang, image-alt, link-name, select-name, target-size. |
| Coverage | complete |

## Summary

| Severity | Current violations |
| --- | --- |
| Critical | 30 |
| Serious | 12 |
| Moderate | 50 |
| Minor | 0 |
| Unknown | 0 |
| Total | 92 |

| Status | Violations |
| --- | --- |
| New | 92 |
| Still open | 0 |
| Fixed | 0 |
| Unassessed (not verified fixed) | 0 |
| Current total | 92 |

Rules with current violations: 11. WCAG success criteria with findings: 6. Best-practice rules: 2.

## Scope

| Field | Value |
| --- | --- |
| Start URL | https://www.w3.org/WAI/demos/bad/before/home.html |
| Origin | https://www.w3.org |
| Page limit | 5 |
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
| https://www.w3.org/ | 2026-11-12T12:25:24.785Z | 4.14.0 | complete | 0 | 0 | 0 | no |
| https://www.w3.org/WAI/ | 2026-11-12T12:25:28.903Z | 4.14.0 | complete | 3 | 3 | 0 | no |
| https://www.w3.org/WAI/demos/bad/Overview.html | 2026-11-12T12:25:31.512Z | 4.14.0 | complete | 7 | 7 | 0 | no |
| https://www.w3.org/WAI/demos/bad/before/home.html | 2026-11-12T12:25:22.256Z | 4.14.0 | complete | 57 | 57 | 0 | no |
| https://www.w3.org/WAI/demos/bad/before/reports/home.html | 2026-11-12T12:25:33.798Z | 4.14.0 | complete | 25 | 25 | 0 | no |

### Links skipped and why

- Page limit reached \(--crawl cap\): 169
  - `https://www.w3.org/2005/02/TranslationPolicy`
  - `https://www.w3.org/Consortium/Legal/copyright-documents`
  - `https://www.w3.org/Consortium/Legal/copyright-software`
  - `https://www.w3.org/Consortium/Legal/ipr-notice`
  - `https://www.w3.org/Consortium/Legal/privacy-statement`
  - `https://www.w3.org/International/i18n-drafts/nav/about`
  - `https://www.w3.org/Member/`
  - `https://www.w3.org/People/shadi/`
  - `https://www.w3.org/TR/`
  - `https://www.w3.org/TR/2008/NOTE-WCAG20-TECHS-20081211/F1`
  - …and 159 more (full list in the JSON report)
- Different origin \(not crawled\): 12
  - `http://www.csail.mit.edu/`
  - `http://www.ercim.org/`
  - `http://www.keio.ac.jp/`
  - `https://auth.w3.org/?url=https://www.w3.org/`
  - `https://github.com/w3c/`
  - `https://status.w3.org/`
  - `https://w3c.social/@w3c`
  - `https://w3c.social/@wai`
  - `https://www.fordfoundation.org/`
  - `https://www.fordfoundation.org/work/challenging-inequality/technology-and-society/`
  - …and 2 more (full list in the JSON report)
- Not an http\(s\) link \(javascript:, mailto:, …\): 6
  - `javascript:location.href='home.html';`
  - `javascript:location.href='news.html';`
  - `javascript:location.href='survey.html';`
  - `javascript:location.href='tickets.html';`
  - `mailto:wai-eo-editors@w3.org`
  - `mailto:wai@w3.org`
- Not an HTML page \(file download\): 1
  - `https://www.w3.org/WAI/demos/bad/bad.zip`

## Trend versus previous scan

No previous scan was supplied, so every current violation is reported as new.

## Findings by WCAG success criterion

WCAG success criteria are mapped from axe-core rule tags. The mapping needs expert review before it is relied on. A rule mapped to more than one criterion is listed under the first.

### WCAG 1.1.1 Non-text Content \(Level A, WCAG 2.1\)

Current findings: 27.

#### image-alt — critical

Images must have alternative text ([rule documentation](https://dequeuniversity.com/rules/axe/4.14/image-alt?application=playwright))

- How to fix: Provide contextual alternative text for informative images; use empty alt for genuinely decorative images.
- WCAG: 1.1.1 Non-text Content \(Level A, WCAG 2.1\)
- Counts: 27 new, 0 still open, 0 fixed, 0 unassessed

| Status | Severity | Page | Selector | Element |
| --- | --- | --- | --- | --- |
| New | critical | https://www.w3.org/WAI/demos/bad/before/home.html | `.newsheadline:nth-child(1) > img[src$="headline_middle.gif"][width="23"][height="24"]` | `<img src="./img/headline_middle.gif" width="23" height="24" align="absmiddle">` |
| New | critical | https://www.w3.org/WAI/demos/bad/before/home.html | `img[name="nav_facts"]` | `<img name="nav_facts" src="./img/nav_facts.gif" width="105" height="23" hspace="9" border="0px">` |
| New | critical | https://www.w3.org/WAI/demos/bad/before/home.html | `img[name="nav_home"]` | `<img name="nav_home" src="./img/nav_home.gif" width="88" height="27" hspace="15" border="0px">` |
| New | critical | https://www.w3.org/WAI/demos/bad/before/home.html | `img[src$="border_bottom.gif"]` | `<img src="./img/border_bottom.gif" height="10px">` |
| New | critical | https://www.w3.org/WAI/demos/bad/before/home.html | `img[src$="border_bottom_left.gif"]` | `<img src="./img/border_bottom_left.gif" width="10px" height="10px">` |
| New | critical | https://www.w3.org/WAI/demos/bad/before/home.html | `img[src$="border_bottom_right.gif"]` | `<img src="./img/border_bottom_right.gif" width="10px" height="10px">` |
| New | critical | https://www.w3.org/WAI/demos/bad/before/home.html | `img[src$="border_left.gif"]` | `<img src="./img/border_left.gif" width="10px">` |
| New | critical | https://www.w3.org/WAI/demos/bad/before/home.html | `img[src$="border_left_top.gif"]` | `<img src="./img/border_left_top.gif" width="10px" height="10px">` |
| New | critical | https://www.w3.org/WAI/demos/bad/before/home.html | `img[src$="border_right.gif"]` | `<img src="./img/border_right.gif" width="10px">` |
| New | critical | https://www.w3.org/WAI/demos/bad/before/home.html | `img[src$="border_right_top.gif"]` | `<img src="./img/border_right_top.gif" width="10px" height="10px">` |
| New | critical | https://www.w3.org/WAI/demos/bad/before/home.html | `img[src$="border_top.gif"]` | `<img src="./img/border_top.gif" height="10px">` |
| New | critical | https://www.w3.org/WAI/demos/bad/before/home.html | `img[src$="mark.gif"]` | `<img src="./img/mark.gif" width="158px" height="7px">` |
| New | critical | https://www.w3.org/WAI/demos/bad/before/home.html | `img[src$="marker2_t.gif"][height="30px"][width="1px"]` | `<img src="./img/marker2_t.gif" width="1px" height="30px">` |
| New | critical | https://www.w3.org/WAI/demos/bad/before/home.html | `img[src$="nav_news.gif"]` | `<img src="./img/nav_news.gif" name="nav_news" width="90" height="21" hspace="12" border="0px">` |
| New | critical | https://www.w3.org/WAI/demos/bad/before/home.html | `img[src$="nav_survey.gif"]` | `<img src="./img/nav_survey.gif" name="nav_survey" width="107" height="32" hspace="8" border="0px">` |
| New | critical | https://www.w3.org/WAI/demos/bad/before/home.html | `img[src$="teaser_right1.jpg"]` | `<img src="./img/teaser_right1.jpg" width="150px" height="106px">` |
| New | critical | https://www.w3.org/WAI/demos/bad/before/home.html | `img[src$="teaser_right2.jpg"]` | `<img src="./img/teaser_right2.jpg" width="150px" height="154px">` |
| New | critical | https://www.w3.org/WAI/demos/bad/before/home.html | `img[src$="top_logo_next_end.gif"]` | `<img src="./img/top_logo_next_end.gif" width="24px" height="86px">` |
| New | critical | https://www.w3.org/WAI/demos/bad/before/home.html | `img[src$="top_logo_next_start.gif"]` | `<img src="./img/top_logo_next_start.gif" width="22px" height="86px">` |
| New | critical | https://www.w3.org/WAI/demos/bad/before/home.html | `img[src$="top_weather.gif"]` | `<img src="./img/top_weather.gif" width="128px" height="86px">` |
| New | critical | https://www.w3.org/WAI/demos/bad/before/home.html | `img[width="1"]` | `<img src="./img/marker2_t.gif" width="1" height="30px">` |
| New | critical | https://www.w3.org/WAI/demos/bad/before/home.html | `td[background="./img/marker2_w.gif"][width="150px"] > img[src$="marker2_w.gif"][width="78px"][height="1px"]` | `<img src="./img/marker2_w.gif" width="78px" height="1px">` |
| New | critical | https://www.w3.org/WAI/demos/bad/before/home.html | `td[colspan="5"][background="./img/marker2_w.gif"][width="780px"] > img[src$="marker2_w.gif"][width="78px"][height="1px"]` | `<img src=".img/marker2_w.gif" width="78px" height="1px">` |
| New | critical | https://www.w3.org/WAI/demos/bad/before/home.html | `td[width="151px"][background="./img/marker2_w.gif"] > img[src$="marker2_w.gif"][width="78px"][height="1px"]` | `<img src="./img/marker2_w.gif" width="78px" height="1px">` |
| New | critical | https://www.w3.org/WAI/demos/bad/before/home.html | `td[width="155px"][background="./img/marker2_w.gif"] > img[src$="marker2_w.gif"][width="78px"][height="1px"]` | `<img src="./img/marker2_w.gif" width="78px" height="1px">` |
| New | critical | https://www.w3.org/WAI/demos/bad/before/home.html | `td[width="20px"]:nth-child(2) > img[src$="blank_5x5.gif"][height="5px"][width="20px"]` | `<img src="./img/blank_5x5.gif" width="20px" height="5px">` |
| New | critical | https://www.w3.org/WAI/demos/bad/before/home.html | `tr[height="1px"]:nth-child(3) > td[width="154px"][background="./img/marker2_w.gif"] > img[src$="marker2_w.gif"][width="78px"][height="1px"]` | `<img src="./img/marker2_w.gif" width="78px" height="1px">` |

### WCAG 1.4.3 Contrast \(Minimum\) \(Level AA, WCAG 2.1\)

Current findings: 1.

#### color-contrast — serious

Elements must meet minimum color contrast ratio thresholds ([rule documentation](https://dequeuniversity.com/rules/axe/4.14/color-contrast?application=playwright))

- How to fix: Adjust foreground/background colors to meet the applicable contrast ratio; include hover, focus and disabled states where relevant.
- WCAG: 1.4.3 Contrast \(Minimum\) \(Level AA, WCAG 2.1\)
- Counts: 1 new, 0 still open, 0 fixed, 0 unassessed

| Status | Severity | Page | Selector | Element |
| --- | --- | --- | --- | --- |
| New | serious | https://www.w3.org/WAI/demos/bad/before/home.html | `tr[height="25px"]:nth-child(2) > td[bgcolor="#A9B8BF"][width="150px"] > font[color="#41545D"][size="2"] > b` | `<b>Free Penguins</b>` |

### WCAG 2.4.4 Link Purpose \(In Context\) \(Level A, WCAG 2.1\)

Current findings: 5.

#### link-name — serious

Links must have discernible text ([rule documentation](https://dequeuniversity.com/rules/axe/4.14/link-name?application=playwright))

- How to fix: Links must have discernible text Consult the rule guidance and review the actual component; automated advice is not a verified fix.
- WCAG: 2.4.4 Link Purpose \(In Context\) \(Level A, WCAG 2.1\); 4.1.2 Name, Role, Value \(Level A, WCAG 2.1\)
- Counts: 5 new, 0 still open, 0 fixed, 0 unassessed

| Status | Severity | Page | Selector | Element |
| --- | --- | --- | --- | --- |
| New | serious | https://www.w3.org/WAI/demos/bad/before/home.html | `#home > a[onfocus="blur();"]` | `<a href="javascript:location.href='home.html';" onfocus="blur();"><img name="nav_home" src="./img/nav_home.gif" width="88" height="27" hspace="15" border="0px"></a>` |
| New | serious | https://www.w3.org/WAI/demos/bad/before/home.html | `#news > a[onfocus="blur();"]` | `<a href="javascript:location.href='news.html';" onfocus="blur();"><img src="./img/nav_news.gif" name="nav_news" width="90" height="21" hspace="12" border="0px"></a>` |
| New | serious | https://www.w3.org/WAI/demos/bad/before/home.html | `#survey > a[onfocus="blur();"]` | `<a href="javascript:location.href='survey.html';" onfocus="blur();"><img src="./img/nav_survey.gif" name="nav_survey" width="107" height="32" hspace="8" border="0px"></a>` |
| New | serious | https://www.w3.org/WAI/demos/bad/before/home.html | `#tickets > a[onfocus="blur();"]` | `<a href="javascript:location.href='tickets.html';" onfocus="blur();"><img name="nav_facts" src="./img/nav_facts.gif" width="105" height="23" hspace="9" border="0px"></a>` |
| New | serious | https://www.w3.org/WAI/demos/bad/before/home.html | `.story:nth-child(1) > span > a[href$="news.html"][onfocus="blur();"]` | `<a href="news.html" onfocus="blur();"><img src="./img/morearrow.gif" width="48" height="10" alt="" border="0" onmouseover="this.src='./img/morearrow_a.gif'" onmouseout="this.src='./img/morearrow.gif'" style="vertical-align: bottom"></a>` |

### WCAG 2.5.8 Target Size \(Minimum\) \(Level AA, WCAG 2.2\)

Current findings: 4.

#### target-size — serious

All touch targets must be 24px large, or leave sufficient space ([rule documentation](https://dequeuniversity.com/rules/axe/4.14/target-size?application=playwright))

- How to fix: All touch targets must be 24px large, or leave sufficient space Consult the rule guidance and review the actual component; automated advice is not a verified fix.
- WCAG: 2.5.8 Target Size \(Minimum\) \(Level AA, WCAG 2.2\)
- Counts: 4 new, 0 still open, 0 fixed, 0 unassessed

| Status | Severity | Page | Selector | Element |
| --- | --- | --- | --- | --- |
| New | serious | https://www.w3.org/WAI/demos/bad/before/home.html | `.accessible > .report[href$="home.html"]` | `<a href="../after/reports/home.html" class="report"><span class="hidden">Accessible Home Page </span> Report</a>` |
| New | serious | https://www.w3.org/WAI/demos/bad/before/home.html | `.inaccessible > .report[href$="home.html"]` | `<a href="./reports/home.html" class="report"><span class="hidden">Inaccessible Home Page </span> Report</a>` |
| New | serious | https://www.w3.org/WAI/demos/bad/before/reports/home.html | `.accessible > .page[href$="home.html"]` | `<a href="../../after/home.html" class="page"><span class="hidden">Accessible </span>Home Page</a>` |
| New | serious | https://www.w3.org/WAI/demos/bad/before/reports/home.html | `.inaccessible > .page[href$="home.html"]` | `<a href="../home.html" class="page"><span class="hidden">Inaccessible </span>Home Page</a>` |

### WCAG 3.1.1 Language of Page \(Level A, WCAG 2.1\)

Current findings: 1.

#### html-has-lang — serious

&lt;html&gt; element must have a lang attribute ([rule documentation](https://dequeuniversity.com/rules/axe/4.14/html-has-lang?application=playwright))

- How to fix: &lt;html&gt; element must have a lang attribute Consult the rule guidance and review the actual component; automated advice is not a verified fix.
- WCAG: 3.1.1 Language of Page \(Level A, WCAG 2.1\)
- Counts: 1 new, 0 still open, 0 fixed, 0 unassessed

| Status | Severity | Page | Selector | Element |
| --- | --- | --- | --- | --- |
| New | serious | https://www.w3.org/WAI/demos/bad/before/home.html | `html` | `<html>` |

### WCAG 4.1.2 Name, Role, Value \(Level A, WCAG 2.1\)

Current findings: 4.

#### aria-allowed-attr — critical

Elements must only use supported ARIA attributes ([rule documentation](https://dequeuniversity.com/rules/axe/4.14/aria-allowed-attr?application=playwright))

- How to fix: Elements must only use supported ARIA attributes Consult the rule guidance and review the actual component; automated advice is not a verified fix.
- WCAG: 4.1.2 Name, Role, Value \(Level A, WCAG 2.1\)
- Counts: 1 new, 0 still open, 0 fixed, 0 unassessed

| Status | Severity | Page | Selector | Element |
| --- | --- | --- | --- | --- |
| New | critical | https://www.w3.org/WAI/ | `iframe .ytmVideoInfoVideoTitle` | `<a class="ytmVideoInfoVideoTitle" aria-level="2" href="https://www.youtube.com/watch?v=iWO5N3n1DXU"><span class="ytAttributedStringHost ytmVideoInfoLink ytAttributedStringWhiteSpaceNoWrap" style="">Web Accessibility Perspectives: Video Captions</span></a>` |

#### button-name — critical

Buttons must have discernible text ([rule documentation](https://dequeuniversity.com/rules/axe/4.14/button-name?application=playwright))

- How to fix: Give the button a clear accessible name matching its visible purpose; prefer visible text.
- WCAG: 4.1.2 Name, Role, Value \(Level A, WCAG 2.1\)
- Counts: 1 new, 0 still open, 0 fixed, 0 unassessed

| Status | Severity | Page | Selector | Element |
| --- | --- | --- | --- | --- |
| New | critical | https://www.w3.org/WAI/ | `iframe .ytmVideoInfoChannelAvatar` | `<button class="ytmVideoInfoLink ytmVideoInfoChannelAvatar"><img class="ytCoreImageHost ytmVideoInfoChannelLogo ytCoreImageFillParentHeight ytCoreImageFillParentWidth ytCoreImageContentModeScaleAspectFill" alt="thumbnail-image" style="background-color: transparent;"></button>` |

#### select-name — critical

Select element must have an accessible name ([rule documentation](https://dequeuniversity.com/rules/axe/4.14/select-name?application=playwright))

- How to fix: Select element must have an accessible name Consult the rule guidance and review the actual component; automated advice is not a verified fix.
- WCAG: 4.1.2 Name, Role, Value \(Level A, WCAG 2.1\)
- Counts: 1 new, 0 still open, 0 fixed, 0 unassessed

| Status | Severity | Page | Selector | Element |
| --- | --- | --- | --- | --- |
| New | critical | https://www.w3.org/WAI/demos/bad/before/home.html | `select` | `<select onchange="location.href = this.value;">` |

#### aria-prohibited-attr — serious

Elements must only use permitted ARIA attributes ([rule documentation](https://dequeuniversity.com/rules/axe/4.14/aria-prohibited-attr?application=playwright))

- How to fix: Elements must only use permitted ARIA attributes Consult the rule guidance and review the actual component; automated advice is not a verified fix.
- WCAG: 4.1.2 Name, Role, Value \(Level A, WCAG 2.1\)
- Counts: 1 new, 0 still open, 0 fixed, 0 unassessed

| Status | Severity | Page | Selector | Element |
| --- | --- | --- | --- | --- |
| New | serious | https://www.w3.org/WAI/ | `iframe #movie_player` | `<div class="html5-video-player ytp-hide-controls ytp-exp-bottom-control-flexbox ytp-modern-caption ytp-livebadge-color unstarted-mode ytp-small-mode" tabindex="" id="movie_player" data-version="/s/player/a5c2aafe/player_embed.vflset/en_US/base.js" aria-label="YouTube Video Player">` |

## Best-practice rules (no WCAG success criterion)

### landmark-one-main — moderate

Document should have one main landmark ([rule documentation](https://dequeuniversity.com/rules/axe/4.14/landmark-one-main?application=playwright))

- How to fix: Document should have one main landmark Consult the rule guidance and review the actual component; automated advice is not a verified fix.
- WCAG: none mapped (best practice)
- Counts: 3 new, 0 still open, 0 fixed, 0 unassessed

| Status | Severity | Page | Selector | Element |
| --- | --- | --- | --- | --- |
| New | moderate | https://www.w3.org/WAI/demos/bad/Overview.html | `html` | `<html lang="en">` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/home.html | `html` | `<html>` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/reports/home.html | `html` | `<html lang="en">` |

### region — moderate

All page content should be contained by landmarks ([rule documentation](https://dequeuniversity.com/rules/axe/4.14/region?application=playwright))

- How to fix: All page content should be contained by landmarks Consult the rule guidance and review the actual component; automated advice is not a verified fix.
- WCAG: none mapped (best practice)
- Counts: 47 new, 0 still open, 0 fixed, 0 unassessed

| Status | Severity | Page | Selector | Element |
| --- | --- | --- | --- | --- |
| New | moderate | https://www.w3.org/WAI/demos/bad/Overview.html | `#logos` | `<p id="logos"><a href="https://www.w3.org/" title="W3C Home"><img alt="W3C logo" src="./img/w3c.png" height="48" width="72"></a><a href="https://www.w3.org/WAI/" title="WAI Home"><img alt="Web Accessibility Initiative (WAI) logo" src="./img/wai.png" height="48"></a></p>` |
| New | moderate | https://www.w3.org/WAI/demos/bad/Overview.html | `#meta-footer` | `<div id="meta-footer" class="meta">` |
| New | moderate | https://www.w3.org/WAI/demos/bad/Overview.html | `#mnav` | `<div id="mnav" class="accessible">` |
| New | moderate | https://www.w3.org/WAI/demos/bad/Overview.html | `#page` | `<div id="page">` |
| New | moderate | https://www.w3.org/WAI/demos/bad/Overview.html | `.subline` | `<p class="subline">Improving a Web site using Web Content Accessibility Guidelines (WCAG) 2.0</p>` |
| New | moderate | https://www.w3.org/WAI/demos/bad/Overview.html | `h1` | `<h1><span class="subhead">Overview </span>Before and After Demonstration</h1>` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/home.html | `#logos` | `<p id="logos"><a href="https://www.w3.org/" title="W3C Home"><img alt="W3C logo" src="../img/w3c.png" height="48" width="72"></a><a href="https://www.w3.org/WAI/" title="WAI Home"><img alt="Web Accessibility Initiative (WAI) logo" src="../img/wai.png" height="48"></a></p>` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/home.html | `#main > p:nth-child(2)` | `<p>Citylights is the new portal for visitors and residents. Find out what's on, book tickets, and get the latest news.</p>` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/home.html | `#meta-footer` | `<div id="meta-footer" class="meta">` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/home.html | `#mnav` | `<div id="mnav" class="inaccessible">` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/home.html | `#startcontent` | `<p class="skip" id="startcontent">Demo starts here</p>` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/home.html | `.headline` | `<p class="headline">Welcome to CityLights</p>` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/home.html | `.newsbar:nth-child(2)` | `<div class="newsbar">` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/home.html | `.subheadline` | `<p class="subheadline">Elsewhere on the Web</p>` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/home.html | `.subline` | `<p class="subline">Improving a Web site using Web Content Accessibility Guidelines (WCAG) 2.0</p>` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/home.html | `h1` | `<h1><span class="subhead">Inaccessible Home Page</span><span class="hidden"> -</span> Before and After Demonstration</h1>` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/home.html | `p:nth-child(7)` | `<p>` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/home.html | `table[height="144px"]` | `<table width="780px" height="144px" border="0px" cellspacing="0px" cellpadding="0px" bgcolor="WHITE">` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/home.html | `table[height="17px"][bgcolor="#EDEDED"][cellpadding="0px"]` | `<table width="780px" height="17px" border="0px" cellspacing="0px" cellpadding="0px" bgcolor="#EDEDED">` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/home.html | `td[background="./img/border_left.gif"]` | `<td width="10px" background="./img/border_left.gif"><img src="./img/border_left.gif" width="10px"></td>` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/home.html | `td[background="./img/border_right.gif"]` | `<td width="10px" background="./img/border_right.gif"><img src="./img/border_right.gif" width="10px"></td>` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/home.html | `td[bgcolor="#E4E4E4"]` | `<td width="155px" bgcolor="#E4E4E4" valign="TOP">` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/home.html | `td[width="151px"][valign="TOP"]` | `<td width="151px" valign="TOP">` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/home.html | `td[width="20px"]:nth-child(2)` | `<td width="20px"><img src="./img/blank_5x5.gif" width="20px" height="5px"></td>` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/home.html | `tr[height="10px"]:nth-child(1)` | `<tr height="10px">` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/reports/home.html | `#logos` | `<p id="logos"><a href="https://www.w3.org/" title="W3C Home"><img alt="W3C logo" src="../../img/w3c.png" height="48" width="72"></a><a href="https://www.w3.org/WAI/" title="WAI Home"><img alt="Web Accessibility Initiative (WAI) logo" src="../../img/wai.png" height="48"></a></p>` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/reports/home.html | `#meta-footer` | `<div id="meta-footer" class="meta">` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/reports/home.html | `#mnav` | `<div id="mnav" class="inaccessible">` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/reports/home.html | `#o > caption` | `<caption>Conformance of Home Page to WCAG 2.0 - Operable</caption>` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/reports/home.html | `#o > tbody > .guideline.fail:nth-child(1)` | `<tr class="guideline fail">` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/reports/home.html | `#o > thead` | `<thead>             <tr>               <td></td>               <th>#</th>               <th>Title</th>               <th>Description</th>               <th>Result</th>             </tr>           </thead>` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/reports/home.html | `#p > caption` | `<caption>Conformance of Home Page to WCAG 2.0 - Perceivable</caption>` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/reports/home.html | `#p > tbody > .guideline.fail:nth-child(1)` | `<tr class="guideline fail">` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/reports/home.html | `#p > tbody > .guideline.pass` | `<tr class="guideline pass">` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/reports/home.html | `#p > thead` | `<thead>             <tr>               <td></td>               <th>#</th>               <th>Title</th>               <th>Description</th>               <th>Result</th>             </tr>           </thead>` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/reports/home.html | `#r > caption` | `<caption>Conformance of Home Page to WCAG 2.0 - Robust</caption>` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/reports/home.html | `#r > tbody > .guideline.fail` | `<tr class="guideline fail">` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/reports/home.html | `#r > thead` | `<thead>             <tr>               <td></td>               <th>#</th>               <th>Title</th>               <th>Description</th>               <th>Result</th>             </tr>           </thead>` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/reports/home.html | `#u > caption` | `<caption>Conformance of Home Page to WCAG 2.0 - Understandable</caption>` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/reports/home.html | `#u > tbody > .guideline.fail:nth-child(1)` | `<tr class="guideline fail">` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/reports/home.html | `#u > thead` | `<thead>             <tr>               <td></td>               <th>#</th>               <th>Title</th>               <th>Description</th>               <th>Result</th>             </tr>           </thead>` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/reports/home.html | `.guideline.fail:nth-child(23)` | `<tr class="guideline fail">` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/reports/home.html | `.guideline.pass:nth-child(8)` | `<tr class="guideline pass">` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/reports/home.html | `.reportControls:nth-child(2)` | `<div class="reportControls"><a href="#">Expand all rows</a> <a href="#">Collapse all rows</a></div>` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/reports/home.html | `.subline` | `<p class="subline">Improving a Web site using Web Content Accessibility Guidelines (WCAG) 2.0</p>` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/reports/home.html | `h1` | `<h1><span class="subhead">Inaccessible Home Page Report </span>Before and After Demonstration</h1>` |
| New | moderate | https://www.w3.org/WAI/demos/bad/before/reports/home.html | `h2:nth-child(1)` | `<h2><a name="perceivable" id="perceivable">Perceivable</a></h2>` |

## Disclaimer

Automated testing only. Not a WCAG audit, certification or legal advice. Automated tools such as axe-core detect only a subset of accessibility issues.
