import { expect, test } from '@playwright/test';
import pricing from '../config/pricing.json';
import { PILOT_REQUEST_HREF } from '../lib/billing';
import { AUTOMATED_TESTING_DISCLAIMER, LEGAL_DISCLAIMER } from '../lib/copy';
import { pilotRequestText } from '../lib/pilot-offer';
import { blockOtherOrigins, expectFlagOffHome, withOfferServer } from './offer-support';
import { expectNoSeriousViolations } from './support';

const price = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: pricing.currency,
  maximumFractionDigits: 0,
}).format(pricing.priceUsdPerYear);

const states = [
  { name: 'off', enabled: false, pilotUrl: '', checkout: '' },
  { name: 'invoice-waitlist', enabled: true, pilotUrl: '', checkout: '' },
  { name: 'invoice-mailto', enabled: true, pilotUrl: 'mailto:pilot@example.test?subject=Pilot', checkout: '' },
  { name: 'https-checkout', enabled: true, pilotUrl: '', checkout: 'https://checkout.example.test/buy?plan=yearly' },
];

for (const { name, enabled, pilotUrl, checkout } of states) {
  test(`go-live preview: ${name}`, async ({ page }) => {
    await withOfferServer({
      A11YGATE_PRICING_ENABLED: enabled ? '1' : '',
      A11YGATE_PILOT_REQUEST_URL: pilotUrl,
      A11YGATE_CHECKOUT_URL: checkout,
    }, async (origin) => {
      await blockOtherOrigins(page, origin);
      await page.route(`${origin}/api/waitlist`, (route) => route.fulfill({
        json: { available: enabled },
      }));
      const pilotTarget = pilotUrl || PILOT_REQUEST_HREF;
      const home = await page.goto(origin);
      expect(home?.status()).toBe(200);
      if (enabled) {
        const offer = page.locator('section.offer');
        await expect(offer.getByText(`${price} per year`, { exact: true })).toBeVisible();
        await expect(offer.getByText(AUTOMATED_TESTING_DISCLAIMER, { exact: true })).toBeVisible();
        await expect(offer.getByRole('link', { name: pilotRequestText, exact: true })).toHaveAttribute('href', pilotTarget);
        await expect(page.locator('.waitlist').getByRole('heading', {
          name: pilotUrl ? 'Join the waitlist' : 'Request a free pilot',
          exact: true,
        })).toBeVisible();
      } else {
        await expectFlagOffHome(page);
        await expect(page.getByText(LEGAL_DISCLAIMER, { exact: true })).toBeVisible();
      }
      await expectNoSeriousViolations(page, `${name} home`);
      await page.screenshot({ path: `go-live-preview/${name}-home.png`, fullPage: true });

      const response = await page.goto(`${origin}/pricing`);
      expect(response?.status()).toBe(enabled ? 200 : 404);
      if (enabled) {
        const main = page.getByRole('main');
        await expect(main.getByText(`${price}/year (${pricing.currency})`, { exact: true })).toBeVisible();
        await expect(main.getByText(AUTOMATED_TESTING_DISCLAIMER, { exact: true })).toBeVisible();
        await expect(main.getByRole('link', { name: 'Request a pilot', exact: true })).toHaveAttribute('href', pilotTarget);
        const payment = checkout ? `Subscribe — ${price}/year` : 'Request an invoice';
        await expect(main.getByRole('link', { name: payment, exact: true })).toHaveAttribute('href', checkout || pilotTarget);
      }
      await expectNoSeriousViolations(page, `${name} pricing`);
      await page.screenshot({ path: `go-live-preview/${name}-pricing.png`, fullPage: true });
    });
  });
}
