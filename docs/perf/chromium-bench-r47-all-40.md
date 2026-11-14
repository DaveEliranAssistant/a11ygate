# Chromium memory and runtime benchmark

Recorded 2026-11-14T15:48:15.132Z with `npm run bench -- --pages 40 --engines all --concurrency 4 --name chromium-bench-r47-all-40`. Every number below comes from that recorded run (raw data: `chromium-bench-r47-all-40.json`); none are estimated.

## Machine

- Model: MacBookPro16,1
- CPU: Intel(R) Core(TM) i9-9880H CPU @ 2.30GHz (16 logical cores)
- RAM: 32 GiB
- OS: macOS 15.7.4 (24G517)
- Node.js: v20.19.6
- Chromium: 156.0.8078.4 (Playwright headless shell); Playwright 1.64.1; axe-core 4.14.0

## Results

Fixture: generated loopback site (start page linking to every other page; each page has a shared layout, a 20-row table and a few known axe violations). `--delay-ms 0`, `--fail-on none`.
Peak RSS is sampled every 250 ms with `ps`: Node is the CLI process, Chromium is the sum of all its descendant processes. Growth is mean Chromium RSS while the last fifth of pages started minus the first fifth.

| Engines | Concurrency | Recycle every | Pages complete / requested | Failures (pages / engine errors) | Wall time (s) | Pages/min | Peak RSS Node (MB) | Peak RSS Chromium (MB) | Peak RSS total (MB) | Chromium RSS growth (MB) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| axe,htmlcs,ibm,lighthouse | 4 | — | 36 / 40 | 4 / 3 | 235.9 | 9.2 | 473 | 802 | 1116 | -20 |

### Failure reasons

- axe,htmlcs,ibm,lighthouse, concurrency 4: 4× Page timeout after 30000ms.; 1× lighthouse: browserContext.newCDPSession: page: no object with guid page@0367f5c35a4e72eba596a86c5cf9ed5a; 1× lighthouse: Lighthouse audit accesskeys failed: Required Accessibility gatherer encountered an error: Protocol error (Page.enable): ; 1× lighthouse: browserContext.newCDPSession: page: no object with guid page@ebf26cb367349cbd118b2bb491ea8548

Shared batch machine under concurrent test load; see README.md for the R47 follow-up.

Automated testing only. Not a WCAG audit, certification or legal advice.
