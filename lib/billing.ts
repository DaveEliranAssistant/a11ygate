import pricingConfig from '@/config/pricing.json';

export const pricing = pricingConfig;

// Pilot requests fall back to the existing waitlist form when A11YGATE_PILOT_REQUEST_URL is unset.
export const PILOT_REQUEST_HREF = '/#waitlist-heading';

export function formatAnnualPrice(config: Pick<typeof pricing, 'currency' | 'priceUsdPerYear'>): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: config.currency,
    maximumFractionDigits: 0,
  }).format(config.priceUsdPerYear);
}

export const annualPrice = formatAnnualPrice(pricing);

export function isPricingEnabled(): boolean {
  const value = process.env.A11YGATE_PRICING_ENABLED;
  return value === '1' || value === 'true';
}

function isPublicHttpsUrl(url: URL, raw: string): boolean {
  return url.protocol === 'https:' && /^https:\/\/[^/\\\s]/i.test(raw) && !url.username && !url.password;
}

export function getCheckoutUrl(
  env: Record<string, string | undefined> = process.env,
  warn: (message: string) => void = console.warn,
): string | undefined {
  const value = env.A11YGATE_CHECKOUT_URL;
  if (value === undefined || value === '') return undefined;

  const url = URL.canParse(value) ? new URL(value) : undefined;
  if (url && isPublicHttpsUrl(url, value)) {
    return url.href;
  }

  warn('Ignoring A11YGATE_CHECKOUT_URL. Set it to an absolute HTTPS checkout URL without credentials.');
  return undefined;
}

/** Server-side, read per request. Accepts only https: (no credentials) or mailto: links. */
export function getPilotRequestUrl(): string | undefined {
  const value = process.env.A11YGATE_PILOT_REQUEST_URL;
  if (value === undefined || value === '') return undefined;

  const url = URL.canParse(value) ? new URL(value) : undefined;
  if (url && isPublicHttpsUrl(url, value)) {
    return url.href;
  }
  if (url?.protocol === 'mailto:' && /^mailto:[^\s@]+@[^\s@]+/i.test(value)) {
    return url.href;
  }

  console.warn('Ignoring A11YGATE_PILOT_REQUEST_URL. Set it to an absolute HTTPS URL without credentials or a mailto: address.');
  return undefined;
}

/** Where every "request a pilot" link points: the configured URL, or the waitlist form on the home page. */
export function getPilotRequestHref(): string {
  return getPilotRequestUrl() ?? PILOT_REQUEST_HREF;
}
