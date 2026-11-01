import type { Metadata } from 'next';
import { ReportView } from '@/components/ReportView';

export const metadata: Metadata = {
  title: 'Evidence report',
  description:
    'EU Accessibility Act evidence report generated in your browser from axe-core results. Informational only, not a certification.',
  robots: { index: false, follow: false },
};

export default function ReportPage() {
  return <ReportView />;
}
