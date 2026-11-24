import { clientAddress, hashUserAgent, sha256 } from '@/lib/waitlist/hash';
import {
  MAX_WAITLIST_BYTES,
  PILOT_REQUEST_SOURCE,
  PILOT_REQUEST_SUCCESS,
  WAITLIST_INVALID,
  WAITLIST_JSON_ERROR,
  WAITLIST_RATE_LIMITED,
  WAITLIST_SOURCE,
  WAITLIST_SUCCESS,
  WAITLIST_TOO_LARGE,
  WAITLIST_UNAVAILABLE,
} from '@/lib/waitlist/messages';
import { validateWaitlistInput, type WaitlistSignup } from '@/lib/waitlist/validate';

export type WaitlistRow = WaitlistSignup & {
  source: string;
  userAgentHash: string | null;
};

export type WaitlistInsert = (row: WaitlistRow) => Promise<'created' | 'exists'>;

export type WaitlistDeps = {
  databaseConfigured: boolean;
  insert: WaitlistInsert;
  takeToken: (key: string, now: number) => { allowed: boolean };
  now?: () => number;
};

function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

export function databaseUrl(): string | null {
  const pooled = process.env.DATABASE_URL_POOLED?.trim();
  if (pooled) return pooled;
  const direct = process.env.DATABASE_URL?.trim();
  return direct || null;
}

export async function handleWaitlistPost(request: Request, deps: WaitlistDeps): Promise<Response> {
  try {
    const declared = request.headers.get('content-length');
    if (declared && Number(declared) > MAX_WAITLIST_BYTES) {
      return json(413, { ok: false, message: WAITLIST_TOO_LARGE });
    }
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_WAITLIST_BYTES) {
      return json(413, { ok: false, message: WAITLIST_TOO_LARGE });
    }

    const now = deps.now ? deps.now() : Date.now();
    const address = clientAddress(request.headers.get('x-forwarded-for'));
    const key = sha256(address || 'unknown');
    let allowed = true;
    try {
      allowed = deps.takeToken(key, now).allowed;
    } catch {
      allowed = true;
    }
    if (!allowed) return json(429, { ok: false, message: WAITLIST_RATE_LIMITED });

    let parsed: unknown;
    try {
      parsed = text.trim().length === 0 ? null : JSON.parse(text);
    } catch {
      return json(400, { ok: false, message: WAITLIST_JSON_ERROR });
    }

    const validated = validateWaitlistInput(parsed);
    if (!validated.ok) {
      return json(400, { ok: false, message: WAITLIST_INVALID, fields: validated.fields });
    }
    const pilot = validated.variant === 'pilot';
    const successBody = { ok: true, message: pilot ? PILOT_REQUEST_SUCCESS : WAITLIST_SUCCESS };
    if (validated.honeypot) return json(200, successBody);
    if (!deps.databaseConfigured) {
      return json(503, { ok: false, message: WAITLIST_UNAVAILABLE });
    }

    try {
      await deps.insert({
        ...validated.signup,
        source: pilot ? PILOT_REQUEST_SOURCE : WAITLIST_SOURCE,
        userAgentHash: hashUserAgent(request.headers.get('user-agent')),
      });
    } catch {
      return json(503, { ok: false, message: WAITLIST_UNAVAILABLE });
    }
    return json(200, successBody);
  } catch {
    return json(503, { ok: false, message: WAITLIST_UNAVAILABLE });
  }
}
