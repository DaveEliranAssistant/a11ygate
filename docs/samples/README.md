# Sample deliverables

Automated testing only. Not a WCAG audit, certification or legal advice.

These are the files a pilot produces, so you can see them before you start one. **All data comes from our demo app ([`fixtures/demo-app`](../../fixtures/demo-app)), not a customer site.** "Example Ltd" is a fictional customer, and every page and file is marked **SAMPLE**. The demo app ran on 127.0.0.1 only. Dates are fixed sample dates.

| File | What it is |
| --- | --- |
| [prospect-summary.pdf](prospect-summary.pdf) | The scan summary for a prospect, with the pilot offer, from `a11ygate prospect --offer`. |
| [pilot-results.pdf](pilot-results.pdf) | End-of-pilot results from `a11ygate pilot report`: kickoff vs latest findings, trend and success criteria. |
| [quote-sample.pdf](quote-sample.pdf) | The draft renewal quote from `a11ygate pilot report` (DRAFT, reviewed by a person before any real quote is sent). |
| [evidence-pack-sample.zip](evidence-pack-sample.zip) | An evidence pack from `a11ygate evidence pack`: report, scan outputs (JSON, Markdown, HTML, SARIF, JUnit), engine results and a SHA-256 manifest. |
| [report.html](report.html) | The HTML scan report (v2) of the gate run, with executive summary, top fixes and findings by WCAG criterion and page. |
| [screenshot-pr-gate.png](screenshot-pr-gate.png) | The PR gate failing on the one new finding (an unnamed icon button) while existing findings stay in the baseline. |
| [screenshot-report-summary.png](screenshot-report-summary.png) | The top of the HTML report: verdict and executive summary. |
| [screenshot-trend.png](screenshot-trend.png) | The trend report across the three evidence packs from the sample pilot. |

## How the samples are made

`npm run samples` runs the [demo flow](../pilot/demo-script.md) on the local demo app: kickoff scan, baseline, mid-pilot scan, one regression, gate scan, evidence packs, then `prospect --offer`, `pilot report` and `trend`. It then adds the SAMPLE marking and the Example Ltd name, rewrites the local port to 127.0.0.1:4173 and prints the PDFs with Playwright Chromium. Dates come from `SOURCE_DATE_EPOCH` (default 2026-11-26). Use `npm run samples -- --out-dir <dir>` to write somewhere else. Needs `npm run cli:build` and Playwright Chromium.

External links inside the reports point to rule documentation (W3C WCAG pages and axe-core rule help) and to the A11yGate site; no other site was scanned.

The samples show what automated testing finds on one small demo app. They do not show what a scan of your site will find, and they cover only part of WCAG.

Automated testing only. Not a WCAG audit, certification or legal advice.
