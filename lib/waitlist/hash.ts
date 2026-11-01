import { createHash } from 'node:crypto';

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hashUserAgent(value: string | null): string | null {
  if (!value || value.trim().length === 0) return null;
  return sha256(value);
}

export function clientAddress(forwardedFor: string | null): string {
  const first = forwardedFor?.split(',')[0]?.trim() ?? '';
  return first;
}
