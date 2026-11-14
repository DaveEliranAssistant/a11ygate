import { attribution } from '@/lib/scan/engines/dedupe';
import { SITE_URL } from '@/lib/copy';
import { FORMAT_DISCLAIMER, type FormatFinding, type FormatReport, type FormatWcag } from '@/lib/report-formats';
import { impactRank } from '@/lib/gate';
import type { Impact as ImpactName } from '@/lib/types';

export const SARIF_SCHEMA_URL = 'https://json.schemastore.org/sarif-2.1.0.json';
export const SARIF_VERSION = '2.1.0' as const;

type SarifLevel = 'error' | 'warning' | 'note';

export function sarifLevel(impact: ImpactName | null): SarifLevel {
  if (impact === 'critical' || impact === 'serious') return 'error';
  if (impact === 'moderate') return 'warning';
  return 'note';
}

function wcagTags(wcag: readonly FormatWcag[], tags: readonly string[]): string[] {
  const out = new Set<string>(['accessibility']);
  for (const tag of tags) out.add(tag);
  for (const item of wcag) out.add(`WCAG ${item.number}`);
  return [...out];
}

function uniqueRules(findings: readonly FormatFinding[]): FormatFinding[] {
  const byId = new Map<string, FormatFinding>();
  for (const finding of findings) {
    const existing = byId.get(finding.ruleId);
    if (!existing || impactRank(finding.impact) > impactRank(existing.impact)) {
      byId.set(finding.ruleId, finding);
    }
  }
  return [...byId.values()].sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}

function artifactLocation(finding: FormatFinding): { uri: string; uriBaseId?: string } {
  if (finding.source?.file) {
    const uri = finding.source.file.replace(/\\/g, '/');
    return { uri };
  }
  return { uri: finding.pageUrl };
}

function region(finding: FormatFinding) {
  if (finding.source) {
    return {
      startLine: finding.source.startLine,
      ...(finding.source.startColumn !== undefined ? { startColumn: finding.source.startColumn } : {}),
      ...(finding.source.endLine !== undefined ? { endLine: finding.source.endLine } : {}),
      ...(finding.source.endColumn !== undefined ? { endColumn: finding.source.endColumn } : {}),
      snippet: { text: finding.html },
      message: { text: `selector: ${finding.selector}` },
    };
  }
  return {
    snippet: { text: finding.html },
    message: { text: `selector: ${finding.selector}` },
  };
}

function taxaFor(findings: readonly FormatFinding[]) {
  const byId = new Map<string, FormatWcag>();
  for (const finding of findings) {
    for (const item of finding.wcag) {
      if (!byId.has(item.number)) byId.set(item.number, item);
    }
  }
  return [...byId.values()]
    .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }))
    .map((item) => ({
      id: item.number,
      name: item.name,
      shortDescription: { text: `WCAG ${item.wcag} ${item.number} ${item.name} (${item.level})` },
    }));
}

/**
 * SARIF 2.1.0 log. When a finding is mapped to a source file and line, that
 * path is used as the artifact URI; otherwise the page URL and selector are recorded.
 */
export function toSarif(report: FormatReport): string {
  const rules = uniqueRules(report.findings);
  const ruleIndex = new Map(rules.map((rule, index) => [rule.ruleId, index]));
  const taxa = taxaFor(report.findings);
  const taxonIndex = new Map(taxa.map((taxon, index) => [taxon.id, index]));

  const driverRules = rules.map((rule) => {
    const relationships = rule.wcag
      .map((item) => taxonIndex.get(item.number))
      .filter((index): index is number => index !== undefined)
      .map((index) => ({
        target: { id: taxa[index]!.id, index, toolComponent: { name: 'WCAG', index: 0 } },
        kinds: ['relevant'],
      }));
    return {
      id: rule.ruleId,
      name: rule.ruleId,
      shortDescription: { text: rule.help },
      fullDescription: { text: rule.help },
      helpUri: rule.helpUrl,
      help: { text: rule.help },
      defaultConfiguration: { level: sarifLevel(rule.impact) },
      properties: { tags: wcagTags(rule.wcag, rule.tags), impact: rule.impact ?? 'unspecified' },
      ...(relationships.length > 0 ? { relationships } : {}),
    };
  });

  const results = [...report.findings]
    .sort(
      (a, b) =>
        a.pageUrl.localeCompare(b.pageUrl) || a.ruleId.localeCompare(b.ruleId) || a.selector.localeCompare(b.selector),
    )
    .map((finding) => {
      const index = ruleIndex.get(finding.ruleId);
      return {
        ruleId: finding.ruleId,
        ...(index !== undefined ? { ruleIndex: index } : {}),
        level: sarifLevel(finding.impact),
        message: {
          text: `${finding.help} (${finding.impact ?? 'unspecified'}) at ${finding.selector} on ${finding.pageUrl}${finding.engines ? "; " + attribution(finding) : ""}`,
        },
        locations: [
          {
            physicalLocation: {
              artifactLocation: artifactLocation(finding),
              region: region(finding),
            },
            logicalLocations: [
              {
                fullyQualifiedName: finding.selector,
                kind: 'element',
                name: finding.selector,
              },
            ],
          },
        ],
        ...(finding.fingerprint ? { fingerprints: { a11ygate: finding.fingerprint }, partialFingerprints: { a11ygate: finding.fingerprint } } : {}),
        properties: {
          ...(finding.engines ? { engines: finding.engines, confidence: finding.confidence } : {}),
          selector: finding.selector,
          impact: finding.impact ?? 'unspecified',
          tags: finding.tags,
          wcag: finding.wcag.map((item) => item.number),
          pageUrl: finding.pageUrl,
          ...(finding.status ? { status: finding.status } : {}),
        },
      };
    });

  const log = {
    $schema: SARIF_SCHEMA_URL,
    version: SARIF_VERSION,
    runs: [
      {
        tool: {
          driver: {
            name: 'A11yGate',
            version: report.version,
            informationUri: SITE_URL,
            rules: driverRules,
          },
        },
        ...(taxa.length > 0
          ? {
              taxonomies: [
                {
                  name: 'WCAG',
                  informationUri: 'https://www.w3.org/WAI/standards-guidelines/wcag/',
                  taxa,
                },
              ],
            }
          : {}),
        results,
        properties: {
          disclaimer: FORMAT_DISCLAIMER,
          ...(report.engines ? { enginesUsed: report.engines.used, enginesErrored: report.engines.errored } : {}),
          verdict: report.verdict,
          reason: report.reason,
          command: report.command,
          ...(report.startUrl ? { startUrl: report.startUrl } : {}),
          ...(report.projectName ? { projectName: report.projectName } : {}),
        },
      },
    ],
  };

  return `${JSON.stringify(log, null, 2)}\n`;
}
