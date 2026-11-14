# Chromium memory and runtime benchmark

Recorded 2026-11-14T13:30:57.666Z with `npm run bench -- --pages 40 --engines all --concurrency 1,2,4 --name chromium-bench-all-40`. Every number below comes from that recorded run (raw data: `chromium-bench-all-40.json`); none are estimated.

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
| axe,htmlcs,ibm,lighthouse | 1 | — | 40 / 40 | 0 / 0 | 162.1 | 14.8 | 517 | 323 | 792 | -26 |
| axe,htmlcs,ibm,lighthouse | 2 | — | 40 / 40 | 0 / 19 | 94.9 | 25.3 | 534 | 484 | 1006 | -44 |
| axe,htmlcs,ibm,lighthouse | 4 | — | 40 / 40 | 0 / 29 | 60.7 | 39.6 | 729 | 846 | 1435 | 43 |

### Failure reasons

- axe,htmlcs,ibm,lighthouse, concurrency 2: 19× lighthouse: The "start lh:runner:gather" performance mark has not been set
- axe,htmlcs,ibm,lighthouse, concurrency 4: 29× lighthouse: The "start lh:runner:gather" performance mark has not been set
