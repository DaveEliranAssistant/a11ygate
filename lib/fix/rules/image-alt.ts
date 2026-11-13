import { getAttr, literal } from '@/lib/fix/element';
import { PLACEHOLDER, type Rule, type TextEdit } from '@/lib/fix/types';
import { commentBefore, insertAfterName } from '@/lib/fix/rules/shared';

export const ALT_TODO = `${PLACEHOLDER}: write alt text that describes this image, or confirm it is decorative and keep alt=""`;

/** image-alt: `alt=""` plus a TODO comment. Never writes a description. */
export const imageAltRule: Rule = ({ source, kind, tag }) => {
  if (kind === 'jsx' ? tag.tagName !== 'img' : tag.tagName.toLowerCase() !== 'img') return null;
  if (getAttr(tag, 'alt')) return null;
  const role = (literal(tag, 'role') ?? '').toLowerCase();
  if (role === 'presentation' || role === 'none') return null;
  if (literal(tag, 'aria-label') || getAttr(tag, 'aria-labelledby') || literal(tag, 'title')) return null;

  const edits: TextEdit[] = [];
  const comment = commentBefore(source, tag.start, kind, ALT_TODO);
  if (comment) {
    edits.push(comment, insertAfterName(tag.nameEnd, 'alt=""'));
  } else {
    // JSX outside a children list: a block comment inside the tag is still valid syntax.
    edits.push(insertAfterName(tag.nameEnd, `alt="" /* ${ALT_TODO} */`));
  }
  return {
    rule: 'image-alt',
    edits,
    placeholder: true,
    note: `Adds \`alt=""\` and a \`${PLACEHOLDER}\` comment. A human must write a real description, or confirm the image is decorative.`,
  };
};
