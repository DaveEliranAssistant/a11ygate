import Link from 'next/link';
import { AUTOMATED_TESTING_DISCLAIMER, LEGAL_DISCLAIMER } from '@/lib/copy';

export function SiteFooter({ automatedTestingDisclaimer = false }: { automatedTestingDisclaimer?: boolean } = {}) {
  return (
    <footer className="site-footer no-print">
      <div className="footer-inner">
        <p>Scans stay in this browser. A waitlist email is stored only after you consent.</p>
        <p className="footer-disclaimer">{LEGAL_DISCLAIMER}</p>
        {automatedTestingDisclaimer ? <p className="footer-disclaimer">{AUTOMATED_TESTING_DISCLAIMER}</p> : null}
        <p>
          <Link href="/privacy">Privacy</Link>
          {' · '}
          <a href="https://github.com/DaveEliranAssistant/a11ygate/discussions/categories/ideas">Give feedback</a>
        </p>
      </div>
    </footer>
  );
}
