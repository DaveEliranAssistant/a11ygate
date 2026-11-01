import { ogContentType, ogImage, ogSize } from '@/lib/og-image';

export const alt = 'A11yGate turns axe-core results into an accessibility regression gate';
export const size = ogSize;
export const contentType = ogContentType;

export default function Image() {
  return ogImage();
}
