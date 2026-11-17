import pricingConfig from '@/config/pricing.json';

export const pricing = pricingConfig;

// Until the pilot request CTA ships, use the existing waitlist.
export const PILOT_REQUEST_HREF = '/#waitlist-heading';

export const annualPrice = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: pricing.currency,
  maximumFractionDigits: 0,
}).format(pricing.priceUsdPerYear);

export function isPricingEnabled(): boolean {
  const value = process.env.A11YGATE_PRICING_ENABLED;
  return value === '1' || value === 'true';
}

export function getCheckoutUrl(): string | undefined {
  const value = process.env.A11YGATE_CHECKOUT_URL;
  if (value === undefined || value === '') return undefined;

  const url = URL.canParse(value) ? new URL(value) : undefined;
  if (url?.protocol === 'https:' && /^https:\/\/[^/\\\s]/i.test(value) && !url.username && !url.password) {
    return url.href;
  }

  console.warn('Ignoring A11YGATE_CHECKOUT_URL. Set it to an absolute HTTPS checkout URL without credentials.');
  return undefined;
}
