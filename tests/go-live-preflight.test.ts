import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { annualPrice } from '@/lib/billing';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { blockNetwork } from './network-guard';

const root = realpathSync('.');
const script = 'scripts/go-live-preflight.mjs';

function run(env: Record<string, string> = {}, args: string[] = []) {
  const result = spawnSync(process.execPath, [...args, script], {
    cwd: root,
    env: { NODE_ENV: 'test', ...env },
    encoding: 'utf8',
    timeout: 5_000,
  });
  if (result.error) throw result.error;
  expect(result.stdout).toContain(AUTOMATED_TESTING_DISCLAIMER);
  return result;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

it.each([
  ['A11YGATE_CHECKOUT_URL', 'http://checkout.example.test/token'],
  ['A11YGATE_CHECKOUT_URL', 'https://user:password@checkout.example.test/buy'],
  ['A11YGATE_CHECKOUT_URL', 'javascript:alert(1)'],
  ['A11YGATE_PILOT_REQUEST_URL', 'http://forms.example.test/pilot'],
  ['A11YGATE_PILOT_REQUEST_URL', 'https://user:password@forms.example.test/pilot'],
  ['A11YGATE_PILOT_REQUEST_URL', 'javascript:alert(1)'],
  ['A11YGATE_PILOT_REQUEST_URL', 'mailto:?subject=pilot'],
  ['A11YGATE_PILOT_REQUEST_URL', '/relative/path'],
  ['A11YGATE_PRICING_ENABLED', 'yes'],
])('returns an error for invalid %s (%s) even when the offer is off', (key, value) => {
  const result = run({ [key]: value });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`Error: ${key}`);
  expect(result.stdout + result.stderr).not.toContain(value);
});

it('describes today’s flag-off state with no shell values', () => {
  const result = run();
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('offer hidden');
  expect(result.stdout).toContain('404 (pricing disabled)');
  expect(result.stdout).toContain('invoice on request');
});

it('describes the enabled offer with the waitlist and invoice fallbacks', () => {
  const result = run({ A11YGATE_PRICING_ENABLED: '1' });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain(`${annualPrice} per year`);
  expect(result.stdout).toContain('Request an invoice → Waitlist form (/#waitlist-heading)');
  expect(result.stdout).toContain('Pilot request form');
  expect(result.stdout).toContain('invoice on request');
});

it('describes the mailto CTA and invoice link without exposing the address or query', () => {
  const result = run({
    A11YGATE_PRICING_ENABLED: 'true',
    A11YGATE_PILOT_REQUEST_URL: 'mailto:private@example.test?subject=private-subject',
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('Request an invoice → mailto: (address redacted)');
  expect(result.stdout + result.stderr).not.toContain('private');
});

it.each(['true', 'false'])('describes HTTPS destinations and keeps the quote independent of the %s flag', (flag) => {
  const result = run({
    A11YGATE_PRICING_ENABLED: flag,
    A11YGATE_PILOT_REQUEST_URL: 'https://forms.example.test/private-path?token=private-token',
    A11YGATE_CHECKOUT_URL: 'https://checkout.example.test/private-path?token=private-token',
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('Checkout link → HTTPS (checkout.example.test)');
  if (flag === 'true') {
    expect(result.stdout).toContain('HTTPS (forms.example.test)');
    expect(result.stdout).toContain(`Subscribe — ${annualPrice}/year → HTTPS (checkout.example.test)`);
  } else {
    expect(result.stdout).toContain('offer hidden');
    expect(result.stdout).toContain('404 (pricing disabled)');
  }
  expect(result.stdout + result.stderr).not.toContain('private');
});

it('runs under Node filesystem permissions with read access limited to the repository', () => {
  const result = run({
    A11YGATE_PRICING_ENABLED: '1',
    A11YGATE_PILOT_REQUEST_URL: 'https://forms.example.test/pilot',
    A11YGATE_CHECKOUT_URL: 'https://checkout.example.test/buy',
  }, ['--experimental-permission', `--allow-fs-read=${root}/*`]);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).not.toContain('ERR_ACCESS_DENIED');
});

it('makes no network calls with both HTTPS destinations configured', async () => {
  vi.stubEnv('A11YGATE_PRICING_ENABLED', '1');
  vi.stubEnv('A11YGATE_PILOT_REQUEST_URL', 'https://forms.example.test/pilot');
  vi.stubEnv('A11YGATE_CHECKOUT_URL', 'https://checkout.example.test/buy');
  const table = vi.spyOn(console, 'table').mockImplementation(() => {});
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const guard = blockNetwork();
  try {
    // Vite loads the actual script in this process so the network spies apply.
    const entry = '../scripts/go-live-preflight.mjs';
    await import(entry);
    expect(guard.attempts).toEqual([]);
    expect(table).toHaveBeenCalledOnce();
  } finally {
    guard.restore();
    table.mockRestore();
    log.mockRestore();
  }
});

it('lists only implemented env names in the order Eliran should flip them', () => {
  const runbook = readFileSync('docs/pilot/owner-runbook.md', 'utf8');
  const checklist = runbook.split('## Flip the switch\n')[1]?.split('\n## ')[0] ?? '';
  const names = [...checklist.matchAll(/`(A11YGATE_[A-Z_]+)`/g)].map((match) => match[1]);
  const billing = readFileSync('lib/billing-env.mjs', 'utf8');
  expect(names).toEqual([
    'A11YGATE_PILOT_REQUEST_URL',
    'A11YGATE_PRICING_ENABLED',
    'A11YGATE_CHECKOUT_URL',
  ]);
  for (const name of names) expect(billing).toContain(`env.${name}`);
  const steps = checklist.match(/^\d\. \[ \].+$/gm) ?? [];
  expect(steps).toHaveLength(names.length);
  for (const step of steps) {
    expect(step).toContain('npm run go-live:preflight');
  }
});
