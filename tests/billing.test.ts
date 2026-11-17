import { afterEach, expect, it, vi } from 'vitest';
import { getCheckoutUrl, isPricingEnabled } from '@/lib/billing';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it.each([undefined, '', '0', 'false', 'TRUE', 'yes'])('keeps pricing off for %s', (value) => {
  vi.stubEnv('A11YGATE_PRICING_ENABLED', value);
  expect(isPricingEnabled()).toBe(false);
});

it.each(['1', 'true'])('enables pricing for %s', (value) => {
  vi.stubEnv('A11YGATE_PRICING_ENABLED', value);
  expect(isPricingEnabled()).toBe(true);
});

it.each([undefined, ''])('selects the invoice fallback without warning for %s', (value) => {
  vi.stubEnv('A11YGATE_CHECKOUT_URL', value);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(getCheckoutUrl()).toBeUndefined();
  expect(warn).not.toHaveBeenCalled();
});

it.each([
  'http://checkout.example.test/checkout',
  'javascript:alert(1)',
  'not a URL',
  'https://',
  'https:checkout.example.test',
  'https://user:password@checkout.example.test/',
])('ignores invalid checkout URL %s and logs a warning', (value) => {
  vi.stubEnv('A11YGATE_CHECKOUT_URL', value);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(getCheckoutUrl()).toBeUndefined();
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('A11YGATE_CHECKOUT_URL'));
  expect(warn.mock.calls[0]?.[0]).not.toContain(value);
});

it('returns the public HTTPS checkout link', () => {
  const url = 'https://checkout.example.test/buy?plan=yearly';
  vi.stubEnv('A11YGATE_CHECKOUT_URL', url);
  expect(getCheckoutUrl()).toBe(url);
});
