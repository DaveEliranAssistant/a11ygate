# Billing setup

1. **Owner action** — Choose a hosted checkout provider and complete account, tax, VAT and invoicing setup for your Israeli business registration.
2. **Owner action** — Create the product “A11yGate yearly” at $990 USD per year. Check the amount and billing interval against [the pricing config](../config/pricing.json).
3. **Owner action** — Copy the public HTTPS hosted checkout URL for that product.
4. **Owner action** — Set `A11YGATE_CHECKOUT_URL` to the public URL and `A11YGATE_PRICING_ENABLED` to `1` in the target Vercel environment. To launch with invoice requests, leave the checkout URL unset.
5. **Owner action** — Redeploy and verify the price and checkout link or invoice link on `/pricing`.

**Owner action** — Fill in the provider comparison before choosing a provider.

| Provider | Hosted checkout | Fees | VAT and invoicing | Notes |
| --- | --- | --- | --- | --- |
| [[OWNER: candidate]] | | | | |

Automated testing only. Not a WCAG audit, certification or legal advice.
