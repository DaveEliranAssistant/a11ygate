import type { Metadata } from 'next';
import Link from 'next/link';
import { DisclaimerNote } from '@/components/DisclaimerNote';

export const metadata: Metadata = {
  title: 'Privacy',
  description:
    'A11yGate processes accessibility scans in your browser. Nothing is uploaded, and this launch does not track you.',
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage() {
  return (
    <main id="main" className="shell narrow" tabIndex={-1}>
      <p className="kicker">Privacy</p>
      <h1>Privacy</h1>
      <p className="lede">
        A11yGate runs entirely in your browser. The scans you import are not uploaded.
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
          <li>Scan data, names, and emails are not uploaded.</li>
          <li>There is no analytics, advertising, or other tracking.</li>
          <li>A11yGate does not set cookies.</li>
          <li>There is no payment.</li>
        </ul>
        <p>
          The waitlist control is a mailto link. It opens your email app. A11yGate does not receive
          or store that address.
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
