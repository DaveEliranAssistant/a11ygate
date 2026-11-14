import { defineConfig } from '@playwright/test';

// CLI-only fixture checks: no production app, external services, or unit-test browser launch.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'auth.spec.ts',
  workers: 1,
  timeout: 60_000,
  forbidOnly: true,
  reporter: 'list',
  use: { trace: 'off' },
});
