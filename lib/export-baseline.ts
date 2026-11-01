import type { AxeResults } from '@/lib/types';

export function baselineDocument(results: readonly AxeResults[]): string {
  return `${JSON.stringify(results, null, 2)}\n`;
}
