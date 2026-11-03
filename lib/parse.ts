import { fingerprint, pagePath } from '@/lib/fingerprint';
import { impactRank } from '@/lib/gate';
import { axeJsonByteLength, axeJsonTooLargeMessage, MAX_AXE_JSON_BYTES } from '@/lib/limits';
import type { AxeNode, AxeResults, AxeViolation, Finding, Impact, PageInfo } from '@/lib/types';
import { isImpact } from '@/lib/types';

const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_TIMESTAMP.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const day = value.slice(0, 10);
  const calendar = new Date(day + 'T00:00:00Z');
  return Number.isFinite(calendar.getTime()) && calendar.toISOString().slice(0, 10) === day && Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60 && Number(value.slice(17, 19)) < 60;
}

export type ParseResult =
  | { ok: true; results: AxeResults[]; synthetic: boolean }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, '').trim();
}

function readImpact(
  value: unknown,
  path: string,
): { ok: true; impact: Impact | null } | { ok: false; error: string } {
  if (value === null || isImpact(value)) return { ok: true, impact: value };
  return {
    ok: false,
    error: `${path} must be minor, moderate, serious, critical, or null`,
  };
}

function readTarget(value: unknown, path: string): string[] | string {
  if (!Array.isArray(value) || value.length === 0) {
    return `${path}.target must be an array of strings`;
  }
  const flat: string[] = [];
  for (const part of value) {
    if (typeof part === 'string') {
      if (part.trim().length === 0) return `${path}.target must be an array of strings`;
      flat.push(part);
      continue;
    }
    // axe frame and shadow selectors are nested string arrays.
    if (
      Array.isArray(part) &&
      part.length > 0 &&
      part.every((item) => typeof item === 'string' && item.trim().length > 0)
    ) {
      flat.push(part.join(' '));
      continue;
    }
    return `${path}.target must be an array of strings`;
  }
  return flat;
}

function validateNode(value: unknown, path: string): AxeNode | string {
  if (!isRecord(value)) return `${path} must be an object`;
  const target = readTarget(value.target, path);
  if (typeof target === 'string') return target;
  if (typeof value.html !== 'string') return `${path}.html must be a string`;

  const node: AxeNode = {
    target,
    html: value.html,
  };
  if (Object.prototype.hasOwnProperty.call(value, 'impact')) {
    const impact = readImpact(value.impact, `${path}.impact`);
    if (!impact.ok) return impact.error;
    node.impact = impact.impact;
  }
  return node;
}

function validateViolation(value: unknown, path: string): AxeViolation | string {
  if (!isRecord(value)) return `${path} must be an object`;
  if (typeof value.id !== 'string' || value.id.trim().length === 0) {
    return `${path}.id must be a non-empty string`;
  }
  if (!Object.prototype.hasOwnProperty.call(value, 'impact')) {
    return `${path}.impact is missing`;
  }
  const impact = readImpact(value.impact, `${path}.impact`);
  if (!impact.ok) return impact.error;
  if (!Array.isArray(value.tags)) return `${path}.tags must be an array of strings`;
  if (!value.tags.every((tag) => typeof tag === 'string')) {
    return `${path}.tags must be an array of strings`;
  }
  if (typeof value.help !== 'string' || value.help.trim().length === 0) {
    return `${path}.help must be a non-empty string`;
  }
  if (typeof value.helpUrl !== 'string' || value.helpUrl.trim().length === 0) {
    return `${path}.helpUrl must be a non-empty string`;
  }
  if (!Array.isArray(value.nodes) || value.nodes.length === 0) {
    return `${path}.nodes must contain at least one node`;
  }

  const nodes: AxeNode[] = [];
  for (let index = 0; index < value.nodes.length; index += 1) {
    const node = validateNode(value.nodes[index], `${path}.nodes[${index}]`);
    if (typeof node === 'string') return node;
    nodes.push(node);
  }

  return {
    id: value.id,
    impact: impact.impact,
    tags: value.tags,
    help: value.help,
    helpUrl: value.helpUrl,
    nodes,
  };
}

function isSynthetic(value: Record<string, unknown>): boolean {
  return typeof value._fixture === 'string' && /synthetic/i.test(value._fixture);
}

function validateResult(value: unknown, path: string): { result: AxeResults; synthetic: boolean } | string {
  if (!isRecord(value)) return `${path} must be an axe result object`;
  if (typeof value.url !== 'string' || value.url.trim().length === 0) {
    return `${path}.url must be a non-empty string`;
  }
  if (!isIsoTimestamp(value.timestamp)) {
    return `${path}.timestamp must be an ISO date string`;
  }
  if (
    !isRecord(value.testEngine) ||
    typeof value.testEngine.version !== 'string' ||
    value.testEngine.version.trim().length === 0
  ) {
    return `${path}.testEngine.version must be a non-empty string`;
  }
  if (!Array.isArray(value.violations)) return `${path}.violations must be an array`;

  for (const key of ['toolOptions', 'scanConfig', 'testEnvironment']) {
    if (key in value && !isRecord(value[key])) return `${path}.${key} must be an object`;
  }
  if ('scanStatus' in value && value.scanStatus !== 'complete' && value.scanStatus !== 'failed') return `${path}.scanStatus must be complete or failed`;
  if ('scanError' in value && (typeof value.scanError !== 'string' || !value.scanError.trim())) return `${path}.scanError must be a non-empty string`;
  if (value.scanStatus === 'failed' && !value.scanError) return `${path}.scanError is required for failed scans`;
  const incomplete: AxeViolation[] = [];
  if ('incomplete' in value) {
    if (!Array.isArray(value.incomplete)) return `${path}.incomplete must be an array`;
    for (let i = 0; i < value.incomplete.length; i++) {
      const item = validateViolation(value.incomplete[i], `${path}.incomplete[${i}]`);
      if (typeof item === 'string') return item;
      incomplete.push(item);
    }
  }
  const violations: AxeViolation[] = [];
  for (let index = 0; index < value.violations.length; index += 1) {
    const violation = validateViolation(value.violations[index], `${path}.violations[${index}]`);
    if (typeof violation === 'string') return violation;
    violations.push(violation);
  }

  return {
    synthetic: isSynthetic(value),
    result: {
      url: value.url,
      timestamp: value.timestamp,
      testEngine: { version: value.testEngine.version },
      violations,
      ...('toolOptions' in value ? {toolOptions: value.toolOptions as Record<string, unknown>} : {}),
      ...('scanConfig' in value ? {scanConfig: value.scanConfig as Record<string, unknown>} : {}),
      ...('testEnvironment' in value ? {testEnvironment: value.testEnvironment as Record<string, unknown>} : {}),
      ...('scanStatus' in value ? {scanStatus: value.scanStatus as 'complete' | 'failed'} : {}),
      ...(typeof value.scanError === 'string' ? {scanError: value.scanError} : {}),
      ...('incomplete' in value ? {incomplete} : {}),
    },
  };
}

function looksLikeAxeResult(value: Record<string, unknown>): boolean {
  return Array.isArray(value.violations) || typeof value.url === 'string';
}

function unwrapEnvelope(value: unknown): unknown {
  if (!isRecord(value) || looksLikeAxeResult(value)) return value;
  if ('results' in value) return value.results;
  return value;
}

function foreignShapeMessage(value: Record<string, unknown>): string | null {
  if (looksLikeAxeResult(value)) return null;
  if (Array.isArray(value.issues)) {
    return 'This looks like a pa11y report. A11yGate reads axe-core JSON: one result object, or an array of result objects, with url, timestamp, testEngine.version, and violations.';
  }
  if (isRecord(value.audits) || isRecord(value.categories) || typeof value.lighthouseVersion === 'string') {
    return 'This looks like a Lighthouse report. A11yGate reads axe-core JSON, not a Lighthouse export.';
  }
  return null;
}

function parseAxeJsonInner(text: string): ParseResult {
  if (typeof text !== 'string') return { ok: false, error: 'Not valid JSON.' };
  if (text.length > MAX_AXE_JSON_BYTES || axeJsonByteLength(text) > MAX_AXE_JSON_BYTES) {
    return { ok: false, error: axeJsonTooLargeMessage() };
  }
  const source = stripBom(text);
  if (source.length === 0) return { ok: false, error: 'The file is empty.' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'could not parse JSON';
    return { ok: false, error: `Not valid JSON: ${detail}` };
  }

  parsed = unwrapEnvelope(parsed);

  if (isRecord(parsed)) {
    const hint = foreignShapeMessage(parsed);
    if (hint) return { ok: false, error: hint };
  }

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return { ok: false, error: 'The array does not contain any axe results.' };
    const results: AxeResults[] = [];
    let synthetic = false;
    for (let index = 0; index < parsed.length; index += 1) {
      const validated = validateResult(parsed[index], `results[${index}]`);
      if (typeof validated === 'string') return { ok: false, error: validated };
      results.push(validated.result);
      synthetic = synthetic || validated.synthetic;
    }
    return { ok: true, results, synthetic };
  }

  if (!isRecord(parsed)) {
    return { ok: false, error: 'Expected an axe result object or an array of axe results.' };
  }

  const validated = validateResult(parsed, 'result');
  if (typeof validated === 'string') return { ok: false, error: validated };
  return { ok: true, results: [validated.result], synthetic: validated.synthetic };
}

export function parseAxeJson(text: string): ParseResult {
  try {
    return parseAxeJsonInner(text);
  } catch {
    return {
      ok: false,
      error: 'Could not read this JSON. Check that it is an axe-core result and try again.',
    };
  }
}

export function parseAxeDocuments(documents: readonly { name: string; text: string }[]): ParseResult {
  if (documents.length === 0) return { ok: false, error: 'Choose at least one JSON file.' };
  const results: AxeResults[] = [];
  let synthetic = false;
  for (const document of documents) {
    const parsed = parseAxeJson(document.text);
    if (!parsed.ok) return { ok: false, error: `${document.name}: ${parsed.error}` };
    results.push(...parsed.results);
    synthetic = synthetic || parsed.synthetic;
  }
  return { ok: true, results, synthetic };
}

export function findingsFromResults(results: readonly AxeResults[]): Finding[] {
  const byFingerprint = new Map<string, Finding>();
  for (const result of results) {
    const path = pagePath(result.url);
    for (const violation of result.violations) {
      for (const node of violation.nodes) {
        const selector = node.target.join(' ');
        const resolvedImpact = node.impact !== undefined ? node.impact : violation.impact;
        const finding: Finding = {
          fingerprint: fingerprint(violation.id, selector, result.url),
          ruleId: violation.id,
          impact: resolvedImpact,
          tags: violation.tags,
          help: violation.help,
          helpUrl: violation.helpUrl,
          selector,
          html: node.html,
          url: result.url,
          path,
          engineVersion: result.testEngine.version,
          timestamp: result.timestamp,
        };
        const existing = byFingerprint.get(finding.fingerprint);
        if (!existing || impactRank(finding.impact) > impactRank(existing.impact)) {
          byFingerprint.set(finding.fingerprint, finding);
        }
      }
    }
  }

  return [...byFingerprint.values()].sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      a.ruleId.localeCompare(b.ruleId) ||
      a.selector.localeCompare(b.selector),
  );
}

export function pagesFromResults(results: readonly AxeResults[]): PageInfo[] {
  return results.map((result) => ({
    url: result.url,
    path: pagePath(result.url),
    timestamp: result.timestamp,
    engineVersion: result.testEngine.version,
  }));
}

export function engineVersions(results: readonly AxeResults[]): string[] {
  return [...new Set(results.map((result) => result.testEngine.version))];
}
