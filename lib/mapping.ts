/**
 * Static crosswalk from axe-core `wcag*` success-criterion tags to WCAG 2.1/2.2
 * and EN 301 549 clause 9.
 *
 * This mapping needs expert review before it is used as compliance evidence.
 * Clause numbers follow the usual 9.x mirror of the WCAG number. EN 301 549
 * edition alignment, especially for criteria added in WCAG 2.2, has to be
 * confirmed by a qualified accessibility specialist. Level tags such as
 * `wcag2aa` are not success criteria. A finding with no mapped criterion is
 * reported as best practice.
 */

export type WcagEdition = '2.1' | '2.2';
export type WcagLevel = 'A' | 'AA';

export type Criterion = {
  tag: string;
  number: string;
  name: string;
  level: WcagLevel;
  en301549: string;
  wcag: WcagEdition;
};

export type StandardsHit =
  | ({ kind: 'criterion' } & Criterion)
  | { kind: 'best-practice' };

type CriterionSeed = {
  number: string;
  name: string;
  level: WcagLevel;
  wcag: WcagEdition;
};

const SEEDS: readonly CriterionSeed[] = [
  { number: '1.1.1', name: 'Non-text Content', level: 'A', wcag: '2.1' },
  { number: '1.2.1', name: 'Audio-only and Video-only (Prerecorded)', level: 'A', wcag: '2.1' },
  { number: '1.2.2', name: 'Captions (Prerecorded)', level: 'A', wcag: '2.1' },
  {
    number: '1.2.3',
    name: 'Audio Description or Media Alternative (Prerecorded)',
    level: 'A',
    wcag: '2.1',
  },
  { number: '1.2.4', name: 'Captions (Live)', level: 'AA', wcag: '2.1' },
  { number: '1.2.5', name: 'Audio Description (Prerecorded)', level: 'AA', wcag: '2.1' },
  { number: '1.3.1', name: 'Info and Relationships', level: 'A', wcag: '2.1' },
  { number: '1.3.2', name: 'Meaningful Sequence', level: 'A', wcag: '2.1' },
  { number: '1.3.3', name: 'Sensory Characteristics', level: 'A', wcag: '2.1' },
  { number: '1.3.4', name: 'Orientation', level: 'AA', wcag: '2.1' },
  { number: '1.3.5', name: 'Identify Input Purpose', level: 'AA', wcag: '2.1' },
  { number: '1.4.1', name: 'Use of Color', level: 'A', wcag: '2.1' },
  { number: '1.4.2', name: 'Audio Control', level: 'A', wcag: '2.1' },
  { number: '1.4.3', name: 'Contrast (Minimum)', level: 'AA', wcag: '2.1' },
  { number: '1.4.4', name: 'Resize Text', level: 'AA', wcag: '2.1' },
  { number: '1.4.5', name: 'Images of Text', level: 'AA', wcag: '2.1' },
  { number: '1.4.10', name: 'Reflow', level: 'AA', wcag: '2.1' },
  { number: '1.4.11', name: 'Non-text Contrast', level: 'AA', wcag: '2.1' },
  { number: '1.4.12', name: 'Text Spacing', level: 'AA', wcag: '2.1' },
  { number: '1.4.13', name: 'Content on Hover or Focus', level: 'AA', wcag: '2.1' },
  { number: '2.1.1', name: 'Keyboard', level: 'A', wcag: '2.1' },
  { number: '2.1.2', name: 'No Keyboard Trap', level: 'A', wcag: '2.1' },
  { number: '2.1.4', name: 'Character Key Shortcuts', level: 'A', wcag: '2.1' },
  { number: '2.2.1', name: 'Timing Adjustable', level: 'A', wcag: '2.1' },
  { number: '2.2.2', name: 'Pause, Stop, Hide', level: 'A', wcag: '2.1' },
  { number: '2.3.1', name: 'Three Flashes or Below Threshold', level: 'A', wcag: '2.1' },
  { number: '2.4.1', name: 'Bypass Blocks', level: 'A', wcag: '2.1' },
  { number: '2.4.2', name: 'Page Titled', level: 'A', wcag: '2.1' },
  { number: '2.4.3', name: 'Focus Order', level: 'A', wcag: '2.1' },
  { number: '2.4.4', name: 'Link Purpose (In Context)', level: 'A', wcag: '2.1' },
  { number: '2.4.5', name: 'Multiple Ways', level: 'AA', wcag: '2.1' },
  { number: '2.4.6', name: 'Headings and Labels', level: 'AA', wcag: '2.1' },
  { number: '2.4.7', name: 'Focus Visible', level: 'AA', wcag: '2.1' },
  { number: '2.4.11', name: 'Focus Not Obscured (Minimum)', level: 'AA', wcag: '2.2' },
  { number: '2.5.1', name: 'Pointer Gestures', level: 'A', wcag: '2.1' },
  { number: '2.5.2', name: 'Pointer Cancellation', level: 'A', wcag: '2.1' },
  { number: '2.5.3', name: 'Label in Name', level: 'A', wcag: '2.1' },
  { number: '2.5.4', name: 'Motion Actuation', level: 'A', wcag: '2.1' },
  { number: '2.5.7', name: 'Dragging Movements', level: 'AA', wcag: '2.2' },
  { number: '2.5.8', name: 'Target Size (Minimum)', level: 'AA', wcag: '2.2' },
  { number: '3.1.1', name: 'Language of Page', level: 'A', wcag: '2.1' },
  { number: '3.1.2', name: 'Language of Parts', level: 'AA', wcag: '2.1' },
  { number: '3.2.1', name: 'On Focus', level: 'A', wcag: '2.1' },
  { number: '3.2.2', name: 'On Input', level: 'A', wcag: '2.1' },
  { number: '3.2.3', name: 'Consistent Navigation', level: 'AA', wcag: '2.1' },
  { number: '3.2.4', name: 'Consistent Identification', level: 'AA', wcag: '2.1' },
  { number: '3.2.6', name: 'Consistent Help', level: 'A', wcag: '2.2' },
  { number: '3.3.1', name: 'Error Identification', level: 'A', wcag: '2.1' },
  { number: '3.3.2', name: 'Labels or Instructions', level: 'A', wcag: '2.1' },
  { number: '3.3.3', name: 'Error Suggestion', level: 'AA', wcag: '2.1' },
  { number: '3.3.4', name: 'Error Prevention (Legal, Financial, Data)', level: 'AA', wcag: '2.1' },
  { number: '3.3.7', name: 'Redundant Entry', level: 'A', wcag: '2.2' },
  { number: '3.3.8', name: 'Accessible Authentication (Minimum)', level: 'AA', wcag: '2.2' },
  // 4.1.1 Parsing was removed in WCAG 2.2. Kept for axe tags on WCAG 2.1 targets.
  { number: '4.1.1', name: 'Parsing', level: 'A', wcag: '2.1' },
  { number: '4.1.2', name: 'Name, Role, Value', level: 'A', wcag: '2.1' },
  { number: '4.1.3', name: 'Status Messages', level: 'AA', wcag: '2.1' },
];

function tagFor(number: string): string {
  return `wcag${number.split('.').join('')}`;
}

export const CRITERIA: readonly Criterion[] = SEEDS.map((seed) => ({
  tag: tagFor(seed.number),
  number: seed.number,
  name: seed.name,
  level: seed.level,
  en301549: `9.${seed.number}`,
  wcag: seed.wcag,
}));

const BY_TAG = new Map(CRITERIA.map((criterion) => [criterion.tag, criterion]));

export function getCriterion(tag: string): Criterion | null {
  return BY_TAG.get(tag.toLowerCase()) ?? null;
}

export function lookupStandards(tags: readonly string[]): StandardsHit[] {
  const hits: StandardsHit[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const criterion = getCriterion(tag);
    if (!criterion || seen.has(criterion.number)) continue;
    seen.add(criterion.number);
    hits.push({ kind: 'criterion', ...criterion });
  }
  if (hits.length === 0) return [{ kind: 'best-practice' }];
  return hits;
}

export function formatStandards(tags: readonly string[]): string {
  const hits = lookupStandards(tags);
  if (hits.length === 1 && hits[0]?.kind === 'best-practice') return 'best practice';
  return hits
    .filter((hit): hit is Extract<StandardsHit, { kind: 'criterion' }> => hit.kind === 'criterion')
    .map(
      (hit) =>
        `WCAG ${hit.wcag} ${hit.number} ${hit.name} (${hit.level}); EN 301 549 ${hit.en301549}`,
    )
    .join(' | ');
}

/**
 * Official W3C "Understanding WCAG 2.2" documents. This base URL is the single
 * source of external "how to fix" links for success criteria; report writers
 * must link through {@link understandingUrl} instead of hardcoding URLs.
 * The page slug is the criterion name, lowercased, punctuation dropped and
 * spaces hyphenated (e.g. 1.4.3 Contrast (Minimum) → contrast-minimum).
 */
export const W3C_UNDERSTANDING_BASE = 'https://www.w3.org/WAI/WCAG22/Understanding/';

export function understandingUrl(criterion: Pick<Criterion, 'number'>): string | null {
  const known = CRITERIA.find((c) => c.number === criterion.number);
  if (!known) return null;
  const slug = known.name.toLowerCase().replace(/[(),]/g, '').trim().replace(/\s+/g, '-');
  return `${W3C_UNDERSTANDING_BASE}${slug}.html`;
}
