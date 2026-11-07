import Link from 'next/link';
import { LEGAL_DISCLAIMER } from '@/lib/copy';

export function SiteFooter() {
  return (
    <footer className="site-footer no-print">
      <div className="footer-inner">
        <p>Scans stay in this browser. A waitlist email is stored only after you consent.</p>
        <p className="footer-disclaimer">{LEGAL_DISCLAIMER}</p>
        <p>
          <Link href="/privacy">Privacy</Link>
          {' · '}
          <a href="https://github.com/DaveEliranAssistant/a11ygate/discussions/categories/ideas">Give feedback</a>
        </p>
      </div>
    </footer>
  );
}
