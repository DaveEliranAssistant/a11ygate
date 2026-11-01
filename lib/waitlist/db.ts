import { Client } from 'pg';
import { databaseUrl } from '@/lib/waitlist/handle';
import type { WaitlistRow } from '@/lib/waitlist/handle';

export async function insertWaitlistSignup(row: WaitlistRow): Promise<'created' | 'exists'> {
  const url = databaseUrl();
  if (!url) throw new Error('Waitlist database is not configured.');
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    const result = await client.query(
      `INSERT INTO waitlist_signups (email, role, company, consent, source, user_agent_hash)
       VALUES ($1, $2, $3, true, $4, $5)
       ON CONFLICT (email) DO NOTHING
       RETURNING email`,
      [row.email, row.role, row.company, row.source, row.userAgentHash],
    );
    return result.rowCount && result.rowCount > 0 ? 'created' : 'exists';
  } finally {
    await client.end().catch(() => undefined);
  }
}
