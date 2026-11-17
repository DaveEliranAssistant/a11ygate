import type { MetadataRoute } from 'next';
import { connection } from 'next/server';
import { isPricingEnabled } from '@/lib/billing';
import { SITE_URL } from '@/lib/copy';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();

  const pages: MetadataRoute.Sitemap = [
    { url: SITE_URL, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/privacy`, changeFrequency: 'monthly', priority: 0.4 },
  ];
  if (isPricingEnabled()) {
    pages.push({ url: `${SITE_URL}/pricing`, changeFrequency: 'monthly', priority: 0.4 });
  }
  return pages;
}
