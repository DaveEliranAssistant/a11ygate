import { expect, test } from '@playwright/test';
import { CI_AXE_SNIPPET, CI_CLI_COMMANDS } from '../lib/copy';
import { expectNoSeriousViolations } from './support';

test('waitlist form shows default, error, and success states', async ({ page }) => {
  let posts = 0;
  await page.route('**/api/waitlist', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ available: true }),
      });
      return;
    }
    posts += 1;
    const body = route.request().postDataJSON() as { email?: string; consent?: boolean };
    if (body.email === 'bad@example.com') {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          message: 'Check the form and try again.',
          fields: { email: 'Enter a valid email address.' },
        }),
      });
      return;
    }
    expect(body.consent).toBe(true);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, message: 'You are on the waitlist.' }),
    });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Join the waitlist' })).toBeVisible();
  await expect(page.locator('.waitlist').getByRole('link', { name: 'Run it in CI now' })).toHaveAttribute(
    'href',
    '#ci-setup',
  );
  const landing = page.locator('#ci-setup');
  await expect(landing.getByRole('heading', { level: 2, name: 'Run it in CI now' })).toBeVisible();
  await expect(landing).toContainText(CI_AXE_SNIPPET);
  await expect(landing).toContainText(CI_CLI_COMMANDS);
  await expect(landing).toContainText('uses: DaveEliranAssistant/a11ygate/action@<ref>');
  await expect(page.getByRole('button', { name: 'Load demo data' })).toBeEnabled();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Role (optional)')).toBeVisible();
  await expect(page.getByLabel('Company (optional)')).toBeVisible();
  const consent = page.getByLabel('I agree to receive product updates about A11yGate.');
  await expect(consent).not.toBeChecked();
  await expect(page.locator('.honeypot')).toHaveAttribute('inert', '');
  await expectNoSeriousViolations(page, 'waitlist form');

  await page.getByLabel('Email').fill('bad@example.com');
  await consent.check();
  await page.getByRole('button', { name: 'Join the waitlist' }).click();
  const alert = page.locator('#waitlist-error');
  await expect(alert).toBeFocused();
  await expect(alert).toContainText('Check the form and try again.');
  await expect(page.getByText('Enter a valid email address.')).toBeVisible();
  await expectNoSeriousViolations(page, 'waitlist error');

  await page.getByLabel('Email').fill('person@example.com');
  await page.getByLabel('Role (optional)').fill('Engineer');
  await page.getByRole('button', { name: 'Join the waitlist' }).click();
  const success = page.locator('#waitlist-success');
  await expect(success).toContainText('You are on the waitlist.');
  await expect(success).toContainText('You do not need to wait.');
  await expect(success).toBeFocused();
  const thanks = page.locator('.waitlist');
  await expect(thanks).toContainText(CI_AXE_SNIPPET);
  await expect(thanks).toContainText(CI_CLI_COMMANDS);
  await expect(thanks).toContainText('uses: DaveEliranAssistant/a11ygate/action@<ref>');
  expect(posts).toBe(2);
  await expectNoSeriousViolations(page, 'waitlist success');
});
