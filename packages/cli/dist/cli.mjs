#!/usr/bin/env node

// packages/cli/src/run.ts
import { mkdir as mkdir2, readFile as readFile2, realpath, stat, lstat, writeFile as writeFile2 } from "node:fs/promises";
import path2 from "node:path";
import { fileURLToPath } from "node:url";

// lib/types.ts
var IMPACTS = ["minor", "moderate", "serious", "critical"];
function isImpact(value) {
  return value === "minor" || value === "moderate" || value === "serious" || value === "critical";
}

// lib/copy.ts
var DISCLAIMER = "Automated checks cover only part of WCAG; this is evidence, not certification.";
var LEGAL_DISCLAIMER = "Informational only. Not legal advice. Not a certification of EAA compliance.";
var AUTOMATED_TESTING_DISCLAIMER = "Automated testing only. Not a WCAG audit, certification or legal advice.";
var SITE_URL = "https://a11ygate.vercel.app";

// lib/mapping.ts
var SEEDS = [
  { number: "1.1.1", name: "Non-text Content", level: "A", wcag: "2.1" },
  { number: "1.2.1", name: "Audio-only and Video-only (Prerecorded)", level: "A", wcag: "2.1" },
  { number: "1.2.2", name: "Captions (Prerecorded)", level: "A", wcag: "2.1" },
  {
    number: "1.2.3",
    name: "Audio Description or Media Alternative (Prerecorded)",
    level: "A",
    wcag: "2.1"
  },
  { number: "1.2.4", name: "Captions (Live)", level: "AA", wcag: "2.1" },
  { number: "1.2.5", name: "Audio Description (Prerecorded)", level: "AA", wcag: "2.1" },
  { number: "1.3.1", name: "Info and Relationships", level: "A", wcag: "2.1" },
  { number: "1.3.2", name: "Meaningful Sequence", level: "A", wcag: "2.1" },
  { number: "1.3.3", name: "Sensory Characteristics", level: "A", wcag: "2.1" },
  { number: "1.3.4", name: "Orientation", level: "AA", wcag: "2.1" },
  { number: "1.3.5", name: "Identify Input Purpose", level: "AA", wcag: "2.1" },
  { number: "1.4.1", name: "Use of Color", level: "A", wcag: "2.1" },
  { number: "1.4.2", name: "Audio Control", level: "A", wcag: "2.1" },
  { number: "1.4.3", name: "Contrast (Minimum)", level: "AA", wcag: "2.1" },
  { number: "1.4.4", name: "Resize Text", level: "AA", wcag: "2.1" },
  { number: "1.4.5", name: "Images of Text", level: "AA", wcag: "2.1" },
  { number: "1.4.10", name: "Reflow", level: "AA", wcag: "2.1" },
  { number: "1.4.11", name: "Non-text Contrast", level: "AA", wcag: "2.1" },
  { number: "1.4.12", name: "Text Spacing", level: "AA", wcag: "2.1" },
  { number: "1.4.13", name: "Content on Hover or Focus", level: "AA", wcag: "2.1" },
  { number: "2.1.1", name: "Keyboard", level: "A", wcag: "2.1" },
  { number: "2.1.2", name: "No Keyboard Trap", level: "A", wcag: "2.1" },
  { number: "2.1.4", name: "Character Key Shortcuts", level: "A", wcag: "2.1" },
  { number: "2.2.1", name: "Timing Adjustable", level: "A", wcag: "2.1" },
  { number: "2.2.2", name: "Pause, Stop, Hide", level: "A", wcag: "2.1" },
  { number: "2.3.1", name: "Three Flashes or Below Threshold", level: "A", wcag: "2.1" },
  { number: "2.4.1", name: "Bypass Blocks", level: "A", wcag: "2.1" },
  { number: "2.4.2", name: "Page Titled", level: "A", wcag: "2.1" },
  { number: "2.4.3", name: "Focus Order", level: "A", wcag: "2.1" },
  { number: "2.4.4", name: "Link Purpose (In Context)", level: "A", wcag: "2.1" },
  { number: "2.4.5", name: "Multiple Ways", level: "AA", wcag: "2.1" },
  { number: "2.4.6", name: "Headings and Labels", level: "AA", wcag: "2.1" },
  { number: "2.4.7", name: "Focus Visible", level: "AA", wcag: "2.1" },
  { number: "2.4.11", name: "Focus Not Obscured (Minimum)", level: "AA", wcag: "2.2" },
  { number: "2.5.1", name: "Pointer Gestures", level: "A", wcag: "2.1" },
  { number: "2.5.2", name: "Pointer Cancellation", level: "A", wcag: "2.1" },
  { number: "2.5.3", name: "Label in Name", level: "A", wcag: "2.1" },
  { number: "2.5.4", name: "Motion Actuation", level: "A", wcag: "2.1" },
  { number: "2.5.7", name: "Dragging Movements", level: "AA", wcag: "2.2" },
  { number: "2.5.8", name: "Target Size (Minimum)", level: "AA", wcag: "2.2" },
  { number: "3.1.1", name: "Language of Page", level: "A", wcag: "2.1" },
  { number: "3.1.2", name: "Language of Parts", level: "AA", wcag: "2.1" },
  { number: "3.2.1", name: "On Focus", level: "A", wcag: "2.1" },
  { number: "3.2.2", name: "On Input", level: "A", wcag: "2.1" },
  { number: "3.2.3", name: "Consistent Navigation", level: "AA", wcag: "2.1" },
  { number: "3.2.4", name: "Consistent Identification", level: "AA", wcag: "2.1" },
  { number: "3.2.6", name: "Consistent Help", level: "A", wcag: "2.2" },
  { number: "3.3.1", name: "Error Identification", level: "A", wcag: "2.1" },
  { number: "3.3.2", name: "Labels or Instructions", level: "A", wcag: "2.1" },
  { number: "3.3.3", name: "Error Suggestion", level: "AA", wcag: "2.1" },
  { number: "3.3.4", name: "Error Prevention (Legal, Financial, Data)", level: "AA", wcag: "2.1" },
  { number: "3.3.7", name: "Redundant Entry", level: "A", wcag: "2.2" },
  { number: "3.3.8", name: "Accessible Authentication (Minimum)", level: "AA", wcag: "2.2" },
  // 4.1.1 Parsing was removed in WCAG 2.2. Kept for axe tags on WCAG 2.1 targets.
  { number: "4.1.1", name: "Parsing", level: "A", wcag: "2.1" },
  { number: "4.1.2", name: "Name, Role, Value", level: "A", wcag: "2.1" },
  { number: "4.1.3", name: "Status Messages", level: "AA", wcag: "2.1" }
];
function tagFor(number) {
  return `wcag${number.split(".").join("")}`;
}
var CRITERIA = SEEDS.map((seed) => ({
  tag: tagFor(seed.number),
  number: seed.number,
  name: seed.name,
  level: seed.level,
  en301549: `9.${seed.number}`,
  wcag: seed.wcag
}));
var BY_TAG = new Map(CRITERIA.map((criterion) => [criterion.tag, criterion]));
function getCriterion(tag) {
  return BY_TAG.get(tag.toLowerCase()) ?? null;
}
function lookupStandards(tags) {
  const hits = [];
  const seen = /* @__PURE__ */ new Set();
  for (const tag of tags) {
    const criterion = getCriterion(tag);
    if (!criterion || seen.has(criterion.number)) continue;
    seen.add(criterion.number);
    hits.push({ kind: "criterion", ...criterion });
  }
  if (hits.length === 0) return [{ kind: "best-practice" }];
  return hits;
}
function formatStandards(tags) {
  const hits = lookupStandards(tags);
  if (hits.length === 1 && hits[0]?.kind === "best-practice") return "best practice";
  return hits.filter((hit) => hit.kind === "criterion").map(
    (hit) => `WCAG ${hit.wcag} ${hit.number} ${hit.name} (${hit.level}); EN 301 549 ${hit.en301549}`
  ).join(" | ");
}

// lib/fingerprint.ts
function unescapeCss(value) {
  return value.replace(/\\(.)/g, "$1");
}
function isDynamicId(id) {
  const value = id.trim();
  if (value.length === 0) return false;
  if (/^:r[0-9a-z]+:?$/i.test(value)) return true;
  if (/^ember\d+$/i.test(value)) return true;
  if (/^(?:react|mui|headlessui|radix)-/i.test(value) && /\d/.test(value)) return true;
  if (/(?:^|[-_])[a-f0-9]{6,}(?:$|[-_])/i.test(value) && /\d/.test(value) && /[a-f]/i.test(value)) {
    return true;
  }
  if (/[-_]\d{4,}$/.test(value) || /^\d{4,}$/.test(value)) return true;
  return false;
}
function stripDynamicIds(selector) {
  const withoutAttributes = selector.replace(
    /\[id=(?:'([^']*)'|"([^"]*)"|([^\]]+))\]/gi,
    (match, single, double, bare) => {
      const id = unescapeCss(single ?? double ?? bare ?? "");
      return isDynamicId(id) ? "" : match;
    }
  );
  return withoutAttributes.replace(/#(?:\\.|[^\s#.\[>,+~])+/g, (match) => {
    const id = unescapeCss(match.slice(1));
    return isDynamicId(id) ? "" : match;
  });
}
function stripHashClasses(selector) {
  return selector.replace(/\.css-[a-z0-9]+\b/gi, "").replace(/\.([A-Za-z_][\w-]*?)__[A-Za-z0-9]{5,}\b/g, ".$1");
}
function tidySelector(selector) {
  let current = selector.replace(/\s+/g, " ").trim();
  let previous = "";
  while (current !== previous) {
    previous = current;
    current = current.replace(/\s*>\s*>\s*/g, " > ").replace(/\s*\+\s*\+\s*/g, " + ").replace(/^\s*[>+~]\s*/, "").replace(/\s*[>+~]\s*$/, "").replace(/\s+/g, " ").trim();
  }
  return current;
}
function normaliseSelector(selector) {
  const withoutIndexes = selector.trim().replace(/:nth-(?:last-)?(?:child|of-type)\([^)]*\)/gi, "");
  return tidySelector(stripHashClasses(stripDynamicIds(withoutIndexes)));
}
function pagePath(url) {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    let path3 = parsed.pathname || "/";
    if (path3.length > 1 && path3.endsWith("/")) path3 = path3.slice(0, -1);
    return path3 || "/";
  } catch {
    const withoutQuery = trimmed.split(/[?#]/)[0] ?? "";
    if (withoutQuery.length === 0) return "/";
    let path3 = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
    if (path3.length > 1 && path3.endsWith("/")) path3 = path3.slice(0, -1);
    return path3;
  }
}
function fingerprint(ruleId, selector, url) {
  return `${ruleId}|${normaliseSelector(selector)}|${pagePath(url)}`;
}

// lib/gate.ts
var RANK = {
  minor: 1,
  moderate: 2,
  serious: 3,
  critical: 4
};
function impactRank(impact) {
  if (!impact) return 0;
  return RANK[impact];
}
function meetsThreshold(impact, threshold) {
  return impactRank(impact) >= impactRank(threshold);
}
function gatingFindings(findings, threshold) {
  return findings.filter((finding2) => meetsThreshold(finding2.impact, threshold));
}
function gateVerdict(newFindings, threshold, coverage) {
  if (gatingFindings(newFindings, threshold).length > 0) return "FAIL";
  return coverage?.status === "incomplete" ? "INCOMPLETE" : "PASS";
}
function verdictReason(newFindings, threshold) {
  const gating = gatingFindings(newFindings, threshold);
  if (gating.length === 0) {
    return `No new finding is at or above ${threshold}.`;
  }
  const rules2 = [...new Set(gating.map((finding2) => finding2.ruleId))];
  const noun = gating.length === 1 ? "finding" : "findings";
  return `${gating.length} new ${noun} at or above ${threshold}: ${rules2.join(", ")}.`;
}

// lib/limits.ts
var MAX_AXE_JSON_BYTES = 8 * 1024 * 1024;
function axeJsonByteLength(text) {
  return new TextEncoder().encode(text).byteLength;
}
function axeJsonTooLargeMessage() {
  return "This file is larger than 8 MB. A11yGate reads scans in the browser, so split the results by page or remove the passes, incomplete, and inapplicable arrays before importing.";
}

// lib/parse.ts
var ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
function isIsoTimestamp(value) {
  if (typeof value !== "string" || !ISO_TIMESTAMP.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const day = value.slice(0, 10);
  const calendar = /* @__PURE__ */ new Date(day + "T00:00:00Z");
  return Number.isFinite(calendar.getTime()) && calendar.toISOString().slice(0, 10) === day && Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60 && Number(value.slice(17, 19)) < 60;
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stripBom(text) {
  return text.replace(/^\uFEFF/, "").trim();
}
function readImpact(value, path3) {
  if (value === null || isImpact(value)) return { ok: true, impact: value };
  return {
    ok: false,
    error: `${path3} must be minor, moderate, serious, critical, or null`
  };
}
function readTarget(value, path3) {
  if (!Array.isArray(value) || value.length === 0) {
    return `${path3}.target must be an array of strings`;
  }
  const flat = [];
  for (const part of value) {
    if (typeof part === "string") {
      if (part.trim().length === 0) return `${path3}.target must be an array of strings`;
      flat.push(part);
      continue;
    }
    if (Array.isArray(part) && part.length > 0 && part.every((item) => typeof item === "string" && item.trim().length > 0)) {
      flat.push(part.join(" "));
      continue;
    }
    return `${path3}.target must be an array of strings`;
  }
  return flat;
}
function validateNode(value, path3) {
  if (!isRecord(value)) return `${path3} must be an object`;
  const target = readTarget(value.target, path3);
  if (typeof target === "string") return target;
  if (typeof value.html !== "string") return `${path3}.html must be a string`;
  const node = {
    target,
    html: value.html
  };
  if (Object.prototype.hasOwnProperty.call(value, "impact")) {
    const impact = readImpact(value.impact, `${path3}.impact`);
    if (!impact.ok) return impact.error;
    node.impact = impact.impact;
  }
  return node;
}
function validateViolation(value, path3) {
  if (!isRecord(value)) return `${path3} must be an object`;
  if (typeof value.id !== "string" || value.id.trim().length === 0) {
    return `${path3}.id must be a non-empty string`;
  }
  if (!Object.prototype.hasOwnProperty.call(value, "impact")) {
    return `${path3}.impact is missing`;
  }
  const impact = readImpact(value.impact, `${path3}.impact`);
  if (!impact.ok) return impact.error;
  if (!Array.isArray(value.tags)) return `${path3}.tags must be an array of strings`;
  if (!value.tags.every((tag) => typeof tag === "string")) {
    return `${path3}.tags must be an array of strings`;
  }
  if (typeof value.help !== "string" || value.help.trim().length === 0) {
    return `${path3}.help must be a non-empty string`;
  }
  if (typeof value.helpUrl !== "string" || value.helpUrl.trim().length === 0) {
    return `${path3}.helpUrl must be a non-empty string`;
  }
  if (!Array.isArray(value.nodes) || value.nodes.length === 0) {
    return `${path3}.nodes must contain at least one node`;
  }
  const nodes = [];
  for (let index = 0; index < value.nodes.length; index += 1) {
    const node = validateNode(value.nodes[index], `${path3}.nodes[${index}]`);
    if (typeof node === "string") return node;
    nodes.push(node);
  }
  return {
    id: value.id,
    impact: impact.impact,
    tags: value.tags,
    help: value.help,
    helpUrl: value.helpUrl,
    nodes
  };
}
function isSynthetic(value) {
  return typeof value._fixture === "string" && /synthetic/i.test(value._fixture);
}
function validateResult(value, path3) {
  if (!isRecord(value)) return `${path3} must be an axe result object`;
  if (typeof value.url !== "string" || value.url.trim().length === 0) {
    return `${path3}.url must be a non-empty string`;
  }
  if (!isIsoTimestamp(value.timestamp)) {
    return `${path3}.timestamp must be an ISO date string`;
  }
  if (!isRecord(value.testEngine) || typeof value.testEngine.version !== "string" || value.testEngine.version.trim().length === 0) {
    return `${path3}.testEngine.version must be a non-empty string`;
  }
  if (!Array.isArray(value.violations)) return `${path3}.violations must be an array`;
  for (const key of ["toolOptions", "scanConfig", "testEnvironment"]) {
    if (key in value && !isRecord(value[key])) return `${path3}.${key} must be an object`;
  }
  if ("scanStatus" in value && value.scanStatus !== "complete" && value.scanStatus !== "failed") return `${path3}.scanStatus must be complete or failed`;
  if ("scanError" in value && (typeof value.scanError !== "string" || !value.scanError.trim())) return `${path3}.scanError must be a non-empty string`;
  if (value.scanError && value.scanStatus !== "failed") return `${path3}.scanError requires scanStatus failed; contradictory scan success is unsupported`;
  if (value.scanStatus === "failed" && !value.scanError) return `${path3}.scanError is required for failed scans`;
  const incomplete = [];
  if ("incomplete" in value) {
    if (!Array.isArray(value.incomplete)) return `${path3}.incomplete must be an array`;
    for (let i = 0; i < value.incomplete.length; i++) {
      const item = validateViolation(value.incomplete[i], `${path3}.incomplete[${i}]`);
      if (typeof item === "string") return item;
      incomplete.push(item);
    }
  }
  const violations = [];
  for (let index = 0; index < value.violations.length; index += 1) {
    const violation = validateViolation(value.violations[index], `${path3}.violations[${index}]`);
    if (typeof violation === "string") return violation;
    violations.push(violation);
  }
  return {
    synthetic: isSynthetic(value),
    result: {
      url: value.url,
      timestamp: value.timestamp,
      testEngine: { version: value.testEngine.version },
      violations,
      ..."toolOptions" in value ? { toolOptions: value.toolOptions } : {},
      ..."scanConfig" in value ? { scanConfig: value.scanConfig } : {},
      ..."testEnvironment" in value ? { testEnvironment: value.testEnvironment } : {},
      ..."scanStatus" in value ? { scanStatus: value.scanStatus } : {},
      ...typeof value.scanError === "string" ? { scanError: value.scanError } : {},
      ..."incomplete" in value ? { incomplete } : {}
    }
  };
}
function looksLikeAxeResult(value) {
  return Array.isArray(value.violations) || typeof value.url === "string";
}
function unwrapEnvelope(value) {
  if (!isRecord(value) || looksLikeAxeResult(value)) return value;
  if ("results" in value) return value.results;
  return value;
}
function foreignShapeMessage(value) {
  if (looksLikeAxeResult(value)) return null;
  if (Array.isArray(value.issues)) {
    return "This looks like a pa11y report. A11yGate reads axe-core JSON: one result object, or an array of result objects, with url, timestamp, testEngine.version, and violations.";
  }
  if (isRecord(value.audits) || isRecord(value.categories) || typeof value.lighthouseVersion === "string") {
    return "This looks like a Lighthouse report. A11yGate reads axe-core JSON, not a Lighthouse export.";
  }
  return null;
}
function parseAxeJsonInner(text) {
  if (typeof text !== "string") return { ok: false, error: "Not valid JSON." };
  if (text.length > MAX_AXE_JSON_BYTES || axeJsonByteLength(text) > MAX_AXE_JSON_BYTES) {
    return { ok: false, error: axeJsonTooLargeMessage() };
  }
  const source = stripBom(text);
  if (source.length === 0) return { ok: false, error: "The file is empty." };
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "could not parse JSON";
    return { ok: false, error: `Not valid JSON: ${detail}` };
  }
  parsed = unwrapEnvelope(parsed);
  if (isRecord(parsed)) {
    const hint = foreignShapeMessage(parsed);
    if (hint) return { ok: false, error: hint };
  }
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return { ok: false, error: "The array does not contain any axe results." };
    const results = [];
    let synthetic = false;
    for (let index = 0; index < parsed.length; index += 1) {
      const validated2 = validateResult(parsed[index], `results[${index}]`);
      if (typeof validated2 === "string") return { ok: false, error: validated2 };
      results.push(validated2.result);
      synthetic = synthetic || validated2.synthetic;
    }
    return { ok: true, results, synthetic };
  }
  if (!isRecord(parsed)) {
    return { ok: false, error: "Expected an axe result object or an array of axe results." };
  }
  const validated = validateResult(parsed, "result");
  if (typeof validated === "string") return { ok: false, error: validated };
  return { ok: true, results: [validated.result], synthetic: validated.synthetic };
}
function parseAxeJson(text) {
  try {
    return parseAxeJsonInner(text);
  } catch {
    return {
      ok: false,
      error: "Could not read this JSON. Check that it is an axe-core result and try again."
    };
  }
}
function parseAxeDocuments(documents) {
  if (documents.length === 0) return { ok: false, error: "Choose at least one JSON file." };
  const results = [];
  let synthetic = false;
  for (const document2 of documents) {
    const parsed = parseAxeJson(document2.text);
    if (!parsed.ok) return { ok: false, error: `${document2.name}: ${parsed.error}` };
    results.push(...parsed.results);
    synthetic = synthetic || parsed.synthetic;
  }
  return { ok: true, results, synthetic };
}
function findingsFromResults(results) {
  const byFingerprint = /* @__PURE__ */ new Map();
  for (const result of results) {
    const path3 = pagePath(result.url);
    for (const violation of result.violations) {
      for (const node of violation.nodes) {
        const selector = node.target.join(" ");
        const resolvedImpact = node.impact !== void 0 ? node.impact : violation.impact;
        const finding2 = {
          fingerprint: fingerprint(violation.id, selector, result.url),
          ruleId: violation.id,
          impact: resolvedImpact,
          tags: violation.tags,
          help: violation.help,
          helpUrl: violation.helpUrl,
          selector,
          html: node.html,
          url: result.url,
          path: path3,
          engineVersion: result.testEngine.version,
          timestamp: result.timestamp
        };
        const existing = byFingerprint.get(finding2.fingerprint);
        if (!existing || impactRank(finding2.impact) > impactRank(existing.impact)) {
          byFingerprint.set(finding2.fingerprint, finding2);
        }
      }
    }
  }
  return [...byFingerprint.values()].sort(
    (a, b) => a.path.localeCompare(b.path) || a.ruleId.localeCompare(b.ruleId) || a.selector.localeCompare(b.selector)
  );
}

// lib/report-formats.ts
var REPORT_FORMATS = ["junit", "sarif", "json", "md"];
function isReportFormat(value) {
  return REPORT_FORMATS.includes(value);
}
function parseFormatList(value) {
  const parts = value.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length === 0) return { ok: false, error: "--format needs a value. Use junit, sarif, json, or md." };
  const formats = [];
  for (const part of parts) {
    if (!isReportFormat(part)) {
      return { ok: false, error: `Unknown format "${part}". Use junit, sarif, json, or md.` };
    }
    if (!formats.includes(part)) formats.push(part);
  }
  return { ok: true, formats };
}
function mergeFormats(existing, incoming) {
  const formats = [...existing];
  for (const format of incoming) {
    if (!formats.includes(format)) formats.push(format);
  }
  return formats;
}
function formatFileName(command, format) {
  const prefix = command === "scan" ? "a11ygate-scan" : "a11ygate";
  if (format === "junit") return `${prefix}.junit.xml`;
  if (format === "sarif") return `${prefix}.sarif`;
  if (format === "json") return `${prefix}.json`;
  return `${prefix}.md`;
}
function wcagFromTags(tags) {
  return lookupStandards(tags).flatMap(
    (hit) => hit.kind === "criterion" ? [{ number: hit.number, name: hit.name, level: hit.level, wcag: hit.wcag }] : []
  );
}
function formatFindingFromScan(finding2) {
  return {
    ruleId: finding2.ruleId,
    impact: finding2.impact,
    help: finding2.help,
    helpUrl: finding2.helpUrl,
    tags: finding2.tags,
    wcag: finding2.wcag.map((item) => ({ number: item.number, name: item.name, level: item.level, wcag: item.wcag })),
    pageUrl: finding2.pageUrl,
    selector: finding2.selector,
    html: finding2.html,
    fingerprint: finding2.fingerprint,
    ...finding2.engines ? { engines: finding2.engines, confidence: finding2.confidence } : {}
  };
}
function formatReportFromScan(report) {
  return {
    toolName: "A11yGate",
    version: report.version,
    generatedAt: report.scannedAt,
    command: "scan",
    ...report.engines ? { engines: report.engines } : {},
    verdict: report.verdict,
    reason: report.reason,
    startUrl: report.startUrl,
    pages: report.pages.filter((page) => page.scanStatus === "complete").map((page) => page.url),
    findings: report.findings.map(formatFindingFromScan)
  };
}
function formatFindingFromDiffed(finding2) {
  return {
    ruleId: finding2.ruleId,
    impact: finding2.impact,
    help: finding2.help,
    helpUrl: finding2.helpUrl,
    tags: finding2.tags,
    wcag: wcagFromTags(finding2.tags),
    pageUrl: finding2.url,
    selector: finding2.selector,
    html: finding2.html,
    fingerprint: finding2.fingerprint,
    status: finding2.status
  };
}
function formatReportFromGate(input) {
  const pages = [...new Set(input.currentResults.map((result) => result.url))];
  const statusByFingerprint = new Map(input.findings.map((finding2) => [finding2.fingerprint, finding2.status]));
  const findings = findingsFromResults(input.currentResults).map(
    (finding2) => formatFindingFromDiffed({ ...finding2, status: statusByFingerprint.get(finding2.fingerprint) ?? "new" })
  );
  return {
    toolName: "A11yGate",
    version: input.version,
    generatedAt: input.generatedAt,
    command: "ci",
    verdict: input.verdict,
    reason: input.reason,
    projectName: input.projectName,
    pages,
    findings
  };
}
var FORMAT_DISCLAIMER = AUTOMATED_TESTING_DISCLAIMER;

// packages/cli/src/args.ts
var VALUE_FLAGS = {
  "--current": "current",
  "-c": "current",
  "--baseline": "baseline",
  "-b": "baseline",
  "--threshold": "threshold",
  "-t": "threshold",
  "--markdown": "markdown",
  "-m": "markdown",
  "--json": "json",
  "-j": "json",
  "--update-baseline": "updateBaseline",
  "--manual-evidence": "manualEvidence",
  "--format": "format",
  "--out-dir": "outDir"
};
function flagName(token) {
  const eq = token.indexOf("=");
  if (eq === -1) return { name: token };
  return { name: token.slice(0, eq), inline: token.slice(eq + 1) };
}
function parseArgs(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    return {
      ok: true,
      options: {
        help: true,
        version: false,
        current: [],
        baseline: [],
        threshold: "serious",
        formats: []
      }
    };
  }
  const current = [];
  const baseline = [];
  let threshold = "serious";
  let markdown;
  let json;
  let updateBaseline;
  let manualEvidence;
  let formats = [];
  let outDir;
  let help = false;
  let version = false;
  let thresholdText;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--") {
      return { ok: false, error: "Unexpected extra arguments." };
    }
    if (token === "--help" || token === "-h") {
      help = true;
      continue;
    }
    if (token === "--version") {
      version = true;
      continue;
    }
    const { name, inline } = flagName(token);
    const field = VALUE_FLAGS[name];
    if (!field) {
      if (token.startsWith("-")) return { ok: false, error: `Unknown option ${token}.` };
      return { ok: false, error: `Unexpected argument ${token}.` };
    }
    const value = inline !== void 0 ? inline : argv[index + 1];
    if (inline === void 0) index += 1;
    if (value === void 0 || value.length === 0) {
      return { ok: false, error: `${name} needs a value.` };
    }
    const jsonFlag = name === "--json" || name === "-j";
    if (value.startsWith("-") && !(jsonFlag && value === "-")) {
      return { ok: false, error: `${name} needs a value.` };
    }
    if (field === "current") current.push(value);
    else if (field === "baseline") baseline.push(value);
    else if (field === "threshold") thresholdText = value;
    else if (field === "markdown") markdown = value;
    else if (field === "json") json = value;
    else if (field === "updateBaseline") updateBaseline = value;
    else if (field === "manualEvidence") manualEvidence = value;
    else if (field === "outDir") outDir = value;
    else {
      const parsed = parseFormatList(value);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      formats = mergeFormats(formats, parsed.formats);
    }
  }
  if (!help && !version && thresholdText !== void 0) {
    if (!isImpact(thresholdText)) {
      return {
        ok: false,
        error: `Unknown impact threshold "${thresholdText}". Use minor, moderate, serious, or critical.`
      };
    }
    threshold = thresholdText;
  }
  return {
    ok: true,
    options: { help, version: version && !help, current, baseline, threshold, markdown, json, updateBaseline, manualEvidence, formats, outDir }
  };
}

// packages/cli/src/help.ts
function helpText() {
  return `a11ygate \u2014 accessibility regression gate for axe-core JSON

Usage:
  a11ygate [ci] --current <file> [--current <file>] [--baseline <file>] [options]
  a11ygate scan <url> [--crawl [n]] [--fail-on <impact>] [--out-dir <dir>] [--format <fmt>]
                       (see a11ygate scan --help)

Options:
  -c, --current <file>         Current axe-core JSON. Repeat for more than one file.
                               Each file is one result, an array of results, or { "results": ... }.
  -b, --baseline <file>        Baseline axe-core JSON. Repeatable. Omit to treat every current finding as new.
  -t, --threshold <impact>     minor, moderate, serious, or critical. Default: serious.
                               Exit 1 only when a new finding is at or above this impact.
  -m, --markdown <file>        Also write the Markdown summary to this file. It is always printed.
  -j, --json <file>            Write the JSON result to this file. Use - to print JSON instead of Markdown.
      --update-baseline <file> Write a proposed baseline and <file>.review.json with exact accepted findings.
      --manual-evidence <file> Import schemaVersion 1 human evidence separately from automated checks.
      --format <fmt>           Output format: junit, sarif, json, or md. Repeat or comma-separate for several.
                               Requires --out-dir. Exit codes are unchanged.
      --out-dir <dir>          Write a11ygate.json and a11ygate.md here, plus any --format files
                               (a11ygate.junit.xml, a11ygate.sarif).
  -h, --help                   Show this help.
      --version                Show the version.

Exit codes:
  0  No detected new finding is at or above the threshold; existing debt/unassessed scope remain.
  1  At least one new finding is at or above the threshold.
  2  Incomplete scan coverage, unsafe outputs, invalid evidence, or unreadable arguments/JSON.

Examples:
  npx @qe-atlas/a11ygate --current axe.json --baseline a11y/baseline.json
  npx @qe-atlas/a11ygate --current home.json --current cart.json --threshold critical --json result.json
  npx @qe-atlas/a11ygate --current axe.json --update-baseline a11y/baseline.json

A file larger than 8 MB is refused. The same diff and gate as the web app are used.
This source build is unreleased; published 0.1.0 does not include these coverage/manual features.
PASS is not legal advice or certification. Baseline updates never clear the current gate result.
`;
}

// lib/scan/engines/locators.ts
async function resolveElementKeys(page, findings) {
  const keys = await page.evaluate((selectors) => selectors.map((selector) => {
    try {
      let element = null;
      if (selector.startsWith("/") || selector.startsWith("xpath=")) {
        const nodes = document.evaluate(selector.replace(/^xpath=/, ""), document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE);
        if (nodes.snapshotLength === 1) element = nodes.snapshotItem(0);
      } else {
        const nodes = document.querySelectorAll(selector);
        if (nodes.length === 1) element = nodes[0];
      }
      if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
      const parts = [];
      while (element) {
        const tag = element.localName;
        let index = 1;
        let sibling = element.previousElementSibling;
        while (sibling) {
          if (sibling.localName === tag) index += 1;
          sibling = sibling.previousElementSibling;
        }
        parts.unshift(`${tag}:nth-of-type(${index})`);
        element = element.parentElement;
      }
      return parts.join(">");
    } catch {
      return null;
    }
  }), findings.map((f) => f.selector));
  return findings.map((f, i) => keys[i] ? { ...f, elementKey: keys[i] } : f);
}

// packages/cli/src/scan.ts
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:net";

// lib/scan/engines/optional.ts
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

// lib/scan/engines/wcag-map.ts
var WCAG_RULE_MAP = {
  htmlcs: { "WCAG2AA.Principle1.Guideline1_1.1_1_1.H37": ["1.1.1"] },
  ibm: { img_alt_valid: ["1.1.1"], html_lang_exists: ["3.1.1"], input_label_exists: ["1.3.1", "4.1.2"] },
  lighthouse: { "image-alt": ["1.1.1"], "document-title": ["2.4.2"], "html-has-lang": ["3.1.1"], "color-contrast": ["1.4.3"], label: ["1.3.1", "4.1.2"], "button-name": ["4.1.2"], "link-name": ["2.4.4", "4.1.2"] },
  axe: {
    "image-alt": ["1.1.1"],
    "color-contrast": ["1.4.3"],
    label: ["4.1.2", "1.3.1"],
    region: [],
    "document-title": ["2.4.2"],
    "html-has-lang": ["3.1.1"],
    "html-lang-valid": ["3.1.1"],
    "link-name": ["2.4.4", "4.1.2"],
    "button-name": ["4.1.2"]
  }
};

// lib/scan/engines/optional.ts
var ENGINE_IDS = ["axe", "htmlcs", "ibm", "lighthouse"];
var require2 = createRequire(import.meta.url);
var normalize = (results) => results.findings;
async function localScript(packageName, script) {
  try {
    return await readFile(require2.resolve(`${packageName}/${script}`), "utf8");
  } catch {
    throw new Error(`Missing ${packageName} engine files. Install with: npm install --save-dev ${packageName}`);
  }
}
function finding(engine, url, ruleId, selector, snippet, helpUrl, wcagSc) {
  return {
    engine,
    url,
    ruleId,
    selector,
    snippet,
    helpUrl,
    impact: "serious",
    wcagSc: wcagSc ?? [...WCAG_RULE_MAP[engine]?.[ruleId] ?? []]
  };
}
function createHtmlcsEngine() {
  return {
    id: "htmlcs",
    displayName: "HTML_CodeSniffer",
    async run({ page }, url) {
      await page.evaluate(await localScript("html_codesniffer", "build/HTMLCS.js"));
      const issues = await page.evaluate(async () => {
        const htmlcs = window.HTMLCS;
        return await new Promise((resolve) => {
          htmlcs.process("WCAG2AA", document, () => resolve(htmlcs.getMessages().map((m) => {
            const parts = [];
            let element = m.element;
            while (element) {
              const parent = element.parentElement;
              parts.unshift(`${element.localName}:nth-child(${parent ? Array.from(parent.children).indexOf(element) + 1 : 1})`);
              element = parent;
            }
            return { code: m.code, type: m.type, message: m.msg, selector: parts.join(" > "), snippet: m.element?.outerHTML ?? "" };
          })));
        });
      });
      return { raw: issues, findings: issues.filter((i) => i.type === 1).map((i) => {
        const sc = i.code.match(/Guideline\d+_\d+\.(\d+)_(\d+)_(\d+)/);
        return finding(
          "htmlcs",
          url,
          i.code,
          i.selector,
          i.snippet.slice(0, 2e3),
          "https://squizlabs.github.io/HTML_CodeSniffer/Standards/WCAG2/",
          sc ? [`${sc[1]}.${sc[2]}.${sc[3]}`] : []
        );
      }) };
    },
    normalize
  };
}
function createIbmEngine() {
  return {
    id: "ibm",
    displayName: "IBM Equal Access",
    async run({ page }, url) {
      await page.evaluate(await localScript("accessibility-checker-engine", "ace.js"));
      const native = await page.evaluate(async () => {
        const ace = window.ace;
        const report = await new ace.Checker().check(document, ["IBM_Accessibility"]);
        return { raw: report, issues: report.results.filter((issue) => issue.value[0] === "VIOLATION" && issue.value[1] === "FAIL").map((i) => ({
          ruleId: i.ruleId,
          selector: i.path?.dom ?? "",
          snippet: i.snippet ?? ""
        })) };
      });
      return { raw: native.raw, findings: native.issues.map((i) => finding(
        "ibm",
        url,
        i.ruleId,
        i.selector,
        i.snippet,
        `https://www.ibm.com/able/requirements/checker-rule-sets#${encodeURIComponent(i.ruleId)}`
      )) };
    },
    normalize
  };
}
function createLighthouseEngine() {
  return {
    id: "lighthouse",
    displayName: "Lighthouse accessibility",
    async run({ page, browserURL }, url) {
      let lighthouse;
      let puppeteer;
      try {
        [lighthouse, puppeteer] = await Promise.all([import("lighthouse"), import("puppeteer-core")]);
      } catch {
        throw new Error("Missing Lighthouse engine packages. Install with: npm install --save-dev lighthouse puppeteer-core");
      }
      if (!browserURL) throw new Error("Lighthouse requires the shared Chromium debugging endpoint.");
      const browser = await puppeteer.connect({ browserURL, defaultViewport: null });
      try {
        const cdp = await page.context().newCDPSession(page);
        const { targetInfo } = await cdp.send("Target.getTargetInfo");
        await cdp.detach();
        const target = browser.targets().find((t) => t._targetId === targetInfo.targetId);
        const current = await target?.page();
        if (!current) throw new Error("Could not attach Lighthouse to the existing page.");
        const result = await lighthouse.snapshot(current, { flags: {
          onlyCategories: ["accessibility"],
          logLevel: "silent",
          disableStorageReset: true,
          formFactor: "desktop",
          screenEmulation: { disabled: true }
        } });
        if (!result) throw new Error("Lighthouse returned no report.");
        if (result.lhr.runtimeError) throw new Error(`Lighthouse: ${result.lhr.runtimeError.message}`);
        const failedAudit = Object.values(result.lhr.audits).find((a) => a.scoreDisplayMode === "error");
        if (failedAudit) throw new Error(`Lighthouse audit ${failedAudit.id} failed: ${failedAudit.errorMessage ?? "unknown error"}`);
        return { raw: result.lhr, findings: Object.values(result.lhr.audits).filter((a) => a.score === 0).flatMap((a) => {
          const details = a.details;
          const nodes = (details?.items ?? []).flatMap((i) => [i.node, ...(i.subItems?.items ?? []).map((sub) => sub.node)]).filter((n) => n !== void 0);
          return (nodes.length ? nodes : [{}]).map((n) => finding(
            "lighthouse",
            url,
            a.id,
            n.selector ?? "",
            n.snippet ?? "",
            a.description.match(/https:\/\/[^\s)]+/)?.[0] ?? "https://developer.chrome.com/docs/lighthouse/accessibility/"
          ));
        }) };
      } finally {
        await browser.disconnect();
      }
    },
    normalize
  };
}

// lib/scan/robots.ts
var ROBOTS_AGENT = "a11ygate";
function parseRobots(text, agent = ROBOTS_AGENT) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "disallow" || key === "allow") {
      if (value === "") continue;
      current.rules.push({ allow: key === "allow", pattern: value });
    }
  }
  const name = agent.toLowerCase();
  const rules2 = groups.filter((group2) => group2.agents.some((a) => a === "*" || a.includes(name))).flatMap((group2) => group2.rules);
  return { rules: rules2 };
}
function patternToRegExp(pattern) {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern).split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp("^" + body + (anchored ? "$" : ""));
}
function isAllowedByRobots(robots, pathAndQuery) {
  if (!robots || robots.rules.length === 0) return true;
  let best = null;
  for (const rule of robots.rules) {
    if (!patternToRegExp(rule.pattern).test(pathAndQuery)) continue;
    if (!best || rule.pattern.length > best.pattern.length || rule.pattern.length === best.pattern.length && rule.allow) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}
function robotsAllowsUrl(robots, url) {
  const parsed = new URL(url);
  return isAllowedByRobots(robots, parsed.pathname + parsed.search);
}
async function fetchRobots(origin, userAgent, fetchImpl, timeoutMs = 5e3) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${origin}/robots.txt`, { headers: { "user-agent": userAgent }, signal: controller.signal, redirect: "follow" });
    if (!response.ok) return { rules: null, note: `robots.txt returned HTTP ${response.status}; no rules applied.` };
    const text = (await response.text()).slice(0, 512 * 1024);
    return { rules: parseRobots(text), note: "robots.txt honoured." };
  } catch {
    return { rules: null, note: "robots.txt unreachable; proceeding without rules." };
  } finally {
    clearTimeout(timer);
  }
}

// lib/scan/url.ts
var MAX_CRAWL_PAGES = 20;
var NON_HTML_EXTENSION = /\.(?:pdf|zip|gz|tgz|rar|7z|tar|dmg|exe|msi|apk|iso|png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?|mp3|wav|ogg|m4a|mp4|m4v|mov|avi|webm|mkv|css|js|mjs|json|xml|rss|atom|txt|csv|xlsx?|docx?|pptx?|odt|ods|woff2?|ttf|otf|eot)$/i;
var LOGOUT_LIKE = /(?:^|[\/_\-.?=&])(?:log-?out|log-?off|sign-?out|sign-?off|logoff|signout|end-?session|destroy-?session)(?:$|[\/_\-.?=&])/i;
function normalizeUrl(input, base) {
  let url;
  try {
    url = base === void 0 ? new URL(input) : new URL(input, base);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  url.hash = "";
  return url.toString();
}
function classifyLink(href, pageUrl, origin) {
  const url = normalizeUrl(href, pageUrl);
  if (!url) return { ok: false, reason: "not-http", url: href };
  if (new URL(url).origin !== origin) return { ok: false, reason: "external", url };
  const parsed = new URL(url);
  if (NON_HTML_EXTENSION.test(parsed.pathname)) return { ok: false, reason: "non-html", url };
  if (LOGOUT_LIKE.test(parsed.pathname + parsed.search)) return { ok: false, reason: "logout", url };
  return { ok: true, url };
}
function isHtmlContentType(value) {
  if (!value) return true;
  const type = value.split(";")[0]?.trim().toLowerCase() ?? "";
  return type === "" || type === "text/html" || type === "application/xhtml+xml";
}

// lib/scan/crawl.ts
var defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function clampPages(requested) {
  if (!Number.isFinite(requested) || requested < 1) return 1;
  return Math.min(Math.floor(requested), MAX_CRAWL_PAGES);
}
async function crawl(options) {
  const start = normalizeUrl(options.startUrl);
  if (!start) throw new Error(`Invalid start URL: ${options.startUrl}`);
  const origin = new URL(start).origin;
  const maxPages = clampPages(options.maxPages);
  const sleep = options.sleep ?? defaultSleep;
  const crawling = maxPages > 1;
  const queue = [start];
  const seen = /* @__PURE__ */ new Set([start]);
  const pages = [];
  const skipped = [];
  const skippedSeen = /* @__PURE__ */ new Set();
  const skip = (entry) => {
    const key = entry.reason + " " + entry.url;
    if (skippedSeen.has(key)) return;
    skippedSeen.add(key);
    skipped.push(entry);
  };
  let visits = 0;
  while (queue.length > 0) {
    const url = queue.shift();
    if (pages.length >= maxPages) {
      skip({ url, reason: "cap" });
      continue;
    }
    if (!robotsAllowsUrl(options.robots, url)) {
      skip({ url, reason: "robots" });
      continue;
    }
    if (visits > 0 && options.delayMs > 0) await sleep(options.delayMs);
    visits += 1;
    options.log?.(`Scanning ${url}`);
    const outcome = await options.visit(url, crawling);
    if (outcome.finalUrl && normalizeUrl(outcome.finalUrl) && new URL(outcome.finalUrl).origin !== origin) {
      skip({ url, reason: "redirected-off-origin" });
      pages.push({ url, finalUrl: outcome.finalUrl, status: outcome.status, scanStatus: "skipped", error: "Redirected to another origin; not scanned." });
      continue;
    }
    if (outcome.result || outcome.analysed) {
      pages.push({ url, finalUrl: outcome.finalUrl, status: outcome.status, scanStatus: "complete", result: outcome.result });
    } else {
      pages.push({ url, finalUrl: outcome.finalUrl, status: outcome.status, scanStatus: "failed", error: outcome.error ?? "Page was not analysed." });
    }
    if (!crawling) continue;
    const base = outcome.finalUrl || url;
    for (const href of outcome.links) {
      const link = classifyLink(href, base, origin);
      if (!link.ok) {
        skip({ url: link.url, reason: link.reason, from: url });
        continue;
      }
      if (seen.has(link.url)) continue;
      seen.add(link.url);
      queue.push(link.url);
    }
  }
  return { pages, skipped };
}

// lib/scan/engines/dedupe.ts
function normalizeLocator(locator) {
  const value = locator.trim().replace(/^xpath=/, "");
  if (/^\/(?:[a-zA-Z][\w-]*(?:\[\d+\])?\/)*[a-zA-Z][\w-]*(?:\[\d+\])?$/.test(value) && value.slice(1).split("/").every((part) => /\[\d+\]$/.test(part) || /^(html|body)$/.test(part))) {
    return value.slice(1).split("/").map((part) => {
      const [, tag, index] = part.match(/^([\w-]+)(?:\[(\d+)\])?$/);
      return `${tag.toLowerCase()}:nth-of-type(${index ?? "1"})`;
    }).join(">");
  }
  return value.split(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g).map(
    (part, i) => i % 2 ? part : part.replace(/\s*([>+~])\s*/g, "$1").replace(/\s+/g, " ")
  ).join("").replace(/\[id=("|')([\w-]+)\1\]/g, "#$2");
}
function dedupeFindings(results) {
  const completed = results.filter((r) => r.status === "complete");
  const enginesByPage = /* @__PURE__ */ new Map();
  for (const r of completed) {
    const page = normalizeUrl(r.url) ?? r.url;
    const engines = enginesByPage.get(page) ?? /* @__PURE__ */ new Set();
    engines.add(r.engine);
    enginesByPage.set(page, engines);
  }
  const merged = /* @__PURE__ */ new Map();
  for (const result of completed) {
    if (result.status !== "complete") continue;
    for (const f of result.findings) {
      const page = normalizeUrl(result.url) ?? result.url;
      const locator = f.elementKey ?? normalizeLocator(f.selector);
      const scs = [...new Set(f.wcagSc.length ? f.wcagSc : WCAG_RULE_MAP[f.engine]?.[f.ruleId] ?? [])].sort();
      for (const sc of scs.length ? scs : [null]) {
        const key = JSON.stringify([page, locator || [f.engine, f.ruleId, merged.size], sc ?? `${f.engine}:${f.ruleId}`]);
        const existing = merged.get(key);
        const engines = [.../* @__PURE__ */ new Set([...existing?.engines ?? [], result.engine])].sort();
        const enginesRan = enginesByPage.get(page).size;
        const representative = existing && impactRank(existing.impact) >= impactRank(f.impact) ? existing : f;
        merged.set(key, {
          ...representative,
          url: page,
          wcagSc: sc ? [sc] : [],
          engines,
          confidence: { confirmedBy: engines.length, enginesRan, agreement: engines.length / enginesRan }
        });
      }
    }
  }
  return [...merged.values()];
}
function engineSummary(results) {
  return {
    used: [...new Set(results.filter((r) => r.status === "complete").map((r) => r.engine))].sort(),
    errored: results.flatMap((r) => r.status === "errored" ? [{ engine: r.engine, url: r.url, error: r.error }] : [])
  };
}
function attribution(finding2) {
  return finding2.engines ? `detected by: ${finding2.engines.join(", ")}; confirmed by ${finding2.confidence.confirmedBy} of ${finding2.confidence.enginesRan} engines` : "";
}

// lib/guidance.ts
var rules = {
  "color-contrast": { userImpact: "People with low vision or color-vision differences may not be able to read the affected content.", remediation: "Adjust foreground/background colors to meet the applicable contrast ratio; include hover, focus and disabled states where relevant.", verification: ["Re-run axe on the same page/state and affected selector.", "Measure rendered contrast (normally 4.5:1 text or 3:1 large text); review gradients and dynamic states manually."] },
  "image-alt": { userImpact: "People using screen readers may miss the purpose or information conveyed by the image.", remediation: "Provide contextual alternative text for informative images; use empty alt for genuinely decorative images.", verification: ["Re-run axe on the same page/state and selector.", "Listen with a screen reader and confirm the alternative conveys the same purpose without redundant detail."] },
  "button-name": { userImpact: "Screen-reader and voice-control users may not know the purpose of this button.", remediation: "Give the button a clear accessible name matching its visible purpose; prefer visible text.", verification: ["Inspect its computed accessible name and re-run axe.", "Operate it by keyboard and verify the announced name and resulting state with assistive technology."] },
  "label": { userImpact: "People using assistive technology may not know what input is expected.", remediation: "Associate a visible label with the control and expose instructions/errors programmatically.", verification: ["Inspect the accessible name and label association; re-run axe.", "Navigate and complete the field using keyboard and a screen reader, including validation errors."] }
};
function findingGuidance(f) {
  return { ...rules[f.ruleId] ?? { userImpact: `The affected element may prevent people using assistive technology from perceiving or operating the content (${f.ruleId}); assess the actual user journey.`, remediation: f.help + " Consult the rule guidance and review the actual component; automated advice is not a verified fix.", verification: ["Inspect the affected element and applicable rule guidance.", "Re-run the same rule on the same page/state and manually verify the relevant keyboard/screen-reader journey."] }, source: "Rule-based guidance; contextual human review required, not legal advice or certification." };
}

// lib/export-markdown.ts
function cell(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\\`*_\[\]()!|]/g, "\\$&").replace(/[\r\n]/g, " ");
}
function findingLine(finding2) {
  const selector = finding2.selector.replace(/`/g, "'");
  const impact = finding2.impact ?? "unspecified";
  const guidance = findingGuidance(finding2);
  return `- **${cell(finding2.ruleId)}** (${impact}) on \`${cell(finding2.url)}\` \u2014 \`${cell(selector)}\` \u2014 ${cell(finding2.help)} \u2014 ${cell(formatStandards(finding2.tags))}
  - Affected element: \`${cell(finding2.html)}\`; fingerprint: \`${cell(finding2.fingerprint)}\`.
  - User impact: ${cell(guidance.userImpact)}
  - Remediation: ${cell(guidance.remediation)}
  - Verification: ${guidance.verification.map(cell).join(" ")}${finding2.assessmentReason ? "\n  - Assessment: " + cell(finding2.assessmentReason) : ""}`;
}
function section(title, findings) {
  if (findings.length === 0) return [`## ${title}`, "", "None.", ""];
  return [`## ${title}`, "", ...findings.map(findingLine), ""];
}
function prSummaryMarkdown(input) {
  const lines = [
    `# A11yGate \u2014 ${cell(input.projectName)}`,
    ...input.synthetic ? ["SYNTHETIC evidence \u2014 not a real audit or customer assessment."] : [],
    "",
    `**Verdict: ${input.verdict}** (impact threshold: ${input.threshold})`,
    "",
    input.reason,
    "",
    "| Status | Count |",
    "| --- | --- |",
    `| New | ${input.diff.newFindings.length} |`,
    `| Fixed | ${input.diff.fixedFindings.length} |`,
    `| Still open | ${input.diff.stillOpen.length} |`,
    "",
    `Generated: ${input.generatedAt}`,
    "",
    "## Scan coverage and existing debt",
    "",
    `Coverage: ${input.diff.coverage?.status ?? "unverified"}. Existing debt: ${input.diff.stillOpen.length}; previously reported findings now unassessed: ${input.diff.unassessed?.length ?? 0}. PASS means no detected new threshold violation, not an accessible or certified service.`,
    ...(input.diff.coverage?.issues ?? []).map((i) => `- ${i.code === "missing-page" ? "Missing page" : cell(i.code)}: ${cell(i.page)} \u2014 ${cell(i.detail)}`),
    "",
    "### Unassessed scope",
    ...(input.diff.coverage?.unassessedScope ?? ["Scan coverage was not supplied."]).map((x) => "- " + cell(x)),
    "",
    ...section("New", input.diff.newFindings),
    ...section("Fixed", input.diff.fixedFindings),
    ...section("Still open", input.diff.stillOpen),
    ...section("Unassessed \u2014 not verified fixed", input.diff.unassessed ?? []),
    "## Manual evidence \u2014 separate from automated checks",
    "Self-reported, editable human assertions. Reviewer identity and freshness are not verified. These records do not improve the automated gate; absent evidence is unassessed.",
    ...input.manualChecks?.length ? input.manualChecks.map((c) => `- ${cell(c.id)}: ${cell(c.check)}; scope ${cell(c.scope)}; reviewer ${cell(c.reviewer)}; date ${cell(c.date)}; status **${c.status}**; notes ${cell(c.notes)}`) : ["No manual evidence recorded."],
    "",
    DISCLAIMER,
    LEGAL_DISCLAIMER,
    ""
  ];
  return lines.join("\n");
}

// lib/group.ts
function groupLabel(key, value) {
  if (key === "impact" && value === "unknown") return "unknown impact";
  return value;
}
function groupFindings(findings, by) {
  const groups = /* @__PURE__ */ new Map();
  for (const finding2 of findings) {
    const key = by === "rule" ? finding2.ruleId : by === "page" ? finding2.path : finding2.impact ?? "unknown";
    const existing = groups.get(key);
    if (existing) existing.push(finding2);
    else groups.set(key, [finding2]);
  }
  const grouped = [...groups.entries()].map(([key, items]) => ({
    key,
    label: groupLabel(by, key),
    findings: items
  }));
  if (by === "impact") {
    const rank = (key) => isImpact(key) ? impactRank(key) : 0;
    grouped.sort((a, b) => rank(b.key) - rank(a.key));
  } else {
    grouped.sort((a, b) => a.label.localeCompare(b.label));
  }
  return grouped;
}

// lib/scan/engines/normalized.ts
function normalizeAxeFinding(finding2) {
  const mapped = lookupStandards(finding2.tags).flatMap((hit) => hit.kind === "criterion" ? [hit.number] : []);
  return {
    engine: "axe",
    ruleId: finding2.ruleId,
    wcagSc: mapped.length ? mapped : [...WCAG_RULE_MAP.axe?.[finding2.ruleId] ?? []],
    impact: finding2.impact,
    url: finding2.url,
    selector: finding2.selector,
    snippet: finding2.html,
    helpUrl: finding2.helpUrl,
    compatibility: finding2
  };
}
function normalizeAxeResults(results) {
  return findingsFromResults([results]).map(normalizeAxeFinding);
}
function toLegacyFinding(normalized) {
  const f = normalized.compatibility;
  if (!f) throw new Error("Only axe findings have a legacy representation.");
  return {
    fingerprint: f.fingerprint,
    ruleId: f.ruleId,
    impact: f.impact,
    tags: f.tags,
    help: f.help,
    helpUrl: f.helpUrl,
    selector: f.selector,
    html: f.html,
    url: f.url,
    path: f.path,
    engineVersion: f.engineVersion,
    timestamp: f.timestamp
  };
}

// lib/scan/report.ts
var FAIL_ON_VALUES = [...IMPACTS, "none"];
function isFailOn(value) {
  return typeof value === "string" && FAIL_ON_VALUES.includes(value);
}
var AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa", "best-practice"];
var SCAN_BOUNDARIES = [
  "Only scan sites you own or are explicitly authorized to test.",
  "Automated testing only: axe-core detects a subset of WCAG issues. Absence of findings is not conformance, certification or legal advice.",
  "Read-only: pages were loaded without logging in, filling forms or clicking. Authenticated areas, interactions and dynamic states are unassessed.",
  "Only same-origin pages reachable through a[href] links (at most 20) were visited; robots.txt Disallow rules were honoured."
];
function emptyCounts() {
  return { critical: 0, serious: 0, moderate: 0, minor: 0, unknown: 0 };
}
function selectorsFor(result, ruleId, selector) {
  const node = result.violations.find((v) => v.id === ruleId)?.nodes.find((n) => n.target.join(" ") === selector);
  return node ? [...node.target] : [selector];
}
function toScanFinding(finding2, result) {
  const hits = lookupStandards(finding2.tags);
  const wcag = hits.flatMap(
    (hit) => hit.kind === "criterion" ? [{ number: hit.number, name: hit.name, level: hit.level, wcag: hit.wcag, en301549: hit.en301549 }] : []
  );
  return {
    pageUrl: finding2.url,
    ruleId: finding2.ruleId,
    impact: finding2.impact,
    selector: finding2.selector,
    selectors: selectorsFor(result, finding2.ruleId, finding2.selector),
    html: finding2.html,
    help: finding2.help,
    helpUrl: finding2.helpUrl,
    tags: finding2.tags,
    wcag,
    bestPractice: wcag.length === 0,
    fingerprint: finding2.fingerprint
  };
}
function gatingScanFindings(findings, failOn) {
  if (failOn === "none") return [];
  return findings.filter((f) => meetsThreshold(f.impact, failOn));
}
function scanExitCode(findings, failOn) {
  return gatingScanFindings(findings, failOn).length > 0 ? 1 : 0;
}
function buildScanReport(input) {
  const pages = [];
  const findings = [];
  const results = [];
  const totals = emptyCounts();
  for (const page of input.crawl.pages) {
    const byImpact = emptyCounts();
    let pageFindings = [];
    if (page.result) {
      results.push(page.result);
      pageFindings = normalizeAxeResults(page.result).map((f) => toScanFinding(toLegacyFinding(f), page.result));
      for (const f of pageFindings) {
        byImpact[f.impact ?? "unknown"] += 1;
        totals[f.impact ?? "unknown"] += 1;
      }
      findings.push(...pageFindings);
    }
    pages.push({
      url: page.url,
      finalUrl: page.finalUrl,
      status: page.status,
      scanStatus: page.scanStatus,
      ...page.error ? { error: page.error } : {},
      violations: page.result?.violations.length ?? 0,
      findings: pageFindings.length,
      byImpact
    });
  }
  const extended = input.engineResults?.some((e) => e.engine !== "axe") ?? false;
  if (extended) {
    const merged = dedupeFindings(input.engineResults ?? []);
    findings.splice(0, findings.length, ...merged.map((f) => {
      const wcag = CRITERIA.filter((c) => f.wcagSc.includes(c.number));
      return {
        pageUrl: f.url,
        ruleId: f.ruleId,
        impact: f.impact,
        selector: f.selector,
        selectors: [f.selector],
        html: f.snippet,
        help: f.compatibility?.help ?? f.ruleId,
        helpUrl: f.helpUrl,
        tags: wcag.map((c) => c.tag),
        wcag,
        bestPractice: f.wcagSc.length === 0,
        fingerprint: JSON.stringify([f.url, f.elementKey ?? f.selector, f.wcagSc, f.wcagSc.length ? "" : `${f.engine}:${f.ruleId}`]),
        engines: f.engines,
        confidence: f.confidence
      };
    }));
    for (const key of Object.keys(totals)) totals[key] = 0;
    for (const f of findings) totals[f.impact ?? "unknown"] += 1;
    for (const page of pages) {
      const pageFindings = findings.filter((f) => f.pageUrl === (normalizeUrl(page.url) ?? page.url));
      page.findings = pageFindings.length;
      page.violations = new Set(pageFindings.map((f) => f.ruleId)).size;
      page.byImpact = emptyCounts();
      for (const f of pageFindings) page.byImpact[f.impact ?? "unknown"] += 1;
    }
  }
  const gating = gatingScanFindings(findings, input.failOn);
  const engineErrors = (input.engineResults ?? []).filter((e) => e.status === "errored").length;
  const verdict = engineErrors ? "ERROR" : gating.length > 0 ? "FAIL" : "PASS";
  const reason = input.failOn === "none" ? "Reporting only (--fail-on none)." : gating.length === 0 ? `No finding is at or above ${input.failOn}.` : `${gating.length} finding${gating.length === 1 ? "" : "s"} at or above ${input.failOn}: ${[...new Set(gating.map((f) => f.ruleId))].join(", ")}.`;
  return {
    tool: "a11ygate",
    kind: "site-scan",
    schemaVersion: 1,
    version: input.version,
    axeVersion: results[0]?.testEngine.version ?? null,
    scannedAt: input.scannedAt,
    startUrl: input.startUrl,
    origin: new URL(input.startUrl).origin,
    verdict,
    failOn: input.failOn,
    reason: engineErrors ? `${engineErrors} engine execution(s) errored; coverage is incomplete.` : reason,
    ...extended ? { engineResults: input.engineResults, engines: engineSummary(input.engineResults ?? []), disclaimer: AUTOMATED_TESTING_DISCLAIMER } : {},
    options: { maxPages: input.maxPages, delayMs: input.delayMs, tags: [...AXE_TAGS], userAgent: input.userAgent, robots: input.robotsNote },
    counts: {
      pagesScanned: input.crawl.pages.filter((p) => p.scanStatus === "complete").length,
      pagesFailed: input.crawl.pages.filter((p) => p.scanStatus === "failed").length,
      skippedLinks: input.crawl.skipped.length,
      findings: findings.length,
      byImpact: totals
    },
    pages,
    skipped: input.crawl.skipped,
    findings,
    boundaries: SCAN_BOUNDARIES,
    results
  };
}
function groupByCriterion(findings) {
  const groups = /* @__PURE__ */ new Map();
  for (const finding2 of findings) {
    const keys = finding2.bestPractice ? [{ key: "best-practice", label: "Best practice (no WCAG success criterion mapped)" }] : finding2.wcag.map((c) => ({ key: c.number, label: `WCAG ${c.number} ${c.name} (${c.level}); EN 301 549 ${c.en301549}` }));
    for (const { key, label } of keys) {
      const group2 = groups.get(key) ?? { key, label, findings: [] };
      group2.findings.push(finding2);
      groups.set(key, group2);
    }
  }
  const order = (key) => key === "best-practice" ? [Infinity] : key.split(".").map(Number);
  return [...groups.values()].sort((a, b) => {
    const x = order(a.key);
    const y = order(b.key);
    for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
      const d = (x[i] ?? 0) - (y[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  });
}
function groupBySeverity(findings) {
  const asDiffed = findings.map((f, index) => ({
    fingerprint: String(index),
    ruleId: f.ruleId,
    impact: f.impact,
    tags: f.tags,
    help: f.help,
    helpUrl: f.helpUrl,
    selector: f.selector,
    html: f.html,
    url: f.pageUrl,
    path: f.pageUrl,
    engineVersion: "",
    timestamp: "",
    status: "new"
  }));
  return groupFindings(asDiffed, "impact").map((group2) => ({
    key: group2.key,
    label: group2.label,
    findings: group2.findings.map((f) => findings[Number(f.fingerprint)])
  }));
}
function sortFindings(findings) {
  return [...findings].sort((a, b) => impactRank(b.impact) - impactRank(a.impact) || a.pageUrl.localeCompare(b.pageUrl) || a.ruleId.localeCompare(b.ruleId));
}
function code(value) {
  return "`" + value.replace(/`/g, "'").replace(/[\r\n|]/g, " ") + "`";
}
function heading(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\r\n]/g, " ");
}
function mdFinding(f) {
  return `- **${cell(f.ruleId)}** (${f.impact ?? "unspecified"}) on ${code(f.pageUrl)} \u2014 ${code(f.selector)} \u2014 ${cell(f.help)}${f.engines ? " \u2014 " + attribution(f) : ""} \u2014 [rule guidance](${encodeURI(f.helpUrl).replace(/[()]/g, encodeURIComponent)})`;
}
function scanMarkdown(report) {
  const lines = [
    `# A11yGate site scan \u2014 ${cell(report.startUrl)}`,
    "",
    `**Verdict: ${report.verdict}** (fail on: ${report.failOn})`,
    "",
    cell(report.reason),
    "",
    "| Severity | Findings |",
    "| --- | --- |",
    ...["critical", "serious", "moderate", "minor", "unknown"].map((k) => `| ${k} | ${report.counts.byImpact[k]} |`),
    "",
    `Scanned: ${report.scannedAt}. Pages analysed: ${report.counts.pagesScanned}; failed: ${report.counts.pagesFailed}. axe-core ${report.axeVersion ?? "n/a"}; A11yGate ${report.version}.`,
    "",
    "## Pages",
    "",
    "| Page | HTTP | Status | Findings |",
    "| --- | --- | --- | --- |",
    ...report.pages.map((p) => `| ${cell(p.url)} | ${p.status ?? "\u2014"} | ${p.scanStatus}${p.error ? " \u2014 " + cell(p.error) : ""} | ${p.findings} |`),
    "",
    "## Findings by WCAG criterion",
    ""
  ];
  const byCriterion = groupByCriterion(report.findings);
  if (byCriterion.length === 0) lines.push("None detected.", "");
  for (const group2 of byCriterion) {
    lines.push(`### ${heading(group2.label)}`, "", ...sortFindings(group2.findings).map(mdFinding), "");
  }
  lines.push("## Findings by severity", "");
  const bySeverity = groupBySeverity(report.findings);
  if (bySeverity.length === 0) lines.push("None detected.", "");
  for (const group2 of bySeverity) {
    lines.push(`### ${heading(group2.label)} (${group2.findings.length})`, "", ...group2.findings.map(mdFinding), "");
  }
  const robotsSkipped = report.skipped.filter((s) => s.reason === "robots" || s.reason === "cap");
  if (robotsSkipped.length > 0) {
    lines.push("## Not scanned", "", ...robotsSkipped.map((s) => `- ${cell(s.url)} \u2014 ${s.reason === "robots" ? "disallowed by robots.txt" : "page cap reached"}`), "");
  }
  if (report.engines) lines.push(
    "## Engines used / engines errored",
    "",
    `Engines used: ${report.engines.used.join(", ") || "none"}.`,
    `Engines errored: ${report.engines.errored.length ? report.engines.errored.map((e) => `${cell(e.engine)} \u2014 ${code(e.url)} \u2014 ${cell(e.error)}`).join("; ") : "none"}.`,
    "",
    AUTOMATED_TESTING_DISCLAIMER,
    ""
  );
  lines.push("## Scope and boundaries", "", ...report.boundaries.map((b) => `- ${cell(b)}`), "", DISCLAIMER, LEGAL_DISCLAIMER, "");
  return lines.join("\n");
}
function esc(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function safeHref(url) {
  return /^https?:\/\//i.test(url) ? esc(url) : "#";
}
function htmlFinding(f) {
  return `<li><strong>${esc(f.ruleId)}</strong> <span class="impact ${esc(f.impact ?? "unknown")}">${esc(f.impact ?? "unspecified")}</span><br>Page: <code>${esc(f.pageUrl)}</code><br>Selector: <code>${esc(f.selector)}</code><br>${esc(f.help)}${f.engines ? "<br>" + esc(attribution(f)) : ""} \u2014 <a href="${safeHref(f.helpUrl)}">Rule guidance<span class="sr"> for ${esc(f.ruleId)}</span></a></li>`;
}
function htmlGroups(title, groups) {
  if (groups.length === 0) return `<h2>${esc(title)}</h2><p>None detected.</p>`;
  return `<h2>${esc(title)}</h2>` + groups.map((g) => `<section><h3>${esc(g.label)} (${g.findings.length})</h3><ul>${sortFindings(g.findings).map(htmlFinding).join("")}</ul></section>`).join("");
}
function scanHtml(report) {
  const counts = ["critical", "serious", "moderate", "minor", "unknown"].map((k) => `<tr><th scope="row">${k}</th><td>${report.counts.byImpact[k]}</td></tr>`).join("");
  const pages = report.pages.map((p) => `<tr><td><code>${esc(p.url)}</code></td><td>${p.status ?? "\u2014"}</td><td>${esc(p.scanStatus)}${p.error ? " \u2014 " + esc(p.error) : ""}</td><td>${p.findings}</td></tr>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>A11yGate site scan \u2014 ${esc(report.startUrl)}</title>
<style>
body{font:16px/1.5 system-ui,sans-serif;max-width:60rem;margin:0 auto;padding:1rem;color:#1a1a1a;background:#fff}
code{background:#f2f2f2;padding:0 .2em;word-break:break-all}
table{border-collapse:collapse;margin:1rem 0}th,td{border:1px solid #767676;padding:.25rem .5rem;text-align:left}
li{margin:.5rem 0}.impact{font-weight:600}.critical,.serious{color:#a00000}.moderate{color:#6b4e00}
.verdict{font-size:1.25rem;font-weight:700}.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
a{color:#0b57d0}
</style>
</head>
<body>
<main>
<h1>A11yGate site scan</h1>
<p>Start URL: <code>${esc(report.startUrl)}</code></p>
<p class="verdict">Verdict: ${esc(report.verdict)} (fail on: ${esc(report.failOn)})</p>
<p>${esc(report.reason)}</p>
<p>Scanned ${esc(report.scannedAt)}. Pages analysed: ${report.counts.pagesScanned}; failed: ${report.counts.pagesFailed}. axe-core ${esc(report.axeVersion ?? "n/a")}; A11yGate ${esc(report.version)}.</p>
<table><caption>Findings by severity</caption><thead><tr><th scope="col">Severity</th><th scope="col">Findings</th></tr></thead><tbody>${counts}</tbody></table>
<h2>Pages</h2>
<table><thead><tr><th scope="col">Page</th><th scope="col">HTTP</th><th scope="col">Status</th><th scope="col">Findings</th></tr></thead><tbody>${pages}</tbody></table>
${htmlGroups("Findings by WCAG criterion", groupByCriterion(report.findings))}
${htmlGroups("Findings by severity", groupBySeverity(report.findings))}
${report.engines ? "<h2>Engines used / engines errored</h2><p>Engines used: " + esc(report.engines.used.join(", ") || "none") + ".</p><p>Engines errored: " + (report.engines.errored.length ? report.engines.errored.map((e) => esc(`${e.engine} \u2014 ${e.url} \u2014 ${e.error}`)).join("; ") : "none") + ".</p><p>" + esc(AUTOMATED_TESTING_DISCLAIMER) + "</p>\n" : ""}<h2>Scope and boundaries</h2>
<ul>${report.boundaries.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
<p>${esc(DISCLAIMER)}</p>
<p>${esc(LEGAL_DISCLAIMER)}</p>
</main>
</body>
</html>
`;
}

// lib/scan/engines/axe.ts
function flattenTarget(target) {
  return target.map((part) => Array.isArray(part) ? part.map(String).join(" ") : String(part)).filter((s) => s.trim().length > 0);
}
function toAxeResults(url, axe, userAgent) {
  const violations = axe.violations.map((v) => ({
    id: v.id,
    impact: isImpact(v.impact) ? v.impact : null,
    tags: [...v.tags],
    help: v.help || v.id,
    helpUrl: v.helpUrl || `https://dequeuniversity.com/rules/axe/${v.id}`,
    nodes: v.nodes.map((n) => ({ target: flattenTarget(n.target), html: n.html, ...n.impact !== void 0 ? { impact: isImpact(n.impact) ? n.impact : null } : {} })).filter((n) => n.target.length > 0)
  })).filter((v) => v.nodes.length > 0);
  return {
    url,
    timestamp: new Date(axe.timestamp).toISOString(),
    testEngine: { version: axe.testEngine.version },
    violations,
    toolOptions: { runOnly: { type: "tag", values: [...AXE_TAGS] } },
    scanConfig: { source: "a11ygate scan", readOnly: true, browser: "chromium", userAgent },
    ...axe.testEnvironment && typeof axe.testEnvironment === "object" ? { testEnvironment: axe.testEnvironment } : {},
    scanStatus: "complete"
  };
}
function createAxeEngine(analyze, userAgent) {
  return {
    id: "axe",
    displayName: "axe-core",
    run: async (context, url) => toAxeResults(url, await analyze(context), userAgent),
    normalize: normalizeAxeResults
  };
}

// lib/scan/engines/types.ts
async function runEngine(engine, context, url, timeoutMs = 3e4) {
  let timer;
  try {
    const native = await Promise.race([engine.run(context, url), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Engine ${engine.id} timed out after ${timeoutMs}ms.`)), timeoutMs);
    })]);
    return { engine: engine.id, status: "complete", native, findings: engine.normalize(native) };
  } catch (error) {
    return { engine: engine.id, status: "errored", error: error instanceof Error ? error.message.split("\n")[0] : "Engine failed." };
  } finally {
    clearTimeout(timer);
  }
}

// lib/export-junit.ts
function xmlSafe(value) {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}
function escapeXml(value) {
  return xmlSafe(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function groupFindingsByRuleAndPage(findings) {
  const groups = /* @__PURE__ */ new Map();
  for (const finding2 of findings) {
    const key = `${finding2.pageUrl}\0${finding2.ruleId}`;
    const existing = groups.get(key);
    if (existing) {
      existing.findings.push(finding2);
      continue;
    }
    groups.set(key, { classname: finding2.pageUrl, name: finding2.ruleId, findings: [finding2] });
  }
  return [...groups.values()].sort(
    (a, b) => a.classname.localeCompare(b.classname) || a.name.localeCompare(b.name)
  );
}
function failureMessage(group2) {
  const first = group2.findings[0];
  const impact = first?.impact ?? "unspecified";
  const help = first?.help ?? group2.name;
  const count = group2.findings.length;
  const extra = count > 1 ? ` (${count} instances)` : "";
  return `${group2.name}: ${help} (${impact})${extra}`;
}
function failureBody(group2) {
  const lines = [FORMAT_DISCLAIMER, failureMessage(group2)];
  for (const finding2 of group2.findings) {
    const wcag = finding2.wcag.length > 0 ? finding2.wcag.map((item) => `WCAG ${item.number} ${item.name} (${item.level})`).join("; ") : "best practice (no WCAG success criterion mapped)";
    lines.push(
      `- ${finding2.pageUrl} \u2014 ${finding2.selector} \u2014 ${wcag}`,
      `  element: ${finding2.html}`,
      attribution(finding2),
      finding2.helpUrl ? `  guidance: ${finding2.helpUrl}` : "",
      finding2.status ? `  status: ${finding2.status}` : ""
    );
  }
  return lines.filter((line) => line.length > 0).join("\n");
}
function property(name, value) {
  return `    <property name="${escapeXml(name)}" value="${escapeXml(value)}"/>`;
}
function toJunit(report) {
  const failed = groupFindingsByRuleAndPage(report.findings);
  const failedPages = new Set(failed.map((item) => item.classname));
  const passing = report.pages.filter((page) => !failedPages.has(page)).map((page) => ({ classname: page, name: "no-violations", findings: [] }));
  const cases = [...failed, ...passing].sort(
    (a, b) => a.classname.localeCompare(b.classname) || a.name.localeCompare(b.name)
  );
  const failures = failed.length;
  const tests = cases.length;
  const timestamp = escapeXml(report.generatedAt);
  const properties = [
    property("disclaimer", FORMAT_DISCLAIMER),
    property("tool", report.toolName),
    property("version", report.version),
    property("verdict", report.verdict),
    property("reason", report.reason),
    property("command", report.command)
  ];
  if (report.engines) properties.push(property("engines-used", report.engines.used.join(", ")), property("engines-errored", JSON.stringify(report.engines.errored)));
  if (report.startUrl) properties.push(property("startUrl", report.startUrl));
  if (report.projectName) properties.push(property("projectName", report.projectName));
  const testcases = cases.map((item) => {
    const attrs = `classname="${escapeXml(item.classname)}" name="${escapeXml(item.name)}" time="0"`;
    if (item.findings.length === 0) return `    <testcase ${attrs}/>`;
    const type = escapeXml(item.name);
    const message = escapeXml(failureMessage(item));
    const body = escapeXml(failureBody(item));
    return `    <testcase ${attrs}>
      <failure message="${message}" type="${type}">${body}</failure>
    </testcase>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="A11yGate" tests="${tests}" failures="${failures}" errors="0" skipped="0" time="0" timestamp="${timestamp}" hostname="a11ygate">
  <properties>
${properties.join("\n")}
  </properties>
${testcases.join("\n")}
</testsuite>
`;
}

// lib/export-sarif.ts
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
var SARIF_SCHEMA_URL = "https://json.schemastore.org/sarif-2.1.0.json";
var SARIF_VERSION = "2.1.0";
var GITHUB_SARIF_LIMITS = {
  /** Gzip-compressed upload cap. Uploads over this are rejected. */
  maxGzipBytes: 10 * 1024 * 1024,
  maxRunsPerFile: 20,
  maxResultsPerRun: 25e3,
  /** GitHub keeps only the top N results per run, prioritized by severity. */
  retainedResultsPerRun: 5e3,
  maxRulesPerRun: 25e3,
  maxTagsPerRule: 20,
  displayedTagsPerRule: 10,
  maxLocationsPerResult: 1e3,
  displayedLocationsPerResult: 100,
  docs: {
    sarifSupport: "https://docs.github.com/en/code-security/reference/code-scanning/sarif-files/sarif-support",
    fileTooLarge: "https://docs.github.com/en/code-security/reference/code-scanning/sarif-files/troubleshoot-sarif-uploads/file-too-large",
    resultsExceedLimit: "https://docs.github.com/en/code-security/reference/code-scanning/sarif-files/troubleshoot-sarif-uploads/results-exceed-limit",
    uploadSarif: "https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/integrate-with-existing-tools/upload-sarif-file"
  }
};
var DEFAULT_ENGINE = "axe";
function sarifLevel(impact) {
  if (impact === "critical" || impact === "serious") return "error";
  if (impact === "moderate") return "warning";
  return "note";
}
function gzipByteLength(text) {
  return gzipSync(Buffer.from(text, "utf8")).length;
}
function automationDetailsId(engine) {
  const slug = engine.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || DEFAULT_ENGINE;
  return `a11ygate/${slug}/`;
}
function primaryLocationLineHash(finding2) {
  const uri = identityUri(finding2);
  const line = finding2.source?.startLine ?? 1;
  const basis = finding2.fingerprint ?? [finding2.ruleId, uri, finding2.selector, String(line)].join("\0");
  const hash = createHash("sha256").update(basis).digest("hex").slice(0, 16);
  return `${hash}:${line}`;
}
function identityUri(finding2) {
  if (finding2.source?.file) return finding2.source.file.replace(/\\/g, "/");
  return finding2.pageUrl;
}
function hasUriScheme(value) {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
}
function sanitizePathSegment(segment) {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    decoded = segment;
  }
  const clean = decoded.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!clean || clean === "." || clean === "..") return "_";
  return clean;
}
function githubArtifactUri(finding2) {
  if (finding2.source?.file) {
    const file = finding2.source.file.replace(/\\/g, "/");
    if (!hasUriScheme(file)) return file.replace(/^\/+/, "");
  }
  return pageUrlToRepoRelativePath(finding2.pageUrl);
}
function pageUrlToRepoRelativePath(pageUrl) {
  try {
    const url = new URL(pageUrl);
    const host = sanitizePathSegment(url.host || "page");
    let pathname = url.pathname || "/";
    if (pathname.endsWith("/")) pathname += "index.html";
    const last = pathname.split("/").filter(Boolean).pop() ?? "";
    if (!last.includes(".")) pathname = `${pathname.replace(/\/$/, "")}/index.html`;
    const segments = pathname.split("/").filter(Boolean).map(sanitizePathSegment);
    const extra = `${url.search}${url.hash}`;
    if (extra) {
      const lastSeg = segments.pop() ?? "index.html";
      const dot = lastSeg.lastIndexOf(".");
      const stem = dot > 0 ? lastSeg.slice(0, dot) : lastSeg;
      const ext = dot > 0 ? lastSeg.slice(dot) : ".html";
      segments.push(`${stem}-${createHash("sha256").update(extra).digest("hex").slice(0, 8)}${ext}`);
    }
    return ["a11ygate-pages", host, ...segments].join("/");
  } catch {
    return `a11ygate-pages/unknown/${createHash("sha256").update(pageUrl).digest("hex").slice(0, 16)}.html`;
  }
}
function defaultEngine(report) {
  const used = report.engines?.used ?? [];
  if (used.length === 1 && used[0]) return used[0];
  if (used.includes(DEFAULT_ENGINE)) return DEFAULT_ENGINE;
  return used[0] ?? DEFAULT_ENGINE;
}
function enginesFor(finding2, fallback) {
  if (finding2.engines && finding2.engines.length > 0) return [...new Set(finding2.engines)];
  return [fallback];
}
function wcagTags(wcag, tags, maxTags) {
  const preferred = ["accessibility"];
  for (const item of wcag) preferred.push(`WCAG ${item.number}`);
  const rest = [];
  for (const tag of tags) {
    if (tag !== "accessibility" && !preferred.includes(tag)) rest.push(tag);
  }
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const tag of [...preferred, ...rest]) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= maxTags) break;
  }
  return out;
}
function uniqueRules(findings) {
  const byId = /* @__PURE__ */ new Map();
  for (const finding2 of findings) {
    const existing = byId.get(finding2.ruleId);
    if (!existing || impactRank(finding2.impact) > impactRank(existing.impact)) {
      byId.set(finding2.ruleId, finding2);
    }
  }
  return [...byId.values()].sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}
function artifactLocation(finding2) {
  return { uri: githubArtifactUri(finding2) };
}
function region(finding2) {
  if (finding2.source) {
    return {
      startLine: finding2.source.startLine,
      ...finding2.source.startColumn !== void 0 ? { startColumn: finding2.source.startColumn } : {},
      ...finding2.source.endLine !== void 0 ? { endLine: finding2.source.endLine } : {},
      ...finding2.source.endColumn !== void 0 ? { endColumn: finding2.source.endColumn } : {},
      snippet: { text: finding2.html },
      message: { text: `selector: ${finding2.selector}` }
    };
  }
  return {
    snippet: { text: finding2.html },
    message: { text: `selector: ${finding2.selector}` }
  };
}
function taxaFor(findings) {
  const byId = /* @__PURE__ */ new Map();
  for (const finding2 of findings) {
    for (const item of finding2.wcag) {
      if (!byId.has(item.number)) byId.set(item.number, item);
    }
  }
  return [...byId.values()].sort((a, b) => a.number.localeCompare(b.number, void 0, { numeric: true })).map((item) => ({
    id: item.number,
    name: item.name,
    shortDescription: { text: `WCAG ${item.wcag} ${item.number} ${item.name} (${item.level})` }
  }));
}
function compareFindings(a, b) {
  return a.pageUrl.localeCompare(b.pageUrl) || a.ruleId.localeCompare(b.ruleId) || a.selector.localeCompare(b.selector);
}
function compareBySeverityThenStable(a, b) {
  const rank = impactRank(b.impact) - impactRank(a.impact);
  if (rank !== 0) return rank;
  return compareFindings(a, b);
}
function toSarifResult(finding2, ruleIndex) {
  const index = ruleIndex.get(finding2.ruleId);
  const hash = primaryLocationLineHash(finding2);
  return {
    ruleId: finding2.ruleId,
    ...index !== void 0 ? { ruleIndex: index } : {},
    level: sarifLevel(finding2.impact),
    message: {
      text: `${finding2.help} (${finding2.impact ?? "unspecified"}) at ${finding2.selector} on ${finding2.pageUrl}${finding2.engines ? "; " + attribution(finding2) : ""}`
    },
    locations: [
      {
        physicalLocation: {
          artifactLocation: artifactLocation(finding2),
          region: region(finding2)
        },
        logicalLocations: [
          {
            fullyQualifiedName: finding2.selector,
            kind: "element",
            name: finding2.selector
          },
          {
            fullyQualifiedName: finding2.pageUrl,
            kind: "url",
            name: finding2.pageUrl
          }
        ]
      }
    ],
    fingerprints: finding2.fingerprint ? { a11ygate: finding2.fingerprint } : { a11ygate: hash },
    partialFingerprints: {
      primaryLocationLineHash: hash,
      ...finding2.fingerprint ? { a11ygate: finding2.fingerprint } : {}
    },
    properties: {
      ...finding2.engines ? { engines: finding2.engines, confidence: finding2.confidence } : {},
      selector: finding2.selector,
      impact: finding2.impact ?? "unspecified",
      tags: finding2.tags,
      wcag: finding2.wcag.map((item) => item.number),
      pageUrl: finding2.pageUrl,
      ...finding2.status ? { status: finding2.status } : {}
    }
  };
}
function buildRun(report, engine, findings, limits) {
  const kept = findings.slice().sort(compareBySeverityThenStable);
  const droppedForCap = Math.max(0, kept.length - limits.retainedResultsPerRun);
  if (kept.length > limits.retainedResultsPerRun) kept.length = limits.retainedResultsPerRun;
  if (kept.length > limits.maxResultsPerRun) kept.length = limits.maxResultsPerRun;
  const rules2 = uniqueRules(kept).slice(0, limits.maxRulesPerRun);
  const ruleIndex = new Map(rules2.map((rule, index) => [rule.ruleId, index]));
  const taxa = taxaFor(kept);
  const taxonIndex = new Map(taxa.map((taxon, index) => [taxon.id, index]));
  const driverRules = rules2.map((rule) => {
    const relationships = rule.wcag.map((item) => taxonIndex.get(item.number)).filter((index) => index !== void 0).map((index) => ({
      target: { id: taxa[index].id, index, toolComponent: { name: "WCAG", index: 0 } },
      kinds: ["relevant"]
    }));
    return {
      id: rule.ruleId,
      name: rule.ruleId,
      shortDescription: { text: rule.help },
      fullDescription: { text: rule.help },
      helpUri: rule.helpUrl,
      help: { text: rule.help },
      defaultConfiguration: { level: sarifLevel(rule.impact) },
      properties: { tags: wcagTags(rule.wcag, rule.tags, limits.maxTagsPerRule), impact: rule.impact ?? "unspecified" },
      ...relationships.length > 0 ? { relationships } : {}
    };
  });
  const results = kept.map((finding2) => {
    const result = toSarifResult(finding2, ruleIndex);
    if (result.locations.length > limits.maxLocationsPerResult) {
      result.locations = result.locations.slice(0, limits.maxLocationsPerResult);
    }
    return result;
  });
  return {
    tool: {
      driver: {
        name: "A11yGate",
        version: report.version,
        informationUri: SITE_URL,
        rules: driverRules
      }
    },
    automationDetails: { id: automationDetailsId(engine) },
    ...taxa.length > 0 ? {
      taxonomies: [
        {
          name: "WCAG",
          informationUri: "https://www.w3.org/WAI/standards-guidelines/wcag/",
          taxa
        }
      ]
    } : {},
    results,
    properties: {
      disclaimer: FORMAT_DISCLAIMER,
      ...report.engines ? { enginesUsed: report.engines.used, enginesErrored: report.engines.errored } : {},
      verdict: report.verdict,
      reason: report.reason,
      command: report.command,
      engine,
      ...report.startUrl ? { startUrl: report.startUrl } : {},
      ...report.projectName ? { projectName: report.projectName } : {},
      ...droppedForCap > 0 ? {
        truncatedResults: droppedForCap,
        retainedResults: results.length,
        truncationNote: `Kept the top ${results.length} results by severity (GitHub retains at most ${limits.retainedResultsPerRun} per run).`
      } : {}
    }
  };
}
function resolveLimits(overrides) {
  return {
    maxGzipBytes: overrides?.maxGzipBytes ?? GITHUB_SARIF_LIMITS.maxGzipBytes,
    maxRunsPerFile: overrides?.maxRunsPerFile ?? GITHUB_SARIF_LIMITS.maxRunsPerFile,
    maxResultsPerRun: overrides?.maxResultsPerRun ?? GITHUB_SARIF_LIMITS.maxResultsPerRun,
    retainedResultsPerRun: overrides?.retainedResultsPerRun ?? GITHUB_SARIF_LIMITS.retainedResultsPerRun,
    maxRulesPerRun: overrides?.maxRulesPerRun ?? GITHUB_SARIF_LIMITS.maxRulesPerRun,
    maxTagsPerRule: overrides?.maxTagsPerRule ?? GITHUB_SARIF_LIMITS.maxTagsPerRule,
    maxLocationsPerResult: overrides?.maxLocationsPerResult ?? GITHUB_SARIF_LIMITS.maxLocationsPerResult
  };
}
function stringify(log) {
  return `${JSON.stringify(log, null, 2)}
`;
}
function shrinkSnippets(log, maxChars) {
  const clip = (value) => value && value.length > maxChars ? `${value.slice(0, maxChars)}\u2026` : value;
  for (const run2 of log.runs) {
    for (const rule of run2.tool.driver.rules) {
      const short = rule.shortDescription;
      const full = rule.fullDescription;
      const help = rule.help;
      if (short?.text) short.text = clip(short.text);
      if (full?.text) full.text = clip(full.text);
      if (help?.text) help.text = clip(help.text);
    }
    for (const result of run2.results) {
      if (result.message.text.length > maxChars) {
        result.message.text = `${result.message.text.slice(0, maxChars)}\u2026`;
      }
      for (const location of result.locations) {
        const snippet = location.physicalLocation.region.snippet;
        if (snippet && snippet.text.length > maxChars) {
          snippet.text = `${snippet.text.slice(0, maxChars)}\u2026`;
        }
      }
    }
  }
}
function dropOrphanRules(run2) {
  const used = new Set(run2.results.map((result) => result.ruleId));
  run2.tool.driver.rules = run2.tool.driver.rules.filter((rule) => used.has(String(rule.id)));
  const ruleIndex = new Map(run2.tool.driver.rules.map((rule, index) => [String(rule.id), index]));
  for (const result of run2.results) {
    const index = ruleIndex.get(result.ruleId);
    if (index === void 0) delete result.ruleIndex;
    else result.ruleIndex = index;
  }
}
var LEVEL_RANK = { note: 0, warning: 1, error: 2 };
function dropLowestSeverityResult(log) {
  let chosen;
  let chosenRank = 99;
  for (const run2 of log.runs) {
    for (let index = run2.results.length - 1; index >= 0; index--) {
      const value = LEVEL_RANK[run2.results[index].level];
      if (value < chosenRank) {
        chosenRank = value;
        chosen = { run: run2, index };
      }
    }
  }
  if (!chosen) return false;
  chosen.run.results.splice(chosen.index, 1);
  dropOrphanRules(chosen.run);
  chosen.run.properties.truncatedForUploadSize = (chosen.run.properties.truncatedForUploadSize ?? 0) + 1;
  chosen.run.properties.retainedResults = chosen.run.results.length;
  return true;
}
function applyGitHubSizeBudget(log, maxGzipBytes) {
  if (gzipByteLength(stringify(log)) <= maxGzipBytes) return log;
  shrinkSnippets(log, 256);
  if (gzipByteLength(stringify(log)) <= maxGzipBytes) return log;
  while (gzipByteLength(stringify(log)) > maxGzipBytes) {
    if (!dropLowestSeverityResult(log)) break;
  }
  if (gzipByteLength(stringify(log)) > maxGzipBytes) {
    shrinkSnippets(log, 0);
    for (const run2 of log.runs) {
      for (const result of run2.results) {
        for (const location of result.locations) {
          delete location.physicalLocation.region.snippet;
        }
      }
    }
  }
  return log;
}
function toSarif(report, options = {}) {
  const limits = resolveLimits(options.limits);
  const fallback = defaultEngine(report);
  const grouped = /* @__PURE__ */ new Map();
  for (const finding2 of report.findings) {
    for (const engine of enginesFor(finding2, fallback)) {
      const list = grouped.get(engine) ?? [];
      list.push(finding2);
      grouped.set(engine, list);
    }
  }
  if (grouped.size === 0) grouped.set(fallback, []);
  const engineOrder = report.engines?.used?.length ? [...report.engines.used, ...[...grouped.keys()].filter((engine) => !report.engines?.used.includes(engine)).sort()] : [...grouped.keys()].sort((a, b) => a === DEFAULT_ENGINE ? -1 : b === DEFAULT_ENGINE ? 1 : a.localeCompare(b));
  const runs = [];
  for (const engine of engineOrder) {
    const findings = grouped.get(engine);
    if (!findings) continue;
    runs.push(buildRun(report, engine, findings, limits));
    if (runs.length >= limits.maxRunsPerFile) break;
  }
  if (runs.length === 0) runs.push(buildRun(report, fallback, [], limits));
  const log = {
    $schema: SARIF_SCHEMA_URL,
    version: SARIF_VERSION,
    runs
  };
  applyGitHubSizeBudget(log, limits.maxGzipBytes);
  return stringify(log);
}

// packages/cli/src/scan.ts
var DEFAULT_DELAY_MS = 1e3;
var NAVIGATION_TIMEOUT_MS = 3e4;
var VALUE_FLAGS2 = /* @__PURE__ */ new Set(["--fail-on", "--out-dir", "--json", "--markdown", "--html", "--delay-ms", "--engines", "--format"]);
function parseScanArgs(argv) {
  const options = { help: false, url: "", maxPages: 1, failOn: "serious", delayMs: DEFAULT_DELAY_MS, formats: [], warnings: [], engines: ["axe"] };
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--help" || token === "-h") {
      options.help = true;
      continue;
    }
    if (!token.startsWith("-") || token === "-") {
      positionals.push(token);
      continue;
    }
    const eq = token.indexOf("=");
    const name = eq === -1 ? token : token.slice(0, eq);
    const inline = eq === -1 ? void 0 : token.slice(eq + 1);
    if (name === "--crawl") {
      let text = inline;
      if (text === void 0 && /^\d+$/.test(argv[index + 1] ?? "")) {
        text = argv[index + 1];
        index += 1;
      }
      if (text === void 0) {
        options.maxPages = MAX_CRAWL_PAGES;
        continue;
      }
      if (!/^\d+$/.test(text) || Number(text) < 1) return { ok: false, error: "--crawl needs a whole number of pages from 1 to 20." };
      const requested = Number(text);
      if (requested > MAX_CRAWL_PAGES) options.warnings.push(`--crawl ${requested} exceeds the hard maximum; scanning at most ${MAX_CRAWL_PAGES} pages.`);
      options.maxPages = clampPages(requested);
      continue;
    }
    if (!VALUE_FLAGS2.has(name)) return { ok: false, error: `Unknown scan option ${token}.` };
    const value = inline !== void 0 ? inline : argv[index + 1];
    if (inline === void 0) index += 1;
    if (value === void 0 || value.length === 0 || value.startsWith("-") && !(name === "--json" && value === "-")) {
      return { ok: false, error: `${name} needs a value.` };
    }
    if (name === "--engines") {
      const ids = value.split(",");
      if (ids.some((id) => !ENGINE_IDS.includes(id)) || new Set(ids).size !== ids.length) {
        return { ok: false, error: `Unknown or duplicate --engines "${value}". Use a comma-separated list of axe,htmlcs,ibm,lighthouse.` };
      }
      options.engines = ids;
    } else if (name === "--fail-on") {
      if (!isFailOn(value)) return { ok: false, error: `Unknown --fail-on "${value}". Use minor, moderate, serious, critical, or none.` };
      options.failOn = value;
    } else if (name === "--delay-ms") {
      if (!/^\d+$/.test(value) || Number(value) > 6e4) return { ok: false, error: "--delay-ms needs a whole number of milliseconds from 0 to 60000." };
      options.delayMs = Number(value);
    } else if (name === "--out-dir") options.outDir = value;
    else if (name === "--json") options.json = value;
    else if (name === "--markdown") options.markdown = value;
    else if (name === "--html") options.html = value;
    else {
      const parsed = parseFormatList(value);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      options.formats = mergeFormats(options.formats, parsed.formats);
    }
  }
  if (options.help) return { ok: true, options };
  if (positionals.length === 0) return { ok: false, error: "Pass the URL to scan: a11ygate scan <url>." };
  if (positionals.length > 1) return { ok: false, error: `Unexpected argument ${positionals[1]}.` };
  const url = normalizeUrl(positionals[0]);
  if (!url) return { ok: false, error: `Not a valid http(s) URL: ${positionals[0]}` };
  options.url = url;
  if (options.outDir && (options.json || options.markdown || options.html)) {
    return { ok: false, error: "Use either --out-dir or --json/--markdown/--html, not both." };
  }
  if (options.formats.length > 0 && !options.outDir) {
    return { ok: false, error: "--format requires --out-dir." };
  }
  return { ok: true, options };
}
function scanHelpText() {
  return `a11ygate scan \u2014 load live pages in headless Chromium and run axe-core

Usage:
  a11ygate scan <url> [--crawl [n]] [--fail-on <impact>] [--out-dir <dir>]
                      [--format junit|sarif|json|md] [--json <file>] [--markdown <file>]
                      [--html <file>] [--delay-ms <ms>]

Options:
  --engines <ids>      Default: axe. Opt in: --engines axe,htmlcs,ibm,lighthouse.
  --crawl [n]          Breadth-first crawl of same-origin a[href] links, up to n pages
                       (default and hard maximum: ${MAX_CRAWL_PAGES}). Without --crawl only <url> is scanned.
  --fail-on <impact>   minor, moderate, serious, critical, or none. Default: serious.
  --out-dir <dir>      Write a11ygate-scan.json, a11ygate-scan.md and a11ygate-scan.html here.
  --format <fmt>       Also write junit, sarif, json, or md into --out-dir. Repeat or comma-separate.
                       Exit codes are unchanged.
  --json <file>        Write the JSON report (use - to print JSON instead of Markdown).
  --markdown <file>    Write the Markdown summary. It is printed to stdout unless --json -.
  --html <file>        Write a self-contained HTML summary.
  --delay-ms <ms>      Pause between page loads. Default: ${DEFAULT_DELAY_MS}.

Requires the optional peer dependencies:
  npm install --save-dev playwright @axe-core/playwright && npx playwright install chromium

Opt-in engine peers (install only those selected):
  npm install --save-dev html_codesniffer accessibility-checker-engine lighthouse puppeteer-core
IBM uses the installed engine's offline rules; Lighthouse snapshots the existing page.
See docs/engines.md for licenses and engine result/error reporting.

Boundaries: only scan sites you own or are authorized to test. Read-only (no clicks, forms or
login), same-origin only, honours robots.txt, identifies itself as A11yGate. Automated testing
finds a subset of issues; PASS is not conformance, certification or legal advice.

Automated testing only. Not a WCAG audit, certification or legal advice.

Exit codes:
  0  No finding is at or above --fail-on.
  1  At least one finding is at or above --fail-on.
  2  Bad arguments, missing browser/dependencies, or the start page is unreachable.
`;
}
var ScanSetupError = class extends Error {
};
var INSTALL_HINT = "a11ygate scan needs the optional peer dependencies playwright and @axe-core/playwright.\nInstall them with: npm install --save-dev playwright @axe-core/playwright && npx playwright install chromium\n";
function isModuleNotFound(error) {
  const code2 = error?.code;
  return code2 === "ERR_MODULE_NOT_FOUND" || code2 === "MODULE_NOT_FOUND";
}
var playwrightEngine = async ({ userAgent, origin, engines = ["axe"] }) => {
  const extended = engines.length !== 1 || engines[0] !== "axe";
  let playwright;
  let axeModule;
  try {
    playwright = await import("playwright");
    if (engines.includes("axe") && !extended) axeModule = await import("@axe-core/playwright");
  } catch (error) {
    if (isModuleNotFound(error)) throw new ScanSetupError(INSTALL_HINT);
    throw error;
  }
  let nativeAxe;
  const axeEngine = engines.includes("axe") ? createAxeEngine(async (page) => {
    if (!axeModule) {
      try {
        axeModule = await import("@axe-core/playwright");
      } catch {
        throw new Error("Missing @axe-core/playwright. Install with: npm install --save-dev @axe-core/playwright");
      }
    }
    const AxeBuilder = axeModule.default ?? axeModule.AxeBuilder;
    nativeAxe = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).analyze();
    return nativeAxe;
  }, userAgent) : void 0;
  const engineResults = [];
  const rawEngineResults = [];
  let debugPort;
  if (engines.includes("lighthouse")) {
    const server = createServer();
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    debugPort = server.address().port;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  const browserURL = debugPort ? `http://127.0.0.1:${debugPort}` : void 0;
  const optionalEngines = { htmlcs: createHtmlcsEngine(), ibm: createIbmEngine(), lighthouse: createLighthouseEngine() };
  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true, ...debugPort ? { args: [`--remote-debugging-port=${debugPort}`, "--remote-debugging-address=127.0.0.1"] } : {} });
  } catch (error) {
    const detail = error instanceof Error ? error.message.split("\n")[0] : "unknown error";
    throw new ScanSetupError(`Could not launch headless Chromium (${detail}).
Install it with: npx playwright install chromium
`);
  }
  const context = await browser.newContext({ userAgent, acceptDownloads: false, serviceWorkers: "block", javaScriptEnabled: true });
  return {
    rawEngineResults,
    ...extended ? { engineResults } : {},
    visit: async (url, collectLinks) => {
      const page = await context.newPage();
      page.on("dialog", (dialog) => void dialog.dismiss().catch(() => void 0));
      try {
        const response = await page.goto(url, { waitUntil: "load", timeout: NAVIGATION_TIMEOUT_MS });
        const status = response?.status() ?? null;
        const finalUrl = page.url();
        const contentType = response?.headers()["content-type"] ?? null;
        if (new URL(finalUrl).origin !== origin) return { status, finalUrl, contentType, links: [] };
        if (status !== null && status >= 400) return { status, finalUrl, contentType, links: [], error: `HTTP ${status}` };
        if (!isHtmlContentType(contentType)) return { status, finalUrl, contentType, links: [], error: `Not an HTML page (${contentType}).` };
        const links = collectLinks ? await page.$$eval("a[href]", (anchors) => anchors.map((a) => a.href)) : [];
        let result;
        for (const id of engines) {
          if (id === "axe" && axeEngine) {
            nativeAxe = void 0;
            const execution = await runEngine(axeEngine, page, url);
            rawEngineResults.push({ ...execution, ...execution.status === "complete" ? { native: nativeAxe } : {}, url });
            if (extended && execution.status === "complete") execution.findings = await resolveElementKeys(page, execution.findings);
            if (!extended && execution.status === "errored") throw new Error(execution.error);
            if (execution.status === "complete") result = execution.native;
            if (extended) engineResults.push(execution.status === "complete" ? { url, engine: id, status: "complete", findings: execution.findings } : { url, engine: id, status: "errored", error: execution.error });
          } else if (id !== "axe") {
            const execution = await runEngine(optionalEngines[id], { page, browserURL }, url);
            rawEngineResults.push({ ...execution, url });
            if (execution.status === "complete") execution.findings = await resolveElementKeys(page, execution.findings);
            engineResults.push(execution.status === "complete" ? { url, engine: id, status: "complete", findings: execution.findings } : { url, engine: id, status: "errored", error: execution.error });
          }
        }
        return { status, finalUrl, contentType, links, result, ...extended ? { analysed: true } : {} };
      } catch (error) {
        const detail = error instanceof Error ? error.message.split("\n")[0] : "Navigation failed.";
        return { status: null, finalUrl: url, links: [], error: detail };
      } finally {
        await page.close().catch(() => void 0);
      }
    },
    close: async () => {
      await context.close().catch(() => void 0);
      await browser.close().catch(() => void 0);
    }
  };
};
function scanUserAgent(version) {
  return `Mozilla/5.0 (compatible; A11yGate/${version}; +https://a11ygate.vercel.app) read-only accessibility scan`;
}
async function runScan(argv, io = {}) {
  const stdout = io.stdout ?? ((chunk) => process.stdout.write(chunk));
  const stderr = io.stderr ?? ((chunk) => process.stderr.write(chunk));
  const cwd = io.cwd ?? process.cwd();
  const now = io.now ?? (() => /* @__PURE__ */ new Date());
  const version = io.version ?? "0.0.0";
  const parsed = parseScanArgs(argv);
  if (!parsed.ok) {
    stderr(`${parsed.error}
Run a11ygate scan --help for usage.
`);
    return 2;
  }
  const options = parsed.options;
  if (options.help) {
    stdout(scanHelpText());
    return 0;
  }
  for (const warning of options.warnings) stderr(`${warning}
`);
  const userAgent = scanUserAgent(version);
  const origin = new URL(options.url).origin;
  const fetchImpl = io.fetch ?? globalThis.fetch;
  const robots = await fetchRobots(origin, userAgent, fetchImpl);
  if (!robotsAllowsUrl(robots.rules, options.url)) {
    stderr(`${options.url} is disallowed by ${origin}/robots.txt; nothing was scanned.
`);
    return 2;
  }
  let engine;
  try {
    engine = await (io.engine ?? playwrightEngine)({ userAgent, origin, engines: options.engines });
  } catch (error) {
    stderr(error instanceof ScanSetupError ? error.message : `Could not start the browser: ${error instanceof Error ? error.message : String(error)}
`);
    return 2;
  }
  let result;
  try {
    result = await crawl({
      startUrl: options.url,
      maxPages: options.maxPages,
      delayMs: options.delayMs,
      robots: robots.rules,
      visit: engine.visit,
      sleep: io.sleep,
      log: (message) => stderr(`${message}
`)
    });
  } finally {
    await engine.close();
  }
  const first = result.pages[0];
  if (!first || first.scanStatus !== "complete") {
    stderr(`Start page could not be scanned: ${first?.error ?? "unreachable"}
`);
    return 2;
  }
  const report = buildScanReport({
    crawl: result,
    version,
    scannedAt: now().toISOString(),
    startUrl: options.url,
    failOn: options.failOn,
    maxPages: options.maxPages,
    delayMs: options.delayMs,
    userAgent,
    robotsNote: robots.note,
    engineResults: engine.engineResults
  });
  const json = `${JSON.stringify(report, null, 2)}
`;
  const markdown = scanMarkdown(report);
  const formatReport = formatReportFromScan(report);
  const extra = [];
  if (options.outDir && options.formats.includes("junit")) {
    extra.push([path.join(options.outDir, formatFileName("scan", "junit")), toJunit(formatReport)]);
  }
  if (options.outDir && options.formats.includes("sarif")) {
    extra.push([path.join(options.outDir, formatFileName("scan", "sarif")), toSarif(formatReport)]);
  }
  const targets = options.outDir ? [
    [path.join(options.outDir, "a11ygate-scan.json"), json],
    [path.join(options.outDir, "a11ygate-scan.md"), markdown],
    [path.join(options.outDir, "a11ygate-scan.html"), scanHtml(report)],
    ...extra
  ] : [
    [options.json === "-" ? void 0 : options.json, json],
    [options.markdown, markdown],
    [options.html, options.html ? scanHtml(report) : ""]
  ];
  try {
    if (options.outDir) await mkdir(path.resolve(cwd, options.outDir), { recursive: true });
    if (options.outDir) {
      const evidenceDir = path.resolve(cwd, options.outDir, "engines");
      await mkdir(evidenceDir, { recursive: true });
      for (const id of options.engines) {
        const native = engine.rawEngineResults?.filter((e) => e.engine === id);
        const evidence = native?.length ? native : id === "axe" ? report.results : report.engineResults?.filter((e) => e.engine === id) ?? [];
        await writeFile(path.join(evidenceDir, `${id}.json`), `${JSON.stringify(evidence, null, 2)}
`, "utf8");
      }
    }
    for (const [file, content] of targets) {
      if (file) await writeFile(path.resolve(cwd, file), content, "utf8");
    }
  } catch (error) {
    const code2 = error.code;
    stderr(`Could not write the scan report${code2 ? ` (${code2})` : ""}.
`);
    return 2;
  }
  stdout(options.json === "-" ? json : markdown);
  if (report.engineResults?.some((e) => e.status === "errored")) return 2;
  return report.verdict === "FAIL" ? 1 : scanExitCode(report.findings, options.failOn);
}

// lib/export-baseline.ts
function baselineReview(results, diff) {
  return { schemaVersion: 1, approval: "review-required", acceptedFindings: [...diff.newFindings, ...diff.stillOpen], newlyAccepted: diff.newFindings, retained: diff.stillOpen, noLongerObserved: diff.fixedFindings, unassessed: diff.unassessed ?? [], pages: results.map((r) => r.url), coverage: diff.coverage, warning: "This proposal accepts the listed current findings as existing debt, not resolved issues. Review and commit separately; no approval or certification is implied." };
}
function baselineDocument(results) {
  return `${JSON.stringify(results, null, 2)}
`;
}

// lib/manual-evidence.ts
function parseManualEvidence(text) {
  try {
    if (text.length > MAX_AXE_JSON_BYTES || axeJsonByteLength(text) > MAX_AXE_JSON_BYTES) throw Error("Manual evidence exceeds 8 MB.");
    const v = JSON.parse(text);
    if (!v || v.schemaVersion !== 1 || !Array.isArray(v.checks) || v.checks.length > 200) throw Error("Expected schemaVersion 1 and at most 200 checks.");
    const ids = /* @__PURE__ */ new Set();
    const checks = [];
    for (const x of v.checks) {
      if (!x || typeof x !== "object" || Array.isArray(x)) throw Error("Every manual check must be an object.");
      for (const [key, max] of Object.entries({ id: 120, scope: 1024, check: 256, reviewer: 120, date: 10, notes: 4e3 })) {
        if (typeof x[key] !== "string" || !x[key].trim() || x[key].length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(x[key])) throw Error("Manual check " + key + " is missing, too long or invalid.");
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(x.date) || !Number.isFinite(Date.parse(x.date)) || new Date(x.date).toISOString().slice(0, 10) !== x.date) throw Error("Manual date must be a real ISO YYYY-MM-DD date.");
      if (!["passed", "failed", "not-assessed"].includes(x.status)) throw Error("Manual status must be passed, failed or not-assessed.");
      if (ids.has(x.id)) throw Error("Manual check IDs must be unique.");
      ids.add(x.id);
      checks.push({ id: x.id, scope: x.scope, check: x.check, reviewer: x.reviewer, date: x.date, status: x.status, notes: x.notes });
    }
    return { ok: true, checks };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Invalid manual evidence." };
  }
}

// lib/diff.ts
function byLocation(a, b) {
  return a.path.localeCompare(b.path) || a.ruleId.localeCompare(b.ruleId) || a.selector.localeCompare(b.selector);
}
function indexByFingerprint(findings) {
  const indexed = /* @__PURE__ */ new Map();
  for (const finding2 of findings) {
    if (!indexed.has(finding2.fingerprint)) indexed.set(finding2.fingerprint, finding2);
  }
  return indexed;
}
function diffScans(current, baseline) {
  const base = indexByFingerprint(baseline ?? []);
  const next = indexByFingerprint(current);
  const newFindings = [];
  const stillOpen = [];
  for (const finding2 of next.values()) {
    if (base.has(finding2.fingerprint)) {
      stillOpen.push({ ...finding2, status: "still-open" });
    } else {
      newFindings.push({ ...finding2, status: "new" });
    }
  }
  const fixedFindings = [];
  for (const finding2 of base.values()) {
    if (!next.has(finding2.fingerprint)) {
      fixedFindings.push({ ...finding2, status: "fixed" });
    }
  }
  newFindings.sort(byLocation);
  fixedFindings.sort(byLocation);
  stillOpen.sort(byLocation);
  const statusOrder = { new: 0, fixed: 1, "still-open": 2, unassessed: 3 };
  const all = [...newFindings, ...fixedFindings, ...stillOpen].sort(
    (a, b) => statusOrder[a.status] - statusOrder[b.status] || byLocation(a, b)
  );
  return { newFindings, fixedFindings, stillOpen, all };
}

// lib/compare.ts
function scanPageKey(url) {
  try {
    const u = new URL(url);
    return pagePath(url) + u.search + u.hash;
  } catch {
    return url.trim();
  }
}
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ":" + canonical(v)).join(",") + "}";
  return JSON.stringify(value) ?? "null";
}
function config(result) {
  return canonical({ engine: result.testEngine.version, options: result.toolOptions ?? null, context: result.scanConfig ?? null, environment: result.testEnvironment ?? null });
}
function group(results) {
  const out = /* @__PURE__ */ new Map();
  for (const r of results) {
    const key = scanPageKey(r.url);
    out.set(key, [...out.get(key) ?? [], r]);
  }
  return out;
}
function scopedFindings(results) {
  return results.flatMap((r) => findingsFromResults([r]).map((f) => ({ ...f, fingerprint: scanPageKey(r.url) === f.path ? f.fingerprint : f.fingerprint + "|scope:" + scanPageKey(r.url) })));
}
function compareScans(current, baseline) {
  const next = group(current), base = group(baseline ?? []);
  const coverage = { status: "complete", issues: [], pages: [], unassessedScope: [
    "Only supplied page/query/hash states are assessed; undiscovered pages and interactions are unassessed.",
    "Manual keyboard, screen-reader and usability checks are not performed by the automated gate.",
    "Origins are intentionally ignored for local CI hosts; equivalent environments must be established by the caller.",
    "Normalized selectors are heuristic identities, not proof that every affected element is unchanged."
  ], unassessedFindings: 0 };
  const blocked = /* @__PURE__ */ new Set();
  const issue = (page, code2, detail, blocking = true) => {
    coverage.issues.push({ page, code: code2, detail });
    if (blocking) {
      blocked.add(page);
      coverage.status = "incomplete";
    } else if (coverage.status === "complete") coverage.status = "unverified";
  };
  for (const key of /* @__PURE__ */ new Set([...base.keys(), ...next.keys()])) {
    const a = next.get(key) ?? [], b = base.get(key) ?? [];
    if (!a.length) issue(key, "missing-page", "Page was in the baseline but is absent from the current input; previous findings are unassessed, not fixed.");
    if (a.length > 1 || b.length > 1) issue(key, "duplicate-page", "Multiple scans for this page/state are ambiguous; provide distinct query/hash states or separate comparisons.");
    if ([...a, ...b].some((r) => r.scanStatus === "failed" || !!r.scanError)) issue(key, "failed-scan", [...a, ...b].filter((r) => r.scanStatus === "failed").map((r) => r.scanError).join("; "));
    if (a.length === 1 && b.length === 1 && config(a[0]) !== config(b[0])) issue(key, "configuration-changed", "Engine, toolOptions, scanConfig or testEnvironment differs or is missing on one side; absence is not a fix.");
    if ([...a, ...b].some((r) => !r.toolOptions && !r.scanConfig)) issue(key, "configuration-unrecorded", "Rule selection, exclusions, viewport and authentication context were not fully recorded; equivalence is unverified.", false);
    if ([...a].some((r) => (r.incomplete?.length ?? 0) > 0)) issue(key, "axe-needs-review", "axe incomplete results require human review; they are not passes or accepted fixes.", false);
    coverage.pages.push({ page: key, current: a.length, baseline: b.length, comparable: !blocked.has(key) });
  }
  const d = diffScans(scopedFindings(current), baseline === null ? null : scopedFindings(baseline));
  const unassessed = [];
  d.fixedFindings = d.fixedFindings.filter((f) => {
    const key = scanPageKey(f.url);
    const relocated = d.newFindings.some((n) => scanPageKey(n.url) === key && n.ruleId === f.ruleId);
    const incomplete = next.get(key)?.some((r) => r.incomplete?.some((v) => v.id === f.ruleId));
    const reason = blocked.has(key) ? "Scan coverage is missing, failed or materially incomparable." : relocated ? "A selector changed or another occurrence was found; resolution is unverified." : incomplete ? "axe reported this rule as incomplete; manual review is needed." : null;
    if (reason) {
      unassessed.push({ ...f, status: "unassessed", assessmentReason: reason });
      return false;
    }
    return true;
  });
  coverage.unassessedFindings = unassessed.length;
  return { ...d, unassessed, coverage, all: [...d.newFindings, ...d.fixedFindings, ...d.stillOpen, ...unassessed] };
}

// lib/project.ts
function inferProjectName(results) {
  const hosts = /* @__PURE__ */ new Set();
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
  return "Imported scan";
}

// packages/cli/src/run.ts
function resolveInput(cwd, file) {
  return path2.resolve(cwd, file);
}
async function readDocuments(files, cwd) {
  const documents = [];
  for (const file of files) {
    const absolute = resolveInput(cwd, file);
    try {
      const info = await stat(absolute);
      if (!info.isFile()) return { ok: false, error: `${file}: not a file.` };
      if (info.size === 0) return { ok: false, error: `${file}: The file is empty.` };
      if (info.size > MAX_AXE_JSON_BYTES) {
        return { ok: false, error: `${file}: ${axeJsonTooLargeMessage()}` };
      }
      documents.push({ name: file, text: await readFile2(absolute, "utf8") });
    } catch (error) {
      const code2 = error.code;
      if (code2 === "ENOENT") return { ok: false, error: `${file}: file not found.` };
      return { ok: false, error: `${file}: could not read the file.` };
    }
  }
  return { ok: true, documents };
}
function writeFailure(file, error) {
  const code2 = error.code;
  if (code2 === "ENOENT") return `${file}: the directory does not exist.`;
  if (code2 === "EISDIR") return `${file}: is a directory, not a file.`;
  return `${file}: could not write the file.`;
}
async function readVersion() {
  const here = path2.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path2.join(here, "..", "package.json"),
    path2.join(here, "..", "..", "packages", "cli", "package.json")
  ];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(await readFile2(candidate, "utf8"));
      if (parsed.name === "@qe-atlas/a11ygate" && parsed.version) return parsed.version;
    } catch {
    }
  }
  return "0.0.0";
}
function findingJson(finding2) {
  return {
    status: finding2.status,
    assessmentReason: finding2.assessmentReason,
    guidance: findingGuidance(finding2),
    fingerprint: finding2.fingerprint,
    ruleId: finding2.ruleId,
    impact: finding2.impact,
    path: finding2.path,
    url: finding2.url,
    selector: finding2.selector,
    html: finding2.html,
    help: finding2.help,
    helpUrl: finding2.helpUrl,
    tags: finding2.tags
  };
}
function reportJson(input) {
  return `${JSON.stringify(
    {
      tool: "a11ygate",
      schemaVersion: 2,
      releaseStatus: "unreleased-source-build",
      synthetic: input.synthetic,
      version: input.version,
      projectName: input.projectName,
      verdict: input.verdict,
      threshold: input.threshold,
      reason: input.reason,
      generatedAt: input.generatedAt,
      coverage: input.diff.coverage,
      baselineReview: baselineReview(input.currentResults, input.diff),
      manualChecks: input.manualChecks,
      manualEvidenceNotice: "Self-reported human evidence, not identity-verified or automatically assessed; never improves the automated gate. Unrecorded scopes remain unassessed.",
      counts: {
        new: input.diff.newFindings.length,
        fixed: input.diff.fixedFindings.length,
        stillOpen: input.diff.stillOpen.length
      },
      findings: {
        new: input.diff.newFindings.map(findingJson),
        fixed: input.diff.fixedFindings.map(findingJson),
        stillOpen: input.diff.stillOpen.map(findingJson),
        unassessed: (input.diff.unassessed ?? []).map(findingJson)
      }
    },
    null,
    2
  )}
`;
}
async function run(argv, io = {}) {
  const stdout = io.stdout ?? ((chunk) => process.stdout.write(chunk));
  const stderr = io.stderr ?? ((chunk) => process.stderr.write(chunk));
  const cwd = io.cwd ?? process.cwd();
  const now = io.now ?? (() => /* @__PURE__ */ new Date());
  if (argv[0] === "scan") return runScan(argv.slice(1), { ...io, version: await readVersion() });
  const gateArgv = argv[0] === "ci" ? argv.slice(1) : argv;
  const parsed = parseArgs(gateArgv);
  if (!parsed.ok) {
    stderr(`${parsed.error}
`);
    stderr("Run a11ygate --help for usage.\n");
    return 2;
  }
  const options = parsed.options;
  if (options.help) {
    stdout(helpText());
    return 0;
  }
  if (options.version) {
    stdout(`${await readVersion()}
`);
    return 0;
  }
  if (options.current.length === 0) {
    stderr("Pass at least one current axe JSON file with --current.\n");
    return 2;
  }
  if (options.formats.length > 0 && !options.outDir) {
    stderr("--format requires --out-dir.\n");
    return 2;
  }
  try {
    const identify = async (file) => {
      const absolute = resolveInput(cwd, file);
      const canonical2 = await realpath(absolute).catch(async () => {
        if ((await lstat(absolute).catch(() => null))?.isSymbolicLink()) throw new Error("Dangling symlinks are not safe output/input paths.");
        return path2.join(await realpath(path2.dirname(absolute)).catch(() => path2.dirname(absolute)), path2.basename(absolute));
      });
      const info = await stat(absolute).catch(() => null);
      return { canonical: canonical2, inode: info ? `${info.dev}:${info.ino}` : null };
    };
    const inputs = await Promise.all([...options.current, ...options.baseline, ...options.manualEvidence ? [options.manualEvidence] : []].map(identify));
    const baselineProtectedInputs = await Promise.all([...options.current, ...options.manualEvidence ? [options.manualEvidence] : []].map(identify));
    const outDirFiles = options.outDir ? [.../* @__PURE__ */ new Set([
      path2.join(options.outDir, formatFileName("ci", "json")),
      path2.join(options.outDir, formatFileName("ci", "md")),
      ...options.formats.map((format) => path2.join(options.outDir, formatFileName("ci", format)))
    ])] : [];
    const outputs = [options.markdown, options.json === "-" ? void 0 : options.json, options.updateBaseline, options.updateBaseline ? options.updateBaseline + ".review.json" : void 0, ...outDirFiles].filter((x) => !!x);
    const seen = [];
    for (const output of outputs) {
      const id = await identify(output);
      const same = (x) => x.canonical === id.canonical || !!(id.inode && x.inode === id.inode);
      const protectedInputs = output === options.updateBaseline ? baselineProtectedInputs : inputs;
      if (protectedInputs.some(same) || seen.some(same)) {
        stderr("Output paths must be distinct and must not overwrite input evidence.\n");
        return 2;
      }
      seen.push(id);
    }
  } catch (error) {
    stderr((error instanceof Error ? error.message : "Unsafe output path.") + "\n");
    return 2;
  }
  const currentRead = await readDocuments(options.current, cwd);
  if (!currentRead.ok) {
    stderr(`${currentRead.error}
`);
    return 2;
  }
  const current = parseAxeDocuments(currentRead.documents);
  if (!current.ok) {
    stderr(`${current.error}
`);
    return 2;
  }
  let baselineResults = null;
  let baselineSynthetic = false;
  if (options.baseline.length > 0) {
    const baselineRead = await readDocuments(options.baseline, cwd);
    if (!baselineRead.ok) {
      stderr(`${baselineRead.error}
`);
      return 2;
    }
    const baseline = parseAxeDocuments(baselineRead.documents);
    if (!baseline.ok) {
      stderr(`${baseline.error}
`);
      return 2;
    }
    baselineResults = baseline.results;
    baselineSynthetic = baseline.synthetic;
  }
  if (current.synthetic || baselineSynthetic) {
    stderr("Note: at least one file is marked as a synthetic fixture, not a real audit.\n");
  }
  let manualChecks = [];
  if (options.manualEvidence) {
    const manualRead = await readDocuments([options.manualEvidence], cwd);
    if (!manualRead.ok) {
      stderr(manualRead.error + "\n");
      return 2;
    }
    const manual = parseManualEvidence(manualRead.documents[0].text);
    if (!manual.ok) {
      stderr(manual.error + "\n");
      return 2;
    }
    manualChecks = manual.checks;
  }
  const diff = compareScans(current.results, baselineResults);
  const verdict = gateVerdict(diff.newFindings, options.threshold, diff.coverage);
  const reason = verdict === "INCOMPLETE" ? "Missing, failed or materially incomparable scan coverage prevents a regression PASS." : verdictReason(diff.newFindings, options.threshold);
  const projectName = inferProjectName(current.results);
  const generatedAt = now().toISOString();
  const version = await readVersion();
  const markdown = prSummaryMarkdown({
    projectName,
    verdict,
    threshold: options.threshold,
    diff,
    generatedAt,
    reason,
    manualChecks,
    synthetic: current.synthetic || baselineSynthetic
  });
  const json = reportJson({ version, projectName, verdict, threshold: options.threshold, reason, generatedAt, diff, currentResults: current.results, manualChecks, synthetic: current.synthetic || baselineSynthetic });
  if (options.updateBaseline) {
    if (diff.coverage?.status === "incomplete") {
      stderr("Refusing baseline update: scan coverage is incomplete. Existing baseline is unchanged.\n");
      return 2;
    }
    try {
      await writeFile2(resolveInput(cwd, options.updateBaseline + ".review.json"), JSON.stringify(baselineReview(current.results, diff), null, 2) + "\n", "utf8");
      await writeFile2(resolveInput(cwd, options.updateBaseline), baselineDocument(current.results), "utf8");
    } catch (error) {
      stderr(`${writeFailure(options.updateBaseline, error)}
`);
      return 2;
    }
    stderr(`Wrote baseline ${options.updateBaseline}
`);
  }
  if (options.markdown) {
    try {
      await writeFile2(resolveInput(cwd, options.markdown), markdown, "utf8");
    } catch (error) {
      stderr(`${writeFailure(options.markdown, error)}
`);
      return 2;
    }
  }
  if (options.json && options.json !== "-") {
    try {
      await writeFile2(resolveInput(cwd, options.json), json, "utf8");
    } catch (error) {
      stderr(`${writeFailure(options.json, error)}
`);
      return 2;
    }
  }
  if (options.outDir) {
    const formatReport = formatReportFromGate({
      version,
      generatedAt,
      projectName,
      verdict,
      reason,
      currentResults: current.results,
      findings: [...diff.newFindings, ...diff.stillOpen, ...diff.fixedFindings, ...diff.unassessed ?? []]
    });
    const files = /* @__PURE__ */ new Map([
      [formatFileName("ci", "json"), json],
      [formatFileName("ci", "md"), markdown]
    ]);
    if (options.formats.includes("junit")) files.set(formatFileName("ci", "junit"), toJunit(formatReport));
    if (options.formats.includes("sarif")) files.set(formatFileName("ci", "sarif"), toSarif(formatReport));
    try {
      const dir = resolveInput(cwd, options.outDir);
      await mkdir2(dir, { recursive: true });
      for (const [name, content] of files) {
        await writeFile2(path2.join(dir, name), content, "utf8");
      }
    } catch (error) {
      stderr(`${writeFailure(options.outDir, error)}
`);
      return 2;
    }
  }
  stdout(options.json === "-" ? json : markdown);
  return verdict === "FAIL" ? 1 : verdict === "INCOMPLETE" ? 2 : 0;
}

// packages/cli/src/bin.ts
void run(process.argv.slice(2)).then(
  (code2) => {
    process.exitCode = code2;
  },
  (error) => {
    const message = error instanceof Error ? error.message : "A11yGate failed.";
    process.stderr.write(`${message}
`);
    process.exitCode = 2;
  }
);
