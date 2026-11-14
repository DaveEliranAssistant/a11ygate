/** Seed crosswalk using the same criterion IDs as lib/mapping.ts and axe tags.
 * Empty arrays identify best-practice rules. Native result tags remain authoritative.
 */
export const WCAG_RULE_MAP: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  axe: {
    'image-alt': ['1.1.1'],
    'color-contrast': ['1.4.3'],
    label: ['4.1.2', '1.3.1'],
    region: [],
    'document-title': ['2.4.2'],
    'html-has-lang': ['3.1.1'],
    'html-lang-valid': ['3.1.1'],
    'link-name': ['2.4.4', '4.1.2'],
    'button-name': ['4.1.2'],
  },
};
