# Owner runbook: prospect → pilot → paid

Automated testing only. Not a WCAG audit, certification or legal advice.

This runbook is for Eliran (the owner). It lists the steps for one pilot, from the first prospect scan to the checkout link or invoice. Every step that sends something to a person outside the project is done by Eliran by hand. No A11yGate command sends email, messages or notifications.

The whole path runs offline on fixtures in `tests/pilot-funnel.test.ts` (A11Y-R70): prospect summary from a saved scan, `init --target gitlab --pilot`, scan, baseline, a regression that fails the gate, three evidence packs, the pilot report and the draft quote. The test checks that each artifact carries the disclaimer and that the quote price matches [`config/pricing.json`](../../config/pricing.json) ($990 per year after a free 21-day pilot at $0).

## Before the first pilot: owner decisions (BLOCKED on Eliran)

Nothing below is done by the code. Each item is a decision or an account action for Eliran. Until an item is done, the matching feature stays off or falls back as described.

Payments and pricing (A11Y-R63, [billing setup](../billing-setup.md)):

- [ ] Choose the payment provider, or decide to sell by invoice only.
- [ ] Create the payment-provider account and the $990/yr product (skip when selling by invoice only).
- [ ] Tax, VAT and invoicing setup (Israeli business registration) before the first invoice.
- [ ] Set `A11YGATE_CHECKOUT_URL` (an `https:` URL without credentials) in the Vercel environment for the web app (`/pricing`), and also in the shell environment where you run `a11ygate pilot report`, which reads it at run time for the quote. Leave it unset in either place to show “invoice on request” there.
- [ ] Set `A11YGATE_PRICING_ENABLED=1` in the Vercel environment when the public price should appear. Off by default: `/pricing` returns 404 and the home page shows no price.

Pilot requests and the public offer (A11Y-R64):

- [ ] Decide where pilot requests go: set `A11YGATE_PILOT_REQUEST_URL` to an `https:` URL or a `mailto:` address, or leave it unset to collect requests through the landing page form and read the waitlist database with the command below.
- [ ] Approve turning `A11YGATE_PRICING_ENABLED` on in production (this also shows the pilot offer on the home page).

CI starters (A11Y-R65): no separate decision.

- [ ] For each GitLab pilot, confirm the customer's root `.gitlab-ci.yml` has the `merge_request_event` workflow rule and the include. `init --target gitlab` writes or adds both; if it printed a snippet and exited with code 2 (a root file layout it cannot extend safely), the customer adds them by hand (see [GitLab CI in the quickstart](quickstart.md#gitlab-ci)). Without the rule the gate job does not run on merge requests.

Pilot terms (A11Y-R66):

- [ ] Legal review of `docs/pilot/pilot-terms.template.md` ([draft](pilot-terms.template.md)) before any customer sees it.
- [ ] Business and legal entity details for the terms (legal name, address, registration number, governing law).
- [ ] Default retention period for scan outputs (fill it into the terms and the [kickoff checklist](kickoff-checklist.md)).

Prospect scans (A11Y-R67):

- [ ] Approve each real prospect before any URL outside `config/own-hosts.json` is scanned, and record who approved it and the written permission with `--authorized-by` and `--authorization-note`.
- [ ] Send every prospect report yourself. The CLI only writes local files.

Demo kit (A11Y-R68): no owner decision.

Pilot results and quote (A11Y-R69):

- [ ] Quote legal and tax wording reviewed before the first quote is sent.
- [ ] Invoice issuer details (legal name, address, tax ID) added to the quote or the invoice.
- [ ] Send any quote to a customer yourself. The CLI only writes a draft.

npm package:

- [ ] Decide whether to publish 0.2.0: `npm login` and publish 0.2.0 to the `next` tag are owner actions. The npm `latest` tag is 0.1.0; nothing here publishes.

## Flip the switch

**ELIRAN-ONLY.** Set Vercel environment variables and deploy only after reviewing the intended state. Before each step, set the proposed combination in your local shell and run the preflight. Correct any errors before making the Vercel change. The preflight reads the three settings from your shell and shows the web offer and the quote payment line with destination details redacted. Keep checkout unset through the first two steps.

1. [ ] **CTA destination first.** Run `npm run go-live:preflight`, then set `A11YGATE_PILOT_REQUEST_URL` to an HTTPS link without credentials or a `mailto:` address. Leave it unset to keep pilot requests on the landing page waitlist form.
2. [ ] **Pricing flag second.** Run `npm run go-live:preflight`, then set `A11YGATE_PRICING_ENABLED` to `1` to show the home offer and open `/pricing` with the invoice button.
3. [ ] **Checkout last.** Run `npm run go-live:preflight`, then set `A11YGATE_CHECKOUT_URL` to the HTTPS checkout link without credentials. Leave it unset for invoice-only billing. The quote uses the checkout setting from the shell that runs the CLI.

To review the four local browser previews, run `npm run test:e2e -- e2e/go-live.spec.ts` and open the screenshots in `go-live-preview/`.

## List pilot requests (Eliran only)

Set `DATABASE_URL` in your shell using the production database connection string. Use a role with read-only access if available. Run this command from the repository root:

```sh
npm run --silent pilot-requests -- --i-am-the-owner
```

The script reads only rows tagged `pilot-request` and prints CSV to stdout, newest first. The CSV contains contact information. Keep it out of the repository and review it privately.

Each email keeps the source from its first submission. If someone joined the waitlist before requesting a pilot with the same email, the original row keeps its `landing` source and won't appear in this export.

## Per-pilot steps

### 1. Approve the prospect scan

Only scan a site you own or one whose owner gave written permission. Own hosts (`localhost`, `127.0.0.1`, `::1`, `a11ygate.vercel.app`, `qe-atlas.vercel.app`) need no flags. For anything else, record the approval before the run:

```bash
a11ygate prospect https://www.example.com/ --authorized-by "Eliran" --authorization-note "Written permission from <site owner>, <date>, homepage only" --company "Example Ltd" --offer
```

Or build the summary offline from a scan you already have: `a11ygate prospect --from <scan-dir> --company "Example Ltd" --offer`. Output goes to `prospect-out/` (`prospect-summary.html`, `prospect-summary.pdf`, `prospect-manifest.json`). `--offer` adds the price and pilot length from `config/pricing.json`. The PDF needs local Playwright Chromium.

### 2. Send the prospect report yourself

Read the summary first. It names the scan scope and the automated-testing limits, and it never proposes alt text or labels. Send the PDF from your own mail account. Nothing is sent by A11yGate.

### 3. Kickoff

Make a bundle from a clean checkout of the reviewed commit. After `npm ci`, run:

```sh
npm run pilot:bundle
```

Verify the files with `shasum -a 256 -c SHA256SUMS` from `pilot-bundle/`. Eliran sends the commit-stamped tarball, `SHA256SUMS`, and `INSTALL.md` directly to the customer. Any GitHub Release attachment or npm publication is also Eliran-only.

Go through the [kickoff checklist](kickoff-checklist.md) with the customer: written scan authorization from the site owner, least-privilege access, target URLs, contacts, retention and deletion. Agree on the success criteria. In the customer repository (or a branch they review):

```bash
a11ygate init --yes --target gitlab --pilot --url http://127.0.0.1:4173/
a11ygate doctor
```

Use `--target github`, `jenkins` or `azure-devops` for other CI systems. `--pilot` writes `a11ygate-pilot/success-criteria.yml` and `a11ygate-pilot/KICKOFF.md`. Fill the `[[MISSING]]` fields in the criteria with the customer. Day 1 is the kickoff date; the pilot lasts 21 days.

### 4. Week 1: baseline and required gate

Follow the [quickstart](quickstart.md): first scan, baseline the existing findings, first evidence pack, wire the gate into CI and make it a required check.

```bash
a11ygate scan http://127.0.0.1:4173/ --crawl 10 --out-dir kickoff
a11ygate baseline create kickoff --output .a11ygate-baseline.json
a11ygate evidence pack --from kickoff --out packs/kickoff.zip
```

Commit `.a11ygate-baseline.json`. Open a test PR to show the gate catching a new serious finding (exit 1).

### 5. Week 2: weekly check-in

Review new serious or critical findings with the customer: each gets a fix or a recorded review decision (`a11ygate review`). Make a mid-pilot pack from a gated scan:

```bash
a11ygate scan http://127.0.0.1:4173/ --crawl 10 --baseline .a11ygate-baseline.json --out-dir mid
a11ygate evidence pack --from mid --out packs/mid.zip
```

### 6. Week 3: final scan and evidence

Make the latest scan before the decision date. If you have records from CI and the repository, put `a11ygate-pilot-evidence.json` in the scan output directory before packing (fields in the [pilot onboarding kit](README.md#close-out-a-pilot)). Record only what the records show.

```bash
a11ygate scan http://127.0.0.1:4173/ --crawl 10 --baseline .a11ygate-baseline.json --out-dir latest
a11ygate evidence pack --from latest --out packs/latest.zip
```

### 7. Pilot report

```bash
a11ygate pilot report --kickoff packs/kickoff.zip --latest packs/latest.zip --packs packs --criteria a11ygate-pilot/success-criteria.yml --customer "Example Ltd"
```

This writes `pilot-results.html/.pdf` and `quote.html/.pdf` to `pilot-report/`. Criteria without records show **Not measurable**. Read the results before sharing them; hand the evidence pack and results to the customer yourself.

### 8. Quote

`quote.html/.pdf` is a draft: the amount and term come from `config/pricing.json`. Check the legal and tax wording, the invoice issuer details and the buyer details before sending. Send it yourself.

### 9. Checkout link or invoice

- `a11ygate pilot report` reads `A11YGATE_CHECKOUT_URL` from the environment where it runs (for example `A11YGATE_CHECKOUT_URL=https://… a11ygate pilot report …`). The Vercel setting only configures the web app. With a valid `https:` value, the quote shows that link on the payment line.
- Without it, the quote reads “invoice on request”: issue the invoice yourself after written acceptance. Nothing bills automatically.

If the customer does not convert, follow the end-of-pilot steps in the [kickoff checklist](kickoff-checklist.md): delete scan outputs per the agreed retention period and revoke repository and CI access.

See also [What A11yGate does not do](../what-a11ygate-does-not-do.md) and [Known limits](../known-limits.md).

Automated testing only. Not a WCAG audit, certification or legal advice.
