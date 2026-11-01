import type { Metadata } from 'next';
import Link from 'next/link';
import { DisclaimerNote } from '@/components/DisclaimerNote';
import { PRIVACY_CONTACT } from '@/lib/waitlist/messages';

export const metadata: Metadata = {
  title: 'Privacy',
  description:
    'Scans stay in your browser. The waitlist stores an email only if you join and consent. This launch does not track you.',
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage() {
  return (
    <main id="main" className="shell narrow" tabIndex={-1}>
      <p className="kicker">Privacy</p>
      <h1>Privacy</h1>
      <p className="lede">
        Scan files stay in your browser. The waitlist stores an email only if you join and consent.
      </p>
      <section aria-labelledby="processing-heading">
        <h2 id="processing-heading">What stays on this device</h2>
        <ul>
          <li>JSON files you choose or paste are read locally and parsed in this tab.</li>
          <li>
            The diff, the gate, the evidence report, the exports, and the statement draft are
            computed in the browser.
          </li>
          <li>
            The last scan can be restored from sessionStorage in the same tab. Closing the tab, or
            choosing Clear scan, removes it.
          </li>
          <li>
            Organisation name, contact email, and statement date stay in the form fields. They are
            not written to storage and they are not sent anywhere.
          </li>
        </ul>
      </section>
      <section aria-labelledby="not-collected-heading">
        <h2 id="not-collected-heading">What this launch does not do</h2>
        <ul>
          <li>There is no account and no sign-in.</li>
          <li>Scan files are not uploaded.</li>
          <li>There is no analytics, advertising, or other tracking.</li>
          <li>A11yGate does not set cookies.</li>
          <li>There is no payment.</li>
        </ul>
      </section>
      <section aria-labelledby="waitlist-privacy-heading">
        <h2 id="waitlist-privacy-heading">Waitlist</h2>
        <p>If you join the waitlist and tick the consent box, the server stores:</p>
        <ul>
          <li>Your email address, normalized by trimming it and converting it to lower case.</li>
          <li>Role and company, only when you type them.</li>
          <li>That you consented to product updates.</li>
          <li>The time you joined.</li>
          <li>The source, which is the landing page.</li>
          <li>A SHA-256 hash of the browser user agent. The raw user agent is not stored.</li>
        </ul>
        <p>Your IP address is not stored. The address is used only for a short in-memory rate limit on that server instance.</p>
        <p>
          To ask for deletion, email{' '}
          <a href={`mailto:${PRIVACY_CONTACT}?subject=A11yGate%20waitlist%20deletion`}>{PRIVACY_CONTACT}</a>
          . This address is a placeholder for the owner to replace. Include the email address you
          used on the form.
        </p>
      </section>
      <section aria-labelledby="links-heading">
        <h2 id="links-heading">Links you choose to open</h2>
        <p>
          Help links in a report go to the axe rule documentation. Those sites have their own
          privacy practices. A11yGate does not send your scan with the link. The referrer policy is
          no-referrer.
        </p>
      </section>
      <DisclaimerNote />
      <p>
        <Link href="/">Back to the workspace</Link>
      </p>
    </main>
  );
}
