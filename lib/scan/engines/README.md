# Scan engine contract

`Engine<Context, NativeResults>` identifies an analyzer by `id` and `displayName`.
`run(context, url)` analyzes the caller's existing browser page/session and returns
native results; `normalize(native)` produces one internal `NormalizedFinding` per
rule/node occurrence. Engines do not own navigation, crawl policy or browser lifecycle.
`runEngine` catches analyzer and normalization failures and returns either `complete`
(with native results and findings) or `errored` (with the engine ID and error), so a
future caller can continue with other engines. The CLI keeps its existing failed-page/exit-code behavior when axe alone errors.
Opt-in scans record each engine independently, including errors.

Normalized fields are `engine`, `ruleId` (the engine's own rule ID), `wcagSc`
(success-criterion IDs), `impact` (nullable), `url`, `selector`, `snippet`, and
`helpUrl`. Normalization preserves individual engine occurrences; `dedupe.ts` merges
page/element/criterion matches only for extended reports. `locators.ts` resolves
unique CSS/XPath locators to optional canonical `elementKey` values. The axe adapter also retains
`compatibility`, the historical public `Finding`; `toLegacyFinding` explicitly emits
that shape. Default scan reporters use this mapper and keep native per-page axe
results unchanged, without exposing engine metadata in public JSON.

`wcag-map.ts` is a seed rule crosswalk, using criterion IDs from `lib/mapping.ts`.
Native axe criterion tags take precedence; the table supplies internal fallback IDs
for known rules. Empty criterion arrays represent best-practice rules. Public axe
reports continue to use their historical tag mapping, including tag order.

Only axe is enabled by default. `--engines axe` is equivalent to omitting the flag.
Additional engines require explicitly installed optional peers.

Automated testing only. Not a WCAG audit, certification or legal advice.

R11 adds the `htmlcs`, `ibm`, and `lighthouse` opt-in adapters. See
[engine usage, offline execution and verified package licenses](../../../docs/engines.md).
