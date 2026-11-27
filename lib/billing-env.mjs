// Pilot requests fall back to the existing waitlist form when A11YGATE_PILOT_REQUEST_URL is unset.
export const PILOT_REQUEST_HREF = '/#waitlist-heading';

export function formatAnnualPrice(config) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: config.currency,
    maximumFractionDigits: 0,
  }).format(config.priceUsdPerYear);
}

// Unknown values keep the app off and let preflight report a configuration error.
export function parsePricingFlag(env = process.env) {
  const value = env.A11YGATE_PRICING_ENABLED;
  if (value === '1' || value === 'true') return true;
  if (value === undefined || value === '' || value === '0' || value === 'false') return false;
  return undefined;
}

function isPublicHttpsUrl(url, raw) {
  return url.protocol === 'https:' && /^https:\/\/[^/\\\s]/i.test(raw) && !url.username && !url.password;
}

export function getCheckoutUrl(
  env = process.env,
  warn = console.warn,
) {
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
export function getPilotRequestUrl(env = process.env, warn = console.warn) {
  const value = env.A11YGATE_PILOT_REQUEST_URL;
  if (value === undefined || value === '') return undefined;

  const url = URL.canParse(value) ? new URL(value) : undefined;
  if (url && isPublicHttpsUrl(url, value)) {
    return url.href;
  }
  if (url?.protocol === 'mailto:' && /^mailto:[^\s@]+@[^\s@]+/i.test(value)) {
    return url.href;
  }

  warn('Ignoring A11YGATE_PILOT_REQUEST_URL. Set it to an absolute HTTPS URL without credentials or a mailto: address.');
  return undefined;
}
