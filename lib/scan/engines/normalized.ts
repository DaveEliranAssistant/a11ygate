import { lookupStandards } from '@/lib/mapping';
import { findingsFromResults } from '@/lib/parse';
import type { AxeResults, Finding, Impact } from '@/lib/types';
import { WCAG_RULE_MAP } from './wcag-map';

/** Internal model: one engine rule/node occurrence; no cross-engine deduplication. */
export type NormalizedFinding = {
  engine: string;
  ruleId: string;
  wcagSc: string[];
  impact: Impact | null;
  url: string;
  selector: string;
  /** Canonical DOM path resolved during scanning; raw selector is preserved. */
  elementKey?: string;
  snippet: string;
  helpUrl: string;
  /** Original public axe finding retained for lossless compatibility. */
  compatibility?: Finding;
};

export function normalizeAxeFinding(finding: Finding): NormalizedFinding {
  const mapped = lookupStandards(finding.tags).flatMap((hit) => hit.kind === 'criterion' ? [hit.number] : []);
  return {
    engine: 'axe', ruleId: finding.ruleId,
    wcagSc: mapped.length ? mapped : [...(WCAG_RULE_MAP.axe?.[finding.ruleId] ?? [])],
    impact: finding.impact, url: finding.url, selector: finding.selector,
    snippet: finding.html, helpUrl: finding.helpUrl, compatibility: finding,
  };
}

export function normalizeAxeResults(results: AxeResults): NormalizedFinding[] {
  return findingsFromResults([results]).map(normalizeAxeFinding);
}

/** Deliberately emits only the historical public Finding fields, in historical order. */
export function toLegacyFinding(normalized: NormalizedFinding): Finding {
  const f = normalized.compatibility;
  if (!f) throw new Error('Only axe findings have a legacy representation.');
  return {
    fingerprint: f.fingerprint, ruleId: f.ruleId, impact: f.impact, tags: f.tags,
    help: f.help, helpUrl: f.helpUrl, selector: f.selector, html: f.html,
    url: f.url, path: f.path, engineVersion: f.engineVersion, timestamp: f.timestamp,
  };
}
