import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { listPilotRequests } from '../scripts/list-pilot-requests.mjs';
import { blockNetwork } from './network-guard';

const script = fileURLToPath(new URL('../scripts/list-pilot-requests.mjs', import.meta.url));
const ownerFlag = '--i-am-the-owner';
const databaseUrl = 'postgres://fixture@localhost/pilot';
let network: ReturnType<typeof blockNetwork>;

beforeEach(() => {
  network = blockNetwork();
});

afterEach(() => {
  network.restore();
  expect(network.attempts).toEqual([]);
});

it('connects once, issues only the pilot request SELECT and writes escaped CSV', async () => {
  const query = vi.fn(async () => ({
    rows: [
      {
        created_at: new Date('2026-11-25T01:30:00Z'),
        email: 'pilot@example.com',
        role: 'Lead, "Engineering"',
        company: 'Example\nCompany',
        source: 'pilot-request',
      },
      {
        created_at: new Date('2026-11-24T01:00:00Z'),
        email: 'previous@example.com',
        role: null,
        company: '=1+1',
        source: 'pilot-request',
      },
    ],
  }));
  const connect = vi.fn();
  const end = vi.fn();
  const Client = vi.fn(function () { return { connect, query, end }; });
  const stdout = { write: vi.fn() };
  const stderr = { write: vi.fn() };

  const result = await listPilotRequests({
    args: [ownerFlag],
    env: { DATABASE_URL: databaseUrl },
    Client,
    stdout,
    stderr,
  });
  expect(result).toBe(0);
  expect(Client).toHaveBeenCalledExactlyOnceWith({ connectionString: databaseUrl });
  expect(connect).toHaveBeenCalledTimes(1);
  expect(query).toHaveBeenCalledExactlyOnceWith(
    "SELECT created_at, email, role, company, source\nFROM waitlist_signups WHERE source = 'pilot-request' ORDER BY created_at DESC",
  );
  expect(end).toHaveBeenCalledTimes(1);
  expect(stdout.write).toHaveBeenCalledExactlyOnceWith(
    'created_at,email,role,company,source\r\n' +
    '2026-11-25T01:30:00.000Z,pilot@example.com,"Lead, ""Engineering""","Example\nCompany",pilot-request\r\n' +
    "2026-11-24T01:00:00.000Z,previous@example.com,,'=1+1,pilot-request\r\n",
  );
  expect(stderr.write).not.toHaveBeenCalled();
});

it.each([
  { args: [], env: { DATABASE_URL: databaseUrl }, error: ownerFlag },
  { args: [ownerFlag], env: { DATABASE_URL_POOLED: databaseUrl }, error: 'DATABASE_URL' },
])('refuses before constructing a pg client when $error is missing', async ({ args, env, error }) => {
  const Client = vi.fn();
  const stdout = { write: vi.fn() };
  const stderr = { write: vi.fn() };

  expect(await listPilotRequests({ args, env, Client, stdout, stderr })).toBe(1);
  expect(Client).not.toHaveBeenCalled();
  expect(stdout.write).not.toHaveBeenCalled();
  expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining(error));

  // Exercise the CLI entry point without any database URL for the subprocess.
  const cli = spawnSync(process.execPath, [script, ...args], {
    env: { ...process.env, DATABASE_URL: '', DATABASE_URL_POOLED: '' },
    encoding: 'utf8',
  });
  expect(cli.status).toBe(1);
  expect(cli.stdout).toBe('');
  expect(cli.stderr).toContain(error);
});

it('keeps SQL mutation and DDL out of the export script', () => {
  expect(readFileSync(script, 'utf8')).not.toMatch(
    /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|MERGE)\b/i,
  );
});
