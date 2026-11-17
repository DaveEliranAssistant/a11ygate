# Chromium memory and runtime benchmark

Recorded 2026-11-17T09:50:01.585Z with `npm run bench -- --pages 500 --engines axe,all --concurrency 1,2,4 --max-run-ms 1800000 --no-new-cell-after 2026-11-17T13:40:00Z --name bench-v2`. Every number below comes from that recorded run (raw data: `bench-v2.json`); none are estimated.

## Machine

- Model: MacBookPro16,1
- CPU: Intel(R) Core(TM) i9-9880H CPU @ 2.30GHz (16 logical cores)
- RAM: 32 GiB
- OS: macOS 15.7.4 (24G517)
- Node.js: v20.19.6
- Chromium: 156.0.8078.4 (Playwright headless shell); Playwright 1.64.1; axe-core 4.14.0

## Results

Fixture: generated loopback site (start page linking to every other page; each page has a shared layout, a 20-row table and a few known axe violations). `--delay-ms 0`, `--fail-on none`.
Peak RSS is sampled every 250 ms with `ps` over the whole process tree: Node is the CLI process, Chromium is the sum of all its descendant processes, and total is the peak of the per-sample sum (not the sum of the two peaks). Growth is mean Chromium RSS while the last fifth of pages started minus the first fifth.
Each run is capped at 30 min; a run that hits the cap is "not completed" and has no pages/min figure.

| Engines | Concurrency | Recycle every | Pages complete / requested | Failures (pages / engine errors) | Wall time (s) | Pages/min | Peak RSS Node (MB) | Peak RSS Chromium (MB) | Peak RSS total (MB) | Chromium RSS growth (MB) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| axe | 1 | — | 500 / 500 | 0 / 0 | 395.6 | 75.8 | 443 | 486 | 777 | 15 |
| axe | 2 | — | 500 / 500 | 0 / 0 | 231.5 | 129.6 | 493 | 485 | 946 | -7 |
| axe | 4 | — | 500 / 500 | 0 / 0 | 149.5 | 200.7 | 571 | 847 | 1378 | 1 |
| axe,htmlcs,ibm,lighthouse | 1 | — | 500 / 500 | 0 / 0 | 1400.5 | 21.4 | 1040 | 481 | 1309 | -5 |
| axe,htmlcs,ibm,lighthouse | 2 | — | 500 / 500 | 0 / 0 | 1190.7 | 25.2 | 1089 | 482 | 1471 | -8 |
| axe,htmlcs,ibm,lighthouse | 4 | — | 500 / 500 | 0 / 0 | 1085.2 | 27.6 | 1192 | 849 | 1859 | -4 |

## Notes (A11Y-R49)

- All six runs finished within the 30-minute cap, so no run is marked "not completed". Every run completed 500 of 500 pages with no page failures and no engine errors.
- Scope of "total": the CLI's Node process plus every descendant process (Chromium browser, GPU, network, utility and renderer processes), read every 250 ms with `ps -A -o pid=,ppid=,rss=,comm=` and summed per sample by `scripts/proc-tree-sampler.mjs`. Peak processes in the tree: 6 at concurrency 1, 8 at 2 and 12 at 4 (raw data: `peakProcesses`).
- The Mac was not idle. One-minute load averages at the start of each run were 10.69, 4.64, 6.07, 8.07, 5.75 and 3.97 (`loadAverageAtStart` in the JSON). The main other load was macOS Spotlight indexing (`mds_stores`, `mdworker`) and long-running processes owned by other jobs. No tests or other benchmarks ran during the matrix. Each configuration ran once, so run-to-run variance was not measured.
- Only macOS was measured. The sampler uses the same `ps` columns on Linux (procps), and its unit test covers Linux-shaped output. No Linux numbers are recorded here.
- With all engines, the Node process peaked at 1040–1192 MB, compared with 443–571 MB for axe only. Chromium RSS was about the same for both engine sets at the same concurrency.
- Lighthouse runs serialized behind the A11Y-R47 mutex. All-engines throughput therefore went from 21.4 pages/min at concurrency 1 to 25.2 at concurrency 2 and 27.6 at concurrency 4, while axe-only went from 75.8 to 200.7 pages/min.
- Throughput assumes `--delay-ms 0` against a local server. The default `--delay-ms 1000` caps a scan at about 60 page starts per minute.

Automated testing only. Not a WCAG audit, certification or legal advice.
