#!/usr/bin/env node

// packages/cli/src/run.ts
import { readFile, realpath, stat, lstat, writeFile as writeFile2 } from "node:fs/promises";
import path2 from "node:path";
import { fileURLToPath } from "node:url";

// lib/diff.ts
function byLocation(a, b) {
  return a.path.localeCompare(b.path) || a.ruleId.localeCompare(b.ruleId) || a.selector.localeCompare(b.selector);
}
function indexByFingerprint(findings) {
  const indexed = /* @__PURE__ */ new Map();
  for (const finding of findings) {
    if (!indexed.has(finding.fingerprint)) indexed.set(finding.fingerprint, finding);
  }
  return indexed;
}
function diffScans(current, baseline) {
  const base = indexByFingerprint(baseline ?? []);
  const next = indexByFingerprint(current);
  const newFindings = [];
  const stillOpen = [];
  for (const finding of next.values()) {
    if (base.has(finding.fingerprint)) {
      stillOpen.push({ ...finding, status: "still-open" });
    } else {
      newFindings.push({ ...finding, status: "new" });
    }
  }
  const fixedFindings = [];
  for (const finding of base.values()) {
    if (!next.has(finding.fingerprint)) {
      fixedFindings.push({ ...finding, status: "fixed" });
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
  return findings.filter((finding) => meetsThreshold(finding.impact, threshold));
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
  const rules2 = [...new Set(gating.map((finding) => finding.ruleId))];
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

// lib/types.ts
var IMPACTS = ["minor", "moderate", "serious", "critical"];
function isImpact(value) {
  return value === "minor" || value === "moderate" || value === "serious" || value === "critical";
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
  for (const document of documents) {
    const parsed = parseAxeJson(document.text);
    if (!parsed.ok) return { ok: false, error: `${document.name}: ${parsed.error}` };
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
        const finding = {
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
        const existing = byFingerprint.get(finding.fingerprint);
        if (!existing || impactRank(finding.impact) > impactRank(existing.impact)) {
          byFingerprint.set(finding.fingerprint, finding);
        }
      }
    }
  }
  return [...byFingerprint.values()].sort(
    (a, b) => a.path.localeCompare(b.path) || a.ruleId.localeCompare(b.ruleId) || a.selector.localeCompare(b.selector)
  );
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

// lib/copy.ts
var DISCLAIMER = "Automated checks cover only part of WCAG; this is evidence, not certification.";
var LEGAL_DISCLAIMER = "Informational only. Not legal advice. Not a certification of EAA compliance.";

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
var markdownCell = cell;
function findingLine(finding) {
  const selector = finding.selector.replace(/`/g, "'");
  const impact = finding.impact ?? "unspecified";
  const guidance = findingGuidance(finding);
  return `- **${cell(finding.ruleId)}** (${impact}) on \`${cell(finding.url)}\` \u2014 \`${cell(selector)}\` \u2014 ${cell(finding.help)} \u2014 ${cell(formatStandards(finding.tags))}
  - Affected element: \`${cell(finding.html)}\`; fingerprint: \`${cell(finding.fingerprint)}\`.
  - User impact: ${cell(guidance.userImpact)}
  - Remediation: ${cell(guidance.remediation)}
  - Verification: ${guidance.verification.map(cell).join(" ")}${finding.assessmentReason ? "\n  - Assessment: " + cell(finding.assessmentReason) : ""}`;
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

// lib/evidence-report.ts
var REQUIRED_DISCLAIMER = "Automated testing only. Not a WCAG audit, certification or legal advice.";
var REPORT_DISCLAIMER = `${REQUIRED_DISCLAIMER} Automated tools such as axe-core detect only a subset of accessibility issues.`;
function isReportFormat(value) {
  return value === "html" || value === "md" || value === "json";
}
function inferReportFormat(out) {
  const lower = (out ?? "").toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "md";
  if (lower.endsWith(".json")) return "json";
  return "html";
}
function parseSiteScan(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: "The scan file is not valid JSON." };
  }
  const doc = value;
  if (!doc || typeof doc !== "object" || doc.tool !== "a11ygate" || doc.kind !== "site-scan") {
    return { ok: false, error: 'This is not an a11ygate scan report (kind "site-scan"). Use --current for axe-core JSON.' };
  }
  if (doc.schemaVersion !== 1) return { ok: false, error: `Unsupported scan schemaVersion ${String(doc.schemaVersion)}.` };
  if (typeof doc.scannedAt !== "string" || typeof doc.startUrl !== "string" || !Array.isArray(doc.results)) {
    return { ok: false, error: "The scan report is missing scannedAt, startUrl or results." };
  }
  const options = doc.options ?? { maxPages: 0, delayMs: 0, tags: [], userAgent: "", robots: "" };
  return {
    ok: true,
    scan: {
      version: typeof doc.version === "string" ? doc.version : "unknown",
      axeVersion: typeof doc.axeVersion === "string" ? doc.axeVersion : null,
      scannedAt: doc.scannedAt,
      startUrl: doc.startUrl,
      origin: typeof doc.origin === "string" ? doc.origin : "",
      options,
      pages: Array.isArray(doc.pages) ? doc.pages : [],
      skipped: Array.isArray(doc.skipped) ? doc.skipped : [],
      boundaries: Array.isArray(doc.boundaries) ? doc.boundaries.filter((b) => typeof b === "string") : [],
      results: doc.results
    }
  };
}
var STATUS = {
  new: "new",
  "still-open": "baselined",
  fixed: "fixed",
  unassessed: "unassessed"
};
var STATUS_ORDER = { new: 0, baselined: 1, fixed: 2, unassessed: 3 };
function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function uniqueSorted(values) {
  return [...new Set(values)].sort(compareText);
}
function compareCriterion(a, b) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
function wcagCriteria(tags) {
  const found = /* @__PURE__ */ new Map();
  for (const tag of tags) {
    const known = getCriterion(tag);
    if (known) {
      found.set(known.number, { number: known.number, name: known.name, level: known.level, wcag: known.wcag });
      continue;
    }
    const match = /^wcag(\d)(\d)(\d{1,2})$/i.exec(tag);
    if (!match) continue;
    const number = `${match[1]}.${match[2]}.${match[3]}`;
    if (!found.has(number)) found.set(number, { number, name: null, level: null, wcag: null });
  }
  return [...found.values()].sort((a, b) => compareCriterion(a.number, b.number));
}
function maxImpact(findings) {
  let best = null;
  for (const finding of findings) {
    if (impactRank(finding.impact) > impactRank(best)) best = finding.impact;
  }
  return best;
}
function reportFinding(finding) {
  return {
    status: STATUS[finding.status],
    impact: finding.impact,
    url: finding.url,
    selector: finding.selector,
    html: finding.html,
    fingerprint: finding.fingerprint,
    assessmentReason: finding.assessmentReason ?? null
  };
}
function emptyCounts() {
  return { new: 0, baselined: 0, fixed: 0, unassessed: 0 };
}
function currentCount(counts) {
  return counts.new + counts.baselined;
}
function baselineCount(counts) {
  return counts.baselined + counts.fixed + counts.unassessed;
}
function buildRules(diff) {
  const all = [...diff.newFindings, ...diff.stillOpen, ...diff.fixedFindings, ...diff.unassessed ?? []];
  const byRule = /* @__PURE__ */ new Map();
  for (const finding of all) byRule.set(finding.ruleId, [...byRule.get(finding.ruleId) ?? [], finding]);
  const rules2 = [...byRule.entries()].map(([ruleId, findings]) => {
    const counts = emptyCounts();
    for (const finding of findings) counts[STATUS[finding.status]] += 1;
    const current = findings.filter((finding) => finding.status === "new" || finding.status === "still-open");
    const reference = [...current.length ? current : findings].sort(
      (a, b) => compareText(a.fingerprint, b.fingerprint)
    )[0];
    const tags = uniqueSorted(findings.flatMap((finding) => finding.tags));
    const wcag = wcagCriteria(tags);
    const guidance = findingGuidance({ ruleId, help: reference.help });
    return {
      ruleId,
      impact: maxImpact(current.length ? current : findings),
      help: reference.help,
      helpUrl: reference.helpUrl,
      wcag,
      bestPractice: wcag.length === 0,
      tags,
      fix: guidance.remediation,
      userImpact: guidance.userImpact,
      counts,
      findings: findings.map(reportFinding).sort(
        (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || compareText(a.url, b.url) || compareText(a.selector, b.selector) || compareText(a.fingerprint, b.fingerprint)
      )
    };
  });
  return rules2.sort(
    (a, b) => Number(currentCount(b.counts) > 0) - Number(currentCount(a.counts) > 0) || impactRank(b.impact) - impactRank(a.impact) || compareText(a.ruleId, b.ruleId)
  );
}
function computeTrend(rules2) {
  const rows = rules2.map((rule) => {
    const baseline = baselineCount(rule.counts);
    const now = currentCount(rule.counts);
    return {
      ruleId: rule.ruleId,
      baseline,
      current: now,
      delta: now - baseline,
      new: rule.counts.new,
      fixed: rule.counts.fixed,
      stillOpen: rule.counts.baselined
    };
  }).sort((a, b) => a.delta - b.delta || compareText(a.ruleId, b.ruleId));
  const totals = rows.reduce(
    (sum, row2) => ({
      baseline: sum.baseline + row2.baseline,
      current: sum.current + row2.current,
      delta: sum.delta + row2.delta,
      new: sum.new + row2.new,
      fixed: sum.fixed + row2.fixed,
      stillOpen: sum.stillOpen + row2.stillOpen
    }),
    { baseline: 0, current: 0, delta: 0, new: 0, fixed: 0, stillOpen: 0 }
  );
  return { rules: rows, totals };
}
var SKIP_LABEL = {
  cap: "Page limit reached (--crawl cap)",
  external: "Different origin (not crawled)",
  "not-http": "Not an http(s) link (javascript:, mailto:, \u2026)",
  "non-html": "Not an HTML page (file download)",
  robots: "Disallowed by robots.txt",
  logout: "Looks like a logout/sign-out link (never followed)",
  "redirected-off-origin": "Redirected to another origin"
};
function buildScope(scan) {
  const { current } = scan;
  const groups = /* @__PURE__ */ new Map();
  for (const link of current.skipped) {
    const set = groups.get(link.reason) ?? /* @__PURE__ */ new Set();
    set.add(link.url);
    groups.set(link.reason, set);
  }
  return {
    startUrl: current.startUrl,
    origin: current.origin,
    scannedAt: current.scannedAt,
    previousScannedAt: scan.previous?.scannedAt ?? null,
    maxPages: current.options.maxPages,
    delayMs: current.options.delayMs,
    robots: current.options.robots,
    userAgent: current.options.userAgent,
    axeTags: [...current.options.tags],
    pages: current.pages.map((page) => ({
      url: page.url,
      finalUrl: page.finalUrl,
      status: page.status,
      scanStatus: page.scanStatus,
      error: page.error ?? null
    })),
    skipped: [...groups.entries()].map(([reason, urls]) => ({ reason, label: SKIP_LABEL[reason] ?? reason, count: urls.size, urls: uniqueSorted(urls) })).sort((a, b) => b.count - a.count || compareText(a.reason, b.reason)),
    boundaries: [...current.boundaries]
  };
}
function groupByCriterion(rules2) {
  const groups = /* @__PURE__ */ new Map();
  for (const rule of rules2) {
    const primary = rule.wcag[0];
    if (!primary) continue;
    const group2 = groups.get(primary.number) ?? { criterion: primary, ruleIds: [], currentFindings: 0 };
    group2.ruleIds.push(rule.ruleId);
    group2.currentFindings += currentCount(rule.counts);
    groups.set(primary.number, group2);
  }
  return [...groups.values()].sort((a, b) => compareCriterion(a.criterion.number, b.criterion.number));
}
function buildEvidenceReport(input) {
  const { diff } = input;
  const rules2 = buildRules(diff);
  const baselineSupplied = input.baseline !== null;
  const baselinePages = new Set((input.baseline ?? []).map((result) => scanPageKey(result.url)));
  const current = [...diff.newFindings, ...diff.stillOpen];
  const pages = input.current.map((result) => {
    const page = scanPageKey(result.url);
    const onPage = current.filter((finding) => finding.url === result.url);
    return {
      url: result.url,
      page,
      scannedAt: result.timestamp,
      axeCore: result.testEngine.version,
      scanStatus: result.scanStatus === "failed" || result.scanError ? "failed" : "complete",
      violations: onPage.length,
      new: onPage.filter((finding) => finding.status === "new").length,
      baselined: onPage.filter((finding) => finding.status === "still-open").length,
      inBaseline: baselinePages.has(page)
    };
  }).sort((a, b) => compareText(a.url, b.url) || compareText(a.scannedAt, b.scannedAt));
  const trend = computeTrend(rules2);
  const bySeverity = { critical: 0, serious: 0, moderate: 0, minor: 0, unknown: 0 };
  for (const finding of current) bySeverity[finding.impact ?? "unknown"] += 1;
  const baselineViolations = baselineSupplied ? diff.stillOpen.length + diff.fixedFindings.length + (diff.unassessed?.length ?? 0) : null;
  return {
    tool: "a11ygate",
    reportSchemaVersion: 1,
    disclaimer: REPORT_DISCLAIMER,
    input: input.scan ? "site-scan" : "axe-results",
    generatedAt: input.generatedAt,
    projectName: input.projectName,
    synthetic: input.synthetic,
    source: { commit: input.commit?.trim() || null, branch: input.branch?.trim() || null },
    tools: {
      a11ygate: input.version,
      axeCore: {
        current: uniqueSorted(input.current.map((result) => result.testEngine.version)),
        baseline: uniqueSorted((input.baseline ?? []).map((result) => result.testEngine.version))
      }
    },
    gate: { verdict: input.verdict, threshold: input.threshold, reason: input.reason },
    summary: {
      new: diff.newFindings.length,
      baselined: diff.stillOpen.length,
      fixed: diff.fixedFindings.length,
      unassessed: diff.unassessed?.length ?? 0,
      currentViolations: current.length,
      baselineViolations,
      rulesWithCurrentViolations: rules2.filter((rule) => currentCount(rule.counts) > 0).length,
      bySeverity
    },
    scope: input.scan ? buildScope(input.scan) : null,
    coverage: {
      status: diff.coverage?.status ?? "unverified",
      issues: [...diff.coverage?.issues ?? []].sort(
        (a, b) => compareText(a.page, b.page) || compareText(a.code, b.code) || compareText(a.detail, b.detail)
      ),
      unassessedScope: [...diff.coverage?.unassessedScope ?? []]
    },
    pages,
    rules: rules2,
    criteria: groupByCriterion(rules2),
    trend: {
      baselineSupplied,
      totals: baselineSupplied ? trend.totals : null,
      rules: baselineSupplied ? trend.rules : []
    }
  };
}
function statusLabel(report, status) {
  if (status === "baselined") return report.input === "site-scan" ? "Still open" : "Baselined (still open)";
  if (status === "unassessed") return "Unassessed (not verified fixed)";
  return status === "new" ? "New" : "Fixed";
}
function comparedWith(report) {
  return report.input === "site-scan" ? "previous scan" : "baseline";
}
function capitalise(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
function criterionLabel(criterion) {
  if (!criterion.name) return `${criterion.number} (not in A11yGate's criterion table)`;
  return `${criterion.number} ${criterion.name} (Level ${criterion.level}, WCAG ${criterion.wcag})`;
}
function signed(value) {
  return value > 0 ? `+${value}` : String(value);
}
function impactLabel(impact) {
  return impact ?? "unspecified";
}
function safeHref(url) {
  return /^https?:\/\/[^\s"'<>]+$/i.test(url) ? url : null;
}
var SEVERITIES = ["critical", "serious", "moderate", "minor", "unknown"];
var SKIPPED_EXAMPLES = 10;
var MAPPING_NOTE = "WCAG success criteria are mapped from axe-core rule tags. The mapping needs expert review before it is relied on. A rule mapped to more than one criterion is listed under the first.";
function bestPracticeRules(report) {
  return report.rules.filter((rule) => rule.bestPractice);
}
function rulesFor(report, ruleIds) {
  return report.rules.filter((rule) => ruleIds.includes(rule.ruleId));
}
function trendSentence(report) {
  const totals = report.trend.totals;
  if (!totals) {
    return report.input === "site-scan" ? "No previous scan was supplied, so every current violation is reported as new." : "No baseline was supplied, so every current violation is reported as new.";
  }
  return `Total violations: ${totals.baseline} in the ${comparedWith(report)}, ${totals.current} now (${signed(totals.delta)}): ${totals.new} new, ${totals.fixed} fixed, ${totals.stillOpen} still open.`;
}
function evidenceReportJson(report) {
  return `${JSON.stringify({ ...report, disclaimer: REPORT_DISCLAIMER }, null, 2)}
`;
}
var md = markdownCell;
function codeSpan(value) {
  return `\`${value.replace(/`/g, "'").replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ")}\``;
}
function markdownRule(report, rule, heading2) {
  const href = safeHref(rule.helpUrl);
  return [
    `${heading2} ${md(rule.ruleId)} \u2014 ${impactLabel(rule.impact)}`,
    "",
    `${md(rule.help)}${href ? ` ([rule documentation](${href}))` : ""}`,
    "",
    `- How to fix: ${md(rule.fix)}`,
    `- WCAG: ${rule.bestPractice ? "none mapped (best practice)" : rule.wcag.map((criterion) => md(criterionLabel(criterion))).join("; ")}`,
    `- Counts: ${rule.counts.new} new, ${rule.counts.baselined} ${report.input === "site-scan" ? "still open" : "baselined"}, ${rule.counts.fixed} fixed, ${rule.counts.unassessed} unassessed`,
    "",
    "| Status | Severity | Page | Selector | Element |",
    "| --- | --- | --- | --- | --- |",
    ...rule.findings.map(
      (finding) => `| ${statusLabel(report, finding.status)}${finding.assessmentReason ? ` \u2014 ${md(finding.assessmentReason)}` : ""} | ${impactLabel(finding.impact)} | ${md(finding.url)} | ${codeSpan(finding.selector)} | ${codeSpan(finding.html)} |`
    ),
    ""
  ];
}
function evidenceReportMarkdown(report) {
  const { summary, trend, scope } = report;
  const scanMode = report.input === "site-scan";
  const lines = [
    `# Accessibility evidence report \u2014 ${md(report.projectName)}`,
    "",
    `> **${REPORT_DISCLAIMER}**`,
    "",
    ...report.synthetic ? ["**SYNTHETIC evidence \u2014 not a real audit or customer assessment.**", ""] : [],
    "## Scan details",
    "",
    "| Field | Value |",
    "| --- | --- |",
    ...scope ? [
      `| Scanned at | ${md(scope.scannedAt)} |`,
      `| Previous scan | ${scope.previousScannedAt ? md(scope.previousScannedAt) : "none supplied"} |`
    ] : [],
    `| Generated | ${md(report.generatedAt)} |`,
    `| Commit | ${report.source.commit ? codeSpan(report.source.commit) : "not recorded"} |`,
    `| Branch | ${report.source.branch ? codeSpan(report.source.branch) : "not recorded"} |`,
    `| A11yGate | ${md(report.tools.a11ygate)} |`,
    `| axe-core (current) | ${md(report.tools.axeCore.current.join(", ") || "unknown")} |`,
    `| axe-core (${comparedWith(report)}) | ${trend.baselineSupplied ? md(report.tools.axeCore.baseline.join(", ") || "unknown") : `no ${comparedWith(report)}`} |`,
    `| Gate | ${report.gate.verdict} at threshold ${report.gate.threshold} \u2014 ${md(report.gate.reason)} |`,
    `| Coverage | ${report.coverage.status} |`,
    "",
    "## Summary",
    "",
    "| Severity | Current violations |",
    "| --- | --- |",
    ...SEVERITIES.map((severity) => `| ${capitalise(severity)} | ${summary.bySeverity[severity]} |`),
    `| Total | ${summary.currentViolations} |`,
    "",
    "| Status | Violations |",
    "| --- | --- |",
    `| New | ${summary.new} |`,
    `| ${statusLabel(report, "baselined")} | ${summary.baselined} |`,
    `| Fixed | ${summary.fixed} |`,
    `| Unassessed (not verified fixed) | ${summary.unassessed} |`,
    `| Current total | ${summary.currentViolations} |`,
    "",
    `Rules with current violations: ${summary.rulesWithCurrentViolations}. WCAG success criteria with findings: ${report.criteria.length}. Best-practice rules: ${bestPracticeRules(report).length}.`,
    ""
  ];
  if (scope) {
    lines.push(
      "## Scope",
      "",
      "| Field | Value |",
      "| --- | --- |",
      `| Start URL | ${md(scope.startUrl)} |`,
      `| Origin | ${md(scope.origin)} |`,
      `| Page limit | ${scope.maxPages} |`,
      `| Delay between pages | ${scope.delayMs} ms |`,
      `| robots.txt | ${md(scope.robots)} |`,
      `| User agent | ${codeSpan(scope.userAgent)} |`,
      `| axe-core tags | ${md(scope.axeTags.join(", "))} |`,
      "",
      "### Boundaries",
      "",
      ...scope.boundaries.map((boundary) => `- ${md(boundary)}`),
      ""
    );
  }
  lines.push(
    "## Pages scanned",
    "",
    `| Page | Scanned | axe-core | Scan | Violations | New | ${scanMode ? "Still open" : "Baselined"} | In ${comparedWith(report)} |`,
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...report.pages.map(
      (page) => `| ${md(page.url)} | ${md(page.scannedAt)} | ${md(page.axeCore)} | ${page.scanStatus} | ${page.violations} | ${page.new} | ${page.baselined} | ${page.inBaseline ? "yes" : "no"} |`
    ),
    ""
  );
  if (scope) {
    const notScanned = scope.pages.filter((page) => page.scanStatus !== "complete");
    if (notScanned.length > 0) {
      lines.push(
        "### Pages not scanned",
        "",
        ...notScanned.map((page) => `- ${md(page.url)} \u2014 ${page.scanStatus}${page.error ? `: ${md(page.error)}` : ""}`),
        ""
      );
    }
    lines.push("### Links skipped and why", "");
    if (scope.skipped.length === 0) lines.push("No links were skipped.", "");
    for (const group2 of scope.skipped) {
      const extra = group2.urls.length - SKIPPED_EXAMPLES;
      lines.push(
        `- ${md(group2.label)}: ${group2.count}`,
        ...group2.urls.slice(0, SKIPPED_EXAMPLES).map((url) => `  - ${codeSpan(url)}`),
        ...extra > 0 ? [`  - \u2026and ${extra} more (full list in the JSON report)`] : []
      );
    }
    if (scope.skipped.length > 0) lines.push("");
  }
  if (report.coverage.issues.length > 0) {
    lines.push(
      "### Coverage issues",
      "",
      ...report.coverage.issues.map((issue) => `- ${md(issue.code)} on ${codeSpan(issue.page)}: ${md(issue.detail)}`),
      ""
    );
  }
  lines.push(`## Trend versus ${comparedWith(report)}`, "", trendSentence(report), "");
  if (trend.totals) {
    lines.push(
      `| Rule | New | Fixed | Still open | ${capitalise(comparedWith(report))} | Current | Change |`,
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...trend.rules.map(
        (row2) => `| ${md(row2.ruleId)} | ${row2.new} | ${row2.fixed} | ${row2.stillOpen} | ${row2.baseline} | ${row2.current} | ${signed(row2.delta)} |`
      ),
      `| **Total** | ${trend.totals.new} | ${trend.totals.fixed} | ${trend.totals.stillOpen} | ${trend.totals.baseline} | ${trend.totals.current} | ${signed(trend.totals.delta)} |`,
      ""
    );
  }
  lines.push("## Findings by WCAG success criterion", "", MAPPING_NOTE, "");
  if (report.criteria.length === 0) lines.push("No findings were mapped to a WCAG success criterion.", "");
  for (const group2 of report.criteria) {
    lines.push(`### WCAG ${md(criterionLabel(group2.criterion))}`, "", `Current findings: ${group2.currentFindings}.`, "");
    for (const rule of rulesFor(report, group2.ruleIds)) lines.push(...markdownRule(report, rule, "####"));
  }
  const bestPractice = bestPracticeRules(report);
  lines.push("## Best-practice rules (no WCAG success criterion)", "");
  if (bestPractice.length === 0) lines.push("No best-practice findings.", "");
  for (const rule of bestPractice) lines.push(...markdownRule(report, rule, "###"));
  lines.push("## Disclaimer", "", REPORT_DISCLAIMER, "");
  return lines.join("\n");
}
function esc(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
var STYLE = `
:root{color-scheme:light;--fg:#1b1f24;--muted:#4b5563;--line:#d0d7de;--bg:#ffffff;--soft:#f6f8fa}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:72rem;margin:0 auto;padding:2rem 1.25rem 4rem}
h1{font-size:1.75rem;margin:0 0 .5rem}
h2{font-size:1.35rem;margin:2.5rem 0 .75rem;border-bottom:1px solid var(--line);padding-bottom:.25rem}
h3{font-size:1.15rem;margin:1.75rem 0 .5rem}
h4{font-size:1.05rem;margin:1.5rem 0 .5rem}
.disclaimer{border:2px solid #9a6700;background:#fff8c5;padding:.75rem 1rem;border-radius:.375rem;font-weight:600}
.synthetic{border:2px solid #cf222e;background:#ffebe9;padding:.5rem 1rem;border-radius:.375rem;font-weight:700}
table{border-collapse:collapse;width:100%;margin:.5rem 0 1rem;font-size:.9375rem}
caption{text-align:left;font-weight:600;padding:.25rem 0}
th,td{border:1px solid var(--line);padding:.375rem .5rem;text-align:left;vertical-align:top}
thead th{background:var(--soft)}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.875em;overflow-wrap:anywhere;word-break:break-word}
.muted{color:var(--muted)}
.impact{display:inline-block;padding:0 .4rem;border-radius:.25rem;border:1px solid currentColor;font-size:.8125rem;font-weight:600;text-transform:uppercase}
.impact-critical{color:#a40e26}.impact-serious{color:#9a3412}.impact-moderate{color:#7c4a03}.impact-minor,.impact-unspecified,.impact-unknown{color:#374151}
a{color:#0550ae}
@media print{
@page{margin:1.5cm}
body{font-size:11pt}
main{max-width:none;padding:0}
.sheet{break-before:page}
h2,h3,h4,caption{break-after:avoid}
table{break-inside:auto}
thead{display:table-header-group}
tr,li{break-inside:avoid}
a{color:inherit}
a[href]::after{content:" (" attr(href) ")";font-size:.85em;overflow-wrap:anywhere}
}
`.trim();
function impactBadge(impact) {
  const label = impactLabel(impact);
  return `<span class="impact impact-${label}">${label}</span>`;
}
function row(cells) {
  return `<tr>${cells.join("")}</tr>`;
}
function td(value, numeric = false) {
  return numeric ? `<td class="num">${value}</td>` : `<td>${value}</td>`;
}
function table(caption, headers, rows, numeric = []) {
  const head = headers.map((header, index) => `<th scope="col"${numeric.includes(index) ? ' class="num"' : ""}>${esc(header)}</th>`).join("");
  return `<table>
<caption>${esc(caption)}</caption>
<thead><tr>${head}</tr></thead>
<tbody>
${rows.join("\n")}
</tbody>
</table>`;
}
function keyValueTable(caption, entries) {
  const rows = entries.map(([key, value]) => `<tr><th scope="row">${esc(key)}</th><td>${value}</td></tr>`);
  return `<table>
<caption>${esc(caption)}</caption>
<tbody>
${rows.join("\n")}
</tbody>
</table>`;
}
function codeOrMissing(value) {
  return value ? `<code>${esc(value)}</code>` : '<span class="muted">not recorded</span>';
}
function htmlRule(report, rule, level) {
  const href = safeHref(rule.helpUrl);
  return [
    '<section class="rule">',
    `<h${level} id="rule-${esc(rule.ruleId)}"><code>${esc(rule.ruleId)}</code> ${impactBadge(rule.impact)}</h${level}>`,
    `<p>${esc(rule.help)}${href ? ` (<a href="${esc(href)}">rule documentation for ${esc(rule.ruleId)}</a>)` : ""}</p>`,
    "<ul>",
    `<li><strong>How to fix:</strong> ${esc(rule.fix)}</li>`,
    `<li>WCAG: ${rule.bestPractice ? "none mapped (best practice)" : rule.wcag.map((criterion) => esc(criterionLabel(criterion))).join("; ")}</li>`,
    `<li>Counts: ${rule.counts.new} new, ${rule.counts.baselined} ${report.input === "site-scan" ? "still open" : "baselined"}, ${rule.counts.fixed} fixed, ${rule.counts.unassessed} unassessed</li>`,
    "</ul>",
    table(
      `Occurrences of ${rule.ruleId}`,
      ["Status", "Severity", "Page", "Selector", "Element"],
      rule.findings.map(
        (finding) => row([
          td(
            esc(statusLabel(report, finding.status)) + (finding.assessmentReason ? ` <span class="muted">\u2014 ${esc(finding.assessmentReason)}</span>` : "")
          ),
          td(impactBadge(finding.impact)),
          td(`<code>${esc(finding.url)}</code>`),
          td(`<code>${esc(finding.selector)}</code>`),
          td(`<code>${esc(finding.html)}</code>`)
        ])
      )
    ),
    "</section>"
  ];
}
function evidenceReportHtml(report) {
  const { summary, trend, scope } = report;
  const scanMode = report.input === "site-scan";
  const title = `Accessibility evidence report \u2014 ${report.projectName}`;
  const compared = comparedWith(report);
  const parts = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`,
    '<meta name="generator" content="a11ygate">',
    `<title>${esc(title)}</title>`,
    `<style>${STYLE}</style>`,
    "</head>",
    "<body>",
    "<main>",
    `<h1>${esc(title)}</h1>`,
    `<p class="disclaimer" role="note">${esc(REPORT_DISCLAIMER)}</p>`,
    ...report.synthetic ? ['<p class="synthetic" role="note">SYNTHETIC evidence \u2014 not a real audit or customer assessment.</p>'] : [],
    '<h2 id="scan">Scan details</h2>',
    keyValueTable("Scan details", [
      ...scope ? [
        ["Scanned at", `<time datetime="${esc(scope.scannedAt)}">${esc(scope.scannedAt)}</time>`],
        [
          "Previous scan",
          scope.previousScannedAt ? `<time datetime="${esc(scope.previousScannedAt)}">${esc(scope.previousScannedAt)}</time>` : "none supplied"
        ]
      ] : [],
      ["Generated", `<time datetime="${esc(report.generatedAt)}">${esc(report.generatedAt)}</time>`],
      ["Commit", codeOrMissing(report.source.commit)],
      ["Branch", codeOrMissing(report.source.branch)],
      ["A11yGate", esc(report.tools.a11ygate)],
      ["axe-core (current)", esc(report.tools.axeCore.current.join(", ") || "unknown")],
      [
        `axe-core (${compared})`,
        trend.baselineSupplied ? esc(report.tools.axeCore.baseline.join(", ") || "unknown") : `no ${compared}`
      ],
      ["Gate", `${esc(report.gate.verdict)} at threshold ${esc(report.gate.threshold)} \u2014 ${esc(report.gate.reason)}`],
      ["Coverage", esc(report.coverage.status)]
    ]),
    '<h2 id="summary">Summary</h2>',
    table(
      "Current violations by severity",
      ["Severity", "Current violations"],
      [
        ...SEVERITIES.map((severity) => row([td(capitalise(severity)), td(summary.bySeverity[severity], true)])),
        row([td("Total"), td(summary.currentViolations, true)])
      ],
      [1]
    ),
    table(
      "Violations by status",
      ["Status", "Violations"],
      [
        row([td("New"), td(summary.new, true)]),
        row([td(esc(statusLabel(report, "baselined"))), td(summary.baselined, true)]),
        row([td("Fixed"), td(summary.fixed, true)]),
        row([td("Unassessed (not verified fixed)"), td(summary.unassessed, true)]),
        row([td("Current total"), td(summary.currentViolations, true)])
      ],
      [1]
    ),
    `<p>Rules with current violations: ${summary.rulesWithCurrentViolations}. WCAG success criteria with findings: ${report.criteria.length}. Best-practice rules: ${bestPracticeRules(report).length}.</p>`,
    `<section class="sheet" aria-labelledby="${scope ? "scope" : "pages"}">`
  ];
  if (scope) {
    parts.push(
      '<h2 id="scope">Scope</h2>',
      keyValueTable("Scan scope", [
        ["Start URL", `<code>${esc(scope.startUrl)}</code>`],
        ["Origin", `<code>${esc(scope.origin)}</code>`],
        ["Page limit", String(scope.maxPages)],
        ["Delay between pages", `${scope.delayMs} ms`],
        ["robots.txt", esc(scope.robots)],
        ["User agent", `<code>${esc(scope.userAgent)}</code>`],
        ["axe-core tags", esc(scope.axeTags.join(", "))]
      ]),
      "<h3>Boundaries</h3>",
      "<ul>",
      ...scope.boundaries.map((boundary) => `<li>${esc(boundary)}</li>`),
      "</ul>"
    );
  }
  parts.push(
    '<h2 id="pages">Pages scanned</h2>',
    table(
      "Pages scanned",
      ["Page", "Scanned", "axe-core", "Scan", "Violations", "New", scanMode ? "Still open" : "Baselined", `In ${compared}`],
      report.pages.map(
        (page) => row([
          td(`<code>${esc(page.url)}</code>`),
          td(esc(page.scannedAt)),
          td(esc(page.axeCore)),
          td(page.scanStatus),
          td(page.violations, true),
          td(page.new, true),
          td(page.baselined, true),
          td(page.inBaseline ? "yes" : "no")
        ])
      ),
      [4, 5, 6]
    )
  );
  if (scope) {
    const notScanned = scope.pages.filter((page) => page.scanStatus !== "complete");
    if (notScanned.length > 0) {
      parts.push(
        "<h3>Pages not scanned</h3>",
        "<ul>",
        ...notScanned.map(
          (page) => `<li><code>${esc(page.url)}</code> \u2014 ${esc(page.scanStatus)}${page.error ? `: ${esc(page.error)}` : ""}</li>`
        ),
        "</ul>"
      );
    }
    parts.push("<h3>Links skipped and why</h3>");
    if (scope.skipped.length === 0) parts.push("<p>No links were skipped.</p>");
    else {
      parts.push(
        table(
          "Links skipped and why",
          ["Reason", "Links", "Examples"],
          scope.skipped.map((group2) => {
            const extra = group2.urls.length - SKIPPED_EXAMPLES;
            const examples = group2.urls.slice(0, SKIPPED_EXAMPLES).map((url) => `<code>${esc(url)}</code>`).join("<br>");
            return row([
              td(esc(group2.label)),
              td(group2.count, true),
              td(examples + (extra > 0 ? `<br><span class="muted">\u2026and ${extra} more (full list in the JSON report)</span>` : ""))
            ]);
          }),
          [1]
        )
      );
    }
  }
  if (report.coverage.issues.length > 0) {
    parts.push(
      "<h3>Coverage issues</h3>",
      "<ul>",
      ...report.coverage.issues.map(
        (issue) => `<li><strong>${esc(issue.code)}</strong> on <code>${esc(issue.page)}</code>: ${esc(issue.detail)}</li>`
      ),
      "</ul>"
    );
  }
  parts.push(
    "</section>",
    '<section class="sheet" aria-labelledby="trend">',
    `<h2 id="trend">Trend versus ${compared}</h2>`,
    `<p>${esc(trendSentence(report))}</p>`
  );
  if (trend.totals) {
    parts.push(
      table(
        `Violations per rule, ${compared} and current`,
        ["Rule", "New", "Fixed", "Still open", capitalise(compared), "Current", "Change"],
        [
          ...trend.rules.map(
            (entry) => row([
              td(`<code>${esc(entry.ruleId)}</code>`),
              td(entry.new, true),
              td(entry.fixed, true),
              td(entry.stillOpen, true),
              td(entry.baseline, true),
              td(entry.current, true),
              td(signed(entry.delta), true)
            ])
          ),
          row([
            '<th scope="row">Total</th>',
            td(trend.totals.new, true),
            td(trend.totals.fixed, true),
            td(trend.totals.stillOpen, true),
            td(trend.totals.baseline, true),
            td(trend.totals.current, true),
            td(signed(trend.totals.delta), true)
          ])
        ],
        [1, 2, 3, 4, 5, 6]
      )
    );
  }
  parts.push(
    "</section>",
    '<section class="sheet" aria-labelledby="criteria">',
    '<h2 id="criteria">Findings by WCAG success criterion</h2>',
    `<p class="muted">${esc(MAPPING_NOTE)}</p>`
  );
  if (report.criteria.length === 0) parts.push("<p>No findings were mapped to a WCAG success criterion.</p>");
  for (const group2 of report.criteria) {
    parts.push(
      `<h3 id="sc-${esc(group2.criterion.number)}">WCAG ${esc(criterionLabel(group2.criterion))}</h3>`,
      `<p>Current findings: ${group2.currentFindings}.</p>`
    );
    for (const rule of rulesFor(report, group2.ruleIds)) parts.push(...htmlRule(report, rule, 4));
  }
  const bestPractice = bestPracticeRules(report);
  parts.push(
    "</section>",
    '<section class="sheet" aria-labelledby="best-practice">',
    '<h2 id="best-practice">Best-practice rules (no WCAG success criterion)</h2>'
  );
  if (bestPractice.length === 0) parts.push("<p>No best-practice findings.</p>");
  for (const rule of bestPractice) parts.push(...htmlRule(report, rule, 3));
  parts.push(
    "</section>",
    '<h2 id="disclaimer">Disclaimer</h2>',
    `<p>${esc(REPORT_DISCLAIMER)}</p>`,
    "</main>",
    "</body>",
    "</html>",
    ""
  );
  return parts.join("\n");
}
function renderEvidenceReport(report, format) {
  if (format === "json") return evidenceReportJson(report);
  if (format === "md") return evidenceReportMarkdown(report);
  return evidenceReportHtml(report);
}

// packages/cli/src/args.ts
var VALUE_FLAGS = {
  "--current": "current",
  "-c": "current",
  "--baseline": "baseline",
  "-b": "baseline",
  "--scan": "scan",
  "--previous-scan": "previousScan",
  "--threshold": "threshold",
  "-t": "threshold",
  "--markdown": "markdown",
  "-m": "markdown",
  "--json": "json",
  "-j": "json",
  "--update-baseline": "updateBaseline",
  "--manual-evidence": "manualEvidence",
  "--format": "format",
  "-f": "format",
  "--out": "out",
  "-o": "out",
  "--generated-at": "generatedAt",
  "--commit": "commit",
  "--branch": "branch"
};
var GATE_ONLY = ["markdown", "json", "updateBaseline", "manualEvidence"];
var REPORT_ONLY = ["scan", "previousScan", "format", "out", "generatedAt", "commit", "branch"];
function flagName(token) {
  const eq = token.indexOf("=");
  if (eq === -1) return { name: token };
  return { name: token.slice(0, eq), inline: token.slice(eq + 1) };
}
function parseArgs(input) {
  const command = input[0] === "report" ? "report" : "gate";
  const argv = command === "report" ? input.slice(1) : input;
  if (argv.includes("--help") || argv.includes("-h")) {
    return {
      ok: true,
      options: {
        command,
        help: true,
        version: false,
        current: [],
        baseline: [],
        threshold: "serious"
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
  let scan;
  let previousScan;
  let formatText;
  let out;
  let generatedAtText;
  let commit;
  let branch;
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
    if (command === "report" && GATE_ONLY.includes(field)) {
      return { ok: false, error: `${name} is not available with a11ygate report. Use --format and --out.` };
    }
    if (command === "gate" && REPORT_ONLY.includes(field)) {
      return { ok: false, error: `${name} is only available with a11ygate report.` };
    }
    const value = inline !== void 0 ? inline : argv[index + 1];
    if (inline === void 0) index += 1;
    if (value === void 0 || value.length === 0) {
      return { ok: false, error: `${name} needs a value.` };
    }
    const stdoutFlag = field === "json" || field === "out";
    if (value.startsWith("-") && !(stdoutFlag && value === "-")) {
      return { ok: false, error: `${name} needs a value.` };
    }
    if (field === "current") current.push(value);
    else if (field === "baseline") baseline.push(value);
    else if (field === "scan" || field === "previousScan") {
      if ((field === "scan" ? scan : previousScan) !== void 0) return { ok: false, error: `${name} can only be given once.` };
      if (field === "scan") scan = value;
      else previousScan = value;
    } else if (field === "threshold") thresholdText = value;
    else if (field === "markdown") markdown = value;
    else if (field === "json") json = value;
    else if (field === "updateBaseline") updateBaseline = value;
    else if (field === "manualEvidence") manualEvidence = value;
    else if (field === "format") formatText = value;
    else if (field === "out") out = value;
    else if (field === "generatedAt") generatedAtText = value;
    else if (field === "commit") commit = value;
    else branch = value;
  }
  if (!help && !version) {
    if (scan !== void 0 && (current.length > 0 || baseline.length > 0)) {
      return { ok: false, error: "Use either --scan (with --previous-scan) or --current (with --baseline), not both." };
    }
    if (previousScan !== void 0 && scan === void 0) {
      return { ok: false, error: "--previous-scan needs --scan." };
    }
  }
  let format;
  if (formatText !== void 0) {
    if (!isReportFormat(formatText)) {
      return { ok: false, error: `Unknown report format "${formatText}". Use html, md, or json.` };
    }
    format = formatText;
  }
  let generatedAt;
  if (generatedAtText !== void 0) {
    const parsedDate = new Date(generatedAtText);
    if (!/^\d{4}-\d{2}-\d{2}T/.test(generatedAtText) || Number.isNaN(parsedDate.getTime())) {
      return { ok: false, error: "--generated-at needs an ISO 8601 date-time such as 2026-11-10T09:00:00Z." };
    }
    generatedAt = parsedDate.toISOString();
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
    options: {
      command,
      help,
      version: version && !help,
      current,
      baseline,
      scan,
      previousScan,
      threshold,
      markdown,
      json,
      updateBaseline,
      manualEvidence,
      format,
      out,
      generatedAt,
      commit,
      branch
    }
  };
}

// packages/cli/src/help.ts
function helpText() {
  return `a11ygate \u2014 accessibility regression gate for axe-core JSON

Usage:
  a11ygate --current <file> [--current <file>] [--baseline <file>] [options]
  a11ygate scan <url> [--crawl [n]] [--fail-on <impact>] [--out-dir <dir>]   (see a11ygate scan --help)
  a11ygate report --current <file> [--baseline <file>] [--format html|md|json] [--out <file>]
  a11ygate report --scan <scan.json> [--previous-scan <older.json>] [--format html|md|json] [--out <file>]

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
  -h, --help                   Show this help.
      --version                Show the version.

Evidence report (a11ygate report):
  Takes the same --current, --baseline and --threshold options, or instead:
      --scan <file>            JSON written by a11ygate scan (kind "site-scan"). Adds scope, pages skipped and why,
                               and the scanner's read-only boundaries to the report.
      --previous-scan <file>   An older a11ygate scan JSON. The trend shows new, fixed and still-open per rule.
  plus:
  -f, --format <format>        html (default), md, or json. Inferred from the --out extension when omitted.
  -o, --out <file>             Write the report to this file. Omit or use - to print it.
      --generated-at <iso>     Fix the report timestamp, for reproducible output. Default: now.
      --commit <sha>           Commit to record. Default: $GITHUB_SHA when set.
      --branch <name>          Branch to record. Default: $GITHUB_HEAD_REF or $GITHUB_REF_NAME when set.
  The HTML report is one self-contained file with no external assets or scripts, and prints cleanly to PDF.
  Every format always states: Automated testing only. Not a WCAG audit, certification or legal advice.
  report exits 0 once the report is written, whatever the gate verdict, and 2 on errors.

Exit codes:
  0  No detected new finding is at or above the threshold; existing debt/unassessed scope remain.
  1  At least one new finding is at or above the threshold.
  2  Incomplete scan coverage, unsafe outputs, invalid evidence, or unreadable arguments/JSON.

Examples:
  npx @qe-atlas/a11ygate --current axe.json --baseline a11y/baseline.json
  npx @qe-atlas/a11ygate --current home.json --current cart.json --threshold critical --json result.json
  npx @qe-atlas/a11ygate --current axe.json --update-baseline a11y/baseline.json
  npx @qe-atlas/a11ygate report --current axe.json --baseline a11y/baseline.json --out a11y-report.html
  npx @qe-atlas/a11ygate report --scan a11ygate-scan.json --previous-scan last-month.json --out report.html

A file larger than 8 MB is refused. The same diff and gate as the web app are used.
This source build is unreleased; published 0.1.0 does not include these coverage/manual features.
PASS is not legal advice or certification. Baseline updates never clear the current gate result.
`;
}

// packages/cli/src/scan.ts
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

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
    if (outcome.result) {
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

// lib/group.ts
function groupLabel(key, value) {
  if (key === "impact" && value === "unknown") return "unknown impact";
  return value;
}
function groupFindings(findings, by) {
  const groups = /* @__PURE__ */ new Map();
  for (const finding of findings) {
    const key = by === "rule" ? finding.ruleId : by === "page" ? finding.path : finding.impact ?? "unknown";
    const existing = groups.get(key);
    if (existing) existing.push(finding);
    else groups.set(key, [finding]);
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
function emptyCounts2() {
  return { critical: 0, serious: 0, moderate: 0, minor: 0, unknown: 0 };
}
function selectorsFor(result, ruleId, selector) {
  const node = result.violations.find((v) => v.id === ruleId)?.nodes.find((n) => n.target.join(" ") === selector);
  return node ? [...node.target] : [selector];
}
function toScanFinding(finding, result) {
  const hits = lookupStandards(finding.tags);
  const wcag = hits.flatMap(
    (hit) => hit.kind === "criterion" ? [{ number: hit.number, name: hit.name, level: hit.level, wcag: hit.wcag, en301549: hit.en301549 }] : []
  );
  return {
    pageUrl: finding.url,
    ruleId: finding.ruleId,
    impact: finding.impact,
    selector: finding.selector,
    selectors: selectorsFor(result, finding.ruleId, finding.selector),
    html: finding.html,
    help: finding.help,
    helpUrl: finding.helpUrl,
    tags: finding.tags,
    wcag,
    bestPractice: wcag.length === 0,
    fingerprint: finding.fingerprint
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
  const totals = emptyCounts2();
  for (const page of input.crawl.pages) {
    const byImpact = emptyCounts2();
    let pageFindings = [];
    if (page.result) {
      results.push(page.result);
      pageFindings = findingsFromResults([page.result]).map((f) => toScanFinding(f, page.result));
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
  const gating = gatingScanFindings(findings, input.failOn);
  const verdict = gating.length > 0 ? "FAIL" : "PASS";
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
    reason,
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
function groupByCriterion2(findings) {
  const groups = /* @__PURE__ */ new Map();
  for (const finding of findings) {
    const keys = finding.bestPractice ? [{ key: "best-practice", label: "Best practice (no WCAG success criterion mapped)" }] : finding.wcag.map((c) => ({ key: c.number, label: `WCAG ${c.number} ${c.name} (${c.level}); EN 301 549 ${c.en301549}` }));
    for (const { key, label } of keys) {
      const group2 = groups.get(key) ?? { key, label, findings: [] };
      group2.findings.push(finding);
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
  return `- **${cell(f.ruleId)}** (${f.impact ?? "unspecified"}) on ${code(f.pageUrl)} \u2014 ${code(f.selector)} \u2014 ${cell(f.help)} \u2014 [rule guidance](${encodeURI(f.helpUrl).replace(/[()]/g, encodeURIComponent)})`;
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
  const byCriterion = groupByCriterion2(report.findings);
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
  lines.push("## Scope and boundaries", "", ...report.boundaries.map((b) => `- ${cell(b)}`), "", DISCLAIMER, LEGAL_DISCLAIMER, "");
  return lines.join("\n");
}
function esc2(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function safeHref2(url) {
  return /^https?:\/\//i.test(url) ? esc2(url) : "#";
}
function htmlFinding(f) {
  return `<li><strong>${esc2(f.ruleId)}</strong> <span class="impact ${esc2(f.impact ?? "unknown")}">${esc2(f.impact ?? "unspecified")}</span><br>Page: <code>${esc2(f.pageUrl)}</code><br>Selector: <code>${esc2(f.selector)}</code><br>${esc2(f.help)} \u2014 <a href="${safeHref2(f.helpUrl)}">Rule guidance<span class="sr"> for ${esc2(f.ruleId)}</span></a></li>`;
}
function htmlGroups(title, groups) {
  if (groups.length === 0) return `<h2>${esc2(title)}</h2><p>None detected.</p>`;
  return `<h2>${esc2(title)}</h2>` + groups.map((g) => `<section><h3>${esc2(g.label)} (${g.findings.length})</h3><ul>${sortFindings(g.findings).map(htmlFinding).join("")}</ul></section>`).join("");
}
function scanHtml(report) {
  const counts = ["critical", "serious", "moderate", "minor", "unknown"].map((k) => `<tr><th scope="row">${k}</th><td>${report.counts.byImpact[k]}</td></tr>`).join("");
  const pages = report.pages.map((p) => `<tr><td><code>${esc2(p.url)}</code></td><td>${p.status ?? "\u2014"}</td><td>${esc2(p.scanStatus)}${p.error ? " \u2014 " + esc2(p.error) : ""}</td><td>${p.findings}</td></tr>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>A11yGate site scan \u2014 ${esc2(report.startUrl)}</title>
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
<p>Start URL: <code>${esc2(report.startUrl)}</code></p>
<p class="verdict">Verdict: ${esc2(report.verdict)} (fail on: ${esc2(report.failOn)})</p>
<p>${esc2(report.reason)}</p>
<p>Scanned ${esc2(report.scannedAt)}. Pages analysed: ${report.counts.pagesScanned}; failed: ${report.counts.pagesFailed}. axe-core ${esc2(report.axeVersion ?? "n/a")}; A11yGate ${esc2(report.version)}.</p>
<table><caption>Findings by severity</caption><thead><tr><th scope="col">Severity</th><th scope="col">Findings</th></tr></thead><tbody>${counts}</tbody></table>
<h2>Pages</h2>
<table><thead><tr><th scope="col">Page</th><th scope="col">HTTP</th><th scope="col">Status</th><th scope="col">Findings</th></tr></thead><tbody>${pages}</tbody></table>
${htmlGroups("Findings by WCAG criterion", groupByCriterion2(report.findings))}
${htmlGroups("Findings by severity", groupBySeverity(report.findings))}
<h2>Scope and boundaries</h2>
<ul>${report.boundaries.map((b) => `<li>${esc2(b)}</li>`).join("")}</ul>
<p>${esc2(DISCLAIMER)}</p>
<p>${esc2(LEGAL_DISCLAIMER)}</p>
</main>
</body>
</html>
`;
}

// packages/cli/src/scan.ts
var DEFAULT_DELAY_MS = 1e3;
var NAVIGATION_TIMEOUT_MS = 3e4;
var VALUE_FLAGS2 = /* @__PURE__ */ new Set(["--fail-on", "--out-dir", "--json", "--markdown", "--html", "--delay-ms"]);
function parseScanArgs(argv) {
  const options = { help: false, url: "", maxPages: 1, failOn: "serious", delayMs: DEFAULT_DELAY_MS, warnings: [] };
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
    if (name === "--fail-on") {
      if (!isFailOn(value)) return { ok: false, error: `Unknown --fail-on "${value}". Use minor, moderate, serious, critical, or none.` };
      options.failOn = value;
    } else if (name === "--delay-ms") {
      if (!/^\d+$/.test(value) || Number(value) > 6e4) return { ok: false, error: "--delay-ms needs a whole number of milliseconds from 0 to 60000." };
      options.delayMs = Number(value);
    } else if (name === "--out-dir") options.outDir = value;
    else if (name === "--json") options.json = value;
    else if (name === "--markdown") options.markdown = value;
    else options.html = value;
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
  return { ok: true, options };
}
function scanHelpText() {
  return `a11ygate scan \u2014 load live pages in headless Chromium and run axe-core

Usage:
  a11ygate scan <url> [--crawl [n]] [--fail-on <impact>] [--out-dir <dir>]
                      [--json <file>] [--markdown <file>] [--html <file>] [--delay-ms <ms>]

Options:
  --crawl [n]          Breadth-first crawl of same-origin a[href] links, up to n pages
                       (default and hard maximum: ${MAX_CRAWL_PAGES}). Without --crawl only <url> is scanned.
  --fail-on <impact>   minor, moderate, serious, critical, or none. Default: serious.
  --out-dir <dir>      Write a11ygate-scan.json, a11ygate-scan.md and a11ygate-scan.html here.
  --json <file>        Write the JSON report (use - to print JSON instead of Markdown).
  --markdown <file>    Write the Markdown summary. It is printed to stdout unless --json -.
  --html <file>        Write a self-contained HTML summary.
  --delay-ms <ms>      Pause between page loads. Default: ${DEFAULT_DELAY_MS}.

Requires the optional peer dependencies:
  npm install --save-dev playwright @axe-core/playwright && npx playwright install chromium

Boundaries: only scan sites you own or are authorized to test. Read-only (no clicks, forms or
login), same-origin only, honours robots.txt, identifies itself as A11yGate. Automated testing
finds a subset of issues; PASS is not conformance, certification or legal advice.

Exit codes:
  0  No finding is at or above --fail-on.
  1  At least one finding is at or above --fail-on.
  2  Bad arguments, missing browser/dependencies, or the start page is unreachable.
`;
}
var ScanSetupError = class extends Error {
};
var INSTALL_HINT = "a11ygate scan needs the optional peer dependencies playwright and @axe-core/playwright.\nInstall them with: npm install --save-dev playwright @axe-core/playwright && npx playwright install chromium\n";
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
function isModuleNotFound(error) {
  const code2 = error?.code;
  return code2 === "ERR_MODULE_NOT_FOUND" || code2 === "MODULE_NOT_FOUND";
}
var playwrightEngine = async ({ userAgent, origin }) => {
  let playwright;
  let axeModule;
  try {
    playwright = await import("playwright");
    axeModule = await import("@axe-core/playwright");
  } catch (error) {
    if (isModuleNotFound(error)) throw new ScanSetupError(INSTALL_HINT);
    throw error;
  }
  const AxeBuilder = axeModule.default ?? axeModule.AxeBuilder;
  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message.split("\n")[0] : "unknown error";
    throw new ScanSetupError(`Could not launch headless Chromium (${detail}).
Install it with: npx playwright install chromium
`);
  }
  const context = await browser.newContext({ userAgent, acceptDownloads: false, serviceWorkers: "block", javaScriptEnabled: true });
  return {
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
        const axe = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).analyze();
        return { status, finalUrl, contentType, links, result: toAxeResults(url, axe, userAgent) };
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
    engine = await (io.engine ?? playwrightEngine)({ userAgent, origin });
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
    robotsNote: robots.note
  });
  const json = `${JSON.stringify(report, null, 2)}
`;
  const markdown = scanMarkdown(report);
  const targets = options.outDir ? [
    [path.join(options.outDir, "a11ygate-scan.json"), json],
    [path.join(options.outDir, "a11ygate-scan.md"), markdown],
    [path.join(options.outDir, "a11ygate-scan.html"), scanHtml(report)]
  ] : [
    [options.json === "-" ? void 0 : options.json, json],
    [options.markdown, markdown],
    [options.html, options.html ? scanHtml(report) : ""]
  ];
  try {
    if (options.outDir) await mkdir(path.resolve(cwd, options.outDir), { recursive: true });
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
  return scanExitCode(report.findings, options.failOn);
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
      documents.push({ name: file, text: await readFile(absolute, "utf8") });
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
      const parsed = JSON.parse(await readFile(candidate, "utf8"));
      if (parsed.name === "@qe-atlas/a11ygate" && parsed.version) return parsed.version;
    } catch {
    }
  }
  return "0.0.0";
}
function findingJson(finding) {
  return {
    status: finding.status,
    assessmentReason: finding.assessmentReason,
    guidance: findingGuidance(finding),
    fingerprint: finding.fingerprint,
    ruleId: finding.ruleId,
    impact: finding.impact,
    path: finding.path,
    url: finding.url,
    selector: finding.selector,
    html: finding.html,
    help: finding.help,
    helpUrl: finding.helpUrl,
    tags: finding.tags
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
  const env = io.env ?? process.env;
  if (argv[0] === "scan") return runScan(argv.slice(1), { ...io, version: await readVersion() });
  const parsed = parseArgs(argv);
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
  const currentFiles = options.scan ? [options.scan] : options.current;
  const baselineFiles = options.scan ? options.previousScan ? [options.previousScan] : [] : options.baseline;
  if (currentFiles.length === 0) {
    stderr(
      options.command === "report" ? "Pass a scan JSON with --scan, or at least one current axe JSON file with --current.\n" : "Pass at least one current axe JSON file with --current.\n"
    );
    return 2;
  }
  const reportOut = options.out && options.out !== "-" ? options.out : void 0;
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
    const inputs = await Promise.all([...currentFiles, ...baselineFiles, ...options.manualEvidence ? [options.manualEvidence] : []].map(identify));
    const baselineProtectedInputs = await Promise.all([...currentFiles, ...options.manualEvidence ? [options.manualEvidence] : []].map(identify));
    const outputs = [reportOut, options.markdown, options.json === "-" ? void 0 : options.json, options.updateBaseline, options.updateBaseline ? options.updateBaseline + ".review.json" : void 0].filter((x) => !!x);
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
  const currentRead = await readDocuments(currentFiles, cwd);
  if (!currentRead.ok) {
    stderr(`${currentRead.error}
`);
    return 2;
  }
  let siteScan = null;
  if (options.scan) {
    const parsedScan = parseSiteScan(currentRead.documents[0]?.text ?? "");
    if (!parsedScan.ok) {
      stderr(`${options.scan}: ${parsedScan.error}
`);
      return 2;
    }
    siteScan = parsedScan.scan;
  }
  const current = parseAxeDocuments(currentRead.documents);
  if (!current.ok) {
    stderr(`${current.error}
`);
    return 2;
  }
  let baselineResults = null;
  let baselineSynthetic = false;
  let previousScan = null;
  if (baselineFiles.length > 0) {
    const baselineRead = await readDocuments(baselineFiles, cwd);
    if (!baselineRead.ok) {
      stderr(`${baselineRead.error}
`);
      return 2;
    }
    if (options.previousScan) {
      const parsedPrevious = parseSiteScan(baselineRead.documents[0]?.text ?? "");
      if (!parsedPrevious.ok) {
        stderr(`${options.previousScan}: ${parsedPrevious.error}
`);
        return 2;
      }
      previousScan = parsedPrevious.scan;
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
  const generatedAt = options.generatedAt ?? now().toISOString();
  const version = await readVersion();
  if (options.command === "report") {
    const report = buildEvidenceReport({
      scan: siteScan ? { current: siteScan, previous: previousScan } : null,
      generatedAt,
      version,
      projectName,
      verdict,
      threshold: options.threshold,
      reason,
      synthetic: current.synthetic || baselineSynthetic,
      commit: options.commit ?? env.GITHUB_SHA ?? null,
      branch: options.branch ?? (env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || null),
      current: current.results,
      baseline: baselineResults,
      diff
    });
    const rendered = renderEvidenceReport(report, options.format ?? inferReportFormat(reportOut));
    if (!reportOut) {
      stdout(rendered);
      return 0;
    }
    try {
      await writeFile2(resolveInput(cwd, reportOut), rendered, "utf8");
    } catch (error) {
      stderr(`${writeFailure(reportOut, error)}
`);
      return 2;
    }
    stderr(`Wrote evidence report ${reportOut}
`);
    return 0;
  }
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
