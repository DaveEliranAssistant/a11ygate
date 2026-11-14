import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { attribution } from '@/lib/scan/engines/dedupe';
import { SITE_URL } from '@/lib/copy';
import { FORMAT_DISCLAIMER, type FormatFinding, type FormatReport, type FormatWcag } from '@/lib/report-formats';
import { impactRank } from '@/lib/gate';
import type { Impact as ImpactName } from '@/lib/types';

export const SARIF_SCHEMA_URL = 'https://json.schemastore.org/sarif-2.1.0.json';
export const SARIF_VERSION = '2.1.0' as const;

/**
 * GitHub code scanning SARIF upload limits, cited from docs.github.com.
 * Public repositories can receive third-party SARIF without enabling CodeQL
 * default setup. Private repositories need GitHub Code Security (paid).
 */
export const GITHUB_SARIF_LIMITS = {
  /** Gzip-compressed upload cap. Uploads over this are rejected. */
  maxGzipBytes: 10 * 1024 * 1024,
  maxRunsPerFile: 20,
  maxResultsPerRun: 25_000,
  /** GitHub keeps only the top N results per run, prioritized by severity. */
  retainedResultsPerRun: 5_000,
  maxRulesPerRun: 25_000,
  maxTagsPerRule: 20,
  displayedTagsPerRule: 10,
  maxLocationsPerResult: 1_000,
  displayedLocationsPerResult: 100,
  docs: {
    sarifSupport: 'https://docs.github.com/en/code-security/reference/code-scanning/sarif-files/sarif-support',
    fileTooLarge:
      'https://docs.github.com/en/code-security/reference/code-scanning/sarif-files/troubleshoot-sarif-uploads/file-too-large',
    resultsExceedLimit:
      'https://docs.github.com/en/code-security/reference/code-scanning/sarif-files/troubleshoot-sarif-uploads/results-exceed-limit',
    uploadSarif:
      'https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/integrate-with-existing-tools/upload-sarif-file',
  },
} as const;

export type GitHubSarifLimits = {
  maxGzipBytes: number;
  maxRunsPerFile: number;
  maxResultsPerRun: number;
  retainedResultsPerRun: number;
  maxRulesPerRun: number;
  maxTagsPerRule: number;
  maxLocationsPerResult: number;
};

const DEFAULT_ENGINE = 'axe';

type SarifLevel = 'error' | 'warning' | 'note';

type SarifRegion = {
  startLine?: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
  snippet?: { text: string };
  message?: { text: string };
};

type SarifResult = {
  ruleId: string;
  ruleIndex?: number;
  level: SarifLevel;
  message: { text: string };
  locations: Array<{
    physicalLocation: {
      artifactLocation: { uri: string; uriBaseId?: string };
      region: SarifRegion;
    };
    logicalLocations: Array<{ fullyQualifiedName: string; kind: string; name: string }>;
  }>;
  fingerprints?: Record<string, string>;
  partialFingerprints: { primaryLocationLineHash: string; a11ygate?: string };
  properties: Record<string, unknown>;
};

type SarifRun = {
  tool: {
    driver: {
      name: string;
      version: string;
      informationUri: string;
      rules: Array<Record<string, unknown>>;
    };
  };
  automationDetails: { id: string };
  taxonomies?: Array<{ name: string; informationUri: string; taxa: Array<Record<string, unknown>> }>;
  results: SarifResult[];
  properties: Record<string, unknown>;
};

export type SarifLog = {
  $schema: string;
  version: typeof SARIF_VERSION;
  runs: SarifRun[];
};

export type ToSarifOptions = {
  limits?: Partial<GitHubSarifLimits>;
};

export function sarifLevel(impact: ImpactName | null): SarifLevel {
  if (impact === 'critical' || impact === 'serious') return 'error';
  if (impact === 'moderate') return 'warning';
  return 'note';
}

export function gzipByteLength(text: string): number {
  return gzipSync(Buffer.from(text, 'utf8')).length;
}

/**
 * GitHub parses `automationDetails.id` as `category/run-id`, using the text
 * before the last slash as the category. A trailing slash sets the category
 * without a distinct run id, so two CI runs of the same engine stay in one
 * analysis category. See GITHUB_SARIF_LIMITS.docs.sarifSupport
 * (`runAutomationDetails` object).
 */
export function automationDetailsId(engine: string): string {
  const slug = engine.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || DEFAULT_ENGINE;
  return `a11ygate/${slug}/`;
}

/**
 * Stable GitHub fingerprint. Code scanning only uses
 * `partialFingerprints.primaryLocationLineHash` to match alerts across runs
 * (GITHUB_SARIF_LIMITS.docs.sarifSupport, "Fingerprint generation"). The
 * `hash:line` shape follows the documented example. The same finding on two
 * exports produces the same value; generatedAt and help text are excluded.
 */
export function primaryLocationLineHash(finding: FormatFinding): string {
  const uri = artifactUri(finding);
  const line = finding.source?.startLine ?? 1;
  const basis = finding.fingerprint ?? [finding.ruleId, uri, finding.selector, String(line)].join('\0');
  const hash = createHash('sha256').update(basis).digest('hex').slice(0, 16);
  return `${hash}:${line}`;
}

function artifactUri(finding: FormatFinding): string {
  if (finding.source?.file) return finding.source.file.replace(/\\/g, '/');
  return finding.pageUrl;
}

function defaultEngine(report: FormatReport): string {
  const used = report.engines?.used ?? [];
  if (used.length === 1 && used[0]) return used[0];
  if (used.includes(DEFAULT_ENGINE)) return DEFAULT_ENGINE;
  return used[0] ?? DEFAULT_ENGINE;
}

function enginesFor(finding: FormatFinding, fallback: string): string[] {
  if (finding.engines && finding.engines.length > 0) return [...new Set(finding.engines)];
  return [fallback];
}

function wcagTags(wcag: readonly FormatWcag[], tags: readonly string[], maxTags: number): string[] {
  const preferred: string[] = ['accessibility'];
  for (const item of wcag) preferred.push(`WCAG ${item.number}`);
  const rest: string[] = [];
  for (const tag of tags) {
    if (tag !== 'accessibility' && !preferred.includes(tag)) rest.push(tag);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of [...preferred, ...rest]) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= maxTags) break;
  }
  return out;
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
  return { uri: artifactUri(finding) };
}

function region(finding: FormatFinding): SarifRegion {
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

function compareFindings(a: FormatFinding, b: FormatFinding): number {
  return (
    a.pageUrl.localeCompare(b.pageUrl) ||
    a.ruleId.localeCompare(b.ruleId) ||
    a.selector.localeCompare(b.selector)
  );
}

function compareBySeverityThenStable(a: FormatFinding, b: FormatFinding): number {
  const rank = impactRank(b.impact) - impactRank(a.impact);
  if (rank !== 0) return rank;
  return compareFindings(a, b);
}

function toSarifResult(finding: FormatFinding, ruleIndex: Map<string, number>): SarifResult {
  const index = ruleIndex.get(finding.ruleId);
  const hash = primaryLocationLineHash(finding);
  return {
    ruleId: finding.ruleId,
    ...(index !== undefined ? { ruleIndex: index } : {}),
    level: sarifLevel(finding.impact),
    message: {
      text: `${finding.help} (${finding.impact ?? 'unspecified'}) at ${finding.selector} on ${finding.pageUrl}${finding.engines ? '; ' + attribution(finding) : ''}`,
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
    fingerprints: finding.fingerprint ? { a11ygate: finding.fingerprint } : { a11ygate: hash },
    partialFingerprints: {
      primaryLocationLineHash: hash,
      ...(finding.fingerprint ? { a11ygate: finding.fingerprint } : {}),
    },
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
}

function buildRun(
  report: FormatReport,
  engine: string,
  findings: FormatFinding[],
  limits: GitHubSarifLimits,
): SarifRun {
  const kept = findings.slice().sort(compareBySeverityThenStable);
  const droppedForCap = Math.max(0, kept.length - limits.retainedResultsPerRun);
  if (kept.length > limits.retainedResultsPerRun) kept.length = limits.retainedResultsPerRun;
  if (kept.length > limits.maxResultsPerRun) kept.length = limits.maxResultsPerRun;

  const rules = uniqueRules(kept).slice(0, limits.maxRulesPerRun);
  const ruleIndex = new Map(rules.map((rule, index) => [rule.ruleId, index]));
  const taxa = taxaFor(kept);
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
      properties: { tags: wcagTags(rule.wcag, rule.tags, limits.maxTagsPerRule), impact: rule.impact ?? 'unspecified' },
      ...(relationships.length > 0 ? { relationships } : {}),
    };
  });

  const results = kept.map((finding) => {
    const result = toSarifResult(finding, ruleIndex);
    if (result.locations.length > limits.maxLocationsPerResult) {
      result.locations = result.locations.slice(0, limits.maxLocationsPerResult);
    }
    return result;
  });

  return {
    tool: {
      driver: {
        name: 'A11yGate',
        version: report.version,
        informationUri: SITE_URL,
        rules: driverRules,
      },
    },
    automationDetails: { id: automationDetailsId(engine) },
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
      engine,
      ...(report.startUrl ? { startUrl: report.startUrl } : {}),
      ...(report.projectName ? { projectName: report.projectName } : {}),
      ...(droppedForCap > 0
        ? {
            truncatedResults: droppedForCap,
            retainedResults: results.length,
            truncationNote: `Kept the top ${results.length} results by severity (GitHub retains at most ${limits.retainedResultsPerRun} per run).`,
          }
        : {}),
    },
  };
}

function resolveLimits(overrides?: Partial<GitHubSarifLimits>): GitHubSarifLimits {
  return {
    maxGzipBytes: overrides?.maxGzipBytes ?? GITHUB_SARIF_LIMITS.maxGzipBytes,
    maxRunsPerFile: overrides?.maxRunsPerFile ?? GITHUB_SARIF_LIMITS.maxRunsPerFile,
    maxResultsPerRun: overrides?.maxResultsPerRun ?? GITHUB_SARIF_LIMITS.maxResultsPerRun,
    retainedResultsPerRun: overrides?.retainedResultsPerRun ?? GITHUB_SARIF_LIMITS.retainedResultsPerRun,
    maxRulesPerRun: overrides?.maxRulesPerRun ?? GITHUB_SARIF_LIMITS.maxRulesPerRun,
    maxTagsPerRule: overrides?.maxTagsPerRule ?? GITHUB_SARIF_LIMITS.maxTagsPerRule,
    maxLocationsPerResult: overrides?.maxLocationsPerResult ?? GITHUB_SARIF_LIMITS.maxLocationsPerResult,
  };
}

function stringify(log: SarifLog): string {
  return `${JSON.stringify(log, null, 2)}\n`;
}

function shrinkSnippets(log: SarifLog, maxChars: number): void {
  const clip = (value: string | undefined) =>
    value && value.length > maxChars ? `${value.slice(0, maxChars)}…` : value;
  for (const run of log.runs) {
    for (const rule of run.tool.driver.rules) {
      const short = rule.shortDescription as { text?: string } | undefined;
      const full = rule.fullDescription as { text?: string } | undefined;
      const help = rule.help as { text?: string } | undefined;
      if (short?.text) short.text = clip(short.text)!;
      if (full?.text) full.text = clip(full.text)!;
      if (help?.text) help.text = clip(help.text)!;
    }
    for (const result of run.results) {
      if (result.message.text.length > maxChars) {
        result.message.text = `${result.message.text.slice(0, maxChars)}…`;
      }
      for (const location of result.locations) {
        const snippet = location.physicalLocation.region.snippet;
        if (snippet && snippet.text.length > maxChars) {
          snippet.text = `${snippet.text.slice(0, maxChars)}…`;
        }
      }
    }
  }
}

function dropOrphanRules(run: SarifRun): void {
  const used = new Set(run.results.map((result) => result.ruleId));
  run.tool.driver.rules = run.tool.driver.rules.filter((rule) => used.has(String(rule.id)));
  const ruleIndex = new Map(run.tool.driver.rules.map((rule, index) => [String(rule.id), index]));
  for (const result of run.results) {
    const index = ruleIndex.get(result.ruleId);
    if (index === undefined) delete result.ruleIndex;
    else result.ruleIndex = index;
  }
}

const LEVEL_RANK = { note: 0, warning: 1, error: 2 } as const;

function dropLowestSeverityResult(log: SarifLog): boolean {
  let chosen: { run: SarifRun; index: number } | undefined;
  let chosenRank = 99;
  for (const run of log.runs) {
    for (let index = run.results.length - 1; index >= 0; index--) {
      const value = LEVEL_RANK[run.results[index]!.level];
      if (value < chosenRank) {
        chosenRank = value;
        chosen = { run, index };
      }
    }
  }
  if (!chosen) return false;
  chosen.run.results.splice(chosen.index, 1);
  dropOrphanRules(chosen.run);
  chosen.run.properties.truncatedForUploadSize = (chosen.run.properties.truncatedForUploadSize as number | undefined ?? 0) + 1;
  chosen.run.properties.retainedResults = chosen.run.results.length;
  return true;
}

/**
 * Enforce the gzip size cap from
 * GITHUB_SARIF_LIMITS.docs.fileTooLarge (10 MB compressed).
 * Drops lowest-severity results after shrinking snippets.
 */
export function applyGitHubSizeBudget(log: SarifLog, maxGzipBytes: number): SarifLog {
  if (gzipByteLength(stringify(log)) <= maxGzipBytes) return log;

  shrinkSnippets(log, 256);
  if (gzipByteLength(stringify(log)) <= maxGzipBytes) return log;

  while (gzipByteLength(stringify(log)) > maxGzipBytes) {
    if (!dropLowestSeverityResult(log)) break;
  }

  if (gzipByteLength(stringify(log)) > maxGzipBytes) {
    shrinkSnippets(log, 0);
    for (const run of log.runs) {
      for (const result of run.results) {
        for (const location of result.locations) {
          delete location.physicalLocation.region.snippet;
        }
      }
    }
  }

  return log;
}

/**
 * SARIF 2.1.0 log aligned with GitHub code scanning limits and fingerprints.
 * When a finding is mapped to a source file and line, that path is used as the
 * artifact URI; otherwise the page URL and selector are recorded. Findings are
 * grouped into one run per engine, each with its own automationDetails.id.
 */
export function toSarif(report: FormatReport, options: ToSarifOptions = {}): string {
  const limits = resolveLimits(options.limits);
  const fallback = defaultEngine(report);
  const grouped = new Map<string, FormatFinding[]>();
  for (const finding of report.findings) {
    for (const engine of enginesFor(finding, fallback)) {
      const list = grouped.get(engine) ?? [];
      list.push(finding);
      grouped.set(engine, list);
    }
  }
  if (grouped.size === 0) grouped.set(fallback, []);

  const engineOrder = report.engines?.used?.length
    ? [...report.engines.used, ...[...grouped.keys()].filter((engine) => !report.engines?.used.includes(engine)).sort()]
    : [...grouped.keys()].sort((a, b) => (a === DEFAULT_ENGINE ? -1 : b === DEFAULT_ENGINE ? 1 : a.localeCompare(b)));

  const runs: SarifRun[] = [];
  for (const engine of engineOrder) {
    const findings = grouped.get(engine);
    if (!findings) continue;
    runs.push(buildRun(report, engine, findings, limits));
    if (runs.length >= limits.maxRunsPerFile) break;
  }
  if (runs.length === 0) runs.push(buildRun(report, fallback, [], limits));

  const log: SarifLog = {
    $schema: SARIF_SCHEMA_URL,
    version: SARIF_VERSION,
    runs,
  };
  applyGitHubSizeBudget(log, limits.maxGzipBytes);
  return stringify(log);
}
