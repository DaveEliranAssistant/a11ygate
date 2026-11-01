'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  WAITLIST_INVALID,
  WAITLIST_SUCCESS,
  WAITLIST_UNAVAILABLE,
} from '@/lib/waitlist/messages';
import { validateWaitlistInput, type WaitlistFields } from '@/lib/waitlist/validate';

type Phase = 'loading' | 'unavailable' | 'ready' | 'done';

type ApiError = {
  message?: string;
  fields?: WaitlistFields;
};

export function WaitlistForm() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('');
  const [company, setCompany] = useState('');
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState('');
  const [pending, setPending] = useState(false);
  const [fields, setFields] = useState<WaitlistFields>({});
  const [message, setMessage] = useState('');
  const errorRef = useRef<HTMLParagraphElement>(null);
  const successRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/waitlist', { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as { available?: boolean };
        setPhase(response.ok && body.available === true ? 'ready' : 'unavailable');
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setPhase('unavailable');
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (fields.email || fields.role || fields.company || fields.consent || (message && phase === 'ready')) {
      errorRef.current?.focus();
    }
  }, [fields, message, phase]);

  useEffect(() => {
    if (phase === 'done') successRef.current?.focus();
  }, [phase]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validated = validateWaitlistInput({
      email,
      role,
      company,
      consent,
      company_website: honeypot,
    });
    if (!validated.ok) {
      setFields(validated.fields);
      setMessage(WAITLIST_INVALID);
      return;
    }
    if (validated.honeypot) {
      setFields({});
      setMessage('');
      setPhase('done');
      return;
    }

    setPending(true);
    setFields({});
    setMessage('');
    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          role,
          company,
          consent,
          company_website: honeypot,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as ApiError;
      if (response.ok) {
        setPhase('done');
        return;
      }
      if (response.status === 503) {
        setPhase('unavailable');
        return;
      }
      setFields(body.fields ?? {});
      setMessage(body.message || WAITLIST_INVALID);
    } catch {
      setPhase('unavailable');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="waitlist" aria-labelledby="waitlist-heading">
      <h2 id="waitlist-heading">Join the waitlist</h2>
      <p>Product updates only. Scan files stay in this browser.</p>
      {phase === 'loading' ? (
        <p role="status">Checking whether the waitlist is open.</p>
      ) : null}
      {phase === 'unavailable' ? (
        <p role="status">{WAITLIST_UNAVAILABLE}</p>
      ) : null}
      {phase === 'done' ? (
        <p ref={successRef} id="waitlist-success" role="status" tabIndex={-1}>
          {WAITLIST_SUCCESS}
        </p>
      ) : null}
      {phase === 'ready' ? (
        <form noValidate onSubmit={onSubmit} aria-busy={pending}>
          {message ? (
            <p ref={errorRef} id="waitlist-error" className="alert" role="alert" tabIndex={-1}>
              {message}
            </p>
          ) : null}
          <label htmlFor="waitlist-email">Email</label>
          <input
            id="waitlist-email"
            name="email"
            type="email"
            autoComplete="email"
            spellCheck={false}
            required
            value={email}
            aria-invalid={Boolean(fields.email)}
            aria-describedby={fields.email ? 'waitlist-email-error' : undefined}
            onChange={(event) => setEmail(event.target.value)}
          />
          {fields.email ? (
            <p id="waitlist-email-error" className="field-error">
              {fields.email}
            </p>
          ) : null}
          <label htmlFor="waitlist-role">Role (optional)</label>
          <input
            id="waitlist-role"
            name="role"
            type="text"
            autoComplete="organization-title"
            value={role}
            aria-invalid={Boolean(fields.role)}
            aria-describedby={fields.role ? 'waitlist-role-error' : undefined}
            onChange={(event) => setRole(event.target.value)}
          />
          {fields.role ? (
            <p id="waitlist-role-error" className="field-error">
              {fields.role}
            </p>
          ) : null}
          <label htmlFor="waitlist-company">Company (optional)</label>
          <input
            id="waitlist-company"
            name="company"
            type="text"
            autoComplete="organization"
            value={company}
            aria-invalid={Boolean(fields.company)}
            aria-describedby={fields.company ? 'waitlist-company-error' : undefined}
            onChange={(event) => setCompany(event.target.value)}
          />
          {fields.company ? (
            <p id="waitlist-company-error" className="field-error">
              {fields.company}
            </p>
          ) : null}
          <div className="honeypot" inert>
            <label htmlFor="waitlist-website">Company website</label>
            <input
              id="waitlist-website"
              name="company_website"
              type="text"
              autoComplete="off"
              value={honeypot}
              onChange={(event) => setHoneypot(event.target.value)}
            />
          </div>
          <label className="choice" htmlFor="waitlist-consent">
            <input
              id="waitlist-consent"
              name="consent"
              type="checkbox"
              required
              checked={consent}
              aria-invalid={Boolean(fields.consent)}
              aria-describedby={fields.consent ? 'waitlist-consent-error' : undefined}
              onChange={(event) => setConsent(event.target.checked)}
            />
            I agree to receive product updates about A11yGate.
          </label>
          {fields.consent ? (
            <p id="waitlist-consent-error" className="field-error">
              {fields.consent}
            </p>
          ) : null}
          <div className="row-actions">
            <button type="submit" className="primary" disabled={pending}>
              {pending ? 'Joining…' : 'Join the waitlist'}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
