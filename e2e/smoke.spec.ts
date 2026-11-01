import { expect, test } from '@playwright/test';

test('demo data gates the run and the report renders', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Turn the axe results you already have into an accessibility regression gate and EAA evidence report',
    }),
  ).toBeVisible();
  await expect(page.getByText('Privacy: scans stay in your browser.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Join the waitlist' })).toBeVisible();
  await expect(page.getByText('The waitlist is temporarily unavailable.')).toBeVisible();

  await page.getByRole('button', { name: 'Load demo data' }).click();
  await expect(page.getByTestId('count-new')).toHaveText('2');
  await expect(page.getByTestId('count-fixed')).toHaveText('3');
  await expect(page.getByTestId('count-still-open')).toHaveText('5');
  await expect(page.getByTestId('verdict')).toHaveText('FAIL');
  await expect(page.getByText('1 new finding at or above serious: color-contrast.')).toBeVisible();

  await page.getByRole('link', { name: 'Report', exact: true }).click();
  await expect(page).toHaveURL(/\/report$/);
  await expect(page.getByRole('heading', { level: 1, name: 'EAA evidence report' })).toBeVisible();
  await expect(page.getByTestId('count-new')).toHaveText('2');
  await expect(page.getByTestId('count-fixed')).toHaveText('3');
  await expect(page.getByTestId('count-still-open')).toHaveText('5');
  await expect(page.getByTestId('verdict')).toHaveText('FAIL');
  await expect(
    page.getByText(
      'Automated checks cover only part of WCAG; this is evidence, not certification.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Manual checks' })).toBeVisible();
  await expect(page.getByText('Keyboard.')).toBeVisible();
  await expect(page.getByText('Screen reader.')).toBeVisible();
  await expect(page.getByText('Focus order.')).toBeVisible();
});
