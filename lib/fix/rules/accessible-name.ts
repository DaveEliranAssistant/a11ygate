import { elementRange, getAttr, hasExpression, literal, parseOpenTag, plainText } from '@/lib/fix/element';
import { PLACEHOLDER, type Rule } from '@/lib/fix/types';
import { attribute, insertAfterName } from '@/lib/fix/rules/shared';

export const NAME_PLACEHOLDER = `${PLACEHOLDER}: add accessible name`;

const NOISE = new Set([
  'icon', 'icons', 'ic', 'svg', 'img', 'image', 'images', 'btn', 'button', 'fa', 'fas', 'far', 'fab', 'fal',
  'solid', 'regular', 'outline', 'outlined', 'filled', 'fill', 'light', 'bi', 'mdi', 'glyph', 'sprite',
  'static', 'assets', 'asset', 'media', 'lg', 'sm', 'xs', 'fw', 'png', 'jpg', 'jpeg', 'gif', 'webp',
]);

/** Turns `close-icon.svg`, `IconTrash` or `#icon-search` into `Close`, `Trash`, `Search`. */
export function humanize(raw: string): string | null {
  const base = raw.split(/[?#]/)[0] ?? '';
  const file = (base.split('/').pop() ?? '').replace(/\.[a-z0-9]{2,5}$/i, '');
  const words = file
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[\s_.\-:]+/)
    .map((word) => word.toLowerCase())
    .filter((word) => word.length > 0 && !NOISE.has(word));
  if (words.length === 0 || words.length > 4) return null;
  // Hashes and numbers are not names.
  if (!words.every((word) => /^[a-z]{2,20}$/.test(word))) return null;
  if (words.some((word) => /[bcdfghjklmnpqrstvwxz]{5,}/.test(word))) return null;
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Name hints from icons inside the control: img src, icon name, `<use href>`, icon component, icon class. */
function iconHint(content: string): { name: string; from: string } | null {
  const pattern = /<([A-Za-z][\w:.-]*)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content))) {
    const tag = parseOpenTag(content, match.index);
    if (!tag) continue;
    const tagName = tag.tagName;
    const candidates: { value: string | undefined; from: string }[] = [];
    if (tagName.toLowerCase() === 'img') candidates.push({ value: literal(tag, 'src'), from: 'image file name' });
    candidates.push({ value: literal(tag, 'data-icon'), from: 'icon name' });
    if (tagName.toLowerCase() !== 'img' && tagName.toLowerCase() !== 'input') {
      candidates.push({ value: literal(tag, 'name'), from: 'icon name' });
    }
    if (tagName.toLowerCase() === 'use') {
      candidates.push({ value: literal(tag, 'href') ?? literal(tag, 'xlink:href'), from: 'SVG symbol id' });
    }
    const component = /^(?:([A-Z][A-Za-z]*?)Icon|Icon([A-Z][A-Za-z]*))$/.exec(tagName);
    if (component) candidates.push({ value: component[1] ?? component[2], from: 'icon component name' });
    const cls = literal(tag, 'class') ?? '';
    for (const token of cls.split(/\s+/)) {
      const icon = /^(?:fa|icon|bi|mdi|ti|ri)-([a-z][a-z-]*)$/.exec(token);
      if (icon && !NOISE.has(icon[1])) candidates.push({ value: icon[1], from: 'icon class' });
    }
    for (const candidate of candidates) {
      if (!candidate.value) continue;
      const fragment = candidate.value.startsWith('#') ? candidate.value.slice(1) : candidate.value;
      const name = humanize(fragment);
      if (name) return { name, from: candidate.from };
    }
  }
  return null;
}

/** button-name and link-name: add aria-label from existing context, or a TODO placeholder. */
export const accessibleNameRule: Rule = (input) => {
  const { source, kind, tag, ruleId } = input;
  const name = tag.tagName.toLowerCase();
  if (kind === 'jsx' && tag.tagName !== name) return null;
  const expected = ruleId === 'link-name' ? 'a' : 'button';
  if (name !== expected) return null;
  if (getAttr(tag, 'aria-label') || getAttr(tag, 'aria-labelledby')) return null;

  const range = elementRange(source, tag, kind);
  if (!range) return null;
  const content = source.slice(range.contentStart, range.contentEnd);
  // Visible or dynamic text inside: the problem is elsewhere (hidden text, CSS). Do not guess.
  if (plainText(content).length > 0 || hasExpression(content)) return null;

  const title = literal(tag, 'title');
  const icon = title ? null : iconHint(content);
  const value = title ?? icon?.name ?? NAME_PLACEHOLDER;
  const attr = attribute('aria-label', value) ?? attribute('aria-label', NAME_PLACEHOLDER);
  if (!attr) return null;
  const placeholder = attr.includes(PLACEHOLDER);
  const note = placeholder
    ? `No title, icon name or nearby text to reuse, so this adds a \`${PLACEHOLDER}\` placeholder. Replace it with the real name before merging.`
    : title
      ? 'Copies the existing `title` into `aria-label`.'
      : `Derives \`aria-label\` from the ${icon?.from}. Confirm it describes what the control does.`;
  return { rule: 'accessible-name', edits: [insertAfterName(tag.nameEnd, attr)], placeholder, note };
};
