import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { databaseUrl, handleWaitlistPost, type WaitlistRow } from '@/lib/waitlist/handle';
import { WAITLIST_SUCCESS, WAITLIST_UNAVAILABLE } from '@/lib/waitlist/messages';
import { createRateLimiter } from '@/lib/waitlist/rate-limit';
import { normalizeEmail, validateWaitlistInput } from '@/lib/waitlist/validate';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

function request(body: unknown, headers?: Record<string, string>): Request {
  return new Request('https://a11ygate.vercel.app/api/waitlist', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function post(
  body: unknown,
  deps: Partial<Parameters<typeof handleWaitlistPost>[1]> = {},
  headers?: Record<string, string>,
) {
  const inserted: WaitlistRow[] = [];
  const response = await handleWaitlistPost(request(body, headers), {
    databaseConfigured: true,
    insert: async (row) => {
      inserted.push(row);
      return 'created';
    },
    takeToken: () => ({ allowed: true }),
    ...deps,
  });
  return { status: response.status, body: await response.json(), inserted };
}

describe('waitlist validation and dedupe', () => {
  it('normalizes email case and surrounding space', () => {
    expect(normalizeEmail('  Person@Example.COM ')).toBe('person@example.com');
  });

  it('rejects a missing consent checkbox and an invalid email', () => {
    const result = validateWaitlistInput({ email: 'not-an-email', consent: false, role: '', company: '' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fields.email).toBe('Enter a valid email address.');
    expect(result.fields.consent).toBe('Consent is required to join the waitlist.');
  });

  it('stores the same success response for a new signup and a duplicate', async () => {
    const payload = { email: 'Person@Example.com', consent: true, role: ' QA ', company: '' };
    const created = await post(payload, {
      insert: async (row) => {
        expect(row.email).toBe('person@example.com');
        expect(row.role).toBe('QA');
        expect(row.company).toBeNull();
        expect(row.consent).toBe(true);
        expect(row.source).toBe('landing');
        return 'created';
      },
    });
    const duplicate = await post(payload, { insert: async () => 'exists' });
    expect(created.status).toBe(200);
    expect(duplicate.status).toBe(200);
    expect(created.body).toEqual(duplicate.body);
    expect(created.body).toEqual({ ok: true, message: WAITLIST_SUCCESS });
    expect(JSON.stringify(created.body)).not.toContain('exists');
  });

  it('does not insert a honeypot submission and still returns success', async () => {
    let called = false;
    const result = await post(
      { email: 'person@example.com', consent: true, company_website: 'https://spam.example' },
      {
        insert: async () => {
          called = true;
          return 'created';
        },
      },
    );
    expect(called).toBe(false);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, message: WAITLIST_SUCCESS });
  });

  it('returns 503 when the database is not configured or the insert fails', async () => {
    const missing = await post(
      { email: 'person@example.com', consent: true },
      { databaseConfigured: false, insert: async () => 'created' },
    );
    expect(missing.status).toBe(503);
    expect(missing.body).toEqual({ ok: false, message: WAITLIST_UNAVAILABLE });
    expect(missing.inserted).toEqual([]);

    const failed = await post(
      { email: 'person@example.com', consent: true },
      {
        insert: async () => {
          throw new Error('connection refused');
        },
      },
    );
    expect(failed.status).toBe(503);
    expect(failed.body).toEqual(missing.body);
    expect(JSON.stringify(failed.body)).not.toContain('connection refused');
  });

  it('hashes the user agent and does not put the address on the row', async () => {
    const result = await post(
      { email: 'person@example.com', consent: true },
      {},
      { 'user-agent': 'Mozilla/5.0', 'x-forwarded-for': '203.0.113.8, 10.0.0.1' },
    );
    const row = result.inserted[0];
    expect(row?.userAgentHash).toBe(createHash('sha256').update('Mozilla/5.0').digest('hex'));
    expect(JSON.stringify(row)).not.toContain('203.0.113.8');
  });

  it('rate limits by a hash of the address and allows the request if the limiter throws', async () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 1_000 });
    const headers = { 'x-forwarded-for': '203.0.113.9' };
    const payload = { email: 'person@example.com', consent: true };
    const first = await post(payload, { takeToken: limiter, now: () => 1_000 }, headers);
    const second = await post(payload, { takeToken: limiter, now: () => 1_100 }, headers);
    const third = await post(payload, { takeToken: limiter, now: () => 1_200 }, headers);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);

    const degraded = await post(payload, {
      takeToken: () => {
        throw new Error('limiter down');
      },
    });
    expect(degraded.status).toBe(200);
  });

  it('rejects an oversized body and invalid JSON', async () => {
    const oversized = await post(`{"email":"${'a'.repeat(5_000)}@example.com"}`);
    expect(oversized.status).toBe(413);
    const invalid = await post('{');
    expect(invalid.status).toBe(400);
    expect(invalid.body.message).toContain('JSON');
  });

  it('prefers DATABASE_URL_POOLED and treats a blank value as missing', () => {
    const pooled = process.env.DATABASE_URL_POOLED;
    const direct = process.env.DATABASE_URL;
    try {
      process.env.DATABASE_URL_POOLED = ' postgres://pooled ';
      process.env.DATABASE_URL = 'postgres://direct';
      expect(databaseUrl()).toBe('postgres://pooled');
      process.env.DATABASE_URL_POOLED = '   ';
      expect(databaseUrl()).toBe('postgres://direct');
      delete process.env.DATABASE_URL_POOLED;
      delete process.env.DATABASE_URL;
      expect(databaseUrl()).toBeNull();
    } finally {
      if (pooled === undefined) delete process.env.DATABASE_URL_POOLED;
      else process.env.DATABASE_URL_POOLED = pooled;
      if (direct === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = direct;
    }
  });

  it('keeps the migration idempotent and refuses to run without a URL', () => {
    const sql = readFileSync(new URL('../sql/waitlist.sql', import.meta.url), 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS waitlist_signups');
    expect(sql).toContain('email text NOT NULL UNIQUE');
    expect(sql).toContain('user_agent_hash');
    expect(sql.toLowerCase()).not.toContain('drop table');
    expect(sql).not.toMatch(/\b(ip_address|client_ip|remote_addr)\b/i);

    const result = spawnSync(process.execPath, ['scripts/migrate-waitlist.mjs'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: '', DATABASE_URL_POOLED: '' },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('DATABASE_URL_POOLED');
  });
});
