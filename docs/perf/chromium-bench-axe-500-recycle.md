# Chromium memory and runtime benchmark

Recorded 2026-11-14T13:25:39.132Z with `npm run bench -- --pages 500 --engines axe --concurrency 4 --recycle-every 100 --name chromium-bench-axe-500-recycle`. Every number below comes from that recorded run (raw data: `chromium-bench-axe-500-recycle.json`); none are estimated.

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
| axe | 4 | 100 | 500 / 500 | 0 / 0 | 157.1 | 191 | 551 | 846 | 1381 | -18 |
