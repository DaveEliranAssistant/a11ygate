import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { CLI_NPM_SENTENCE } from '../lib/copy';

// Body text of `/` on main at 7e04729 with the flag off and the waitlist unavailable.
const MAIN_FLAG_OFF = readFileSync('e2e/fixtures/home-flag-off-main.txt', 'utf8');
const OLD_NPM_SENTENCE = 'The CLI is on npm as @qe-atlas/a11ygate@0.2.0.';

export async function expectFlagOffHome(page: Page): Promise<void> {
  expect(MAIN_FLAG_OFF).toContain(OLD_NPM_SENTENCE);
  await expect(page.getByText('The waitlist is temporarily unavailable.')).toBeVisible();
  const text = await page.locator('body').innerText();
  expect(text).not.toContain(OLD_NPM_SENTENCE);
  expect(text).toBe(MAIN_FLAG_OFF.replace(OLD_NPM_SENTENCE, CLI_NPM_SENTENCE));
  await expect(page.locator('#offer-heading')).toHaveCount(0);
}

export async function withOfferServer(
  env: Record<string, string>,
  run: (base: string, log: () => string) => Promise<void>,
): Promise<void> {
  const server = spawn(process.execPath, [
    'node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '0',
  ], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
      A11YGATE_PRICING_ENABLED: '',
      A11YGATE_CHECKOUT_URL: '',
      A11YGATE_PILOT_REQUEST_URL: '',
      ...env,
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
    await expect.poll(() => output.includes('Ready in') ? origin : undefined, { timeout: 10_000, message: 'Next.js loopback server startup' }).toBeDefined();
    await run(origin!, () => output);
  } finally {
    server.kill();
    await exited;
    await test.info().attach('offer-server.log', { body: output, contentType: 'text/plain' });
  }
}

export async function blockOtherOrigins(page: Page, base: string): Promise<void> {
  await page.route('**/*', (route) =>
    new URL(route.request().url()).origin === base ? route.continue() : route.abort(),
  );
}
