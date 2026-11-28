import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { expect, test } from '@playwright/test';
import pricing from '../config/pricing.json';
import { PILOT_REQUEST_HREF } from '../lib/billing';
import { AUTOMATED_TESTING_DISCLAIMER, SAMPLE_DELIVERABLES_URL, SITE_URL } from '../lib/copy';
import { expectNoSeriousViolations } from './support';

const testCheckout = 'https://checkout.example.test/subscribe?plan=yearly';
const price = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: pricing.currency,
  maximumFractionDigits: 0,
}).format(pricing.priceUsdPerYear);

test('pricing flag off returns HTTP 404 and omits pricing from the sitemap', async ({ request }) => {
  expect((await request.get('/pricing')).status()).toBe(404);

  const sitemap = await request.get('/sitemap.xml');
  expect(sitemap.ok()).toBe(true);
  expect(await sitemap.text()).not.toContain('/pricing');
});

for (const mode of ['invoice', 'checkout'] as const) {
  test(`pricing flag on shows the plan and ${mode} link in production`, async ({ page }) => {
    const server = spawn(process.execPath, [
      'node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '0',
    ], {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        NEXT_TELEMETRY_DISABLED: '1',
        A11YGATE_PRICING_ENABLED: mode === 'invoice' ? '1' : 'true',
        A11YGATE_CHECKOUT_URL: mode === 'checkout' ? testCheckout : '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    server.stderr.on('data', (chunk) => { output += chunk.toString(); });
    const exited = once(server, 'close');
    // Reuse the main webServer's production build and let the OS allocate the port.
    let origin: string | undefined;
    server.stdout.on('data', (chunk) => {
      output += chunk.toString();
      origin ??= output.match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
    });

    try {
      await expect.poll(() => origin, { timeout: 10_000, message: 'Next.js loopback server startup' }).toBeDefined();
      const base = origin!;
      await page.route('**/*', (route) =>
        new URL(route.request().url()).origin === base ? route.continue() : route.abort(),
      );
      const response = await page.goto(`${base}/pricing`);
      expect(response?.status()).toBe(200);
      const main = page.getByRole('main');
      await expect(main.getByRole('heading', { name: `${pricing.plan} pricing` })).toBeVisible();
      await expect(main.getByText(`${price}/year (${pricing.currency})`, { exact: true })).toBeVisible();
      await expect(main.getByRole('heading', { name: `3-week free pilot` })).toBeVisible();
      await expect(main.getByText(AUTOMATED_TESTING_DISCLAIMER, { exact: false })).toBeVisible();
      expect(await response!.text()).not.toContain('[[OWNER: tax/invoice wording]]');
      // A11Y-R79: link to the sample deliverables pack (docs/samples on GitHub main).
      await expect(main.getByRole('link', { name: 'See sample deliverables', exact: true })).toHaveAttribute('href', SAMPLE_DELIVERABLES_URL);

      if (mode === 'checkout') {
        const checkout = main.getByRole('link', { name: `Subscribe — ${price}/year`, exact: true });
        await expect(checkout).toHaveAttribute('href', testCheckout);
        await expect(checkout).toHaveAttribute('rel', 'noopener');
        await expect(main.getByRole('link', { name: 'Request an invoice' })).toHaveCount(0);
      } else {
        await expect(main.getByRole('link', { name: 'Request an invoice' })).toHaveAttribute('href', PILOT_REQUEST_HREF);
        await expect(main.getByRole('link', { name: /^Subscribe/ })).toHaveCount(0);
        await page.getByRole('link', { name: 'Request an invoice' }).click();
        await expect(page.locator('#waitlist-heading')).toBeVisible();
        await page.goto(`${base}/pricing`);
      }

      const sitemap = await page.request.get(`${base}/sitemap.xml`);
      expect(sitemap.ok()).toBe(true);
      expect(await sitemap.text()).toContain(`<loc>${SITE_URL}/pricing</loc>`);
      await expectNoSeriousViolations(page, `pricing (${mode})`);
    } finally {
      server.kill();
      await exited;
      await test.info().attach('pricing-server.log', { body: output, contentType: 'text/plain' });
    }
  });
}
