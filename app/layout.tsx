import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { ScanProvider } from '@/lib/store';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'A11yGate',
    template: '%s — A11yGate',
  },
  description:
    'Turn the axe results you already have into an accessibility regression gate and EAA evidence report.',
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
      </body>
    </html>
  );
}
