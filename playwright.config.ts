import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.A11Y_E2E_PORT || 3000);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid A11Y_E2E_PORT');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command:
      process.env.A11Y_E2E_SKIP_BUILD === '1'
        ? `npm run start -- --hostname 127.0.0.1 --port ${port}`
        : `npm run build && npm run start -- --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
});
