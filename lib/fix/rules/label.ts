import { elementRange, findOpenTags, getAttr, literal, plainText, type ElementRange } from '@/lib/fix/element';
import type { Rule, RuleInput, RuleResult, TextEdit } from '@/lib/fix/types';
import { attribute, insertAfterName } from '@/lib/fix/rules/shared';

const CONTROLS = new Set(['input', 'select', 'textarea']);
const UNLABELLED_INPUT_TYPES = new Set(['hidden', 'submit', 'reset', 'button', 'image']);

type Neighbor = { label: ElementRange; position: 'before' | 'after' };

/**
 * A `<label>` that is the control's direct sibling (only whitespace between)
 * and has visible text. Labels that wrap other controls are ignored.
 */
function adjacentLabel(input: RuleInput, control: ElementRange): Neighbor | null {
  const { source, kind } = input;
  const controlEnd = control.close ? control.close.end : control.open.end;
  for (const open of findOpenTags(source, 'label', kind)) {
    const label = elementRange(source, open, kind, 2000);
    if (!label?.close) continue;
    const between =
      label.close.end <= control.open.start
        ? source.slice(label.close.end, control.open.start)
        : open.start >= controlEnd
          ? source.slice(controlEnd, open.start)
          : null;
    if (between === null || between.trim().length > 0) continue;
    const content = source.slice(label.contentStart, label.contentEnd);
    if (/<(input|select|textarea|button)\b/i.test(content)) return null;
    const text = plainText(content);
    const dynamic = /\{(?!\/\*)[^}]+\}/.test(content.replace(/<[^>]*>/g, ' '));
    if (text.length === 0 && !dynamic) return null;
    return { label, position: label.close.end <= control.open.start ? 'before' : 'after' };
  }
  return null;
}

export const labelRule: Rule = (input) => {
  const { source, kind, tag } = input;
  const name = tag.tagName.toLowerCase();
  if (kind === 'jsx' && tag.tagName !== name) return null;
  if (!CONTROLS.has(name)) return null;
  if (name === 'input' && UNLABELLED_INPUT_TYPES.has((literal(tag, 'type') ?? '').toLowerCase())) return null;
  if (literal(tag, 'aria-label') || getAttr(tag, 'aria-labelledby')) return null;

  const control = elementRange(source, tag, kind);
  if (!control) return null;
  const neighbor = adjacentLabel(input, control);
  // No visible label text to reuse: never invent one.
  if (!neighbor) return null;
  const labelTag = neighbor.label.open;
  const forName = kind === 'jsx' ? 'htmlFor' : 'for';
  const labelFor = getAttr(labelTag, 'for');
  const id = getAttr(tag, 'id');

  const result = (edits: TextEdit[], note: string): RuleResult => ({ rule: 'label', edits, placeholder: false, note });

  if (labelFor) {
    // The label already points somewhere. Give the control that id when it has none.
    if (id || labelFor.kind !== 'literal' || !labelFor.value) return null;
    const value = labelFor.value;
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\bid\\s*=\\s*\\{?["']${escaped}["']`).test(source)) return null;
    const attr = attribute('id', value);
    if (!attr) return null;
    return result([insertAfterName(tag.nameEnd, attr)], `Adds \`id="${value}"\` so the existing label's \`${forName}\` points at this control.`);
  }

  if (id && id.kind === 'literal' && id.value) {
    const attr = attribute(forName, id.value);
    if (!attr) return null;
    return result([insertAfterName(labelTag.nameEnd, attr)], `Associates the existing visible label with this control through \`${forName}\`/\`id\`.`);
  }
  if (id && id.kind === 'expression') {
    return result(
      [insertAfterName(labelTag.nameEnd, `${forName}=${source.slice(id.start, id.end).replace(/^[^=]*=\s*/, '')}`)],
      `Associates the existing visible label with this control through \`${forName}\`/\`id\`.`,
    );
  }

  // No id: wrap the control in the existing label instead of inventing an id.
  const label = neighbor.label;
  const controlEnd = control.close ? control.close.end : control.open.end;
  const note = 'Wraps the control in its existing visible `<label>`; the label text is unchanged.';
  if (neighbor.position === 'before' && label.close) {
    const closeText = source.slice(label.close.start, label.close.end);
    return result(
      [
        { start: label.close.start, end: label.close.end, text: '' },
        { start: controlEnd, end: controlEnd, text: closeText },
      ],
      note,
    );
  }
  const openText = source.slice(labelTag.start, labelTag.end);
  return result(
    [
      { start: tag.start, end: tag.start, text: openText },
      { start: labelTag.start, end: labelTag.end, text: '' },
    ],
    note,
  );
};
