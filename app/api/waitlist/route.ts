import { connection } from 'next/server';
import { insertWaitlistSignup } from '@/lib/waitlist/db';
import { databaseUrl, handleWaitlistPost } from '@/lib/waitlist/handle';
import { WAITLIST_UNAVAILABLE } from '@/lib/waitlist/messages';
import { waitlistRateLimit } from '@/lib/waitlist/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  await connection();
  if (!databaseUrl()) {
    return Response.json({ available: false, message: WAITLIST_UNAVAILABLE }, { status: 503 });
  }
  return Response.json({ available: true });
}

export async function POST(request: Request) {
  await connection();
  return handleWaitlistPost(request, {
    databaseConfigured: Boolean(databaseUrl()),
    insert: insertWaitlistSignup,
    takeToken: waitlistRateLimit,
  });
}
