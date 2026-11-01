import { expect, test } from '@playwright/test';
import { LEGAL_DISCLAIMER, SITE_DESCRIPTION } from '../lib/copy';

test('security headers, metadata, and the privacy page', async ({ page }) => {
  const response = await page.goto('/');
  expect(response).not.toBeNull();
  const headers = response!.headers();
  const csp = headers['content-security-policy'] ?? '';
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("connect-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toContain('unsafe-eval');
  expect(csp).not.toContain('va.vercel-scripts.com');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['permissions-policy']).toContain('camera=()');
  expect(headers['permissions-policy']).toContain('microphone=()');
  expect(headers['permissions-policy']).toContain('geolocation=()');

  await expect(page).toHaveTitle(/A11yGate/);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', SITE_DESCRIPTION);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /A11yGate/);
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute('content', SITE_DESCRIPTION);
  await expect(page.locator('meta[property="og:image"]').first()).toHaveAttribute('content', /opengraph-image/);
  await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute('href', /.+/);
  await expect(page.getByRole('contentinfo').getByText(LEGAL_DISCLAIMER)).toBeVisible();

  await page.locator('#current-paste').fill('{"hello":true}');
  await page.getByRole('button', { name: 'Parse pasted current JSON' }).click();
  const alert = page.locator('#import-error');
  await expect(alert).toBeFocused();
  await expect(alert).toContainText('url must be a non-empty string');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  await page.goto('/privacy');
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy' })).toBeVisible();
  await expect(page.getByRole('main').getByText('A11yGate does not set cookies.')).toBeVisible();
  await expect(page.getByRole('main').getByText('Vercel Web Analytics')).toBeVisible();
  await expect(page.getByRole('main').getByText('cookieless')).toBeVisible();
  await expect(page.getByRole('main').getByText('dave.eliran.assistant@gmail.com')).toBeVisible();
  await expect(page.getByRole('main').getByText(LEGAL_DISCLAIMER)).toBeVisible();
  await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Privacy' })).toHaveAttribute(
    'href',
    '/privacy',
  );

  const robots = await page.request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  const robotsText = await robots.text();
  expect(robotsText).toContain('Sitemap: https://a11ygate.vercel.app/sitemap.xml');
  expect(robotsText.toLowerCase()).toContain('disallow: /report');

  const sitemap = await page.request.get('/sitemap.xml');
  expect(sitemap.status()).toBe(200);
  const xml = await sitemap.text();
  expect(xml).toContain('https://a11ygate.vercel.app/privacy');
  expect(xml).not.toContain('/report');

  await page.goto('/report');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
});
