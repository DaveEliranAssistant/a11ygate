export type RateLimitOptions = {
  limit: number;
  windowMs: number;
};

/**
 * Best-effort limiter for one server instance. A fresh instance starts empty,
 * which is the safe degradation for serverless: it does not share state and it
 * does not store the raw IP.
 */
export function createRateLimiter(options: RateLimitOptions) {
  const hits = new Map<string, number[]>();

  return function takeToken(key: string, now: number): { allowed: boolean } {
    const recent = (hits.get(key) ?? []).filter((stamp) => now - stamp < options.windowMs);
    if (recent.length >= options.limit) {
      hits.set(key, recent);
      return { allowed: false };
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5_000) {
      for (const [stored, stamps] of hits) {
        if (stamps.every((stamp) => now - stamp >= options.windowMs)) hits.delete(stored);
      }
    }
    return { allowed: true };
  };
}

export const waitlistRateLimit = createRateLimiter({ limit: 5, windowMs: 10 * 60 * 1000 });
