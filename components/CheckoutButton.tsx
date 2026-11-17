import { annualPrice, getCheckoutUrl, getPilotRequestHref } from '@/lib/billing';

export function CheckoutButton() {
  const url = getCheckoutUrl();

  return url ? (
    <a href={url} rel="noopener">Subscribe — {annualPrice}/year</a>
  ) : (
    <a href={getPilotRequestHref()}>Request an invoice</a>
  );
}
