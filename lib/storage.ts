import { parseAxeJson } from '@/lib/parse';
import { parseManualEvidence } from '@/lib/manual-evidence';
import type { AxeResults, ScanState } from '@/lib/types';
import { isImpact } from '@/lib/types';

export const STORAGE_KEY = 'a11ygate-v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function reviveScan(raw: string): ScanState | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if (typeof value.projectName !== 'string' || value.projectName.trim().length === 0) return null;
  if (typeof value.generatedAt !== 'string' || Number.isNaN(Date.parse(value.generatedAt))) return null;
  if (!isImpact(value.threshold)) return null;
  if (value.groupBy !== 'rule' && value.groupBy !== 'page') return null;
  if (typeof value.currentSynthetic !== 'boolean') return null;
  if (typeof value.baselineSynthetic !== 'boolean') return null;
  if (!Array.isArray(value.currentResults) || value.currentResults.length === 0) return null;

  const current = parseAxeJson(JSON.stringify(value.currentResults));
  if (!current.ok || current.results.length === 0) return null;

  let baselineResults: AxeResults[] | null = null;
  if (value.baselineResults !== null) {
    if (!Array.isArray(value.baselineResults)) return null;
    const baseline = parseAxeJson(JSON.stringify(value.baselineResults));
    if (!baseline.ok) return null;
    baselineResults = baseline.results;
  }

  const manual = parseManualEvidence(JSON.stringify({schemaVersion:1,checks:value.manualChecks ?? []}));
  if (!manual.ok) return null;
  return {
    projectName: value.projectName,
    currentSynthetic: value.currentSynthetic,
    baselineSynthetic: value.baselineSynthetic,
    currentResults: current.results,
    ...(value.manualChecks === undefined ? {} : {manualChecks: manual.checks}),
    baselineResults,
    threshold: value.threshold,
    groupBy: value.groupBy,
    generatedAt: value.generatedAt,
  };
}
