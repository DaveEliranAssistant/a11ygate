import { readFileSync } from 'node:fs';
import {
  formatAnnualPrice,
  getCheckoutUrl,
  getPilotRequestUrl,
  parsePricingFlag,
  PILOT_REQUEST_HREF,
} from '../lib/billing-env.mjs';

function describeDestination(href) {
  if (!href) return `Waitlist form (${PILOT_REQUEST_HREF})`;
  const url = new URL(href);
  return url.protocol === 'mailto:' ? 'mailto: (address redacted)' : `HTTPS (${url.host})`;
}

const env = process.env;
const errors = [];
const warn = (message) => errors.push(message.replace(/^Ignoring /, ''));
const enabled = parsePricingFlag(env);
if (enabled === undefined) {
  errors.push('A11YGATE_PRICING_ENABLED must be 1, true, 0, false, or unset.');
}
const checkout = getCheckoutUrl(env, warn);
const pilotUrl = getPilotRequestUrl(env, warn);

console.log('Automated testing only. Not a WCAG audit, certification or legal advice.');
if (errors.length) {
  for (const error of errors) console.error(`Error: ${error}`);
  process.exitCode = 1;
} else {
  const pricing = JSON.parse(readFileSync(new URL('../config/pricing.json', import.meta.url), 'utf8'));
  const price = formatAnnualPrice(pricing);
  const pilotPrice = pricing.pilot.priceUsd === 0 ? 'free' : `USD ${pricing.pilot.priceUsd}`;
  const pilotLength = Math.ceil(pricing.pilot.lengthDays / 7);
  const destination = describeDestination(pilotUrl);
  const checkoutDestination = checkout ? describeDestination(checkout) : undefined;

  console.table({
    'Home offer': enabled ? `${price} per year (${pricing.currency}); ${pilotLength}-week pilot (${pilotPrice})` : 'offer hidden',
    'Home pilot CTA': enabled ? destination : 'hidden',
    'Home form': enabled && !pilotUrl ? 'Pilot request form' : 'Waitlist',
    '/pricing button': !enabled ? '404 (pricing disabled)' : checkoutDestination
      ? `Subscribe — ${price}/year → ${checkoutDestination}`
      : `Request an invoice → ${destination}`,
    '/pricing pilot CTA': enabled ? destination : 'hidden',
    'Quote payment line': checkoutDestination ? `Checkout link → ${checkoutDestination}` : 'invoice on request',
  });
}
