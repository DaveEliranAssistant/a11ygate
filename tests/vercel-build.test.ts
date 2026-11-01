import { describe, expect, it } from 'vitest';
import { redactConnectionStrings, runVercelBuild } from '../scripts/vercel-build-lib.mjs';

const secret = 'postgres://user:super-secret-password@db.example.com:5432/a11ygate';

describe('Vercel build migration', () => {
  it('skips the migration when no database URL is set and still builds', async () => {
    let migrated = false;
    let built = false;
    const logs: string[] = [];
    const code = await runVercelBuild({
      env: { DATABASE_URL_POOLED: '   ', DATABASE_URL: '' },
      migrate: async () => {
        migrated = true;
        return { ok: true };
      },
      build: async () => {
        built = true;
        return 0;
      },
      log: (line) => logs.push(line),
    });
    expect(code).toBe(0);
    expect(migrated).toBe(false);
    expect(built).toBe(true);
    expect(logs.join('\n')).toContain('Skipping waitlist migration');
  });

  it('stops the build when migration fails and does not print the connection string', async () => {
    let built = false;
    const errors: string[] = [];
    const code = await runVercelBuild({
      env: { DATABASE_URL_POOLED: secret },
      migrate: async () => ({ ok: false, message: `connect ECONNREFUSED ${secret}` }),
      build: async () => {
        built = true;
        return 0;
      },
      error: (line) => errors.push(line),
    });
    const text = errors.join('\n');
    expect(code).toBe(1);
    expect(built).toBe(false);
    expect(text).toContain('Waitlist migration failed');
    expect(text).toContain('The build was stopped');
    expect(text).not.toContain(secret);
    expect(text).not.toContain('super-secret-password');
    expect(text).not.toContain('postgres://');
    expect(text).not.toContain('db.example.com');
  });

  it('redacts a connection string that is not a full URL token', () => {
    const redacted = redactConnectionStrings(`password=${secret}`, [secret]);
    expect(redacted).not.toContain('super-secret-password');
    expect(redacted).not.toContain('postgres://');
  });
});
