import {
  WAITLIST_COMPANY_ERROR,
  WAITLIST_CONSENT_ERROR,
  WAITLIST_EMAIL_ERROR,
  WAITLIST_ROLE_ERROR,
} from '@/lib/waitlist/messages';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const MAX_TEXT = 80;

export type WaitlistFields = {
  email?: string;
  role?: string;
  company?: string;
  consent?: string;
};

export type WaitlistSignup = {
  email: string;
  role: string | null;
  company: string | null;
  consent: true;
};

export type WaitlistValidation =
  | { ok: true; honeypot: true }
  | { ok: true; honeypot: false; signup: WaitlistSignup }
  | { ok: false; fields: WaitlistFields };

export function normalizeEmail(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

function optionalText(value: unknown, message: string): { ok: true; value: string | null } | { ok: false; message: string } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, message };
  const trimmed = value.normalize('NFKC').trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (trimmed.length > MAX_TEXT || CONTROL_CHARS.test(trimmed)) return { ok: false, message };
  return { ok: true, value: trimmed };
}

function honeypotFilled(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateWaitlistInput(input: unknown): WaitlistValidation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, fields: { email: WAITLIST_EMAIL_ERROR, consent: WAITLIST_CONSENT_ERROR } };
  }
  const record = input as Record<string, unknown>;
  if (honeypotFilled(record.company_website)) return { ok: true, honeypot: true };

  const fields: WaitlistFields = {};
  const email = typeof record.email === 'string' ? normalizeEmail(record.email) : '';
  if (email.length === 0 || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    fields.email = WAITLIST_EMAIL_ERROR;
  }
  const role = optionalText(record.role, WAITLIST_ROLE_ERROR);
  if (!role.ok) fields.role = role.message;
  const company = optionalText(record.company, WAITLIST_COMPANY_ERROR);
  if (!company.ok) fields.company = company.message;
  if (record.consent !== true) fields.consent = WAITLIST_CONSENT_ERROR;

  if (Object.keys(fields).length > 0) return { ok: false, fields };

  return {
    ok: true,
    honeypot: false,
    signup: {
      email,
      role: role.ok ? role.value : null,
      company: company.ok ? company.value : null,
      consent: true,
    },
  };
}
