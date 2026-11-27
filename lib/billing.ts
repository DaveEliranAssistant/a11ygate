import pricingConfig from '@/config/pricing.json';
import { formatAnnualPrice, getPilotRequestUrl, parsePricingFlag, PILOT_REQUEST_HREF } from './billing-env.mjs';

export { formatAnnualPrice, getCheckoutUrl, getPilotRequestUrl, PILOT_REQUEST_HREF } from './billing-env.mjs';
export const pricing = pricingConfig;
export const annualPrice = formatAnnualPrice(pricing);

export function isPricingEnabled(): boolean {
  return parsePricingFlag() === true;
}

/** Where every "request a pilot" link points: the configured URL, or the waitlist form on the home page. */
export function getPilotRequestHref(): string {
  return getPilotRequestUrl() ?? PILOT_REQUEST_HREF;
}
