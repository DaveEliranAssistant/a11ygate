import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/next';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { SITE_DESCRIPTION, SITE_URL } from '@/lib/copy';
import { ScanProvider } from '@/lib/store';
import './globals.css';

const title = 'A11yGate — accessibility regression gate';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: title,
    template: '%s — A11yGate',
  },
  description: SITE_DESCRIPTION,
  applicationName: 'A11yGate',
  keywords: ['accessibility', 'axe-core', 'WCAG', 'EU Accessibility Act', 'EN 301 549'],
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: '/',
    siteName: 'A11yGate',
    title,
    description: SITE_DESCRIPTION,
    locale: 'en_GB',
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description: SITE_DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ScanProvider>
          <SiteHeader />
          {children}
          <SiteFooter />
        </ScanProvider>
        <Analytics />
      </body>
    </html>
  );
}
