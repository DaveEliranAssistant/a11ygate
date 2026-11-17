import Link from 'next/link';
import { annualPrice, pricing } from '@/lib/billing';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';

export const OFFER_HEADING = 'Accessibility gate in your CI, with evidence for every release';
export const PILOT_CTA = 'Request a free pilot';

/** Integrations with a guide or template on main (integrations/, docs/integrations/). */
export const SUPPORTED_CI = [
  'GitHub Actions',
  'Jenkins',
  'GitLab CI/CD',
  'Azure DevOps',
  'CircleCI',
  'Bitbucket Pipelines',
] as const;

export const yearlyPriceText = `${annualPrice} per year`;

function pilotLength(days: number): string {
  return days % 7 === 0 ? `${days / 7}-week` : `${days}-day`;
}

export const pilotText = `Start with a free ${pilotLength(pricing.pilot.lengthDays)} pilot`;

export function PilotOffer({ pilotHref }: { pilotHref: string }) {
  const external = /^https:/i.test(pilotHref);
  return (
    <section className="offer" aria-labelledby="offer-heading">
      <h2 id="offer-heading">{OFFER_HEADING}</h2>
      <p>
        A11yGate is a CI gate with a baseline and an evidence pack. It is not an overlay widget; it
        doesn&apos;t change your site at runtime.
      </p>
      <ul>
        <li>
          <strong>CI gate:</strong> a pull request fails when it adds a new serious or critical
          automated finding.
        </li>
        <li>
          <strong>Baseline:</strong> findings you already have are recorded and reviewed, so they
          don&apos;t block every merge.
        </li>
        <li>
          <strong>Evidence pack:</strong> each release gets a report of what was scanned, what
          changed and what still needs a person to check.
        </li>
      </ul>
      <p className="offer-price">
        <strong>{yearlyPriceText}</strong> ({pricing.currency}). {pilotText}.
      </p>

      <h3>How the pilot converts</h3>
      <ol>
        <li>
          <strong>Week 1, setup and baseline:</strong> add the gate to one pipeline and record a
          baseline of current findings.
        </li>
        <li>
          <strong>Week 2, gate on pull requests:</strong> new serious or critical findings fail the
          check; baselined ones don&apos;t.
        </li>
        <li>
          <strong>Week 3, results review:</strong> go through the findings and the evidence pack,
          then subscribe or walk away. Nothing is billed automatically.
        </li>
      </ol>

      <h3>Supported CI</h3>
      <ul className="offer-ci">
        {SUPPORTED_CI.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>

      <p className="hero-actions">
        <a className="button button-ink" href={pilotHref} rel={external ? 'noopener' : undefined}>
          {PILOT_CTA}
        </a>
        <Link href="/pricing">See pricing</Link>
      </p>
      <p className="disclaimer">{AUTOMATED_TESTING_DISCLAIMER}</p>
    </section>
  );
}
