import { lookupStandards } from '@/lib/mapping';

export function StandardsList({ tags }: { tags: readonly string[] }) {
  const hits = lookupStandards(tags);
  if (hits.length === 1 && hits[0]?.kind === 'best-practice') {
    return <span>best practice</span>;
  }

  return (
    <ul className="standards">
      {hits.map((hit) =>
        hit.kind === 'criterion' ? (
          <li key={hit.number}>
            WCAG {hit.wcag} {hit.number} {hit.name} ({hit.level})
            <span className="en">EN 301 549 {hit.en301549}</span>
          </li>
        ) : null,
      )}
    </ul>
  );
}
