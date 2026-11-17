import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import pricing from '../config/pricing.json';
import { PILOT_REQUEST_HREF } from '../lib/billing';
import { AUTOMATED_TESTING_DISCLAIMER, CLI_NPM_SENTENCE } from '../lib/copy';
import { PILOT_REQUEST_INTRO } from '../lib/waitlist/messages';
import { expectNoSeriousViolations } from './support';

const price = `${new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: pricing.currency,
  maximumFractionDigits: 0,
}).format(pricing.priceUsdPerYear)} per year`;

// Body text of `/` on main at 7e04729 with the flag off and the waitlist unavailable.
const MAIN_FLAG_OFF = readFileSync('e2e/fixtures/home-flag-off-main.txt', 'utf8');
const OLD_NPM_SENTENCE = 'The CLI is on npm as @qe-atlas/a11ygate@0.2.0.';

async function stubWaitlist(page: Page, available: boolean): Promise<{ posts: number }> {
  const state = { posts: 0 };
  await page.route('**/api/waitlist', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ available }) });
      return;
    }
    state.posts += 1;
    const body = route.request().postDataJSON() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['company', 'company_website', 'consent', 'email', 'role']);
    expect(body.consent).toBe(true);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, message: 'You are on the waitlist.' }),
    });
  });
  return state;
}

test('flag off: home differs from main only in the npm sentence', async ({ page }) => {
  expect(MAIN_FLAG_OFF).toContain(OLD_NPM_SENTENCE);
  await stubWaitlist(page, false);
  await page.goto('/');
  await expect(page.getByText('The waitlist is temporarily unavailable.')).toBeVisible();
  const text = await page.locator('body').innerText();
  expect(text).not.toContain(OLD_NPM_SENTENCE);
  expect(text).toBe(MAIN_FLAG_OFF.replace(OLD_NPM_SENTENCE, CLI_NPM_SENTENCE));
  await expect(page.locator('#offer-heading')).toHaveCount(0);
});

async function withFlagOnServer(
  pilotUrl: string,
  run: (base: string, log: () => string) => Promise<void>,
): Promise<void> {
  const server = spawn(process.execPath, [
    'node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '0',
  ], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
      A11YGATE_PRICING_ENABLED: '1',
      A11YGATE_CHECKOUT_URL: '',
      A11YGATE_PILOT_REQUEST_URL: pilotUrl,
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
    await run(origin!, () => output);
  } finally {
    server.kill();
    await exited;
    await test.info().attach('landing-offer-server.log', { body: output, contentType: 'text/plain' });
  }
}

async function blockOtherOrigins(page: Page, base: string): Promise<void> {
  await page.route('**/*', (route) =>
    new URL(route.request().url()).origin === base ? route.continue() : route.abort(),
  );
}

test('flag on, no pilot URL: CTA reaches the reused waitlist form by keyboard and submits', async ({ page }) => {
  await withFlagOnServer('', async (base) => {
    await blockOtherOrigins(page, base);
    const waitlist = await stubWaitlist(page, true);
    await page.goto(`${base}/`);

    const offer = page.locator('section.offer');
    await expect(offer.getByRole('heading', { level: 2, name: 'Accessibility gate in your CI, with evidence for every release' })).toBeVisible();
    await expect(offer).toContainText("It is not an overlay widget; it doesn't change your site at runtime.");
    await expect(offer).toContainText(price);
    await expect(offer).toContainText('Start with a free 3-week pilot');
    await expect(offer).toContainText('Nothing is billed automatically.');
    await expect(offer).toContainText(AUTOMATED_TESTING_DISCLAIMER);
    await expect(page.locator('footer')).toContainText(AUTOMATED_TESTING_DISCLAIMER);
    await expect(offer.getByRole('link', { name: 'See pricing' })).toHaveAttribute('href', '/pricing');
    const cta = offer.getByRole('link', { name: 'Request a free pilot' });
    await expect(cta).toHaveAttribute('href', PILOT_REQUEST_HREF);
    await expect(page.locator('#ci-setup')).toContainText(CLI_NPM_SENTENCE);

    const form = page.locator('.waitlist');
    await expect(form.getByRole('heading', { level: 2, name: 'Request a free pilot' })).toBeVisible();
    await expect(form).toContainText(PILOT_REQUEST_INTRO);
    await expect(form.getByLabel('Email')).toBeVisible();
    await expectNoSeriousViolations(page, 'home (flag on, waitlist pilot form)');

    // Keyboard only: Tab from the top of the page to the CTA, then activate it.
    await page.locator('body').focus();
    let reached = false;
    for (let i = 0; i < 40 && !reached; i += 1) {
      await page.keyboard.press('Tab');
      reached = await cta.evaluate((el) => el === document.activeElement);
    }
    expect(reached, 'CTA reachable with Tab').toBe(true);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#waitlist-heading$/);

    await form.getByLabel('Email').fill('person@example.com');
    await form.getByLabel('I agree to receive product updates about A11yGate.').check();
    await form.getByRole('button', { name: 'Join the waitlist' }).click();
    await expect(page.locator('#waitlist-success')).toBeFocused();
    expect(waitlist.posts).toBe(1);
    await expectNoSeriousViolations(page, 'home (flag on, pilot request sent)');
  });
});

for (const pilotUrl of ['https://forms.example.test/a11ygate-pilot', 'mailto:pilot@example.test?subject=A11yGate%20pilot']) {
  test(`flag on, pilot URL set: CTA links to ${pilotUrl.split(':')[0]}`, async ({ page }) => {
    await withFlagOnServer(pilotUrl, async (base) => {
      await blockOtherOrigins(page, base);
      await stubWaitlist(page, true);
      await page.goto(`${base}/`);
      const cta = page.locator('section.offer').getByRole('link', { name: 'Request a free pilot' });
      await expect(cta).toHaveAttribute('href', pilotUrl);
      // The waitlist keeps its own title when pilot requests go elsewhere.
      await expect(page.locator('.waitlist').getByRole('heading', { name: 'Join the waitlist' })).toBeVisible();
      await expectNoSeriousViolations(page, `home (flag on, ${pilotUrl.split(':')[0]} pilot URL)`);
    });
  });
}

test('flag on, invalid pilot URL: falls back to the waitlist form and logs a warning', async ({ page }) => {
  await withFlagOnServer('javascript:alert(1)', async (base, log) => {
    await blockOtherOrigins(page, base);
    await stubWaitlist(page, true);
    await page.goto(`${base}/`);
    await expect(page.locator('section.offer').getByRole('link', { name: 'Request a free pilot' })).toHaveAttribute('href', PILOT_REQUEST_HREF);
    await expect(page.locator('.waitlist').getByRole('heading', { name: 'Request a free pilot' })).toBeVisible();
    expect(log()).toContain('Ignoring A11YGATE_PILOT_REQUEST_URL');
    expect(log()).not.toContain('javascript:alert');
  });
});
