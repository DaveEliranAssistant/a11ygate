# Report languages and the message catalog

Automated testing only. Not a WCAG audit, certification or legal advice.

The HTML report (version 2) and the Markdown / CLI summary written by `a11ygate scan` take every user-visible string from a message catalog: [`locales/en.json`](../locales/en.json). Only English (`en`) is shipped.

## Selecting a language

```sh
a11ygate scan https://localhost:3000 --out-dir a11y --report-lang en
```

`--report-lang en` is the default. Its output is byte-identical to the output without the flag. In `.a11ygate.yml` the same setting is `reportLang` (environment variable `A11YGATE_REPORT_LANG`).

Two **pseudo-locales** are built from the English catalog. They are for layout testing only and are not translations:

| Code | What it does |
| --- | --- |
| `en-XA` | Accents every letter and adds about 40% length, inside `[...]`. A string that is still plain English in the output is not in the catalog. Long labels show where the layout truncates or overflows. |
| `ar-XB` | Wraps catalog text in right-to-left override marks and sets `<html dir="rtl">`, so you can check the layout right to left. |

The CLI prints a warning when you choose a pseudo-locale.

## What is never translated

The disclaimer and legal wording (`lib/copy.ts`) are not in the catalog. Every locale renders them verbatim in English, marked `lang="en" dir="ltr"` in non-English reports. They must never be machine-translated. A localized version needs a human translator and owner sign-off.

Two fixed notices also render verbatim in English (marked `lang="en" dir="ltr"` in non-English reports): the shared-component notice (`lib/group.ts`) and the review-decision notice (`lib/scan/review.ts`). They describe what a heuristic group or a reviewer decision does and does not establish, so they are treated like legal wording.

Data also stays as recorded: engine rule help, guidance text from `lib/guidance.ts`, scope boundaries, the gate reason, page URLs, selectors, HTML snippets, reviewer names, decision reasons and the decision tokens (`to-fix`, `accepted-risk`, `false-positive`). The HTML report version 1 (`--report-version 1`) is frozen and English-only.

## Message format

- Keys are flat, dot-separated strings. Values use `{name}` placeholders, for example `"Top {limit} fixes"`.
- Plurals use `<key>.one` and `<key>.other`; `{n}` is always available.
- HTML report: the catalog text is HTML-escaped, and markup such as `<strong>` and `<code>` stays in the template. Translators do not write HTML.

## Adding a human-provided locale

1. A human translator copies `locales/en.json` to `locales/<lang>.json`, for example `locales/de.json`, and translates the values. Keep every key and every `{placeholder}` exactly as in English. Do not use machine translation.
2. Register the locale in `lib/i18n/index.ts`: import the file, add the code to `SHIPPED_REPORT_LANGS`, and return its catalog from `catalogFor`. If the script is right to left, also add it to `reportDir`.
3. `npm test` runs `tests/i18n-catalog.test.ts`. It checks that every locale has the same keys and placeholders as `en`, that templates only use catalog strings, and that every key is used.
4. Add an axe scan of the new locale to `tests/i18n-catalog.test.ts`, following the `ar-XB` case.
5. A native speaker reviews the rendered HTML and Markdown before release. The disclaimer and legal wording stay in English unless the owner provides a reviewed human translation.

## Adding a new report string

Add the key to `locales/en.json`, then call `t.t('your.key', { ... })` in the template. Do not write prose in the template: the lint in `tests/i18n-catalog.test.ts` fails on hard-coded text. It flags any two-word or capitalised text, any word in HTML text content (even a single lowercase word such as `<button>save</button>`), any word after Markdown block syntax (`- none`), and any word in a user-visible attribute: `aria-label`, `aria-description`, `aria-roledescription`, `aria-placeholder`, `aria-valuetext`, `title`, `alt`, `placeholder`, `label` and `value`. Put those values in the catalog too. CSS blocks are marked with an `i18n-ignore` comment.
