import type { AxeResults } from '@/lib/types';

export function inferProjectName(results: readonly AxeResults[]): string {
  const hosts = new Set<string>();
  for (const result of results) {
    try {
      hosts.add(new URL(result.url).host);
    } catch {
      hosts.add(result.url);
    }
  }
  if (hosts.size === 1) {
    const host = [...hosts][0];
    if (host) return host;
  }
  return 'Imported scan';
}
