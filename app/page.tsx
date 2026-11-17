import { connection } from 'next/server';
import { PilotOffer } from '@/components/PilotOffer';
import { Workspace } from '@/components/Workspace';
import { getPilotRequestUrl, isPricingEnabled, PILOT_REQUEST_HREF } from '@/lib/billing';

export default async function HomePage() {
  // Read the pricing flag and pilot URL at request time, not at build time.
  await connection();
  if (!isPricingEnabled()) return <Workspace />;

  const pilotUrl = getPilotRequestUrl();
  return (
    <Workspace
      offer={<PilotOffer pilotHref={pilotUrl ?? PILOT_REQUEST_HREF} />}
      waitlistVariant={pilotUrl ? 'waitlist' : 'pilot'}
    />
  );
}
