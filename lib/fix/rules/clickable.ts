import { elementRange, getAttr } from '@/lib/fix/element';
import type { OpenTag } from '@/lib/fix/element';
import type { Rule, TextEdit } from '@/lib/fix/types';

/** Content that a <button> must not contain (interactive or block content). */
const NOT_ALLOWED_IN_BUTTON =
  /<(a|button|input|select|textarea|label|details|iframe|div|p|ul|ol|li|table|form|section|article|header|footer|nav|main|aside|h[1-6])\b/i;

export function isClickableDivOrSpan(tag: OpenTag): boolean {
  const name = tag.tagName.toLowerCase();
  return (name === 'div' || name === 'span') && Boolean(getAttr(tag, 'onclick'));
}

/** A div/span with onclick becomes `<button type="button">`, keeping every attribute. */
export const clickableRule: Rule = ({ source, kind, tag }) => {
  if (kind === 'jsx' && tag.tagName !== tag.tagName.toLowerCase()) return null;
  if (!isClickableDivOrSpan(tag)) return null;
  const range = elementRange(source, tag, kind);
  if (!range) return null;
  const content = source.slice(range.contentStart, range.contentEnd);
  if (NOT_ALLOWED_IN_BUTTON.test(content)) return null;

  const opening = getAttr(tag, 'type') ? 'button' : 'button type="button"';
  const edits: TextEdit[] = [{ start: tag.start + 1, end: tag.nameEnd, text: opening }];
  if (range.close) edits.push({ start: range.close.start + 2, end: range.close.start + 2 + tag.tagName.length, text: 'button' });
  return {
    rule: 'clickable-element',
    edits,
    placeholder: false,
    note: `Turns the clickable \`<${tag.tagName}>\` into a native \`<button type="button">\` so it is focusable and keyboard operable. Attributes and the handler are unchanged; check styles that target \`${tag.tagName}\`.`,
  };
};
