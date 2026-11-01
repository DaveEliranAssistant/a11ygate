import Link from 'next/link';
import { LEGAL_DISCLAIMER } from '@/lib/copy';

export function SiteFooter() {
  return (
    <footer className="site-footer no-print">
      <div className="footer-inner">
        <p>Nothing leaves your browser. Scans, names, and emails stay on this device.</p>
        <p className="footer-disclaimer">{LEGAL_DISCLAIMER}</p>
        <p>
          <Link href="/privacy">Privacy</Link>
        </p>
      </div>
    </footer>
  );
}
