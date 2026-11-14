# Chromium memory and runtime: recorded benchmark and sizing table

Automated testing only. Not a WCAG audit, certification or legal advice. These numbers describe resource use, not accessibility coverage.

Every number on this page was copied from a recorded `npm run bench` run on the machine below. None are estimated or extrapolated. Raw data, including per-run sample counts and failure messages, is in the JSON files next to this page:

| Run | Command | Raw data | Table |
| --- | --- | --- | --- |
| axe only, 500 pages, concurrency 1/2/4 | `npm run bench -- --pages 500 --engines axe --concurrency 1,2,4 --name chromium-bench-axe-500` | [JSON](chromium-bench-axe-500.json) | [MD](chromium-bench-axe-500.md) |
| axe only, 500 pages, concurrency 4, `--recycle-every 100` | `npm run bench -- --pages 500 --engines axe --concurrency 4 --recycle-every 100 --name chromium-bench-axe-500-recycle` | [JSON](chromium-bench-axe-500-recycle.json) | [MD](chromium-bench-axe-500-recycle.md) |
| all engines, **40 pages** (subset), concurrency 1/2/4 | `npm run bench -- --pages 40 --engines all --concurrency 1,2,4 --name chromium-bench-all-40` | [JSON](chromium-bench-all-40.json) | [MD](chromium-bench-all-40.md) |

**The matrix is incomplete.** All-engines runs (axe, HTML_CodeSniffer, IBM, Lighthouse) used a 40-page subset of the fixture, not 500 pages. At the 14.8 pages/min recorded at concurrency 1, a 500-page run would not have fit the time available. No 500-page all-engines numbers exist, so none are shown.

## Machine

- Model: MacBookPro16,1 (16-inch MacBook Pro, 2019)
- CPU: Intel(R) Core(TM) i9-9880H CPU @ 2.30GHz (16 logical cores)
- RAM: 32 GiB
- OS: macOS 15.7.4 (24G517)
- Node.js: v20.19.6
- Chromium: 156.0.8078.4 (Playwright headless shell); Playwright 1.64.1; axe-core 4.14.0

## Method

- The fixture is a generated site served on `127.0.0.1` by the bench script. Page `/` links to `/p/1` … `/p/499`. Each page has a shared nav, a 20-row table, a form and deterministic axe violations (missing alt text, low contrast, an unlabelled input). No third-party site is contacted.
- Each run is the built CLI (`packages/cli/dist/cli.mjs scan`) with `--max-pages <n> --concurrency <c> --delay-ms 0 --fail-on none`.
- RSS is sampled every 250 ms with `ps`. "Node" is the CLI process. "Chromium" is the sum of every descendant process (browser, GPU, network and renderer processes). "Total" is the peak of the sum, not the sum of the two peaks.
- Pages/min counts completed pages over the run's wall time, including browser launch.
- Growth is the mean Chromium RSS while the last fifth of pages started, minus the mean while the first fifth started.
- Runs were sequential on an otherwise idle laptop. Run-to-run variance was not measured: each configuration ran once.

## Results

| Engines | Pages | Concurrency | Recycle every | Complete | Page failures / engine errors | Wall time (s) | Pages/min | Peak RSS Node (MB) | Peak RSS Chromium (MB) | Peak RSS total (MB) | Chromium RSS growth (MB) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| axe | 500 | 1 | — | 500 | 0 / 0 | 392.5 | 76.4 | 450 | 480 | 753 | -1 |
| axe | 500 | 2 | — | 500 | 0 / 0 | 267.3 | 112.2 | 481 | 485 | 941 | -12 |
| axe | 500 | 4 | — | 500 | 0 / 0 | 152.7 | 196.4 | 488 | 848 | 1305 | -12 |
| axe | 500 | 4 | 100 | 500 | 0 / 0 | 157.1 | 191 | 551 | 846 | 1381 | -18 |
| axe,htmlcs,ibm,lighthouse | 40 | 1 | — | 40 | 0 / 0 | 162.1 | 14.8 | 517 | 323 | 792 | -26 |
| axe,htmlcs,ibm,lighthouse | 40 | 2 | — | 40 | 0 / 19 | 94.9 | 25.3 | 534 | 484 | 1006 | -44 |
| axe,htmlcs,ibm,lighthouse | 40 | 4 | — | 40 | 0 / 29 | 60.7 | 39.6 | 729 | 846 | 1435 | 43 |

In the original R38 run, the engine errors at concurrency 2 and 4 were all Lighthouse: `The "start lh:runner:gather" performance mark has not been set` (19 of 40 pages at concurrency 2, 29 of 40 at concurrency 4). Lighthouse attaches to the shared browser over the debugging port. Its logger clears process-wide timing marks, so parallel snapshots in one Node process can remove marks still needed by another snapshot. A11Y-R47 serializes Lighthouse snapshots only; other engines and page loading retain crawl concurrency. axe, HTML_CodeSniffer and IBM produced no errors. Errored Lighthouse results are reported as errored, and the scan exits 2. They are never counted as passes.

## Sizing table

Suggested free memory is the recorded peak total RSS plus at least 512 MB of headroom, rounded up to the next 0.5 GB. Treat them as a starting point for similar hardware. Linux CI runners were not measured.

| Configuration | Recorded peak total RSS | Suggested free memory | Recorded throughput on this machine |
| --- | ---: | ---: | ---: |
| axe, concurrency 1 (default) | 753 MB | 1.5 GB | 76.4 pages/min |
| axe, concurrency 2 | 941 MB | 1.5 GB | 112.2 pages/min |
| axe, concurrency 4 | 1305 MB | 2 GB | 196.4 pages/min |
| all engines, concurrency 1 | 792 MB (40-page run) | 1.5 GB | 14.8 pages/min |
| all engines, concurrency > 1 (original R38) | 1006–1435 MB (40-page runs) | Lighthouse errors before R47; see follow-up below | — |

Throughput assumes `--delay-ms 0` against a local server. The default `--delay-ms 1000` spaces page starts by one second, so it caps a scan at about 60 page starts per minute whatever the concurrency.

## Defaults and context recycling

- **No default changed.** Concurrency stays 1, delay stays 1000 ms, and the scan keeps one browser context unless asked. Higher concurrency was faster and had no failures for axe-only, but the default stays polite for sites that are not local fixtures. The original R38 all-engine runs produced Lighthouse errors above concurrency 1; R47 now serializes Lighthouse snapshots to avoid the timing-mark collision. Concurrency still defaults to 1.
- **No memory growth was recorded.** Over 500 pages, Chromium RSS in the last fifth of the scan was 1–12 MB *lower* than in the first fifth at concurrency 1, 2 and 4. Context recycling therefore stays opt-in: `--recycle-every <n>` (config `recycleEvery`). With `--recycle-every 100` at concurrency 4, peak Chromium RSS was 846 MB against 848 MB without it, and throughput was 191 against 196.4 pages/min. On this fixture it neither helped nor hurt much. It is there for real sites whose pages leak memory (for example, long-lived service workers or caches inside one context). Retired contexts close only after their in-flight pages finish, and `tests/context-recycling.test.ts` asserts this.
- Node RSS reached 450–551 MB in axe-only runs and up to 729 MB with all engines. That is the CLI process holding report data and the engine bundles, not Chromium.

## Re-running

```sh
npm run cli:build
npm run bench                         # full matrix: 500 pages, axe and all engines, concurrency 1,2,4
npm run bench -- --pages 40 --engines all --concurrency 1 --out /tmp/perf
```

`npm run bench` is not part of `npm test` or CI. It launches Chromium and scans only its own loopback fixture.

## A11Y-R47 re-measurement

The original R38 rows above are preserved. The first R47 re-measurement ran
while other batch workers, Vitest and Playwright were active on the same machine,
so its throughput and RSS are not an idle-machine comparison. It recorded no
performance-mark collisions, but did record page timeouts and errors after timed-out
pages closed. Serialization does not remove existing page/engine time limits.

Command: `npm run bench -- --pages 40 --engines all --concurrency 4 --name chromium-bench-r47-all-40`.
Raw [JSON](chromium-bench-r47-all-40.json) and [table](chromium-bench-r47-all-40.md).

| Engines | Pages | Concurrency | Complete | Page failures / engine errors | Wall time (s) | Pages/min | Peak RSS Node (MB) | Peak RSS Chromium (MB) | Peak RSS total (MB) | Chromium RSS growth (MB) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| axe,htmlcs,ibm,lighthouse | 40 | 4 | 36 | 4 / 3 | 235.9 | 9.2 | 473 | 802 | 1116 | -20 |

A follow-up ran after this worker's Vitest and Playwright jobs finished (other
batch workers could still be active). All 40 pages and every engine completed
without errors. This is one recorded run, not a throughput estimate.

Command: `npm run bench -- --pages 40 --engines all --concurrency 4 --name chromium-bench-r47-all-40-followup`.
Raw [JSON](chromium-bench-r47-all-40-followup.json) and [table](chromium-bench-r47-all-40-followup.md).

| Engines | Pages | Concurrency | Complete | Page failures / engine errors | Wall time (s) | Pages/min | Peak RSS Node (MB) | Peak RSS Chromium (MB) | Peak RSS total (MB) | Chromium RSS growth (MB) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| axe,htmlcs,ibm,lighthouse | 40 | 4 | 40 | 0 / 0 | 154.0 | 15.6 | 556 | 843 | 1286 | 29 |

Automated testing only. Not a WCAG audit, certification or legal advice.
