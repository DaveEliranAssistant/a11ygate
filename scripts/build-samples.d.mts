export const DISCLAIMER: string;
export const SAMPLE_CUSTOMER: string;
export const SAMPLE_MARK: string;
export const SAMPLE_ORIGIN_HOST: string;
export const DEFAULT_SOURCE_DATE_EPOCH: number;
export const SAMPLE_FILES: string[];
export const SAMPLE_NOTE: string;

export type ScreenshotCheck = { bannerText: string; bannerInViewport: boolean; watermarkVisible: boolean };

export function watermarkHtml(html: string): string;
export function readZipEntries(zip: Buffer): { path: string; data: Buffer }[];
export function buildSamples(options: { outDir: string; epoch?: number; log?: (line: string) => void }): Promise<{
  outDir: string;
  screenshots: Record<string, ScreenshotCheck>;
  hits: string[];
}>;
