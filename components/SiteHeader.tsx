'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="site-header no-print">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className="bar">
        <Link className="wordmark" href="/">
          A11yGate
        </Link>
        <nav aria-label="Primary">
          <div className="nav">
            <Link href="/" aria-current={pathname === '/' ? 'page' : undefined}>
              Workspace
            </Link>
            <Link href="/report" aria-current={pathname === '/report' ? 'page' : undefined}>
              Report
            </Link>
            <Link href="/privacy" aria-current={pathname === '/privacy' ? 'page' : undefined}>
              Privacy
            </Link>
          </div>
        </nav>
      </div>
    </header>
  );
}
