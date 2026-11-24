import pricing from '@/config/pricing.json';
import { PILOT_REQUEST_HEADING } from '@/lib/waitlist/messages';

export function describePilot(config: typeof pricing.pilot) {
  const weeks = Math.ceil(config.lengthDays / 7);
  const price = config.priceUsd === 0
    ? 'free'
    : new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        trailingZeroDisplay: 'stripIfInteger',
      }).format(config.priceUsd);
  return { weeks, length: `${weeks}-week`, price };
}

export const pilot = describePilot(pricing.pilot);
export const pilotRequestText = pilot.price === 'free' ? PILOT_REQUEST_HEADING : 'Request a pilot';
