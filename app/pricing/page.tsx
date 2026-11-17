import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { CheckoutButton } from '@/components/CheckoutButton';
import { annualPrice, isPricingEnabled, PILOT_REQUEST_HREF, pricing } from '@/lib/billing';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';

export const metadata: Metadata = {
  title: 'Pricing',
  alternates: { canonical: '/pricing' },
};

export default async function PricingPage() {
  await connection();
  if (!isPricingEnabled()) notFound();

  return (
    <main id="main" className="shell narrow" tabIndex={-1}>
      <h1>{pricing.plan} pricing</h1>
      <p className="lede">{annualPrice}/year ({pricing.currency})</p>
      <p><CheckoutButton /></p>

      <h2>What’s included</h2>
      <ul>
        <li>Compare automated accessibility findings against a baseline in CI.</li>
        <li>Generate evidence reports and export findings for developer handoff.</li>
        <li>Track changes across scans using evidence packs and trend reports.</li>
      </ul>

      <h2>{pricing.pilot.lengthDays}-day free pilot</h2>
      <p>Try the regression gate in your CI and review the evidence it produces.</p>
      <p><a href={PILOT_REQUEST_HREF}>Request a pilot</a></p>

      <h2>Frequently asked questions</h2>
      <h3>How does the pilot convert?</h3>
      <p>
        After the pilot, you can choose to subscribe or request an invoice for the yearly plan.
        The pilot ends without an automatic charge.
      </p>
      {process.env.NODE_ENV !== 'production' && (
        <>
          <h3>What about VAT and invoices?</h3>
          <p>[[OWNER: tax/invoice wording]]</p>
        </>
      )}
      <p className="disclaimer">{AUTOMATED_TESTING_DISCLAIMER}</p>
    </main>
  );
}
