import { getAttr } from '@/lib/fix/element';
import { PLACEHOLDER, type Rule, type TextEdit } from '@/lib/fix/types';
import { insertAfterName } from '@/lib/fix/rules/shared';

export function safeLang(lang: string | undefined): string {
  const value = (lang ?? '').trim();
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value) ? value : 'en';
}

/** html-has-lang: lang from config plus a TODO to confirm it. */
export const htmlLangRule: Rule = ({ kind, tag, lang }) => {
  if (tag.tagName.toLowerCase() !== 'html' || tag.selfClosing) return null;
  if (kind === 'jsx' && tag.tagName !== 'html') return null;
  const value = safeLang(lang);
  const existing = getAttr(tag, 'lang');
  if (existing && !(existing.kind === 'literal' && (existing.value ?? '').trim() === '') && existing.kind !== 'bare') return null;

  const todo = `${PLACEHOLDER}: confirm "${value}" is the main language of this document`;
  const comment = kind === 'html' ? `<!-- ${todo} -->` : `{/* ${todo} */}`;
  const edits: TextEdit[] = existing
    ? [{ start: existing.start, end: existing.end, text: `lang="${value}"` }]
    : [insertAfterName(tag.nameEnd, `lang="${value}"`)];
  edits.push({ start: tag.end, end: tag.end, text: comment });
  return {
    rule: 'html-has-lang',
    edits,
    placeholder: true,
    note: `Sets \`lang="${value}"\` from the configured default and adds a \`${PLACEHOLDER}\` comment to confirm the language.`,
  };
};
