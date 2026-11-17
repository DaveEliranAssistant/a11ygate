import { annualPrice, getCheckoutUrl, PILOT_REQUEST_HREF } from '@/lib/billing';

export function CheckoutButton() {
  const url = getCheckoutUrl();

  return url ? (
    <a href={url} rel="noopener">Subscribe — {annualPrice}/year</a>
  ) : (
    <a href={PILOT_REQUEST_HREF}>Request an invoice</a>
  );
}
