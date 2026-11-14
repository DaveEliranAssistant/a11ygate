# Scan engine contract

`Engine<Context, NativeResults>` identifies an analyzer by `id` and `displayName`.
`run(context, url)` analyzes the caller's existing browser page/session and returns
native results; `normalize(native)` produces one internal `NormalizedFinding` per
rule/node occurrence. Engines do not own navigation, crawl policy or browser lifecycle.
`runEngine` catches analyzer and normalization failures and returns either `complete`
(with native results and findings) or `errored` (with the engine ID and error), so a
future caller can continue with other engines. The CLI currently runs only axe and
keeps its existing failed-page/exit-code behavior when axe errors.

Normalized fields are `engine`, `ruleId` (the engine's own rule ID), `wcagSc`
(success-criterion IDs), `impact` (nullable), `url`, `selector`, `snippet`, and
`helpUrl`. No cross-engine deduplication is performed. The axe adapter also retains
`compatibility`, the historical public `Finding`; `toLegacyFinding` explicitly emits
that shape. Default scan reporters use this mapper and keep native per-page axe
results unchanged, without exposing engine metadata in public JSON.

`wcag-map.ts` is a seed rule crosswalk, using criterion IDs from `lib/mapping.ts`.
Native axe criterion tags take precedence; the table supplies internal fallback IDs
for known rules. Empty criterion arrays represent best-practice rules. Public axe
reports continue to use their historical tag mapping, including tag order.

Only axe is available and enabled. `--engines axe` is equivalent to omitting the flag.
No additional engine dependencies are installed.

Automated testing only. Not a WCAG audit, certification or legal advice.
