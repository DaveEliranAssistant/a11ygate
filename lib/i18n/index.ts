/**
 * Report message catalog (A11Y-R58).
 *
 * Every user-visible string in the HTML v2 report and the Markdown / CLI
 * summary comes from `locales/en.json`. Messages use a simple `{var}` format;
 * plurals use `<key>.one` / `<key>.other`.
 *
 * Only `en` is shipped. `en-XA` (accented, expanded) and `ar-XB` (right-to-left)
 * are generated pseudo-locales for layout testing, not translations.
 *
 * The disclaimer and legal wording (lib/copy.ts) are deliberately NOT in the
 * catalog: they are never machine-translated or pseudo-localized and render
 * verbatim in English in every locale. See docs/report-locales.md.
 */
import en from '@/locales/en.json';

export type MessageKey = keyof typeof en;
export type Catalog = Record<MessageKey, string>;
export type MessageVars = Record<string, string | number>;

export const EN_CATALOG: Catalog = en;
export const SHIPPED_REPORT_LANGS = ['en'] as const;
export const PSEUDO_REPORT_LANGS = ['en-XA', 'ar-XB'] as const;
export const REPORT_LANGS = [...SHIPPED_REPORT_LANGS, ...PSEUDO_REPORT_LANGS] as const;
export type ReportLang = (typeof REPORT_LANGS)[number];
export const DEFAULT_REPORT_LANG: ReportLang = 'en';

export function isReportLang(value: unknown): value is ReportLang {
  return (REPORT_LANGS as readonly unknown[]).includes(value);
}

export function isPseudoReportLang(lang: ReportLang): boolean {
  return (PSEUDO_REPORT_LANGS as readonly string[]).includes(lang);
}

export function reportDir(lang: ReportLang): 'ltr' | 'rtl' {
  return lang === 'ar-XB' ? 'rtl' : 'ltr';
}

const PLACEHOLDER = /\{(\w+)\}/g;

/** Substitute `{var}` placeholders. A missing variable is a programming error. */
export function formatMessage(template: string, vars: MessageVars = {}): string {
  return template.replace(PLACEHOLDER, (_, name: string) => {
    if (!(name in vars)) throw new Error(`Missing message variable {${name}}`);
    return String(vars[name]);
  });
}

const ACCENTS: Record<string, string> = {
  a: 'å', b: 'ƀ', c: 'ç', d: 'ð', e: 'é', f: 'ƒ', g: 'ĝ', h: 'ĥ', i: 'î', j: 'ĵ', k: 'ķ', l: 'ļ', m: 'ɱ',
  n: 'ñ', o: 'ö', p: 'þ', q: 'ǫ', r: 'ŕ', s: 'š', t: 'ţ', u: 'û', v: 'ṽ', w: 'ŵ', x: 'ẋ', y: 'ý', z: 'ž',
  A: 'Å', B: 'Ɓ', C: 'Ç', D: 'Ð', E: 'É', F: 'Ƒ', G: 'Ĝ', H: 'Ĥ', I: 'Î', J: 'Ĵ', K: 'Ķ', L: 'Ļ', M: 'Ṁ',
  N: 'Ñ', O: 'Ö', P: 'Þ', Q: 'Ǫ', R: 'Ŕ', S: 'Š', T: 'Ţ', U: 'Û', V: 'Ṽ', W: 'Ŵ', X: 'Ẋ', Y: 'Ý', Z: 'Ž',
};

/** Apply `fn` to the literal text of a message, leaving `{var}` placeholders intact. */
function mapText(template: string, fn: (text: string) => string): string {
  return template.split(/(\{\w+\})/).map((part) => (/^\{\w+\}$/.test(part) ? part : fn(part))).join('');
}

/** en-XA: accented letters plus ~40% expansion, so truncation and hard-coded strings show up. */
export function pseudoAccent(template: string): string {
  const letters = template.replace(PLACEHOLDER, '').replace(/[^A-Za-z]/g, '').length;
  if (letters === 0) return template;
  const accented = mapText(template, (text) => text.replace(/[A-Za-z]/g, (c) => ACCENTS[c] ?? c));
  return `[${accented} ${'·'.repeat(Math.max(1, Math.ceil(letters * 0.4)))}]`;
}

/** ar-XB: text wrapped in right-to-left override marks, rendered mirrored like a RTL script. */
export function pseudoBidi(template: string): string {
  if (!/[A-Za-z]/.test(template.replace(PLACEHOLDER, ''))) return template;
  return mapText(template, (text) => (/[A-Za-z]/.test(text) ? `‮${text}‬` : text));
}

export function catalogFor(lang: ReportLang): Catalog {
  if (lang === 'en') return EN_CATALOG;
  const transform = lang === 'en-XA' ? pseudoAccent : pseudoBidi;
  return Object.fromEntries(Object.entries(EN_CATALOG).map(([k, v]) => [k, transform(v)])) as Catalog;
}

export type Translator = {
  lang: ReportLang;
  dir: 'ltr' | 'rtl';
  /** Plain-text message. */
  t(key: MessageKey, vars?: MessageVars): string;
  /** `<key>.one` when n is 1, otherwise `<key>.other`; `{n}` is always available. */
  plural(key: string, n: number, vars?: MessageVars): string;
};

export function translator(lang: ReportLang = DEFAULT_REPORT_LANG, catalog: Catalog = catalogFor(lang)): Translator {
  const lookup = (key: string): string => {
    const message = (catalog as Record<string, string>)[key];
    if (message === undefined) throw new Error(`Missing message key "${key}" in report catalog (${lang})`);
    return message;
  };
  return {
    lang,
    dir: reportDir(lang),
    t: (key, vars) => formatMessage(lookup(key), vars),
    plural: (key, n, vars = {}) => formatMessage(lookup(`${key}.${n === 1 ? 'one' : 'other'}`), { n, ...vars }),
  };
}
