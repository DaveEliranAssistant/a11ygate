// lib/modelfix/adapters.ts
var BUILTIN_ADAPTERS = [];
function failingAdapter(id, message = "stub provider unavailable") {
  return {
    id,
    isConfigured: () => true,
    draft: async () => {
      throw new Error(message);
    }
  };
}
function staticAdapter(id, make) {
  return {
    id,
    isConfigured: () => true,
    draft: async (request) => make(request.findingId, request)
  };
}
var NAME_RULES = /* @__PURE__ */ new Set([
  "aria-command-name",
  "aria-dialog-name",
  "aria-input-field-name",
  "aria-meter-name",
  "aria-progressbar-name",
  "aria-toggle-field-name",
  "aria-tooltip-name",
  "aria-treeitem-name"
]);
function addAttribute(lines, name, value) {
  for (let index = 0; index < lines.length; index += 1) {
    const match = /<([a-zA-Z][\w.:-]*)/.exec(lines[index]);
    if (!match) continue;
    const at = match.index + match[0].length;
    const next = [...lines];
    next[index] = `${lines[index].slice(0, at)} ${name}="${value}"${lines[index].slice(at)}`;
    return next;
  }
  return null;
}
function reviewComment(path2, indent, text) {
  return /\.(jsx|tsx)$/i.test(path2) ? `${indent}{/* ${text} */}` : `${indent}<!-- ${text} -->`;
}
function stubDraft(request) {
  const base = {
    findingId: request.findingId,
    sourceBlobHash: request.sourceBlobHash,
    path: request.path,
    startLine: request.startLine,
    endLine: request.endLine,
    original: [...request.original]
  };
  if (request.ruleId === "image-alt" || NAME_RULES.has(request.ruleId)) {
    const image = request.ruleId === "image-alt";
    const replacement = image ? addAttribute(request.original, "alt", "TODO(a11ygate): describe this image or confirm it is decorative") : addAttribute(request.original, "aria-label", "TODO(a11ygate): name this control");
    if (!replacement) return null;
    return {
      ...base,
      replacement,
      rationale: `Stub draft: adds a ${image ? "alt" : "aria-label"} placeholder. A person must write the final text.`,
      humanReview: ["model-drafted", "placeholder-accessible-name"]
    };
  }
  if (request.ruleId === "color-contrast") {
    const indent = /^\s*/.exec(request.original[0] ?? "")?.[0] ?? "";
    return {
      ...base,
      replacement: [reviewComment(request.path, indent, "TODO(a11ygate): raise text/background contrast; a person must pick the colours"), ...request.original],
      rationale: "Stub draft: marks the element for a contrast fix. It does not choose colours.",
      humanReview: ["model-drafted"]
    };
  }
  return null;
}
function stubAdapter(id = "stub") {
  return {
    id,
    isConfigured: () => true,
    draft: async (request) => {
      const draft = stubDraft(request);
      if (!draft) throw new Error("stub adapter has no draft for this finding");
      return draft;
    }
  };
}

// lib/modelfix/validate.ts
import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

// lib/modelfix/types.ts
var REPO_CONFIG_FILE = ".a11ygate.yml";
var MODEL_ELIGIBLE_RULES = /* @__PURE__ */ new Set([
  "color-contrast",
  "image-alt",
  // ARIA accessible-name rules.
  "aria-command-name",
  "aria-dialog-name",
  "aria-input-field-name",
  "aria-meter-name",
  "aria-progressbar-name",
  "aria-toggle-field-name",
  "aria-tooltip-name",
  "aria-treeitem-name"
]);
var HUMAN_REVIEW_FLAGS = [
  /** Always set: the change was written by a model. */
  "model-drafted",
  /** Alt / accessible-name text was set to something other than a TODO(a11ygate) placeholder (design §7). */
  "generated-accessible-name",
  /** Alt / accessible-name text is a TODO(a11ygate) placeholder; a person must write the final wording. */
  "placeholder-accessible-name",
  /** Visible text content changed. */
  "visible-text-changed",
  /** Colours or other presentation changed; a person must confirm the design intent. */
  "visual-change"
];
var DRAFT_LIMITS = {
  /** Max UTF-8 bytes of the joined replacement. */
  maxReplacementBytes: 4096,
  /** Max replacement lines beyond the original range length. */
  maxExtraLines: 5,
  /** Max replacement lines in total. */
  maxReplacementLines: 40,
  /** Max characters in one replacement line. */
  maxLineLength: 1e3,
  /** Max characters in the rationale. */
  maxRationaleLength: 1e3
};

// lib/modelfix/validate.ts
var PLACEHOLDER = "TODO(a11ygate)";
function gitBlobHash(content) {
  const body = Buffer.from(content, "utf8");
  return createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
}
var DRAFT_KEYS = ["findingId", "sourceBlobHash", "path", "startLine", "endLine", "original", "replacement", "rationale", "humanReview"];
var MULTI_FILE_KEYS = /* @__PURE__ */ new Set(["files", "edits", "patches", "patch", "diff", "additionalFiles", "changes", "paths"]);
var SCANNER_CONFIG = [
  /(^|\/)\.?a11ygate\.ya?ml$/i,
  /(^|\/)\.?a11ygate(rc)?(\.[a-z]+)?$/i,
  /(^|\/)\.axerc(\.[a-z]+)?$/i,
  /(^|\/)axe(\.config)?\.(json|js|cjs|mjs|ts|ya?ml)$/i,
  /(^|\/)\.?lighthouserc(\.[a-z]+)?$/i,
  /(^|\/)\.?pa11y(ci|rc)?(\.[a-z]+)?$/i,
  /(^|\/)\.htmlcsrc(\.[a-z]+)?$/i,
  /(^|\/)\.github\//i,
  /(^|\/)action\.ya?ml$/i,
  /(^|\/)\.gitlab-ci\.ya?ml$/i,
  /(^|\/)(package|package-lock|npm-shrinkwrap)\.json$/i,
  /(^|\/)(yarn\.lock|pnpm-lock\.yaml)$/i,
  /(^|\/)(playwright|vitest|jest|cypress)\.config\.[a-z]+$/i,
  /(^|\/)(eslint\.config\.[a-z]+|\.eslintrc(\.[a-z]+)?)$/i,
  /(^|\/)(stylelint\.config\.[a-z]+|\.stylelintrc(\.[a-z]+)?)$/i
];
var TEST_FILE = [/(^|\/)(tests?|__tests__|e2e|spec)\//i, /\.(test|spec)\.[a-z]+$/i];
var SUPPRESSION = [
  /eslint-disable/i,
  /stylelint-disable/i,
  /@ts-(ignore|nocheck|expect-error)/i,
  /axe-(skip|ignore|disable)/i,
  /data-axe-[a-z-]*/i,
  /a11ygate-(skip|ignore|disable)/i,
  /htmlcs-(ignore|skip|disable)/i,
  /pa11y-(ignore|skip|disable)/i,
  /lighthouse-(ignore|skip|disable)/i,
  /\bnoqa\b/i,
  /aria-hidden\s*=\s*["'{]?\s*true/i,
  /\brole\s*=\s*["'{]?\s*(presentation|none)\b/i,
  /\balt\s*=\s*(""|''|\{\s*(""|''|``)\s*\})/i,
  /display\s*:\s*["']?none/i,
  /visibility\s*:\s*["']?hidden/i,
  /\bhidden\b(?=[\s>=/])/i,
  /opacity\s*:\s*["']?0(\.0+)?\s*[;"'}]/i
];
var EXECUTABLE = [
  /<\s*script\b/i,
  /javascript\s*:/i,
  /\son[a-z]+\s*=/i,
  /<\s*(iframe|object|embed|base|meta)\b/i,
  /\bsrcdoc\s*=/i,
  /dangerouslySetInnerHTML/,
  /\binnerHTML\b/,
  /\beval\s*\(/,
  /\bnew\s+Function\b/,
  /\b(require|import)\s*\(/,
  /child_process/,
  /^\s*#!/m
];
var NAME_ATTRS = ["alt", "aria-label", "aria-labelledby", "aria-description", "aria-describedby", "title", "label"];
var NAME_ATTR = new RegExp(`(?:^|[\\s<])(${NAME_ATTRS.join("|")})\\s*=\\s*("[^"]*"|'[^']*'|\\{[^}]*\\}|[^\\s>]+)`, "gi");
var PRESENTATION_ATTR = /(?:^|[\s<])(style|class|className|color|bgcolor|background)\s*=\s*("[^"]*"|'[^']*'|\{[^}]*\}|[^\s>]+)/gi;
var CSS_COLOR = /\b(color|background(?:-color)?|fill|stroke)\s*:[^;"'}]*/gi;
function count(text, pattern) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return (text.match(new RegExp(pattern.source, flags)) ?? []).length;
}
function added(before, after, patterns) {
  return patterns.find((pattern) => count(after, pattern) > count(before, pattern)) ?? null;
}
function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
function isLine(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}
function parseSchema(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { code: "schema", detail: "draft is not an object" };
  const record = input;
  for (const key of Object.keys(record)) {
    if (MULTI_FILE_KEYS.has(key)) return { code: "extra-file", detail: `draft carries extra file entries (${key})` };
    if (!DRAFT_KEYS.includes(key)) return { code: "schema", detail: `unknown field ${key}` };
  }
  for (const key of DRAFT_KEYS) if (!(key in record)) return { code: "schema", detail: `missing field ${key}` };
  const { findingId, sourceBlobHash, path: file, startLine, endLine, original, replacement, rationale, humanReview } = record;
  if (typeof findingId !== "string" || !findingId) return { code: "schema", detail: "findingId must be a non-empty string" };
  if (typeof sourceBlobHash !== "string" || !/^[0-9a-f]{40}$/.test(sourceBlobHash)) return { code: "schema", detail: "sourceBlobHash must be 40 lower-case hex characters" };
  if (typeof file !== "string") return { code: "schema", detail: "path must be a string" };
  if (!isLine(startLine) || !isLine(endLine) || endLine < startLine) return { code: "schema", detail: "startLine/endLine must be positive integers with endLine >= startLine" };
  if (!isStringArray(original) || !isStringArray(replacement)) return { code: "schema", detail: "original and replacement must be string arrays" };
  if (typeof rationale !== "string" || !rationale.trim()) return { code: "schema", detail: "rationale must be a non-empty string" };
  if (rationale.length > DRAFT_LIMITS.maxRationaleLength) return { code: "oversize", detail: "rationale too long" };
  if (!isStringArray(humanReview) || !humanReview.every((flag) => HUMAN_REVIEW_FLAGS.includes(flag))) {
    return { code: "schema", detail: "humanReview must list known flags only" };
  }
  return input;
}
function unsafePath(file) {
  if (!file) return "empty path";
  if (file.includes("\0")) return "null byte in path";
  if (/[\u0000-\u001f\u007f]/.test(file)) return "control character in path";
  if (file.includes("\\")) return "backslash in path";
  if (file.startsWith("/") || /^[a-z]:/i.test(file) || file.startsWith("~")) return "absolute path";
  if (/%2e|%2f|%5c/i.test(file)) return "encoded path separator";
  const segments = file.split("/");
  if (segments.some((segment) => segment === "..")) return "parent directory segment";
  if (segments.some((segment) => segment === "" || segment === ".")) return "non-normalized path";
  if (path.posix.normalize(file) !== file) return "non-normalized path";
  return null;
}
function symlinkEscape(repoRoot, file) {
  let root;
  try {
    root = realpathSync(repoRoot);
  } catch {
    return { code: "missing-file", detail: "repository root not found" };
  }
  const target = path.join(root, ...file.split("/"));
  try {
    lstatSync(target);
  } catch {
    return { code: "missing-file", detail: "file not found under the repository root" };
  }
  let real;
  try {
    real = realpathSync(target);
  } catch {
    return { code: "symlink-escape", detail: "path does not resolve inside the repository" };
  }
  const relative = path.relative(root, real);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return { code: "symlink-escape", detail: "path resolves outside the repository root" };
  }
  return null;
}
function attrValues(text, pattern) {
  const values = /* @__PURE__ */ new Map();
  for (const match of text.matchAll(pattern)) {
    const name = match[1].toLowerCase();
    values.set(name, [...values.get(name) ?? [], match[2]]);
  }
  return values;
}
function visibleText(text) {
  return text.replace(/<!--[\s\S]*?-->/g, " ").replace(/\{\/\*[\s\S]*?\*\/\}/g, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
function presentation(text) {
  return JSON.stringify([...attrValues(text, PRESENTATION_ATTR)], null, 0) + (text.match(CSS_COLOR) ?? []).join("|");
}
function requiredReviewFlags(original, replacement) {
  const flags = /* @__PURE__ */ new Set(["model-drafted"]);
  const nameFlag = (text) => text.includes(PLACEHOLDER) ? "placeholder-accessible-name" : "generated-accessible-name";
  const before = attrValues(original, NAME_ATTR);
  for (const [name, values] of attrValues(replacement, NAME_ATTR)) {
    const previous = before.get(name) ?? [];
    for (const value of values) if (!previous.includes(value)) flags.add(nameFlag(value));
  }
  const textBefore = visibleText(original);
  const textAfter = visibleText(replacement);
  if (textBefore !== textAfter) {
    flags.add("visible-text-changed");
    flags.add(nameFlag(textAfter));
  }
  if (presentation(original) !== presentation(replacement)) flags.add("visual-change");
  return HUMAN_REVIEW_FLAGS.filter((flag) => flags.has(flag));
}
function validateDraft(input, context) {
  try {
    return validate(input, context);
  } catch {
    return { ok: false, rejection: { code: "schema", detail: "draft could not be read" } };
  }
}
function reject(code, detail) {
  return { ok: false, rejection: { code, detail } };
}
function validate(input, { request, content, repoRoot }) {
  const parsed = parseSchema(input);
  if ("code" in parsed) return reject(parsed.code, parsed.detail);
  const draft = parsed;
  if (draft.findingId !== request.findingId) return reject("finding-mismatch", "draft answers a different finding");
  const unsafe = unsafePath(draft.path);
  if (unsafe) return reject("path-traversal", unsafe);
  if (SCANNER_CONFIG.some((pattern) => pattern.test(draft.path))) return reject("scanner-config", "draft targets scanner, CI or gate configuration");
  if (TEST_FILE.some((pattern) => pattern.test(draft.path))) return reject("check-suppression", "draft targets a test file");
  if (draft.path !== request.path) return reject("extra-file", "draft names a file outside the request");
  if (repoRoot !== void 0) {
    const escape = symlinkEscape(repoRoot, draft.path);
    if (escape) return reject(escape.code, escape.detail);
  }
  if (draft.startLine !== request.startLine || draft.endLine !== request.endLine) return reject("range-mismatch", "draft range differs from the request");
  const blob = gitBlobHash(content);
  if (draft.sourceBlobHash !== blob || request.sourceBlobHash !== blob) return reject("blob-mismatch", "source blob hash does not match the file");
  const lines = content.split("\n").map((line) => line.replace(/\r$/, ""));
  if (draft.endLine > lines.length) return reject("range-mismatch", "range is past the end of the file");
  const actual = lines.slice(draft.startLine - 1, draft.endLine);
  if (draft.original.length !== actual.length || draft.original.some((line, index) => line !== actual[index])) {
    return reject("original-mismatch", "original text does not match the file at the range");
  }
  const replacement = draft.replacement.join("\n");
  const original = draft.original.join("\n");
  if (Buffer.byteLength(replacement, "utf8") > DRAFT_LIMITS.maxReplacementBytes) return reject("oversize", "replacement over the byte cap");
  if (draft.replacement.length > DRAFT_LIMITS.maxReplacementLines) return reject("oversize", "replacement over the line cap");
  if (draft.replacement.length > draft.original.length + DRAFT_LIMITS.maxExtraLines) return reject("oversize", "replacement grows the range too much");
  if (draft.replacement.some((line) => line.length > DRAFT_LIMITS.maxLineLength)) return reject("oversize", "replacement line too long");
  if (draft.replacement.some((line) => /[\n\r\u0000]/.test(line))) return reject("schema", "replacement lines must not contain line breaks or null bytes");
  if (!replacement.trim()) return reject("empty-replacement", "drafts may not delete the range");
  if (replacement === original) return reject("no-change", "replacement equals the original");
  if (added(original, replacement, SUPPRESSION)) return reject("check-suppression", "replacement adds a check suppression or hides content");
  if (added(original, replacement, EXECUTABLE)) return reject("executable-payload", "replacement adds executable content");
  const required = requiredReviewFlags(original, replacement);
  const flags = /* @__PURE__ */ new Set([...draft.humanReview, ...required]);
  const humanReview = HUMAN_REVIEW_FLAGS.filter((flag) => flags.has(flag));
  return {
    ok: true,
    value: {
      draft,
      humanReview,
      needsHumanReview: true,
      requiresAcknowledgement: humanReview.includes("generated-accessible-name") || humanReview.includes("placeholder-accessible-name")
    }
  };
}

// lib/modelfix/config.ts
var ON = /* @__PURE__ */ new Set(["on", "true", "1", "yes"]);
var OFF = /* @__PURE__ */ new Set(["off", "false", "0", "no"]);
var MAX_REQUEST_CAP = 100;
var MAX_TIMEOUT_MS = 12e4;
function parseSwitch(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return { value: null, invalid: false };
  if (ON.has(text)) return { value: "on", invalid: false };
  if (OFF.has(text)) return { value: "off", invalid: false };
  return { value: "off", invalid: true };
}
function parseRepoConsent(text) {
  if (typeof text !== "string") return "missing";
  const values = [];
  for (const raw of text.split(/\r?\n/)) {
    const match = /^modelFixes\s*:(.*)$/.exec(raw);
    if (!match) continue;
    values.push(match[1].replace(/\s+#.*$/, "").trim());
  }
  if (values.length === 0) return "missing";
  if (values.length > 1) return "invalid";
  const value = values[0].replace(/^(['"])(.*)\1$/, "$2");
  if (value === "true") return "opted-in";
  if (value === "false") return "denied";
  return "invalid";
}
function boundedInt(value, max) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  return parsed <= max ? parsed : null;
}
function resolveModelFixConfig(input) {
  const env = input.env ?? {};
  const warnings = [];
  const flag = parseSwitch(input.flag);
  const fromEnv = parseSwitch(env.A11YGATE_MODEL_FIXES);
  if (flag.invalid) warnings.push("Unknown --model-fixes value; treated as off.");
  if (fromEnv.invalid) warnings.push("Unknown A11YGATE_MODEL_FIXES value; treated as off.");
  const requested = flag.value === "off" || fromEnv.value === "off" ? "off" : flag.value ?? fromEnv.value;
  const repo = parseRepoConsent(input.repoConfig);
  const providers = String(env.A11YGATE_MODEL_PROVIDERS ?? "").split(",").map((item) => item.trim().toLowerCase()).filter((item, index, list) => /^[a-z0-9-]+$/.test(item) && list.indexOf(item) === index);
  const maxRequests = boundedInt(env.A11YGATE_MODEL_MAX_REQUESTS, MAX_REQUEST_CAP);
  const timeoutMs = boundedInt(env.A11YGATE_MODEL_TIMEOUT_MS, MAX_TIMEOUT_MS);
  if (maxRequests === null) warnings.push(`A11YGATE_MODEL_MAX_REQUESTS must be an integer from 0 to ${MAX_REQUEST_CAP}; using 0.`);
  if (timeoutMs === null) warnings.push(`A11YGATE_MODEL_TIMEOUT_MS must be an integer from 0 to ${MAX_TIMEOUT_MS}; using 0.`);
  const base = { repo, requested, providers, maxRequests: maxRequests ?? 0, timeoutMs: timeoutMs ?? 0, warnings };
  if (requested === null) return { ...base, enabled: false, reason: "default-off" };
  if (requested === "off") return { ...base, enabled: false, reason: "turned-off" };
  if (repo === "missing") return { ...base, enabled: false, reason: "repo-missing" };
  if (repo === "denied") return { ...base, enabled: false, reason: "repo-denied" };
  if (repo === "invalid") return { ...base, enabled: false, reason: "repo-invalid" };
  return { ...base, enabled: true, reason: "enabled" };
}
var MODEL_FIXES_OFF = resolveModelFixConfig({});

// lib/fix/apply.ts
function applyEdits(text, edits) {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let out = text;
  let floor = Number.POSITIVE_INFINITY;
  for (const edit of sorted) {
    if (edit.end > floor) throw new Error("Overlapping edits.");
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    floor = edit.start;
  }
  return out;
}

// lib/fix/element.ts
var VOID_TAGS = /* @__PURE__ */ new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr"
]);
function normalizeAttrName(raw) {
  const lower = raw.toLowerCase();
  if (lower === "classname") return "class";
  if (lower === "htmlfor") return "for";
  return lower;
}
function skipBraces(text, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") {
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}
function parseOpenTag(text, start) {
  if (text[start] !== "<") return null;
  const nameMatch = /^[A-Za-z][\w:.-]*/.exec(text.slice(start + 1, start + 200));
  if (!nameMatch) return null;
  const tagName = nameMatch[0];
  const nameEnd = start + 1 + tagName.length;
  const attrs = [];
  let i = nameEnd;
  const limit = Math.min(text.length, start + 8e3);
  while (i < limit) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      if (close < 0) return null;
      i = close + 2;
      continue;
    }
    if (ch === "/" && text[i + 1] === ">") {
      return { tagName, attrs, start, nameEnd, end: i + 2, selfClosing: true };
    }
    if (ch === ">") {
      return { tagName, attrs, start, nameEnd, end: i + 1, selfClosing: false };
    }
    if (ch === "{") {
      const close = skipBraces(text, i);
      if (close < 0) return null;
      attrs.push({ raw: text.slice(i, close), name: "{spread}", value: null, kind: "spread", start: i, end: close });
      i = close;
      continue;
    }
    const attrName = /^[^\s=>/"'{]+/.exec(text.slice(i, i + 200));
    if (!attrName) return null;
    const raw = attrName[0];
    const attrStart = i;
    i += raw.length;
    let j = i;
    while (j < limit && /\s/.test(text[j])) j += 1;
    if (text[j] !== "=") {
      attrs.push({ raw, name: normalizeAttrName(raw), value: "", kind: "bare", start: attrStart, end: i });
      continue;
    }
    j += 1;
    while (j < limit && /\s/.test(text[j])) j += 1;
    const q = text[j];
    if (q === '"' || q === "'") {
      const close = text.indexOf(q, j + 1);
      if (close < 0) return null;
      attrs.push({ raw, name: normalizeAttrName(raw), value: text.slice(j + 1, close), kind: "literal", start: attrStart, end: close + 1 });
      i = close + 1;
    } else if (q === "{") {
      const close = skipBraces(text, j);
      if (close < 0) return null;
      const inner = text.slice(j + 1, close - 1).trim();
      const str = /^(["'])((?:(?!\1)[^\\])*)\1$/.exec(inner);
      if (str) {
        attrs.push({ raw, name: normalizeAttrName(raw), value: str[2], kind: "literal", start: attrStart, end: close });
      } else {
        attrs.push({ raw, name: normalizeAttrName(raw), value: null, kind: "expression", start: attrStart, end: close });
      }
      i = close;
    } else {
      const unquoted = /^[^\s>]+/.exec(text.slice(j, j + 500));
      if (!unquoted) return null;
      let value = unquoted[0];
      if (value.endsWith("/") && text[j + value.length] === ">") value = value.slice(0, -1);
      attrs.push({ raw, name: normalizeAttrName(raw), value, kind: "literal", start: attrStart, end: j + value.length });
      i = j + value.length;
    }
  }
  return null;
}
function getAttr(tag, name) {
  const wanted = normalizeAttrName(name);
  return tag.attrs.find((attr) => attr.name === wanted);
}
function literal(tag, name) {
  const attr = getAttr(tag, name);
  if (!attr || attr.kind !== "literal") return void 0;
  const value = (attr.value ?? "").trim();
  return value.length > 0 ? value : void 0;
}
function sameTagName(a, b, kind) {
  return kind === "html" ? a.toLowerCase() === b.toLowerCase() : a === b;
}
function findOpenTags(text, tagName, kind) {
  const tags = [];
  const pattern = /<([A-Za-z][\w:.-]*)/g;
  let match;
  while (match = pattern.exec(text)) {
    if (!sameTagName(match[1], tagName, kind)) continue;
    const tag = parseOpenTag(text, match.index);
    if (tag) tags.push(tag);
  }
  return tags;
}
function elementRange(text, open, kind, maxChars = 6e3) {
  if (open.selfClosing || kind === "html" && VOID_TAGS.has(open.tagName.toLowerCase())) {
    return { open, contentStart: open.end, contentEnd: open.end, close: null };
  }
  const flags = kind === "html" ? "gi" : "g";
  const escaped = open.tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<(/?)${escaped}(?=[\\s>/])`, flags);
  pattern.lastIndex = open.end;
  const limit = open.end + maxChars;
  let depth = 1;
  let match;
  while ((match = pattern.exec(text)) && match.index < limit) {
    if (match[1] === "/") {
      depth -= 1;
      if (depth === 0) {
        const gt = text.indexOf(">", match.index);
        if (gt < 0) return null;
        return { open, contentStart: open.end, contentEnd: match.index, close: { start: match.index, end: gt + 1 } };
      }
    } else {
      const nested = parseOpenTag(text, match.index);
      if (nested && !nested.selfClosing) depth += 1;
      if (nested) pattern.lastIndex = nested.end;
    }
  }
  return null;
}
function plainText(markup) {
  return markup.replace(/<!--[\s\S]*?-->/g, " ").replace(/\{\/\*[\s\S]*?\*\/\}/g, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
function hasExpression(markup) {
  return /\{(?!\/\*)/.test(markup.replace(/<[^>]*>/g, " "));
}
function lineOf(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}
function indentAt(text, offset) {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const before = text.slice(lineStart, offset);
  const indent = /^[ \t]*/.exec(before)?.[0] ?? "";
  return { lineStart, indent, atLineStart: before.trim().length === 0 };
}

// lib/fix/mapper.ts
var KINDS = {
  html: "html",
  htm: "html",
  jsx: "jsx",
  tsx: "jsx",
  js: "jsx",
  mjs: "jsx"
};
function sourceKind(path2) {
  const ext = /\.([a-z0-9]+)$/i.exec(path2)?.[1]?.toLowerCase() ?? "";
  return KINDS[ext] ?? null;
}
var IGNORED = /* @__PURE__ */ new Set(["style", "key", "ref"]);
function findingTag(html) {
  const text = String(html ?? "").trim();
  const start = text.indexOf("<");
  if (start < 0) return null;
  return parseOpenTag(text, start);
}
function norm(value) {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}
function tagMatches(finding, candidate) {
  const rendered = /* @__PURE__ */ new Map();
  for (const attr of finding.attrs) {
    if (attr.kind === "spread" || IGNORED.has(attr.name)) continue;
    rendered.set(attr.name, norm(attr.value ?? ""));
  }
  const spread = candidate.attrs.some((attr) => attr.kind === "spread");
  const seen = /* @__PURE__ */ new Set();
  for (const attr of candidate.attrs) {
    if (attr.kind === "spread" || IGNORED.has(attr.name)) continue;
    seen.add(attr.name);
    if (attr.kind === "expression") continue;
    const value = rendered.get(attr.name);
    if (value === void 0) {
      if (attr.name.startsWith("on")) continue;
      return false;
    }
    if (norm(attr.value ?? "") !== value) return false;
  }
  if (spread) return true;
  for (const name of rendered.keys()) if (!seen.has(name)) return false;
  return true;
}
function mapFinding(html, files) {
  const target = findingTag(html);
  if (!target) return { status: "no-match" };
  const found = [];
  for (const file of files) {
    const kind = sourceKind(file.path);
    if (!kind) continue;
    for (const tag of findOpenTags(file.content, target.tagName.toLowerCase(), kind)) {
      if (tagMatches(target, tag)) found.push({ file, kind, tag });
    }
  }
  if (found.length === 0) return { status: "no-match" };
  if (found.length > 1) return { status: "ambiguous" };
  return { status: "matched", element: found[0] };
}

// lib/fix/types.ts
var PLACEHOLDER2 = "TODO(a11ygate)";

// lib/fix/rules/shared.ts
function attribute(name, value) {
  if (/["{}<>\n\r]/.test(value)) return null;
  return `${name}="${value.replace(/&/g, "&amp;")}"`;
}
function insertAfterName(nameEnd, text) {
  return { start: nameEnd, end: nameEnd, text: ` ${text}` };
}
function inJsxChildren(source, offset) {
  let i = offset - 1;
  while (i >= 0 && /\s/.test(source[i])) i -= 1;
  if (i < 0) return false;
  if (source[i] === ">") return source[i - 1] !== "=";
  if (source[i] === "}") {
    const lineStart = source.lastIndexOf("\n", i) + 1;
    return /^\s*\{[\s\S]*\}$/.test(source.slice(lineStart, i + 1));
  }
  return false;
}
function commentBefore(source, offset, kind, message) {
  let comment;
  if (kind === "html") {
    comment = `<!-- ${message.replace(/--/g, "\u2014")} -->`;
  } else {
    if (!inJsxChildren(source, offset)) return null;
    comment = `{/* ${message.replace(/\*\//g, "* /")} */}`;
  }
  const { indent, atLineStart } = indentAt(source, offset);
  const text = atLineStart ? `${comment}
${indent}` : comment;
  return { start: offset, end: offset, text };
}

// lib/fix/rules/accessible-name.ts
var NAME_PLACEHOLDER = `${PLACEHOLDER2}: add accessible name`;
var NOISE = /* @__PURE__ */ new Set([
  "icon",
  "icons",
  "ic",
  "svg",
  "img",
  "image",
  "images",
  "btn",
  "button",
  "fa",
  "fas",
  "far",
  "fab",
  "fal",
  "solid",
  "regular",
  "outline",
  "outlined",
  "filled",
  "fill",
  "light",
  "bi",
  "mdi",
  "glyph",
  "sprite",
  "static",
  "assets",
  "asset",
  "media",
  "lg",
  "sm",
  "xs",
  "fw",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp"
]);
function humanize(raw) {
  const base = raw.split(/[?#]/)[0] ?? "";
  const file = (base.split("/").pop() ?? "").replace(/\.[a-z0-9]{2,5}$/i, "");
  const words = file.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[\s_.\-:]+/).map((word) => word.toLowerCase()).filter((word) => word.length > 0 && !NOISE.has(word));
  if (words.length === 0 || words.length > 4) return null;
  if (!words.every((word) => /^[a-z]{2,20}$/.test(word))) return null;
  if (words.some((word) => /[bcdfghjklmnpqrstvwxz]{5,}/.test(word))) return null;
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
function iconHint(content) {
  const pattern = /<([A-Za-z][\w:.-]*)/g;
  let match;
  while (match = pattern.exec(content)) {
    const tag = parseOpenTag(content, match.index);
    if (!tag) continue;
    const tagName = tag.tagName;
    const candidates = [];
    if (tagName.toLowerCase() === "img") candidates.push({ value: literal(tag, "src"), from: "image file name" });
    candidates.push({ value: literal(tag, "data-icon"), from: "icon name" });
    if (tagName.toLowerCase() !== "img" && tagName.toLowerCase() !== "input") {
      candidates.push({ value: literal(tag, "name"), from: "icon name" });
    }
    if (tagName.toLowerCase() === "use") {
      candidates.push({ value: literal(tag, "href") ?? literal(tag, "xlink:href"), from: "SVG symbol id" });
    }
    const component = /^(?:([A-Z][A-Za-z]*?)Icon|Icon([A-Z][A-Za-z]*))$/.exec(tagName);
    if (component) candidates.push({ value: component[1] ?? component[2], from: "icon component name" });
    const cls = literal(tag, "class") ?? "";
    for (const token of cls.split(/\s+/)) {
      const icon = /^(?:fa|icon|bi|mdi|ti|ri)-([a-z][a-z-]*)$/.exec(token);
      if (icon && !NOISE.has(icon[1])) candidates.push({ value: icon[1], from: "icon class" });
    }
    for (const candidate of candidates) {
      if (!candidate.value) continue;
      const fragment = candidate.value.startsWith("#") ? candidate.value.slice(1) : candidate.value;
      const name = humanize(fragment);
      if (name) return { name, from: candidate.from };
    }
  }
  return null;
}
var accessibleNameRule = (input) => {
  const { source, kind, tag, ruleId } = input;
  const name = tag.tagName.toLowerCase();
  if (kind === "jsx" && tag.tagName !== name) return null;
  const expected = ruleId === "link-name" ? "a" : "button";
  if (name !== expected) return null;
  if (getAttr(tag, "aria-label") || getAttr(tag, "aria-labelledby")) return null;
  const range = elementRange(source, tag, kind);
  if (!range) return null;
  const content = source.slice(range.contentStart, range.contentEnd);
  if (plainText(content).length > 0 || hasExpression(content)) return null;
  const title = literal(tag, "title");
  const icon = title ? null : iconHint(content);
  const value = title ?? icon?.name ?? NAME_PLACEHOLDER;
  const attr = attribute("aria-label", value) ?? attribute("aria-label", NAME_PLACEHOLDER);
  if (!attr) return null;
  const placeholder = attr.includes(PLACEHOLDER2);
  const note = placeholder ? `No title, icon name or nearby text to reuse, so this adds a \`${PLACEHOLDER2}\` placeholder. Replace it with the real name before merging.` : title ? "Copies the existing `title` into `aria-label`." : `Derives \`aria-label\` from the ${icon?.from}. Confirm it describes what the control does.`;
  return { rule: "accessible-name", edits: [insertAfterName(tag.nameEnd, attr)], placeholder, note };
};

// lib/fix/rules/clickable.ts
var NOT_ALLOWED_IN_BUTTON = /<(a|button|input|select|textarea|label|details|iframe|div|p|ul|ol|li|table|form|section|article|header|footer|nav|main|aside|h[1-6])\b/i;
function isClickableDivOrSpan(tag) {
  const name = tag.tagName.toLowerCase();
  return (name === "div" || name === "span") && Boolean(getAttr(tag, "onclick"));
}
var clickableRule = ({ source, kind, tag }) => {
  if (kind === "jsx" && tag.tagName !== tag.tagName.toLowerCase()) return null;
  if (!isClickableDivOrSpan(tag)) return null;
  const range = elementRange(source, tag, kind);
  if (!range) return null;
  const content = source.slice(range.contentStart, range.contentEnd);
  if (NOT_ALLOWED_IN_BUTTON.test(content)) return null;
  const opening = getAttr(tag, "type") ? "button" : 'button type="button"';
  const edits = [{ start: tag.start + 1, end: tag.nameEnd, text: opening }];
  if (range.close) edits.push({ start: range.close.start + 2, end: range.close.start + 2 + tag.tagName.length, text: "button" });
  return {
    rule: "clickable-element",
    edits,
    placeholder: false,
    note: `Turns the clickable \`<${tag.tagName}>\` into a native \`<button type="button">\` so it is focusable and keyboard operable. Attributes and the handler are unchanged; check styles that target \`${tag.tagName}\`.`
  };
};

// lib/fix/rules/html-lang.ts
function safeLang(lang) {
  const value = (lang ?? "").trim();
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value) ? value : "en";
}
var htmlLangRule = ({ kind, tag, lang }) => {
  if (tag.tagName.toLowerCase() !== "html" || tag.selfClosing) return null;
  if (kind === "jsx" && tag.tagName !== "html") return null;
  const value = safeLang(lang);
  const existing = getAttr(tag, "lang");
  if (existing && !(existing.kind === "literal" && (existing.value ?? "").trim() === "") && existing.kind !== "bare") return null;
  const todo = `${PLACEHOLDER2}: confirm "${value}" is the main language of this document`;
  const comment = kind === "html" ? `<!-- ${todo} -->` : `{/* ${todo} */}`;
  const edits = existing ? [{ start: existing.start, end: existing.end, text: `lang="${value}"` }] : [insertAfterName(tag.nameEnd, `lang="${value}"`)];
  edits.push({ start: tag.end, end: tag.end, text: comment });
  return {
    rule: "html-has-lang",
    edits,
    placeholder: true,
    note: `Sets \`lang="${value}"\` from the configured default and adds a \`${PLACEHOLDER2}\` comment to confirm the language.`
  };
};

// lib/fix/rules/image-alt.ts
var ALT_TODO = `${PLACEHOLDER2}: write alt text that describes this image, or confirm it is decorative and keep alt=""`;
var imageAltRule = ({ source, kind, tag }) => {
  if (kind === "jsx" ? tag.tagName !== "img" : tag.tagName.toLowerCase() !== "img") return null;
  if (getAttr(tag, "alt")) return null;
  const role = (literal(tag, "role") ?? "").toLowerCase();
  if (role === "presentation" || role === "none") return null;
  if (literal(tag, "aria-label") || getAttr(tag, "aria-labelledby") || literal(tag, "title")) return null;
  const edits = [];
  const comment = commentBefore(source, tag.start, kind, ALT_TODO);
  if (comment) {
    edits.push(comment, insertAfterName(tag.nameEnd, 'alt=""'));
  } else {
    edits.push(insertAfterName(tag.nameEnd, `alt="" /* ${ALT_TODO} */`));
  }
  return {
    rule: "image-alt",
    edits,
    placeholder: true,
    note: `Adds \`alt=""\` and a \`${PLACEHOLDER2}\` comment. A human must write a real description, or confirm the image is decorative.`
  };
};

// lib/fix/rules/label.ts
var CONTROLS = /* @__PURE__ */ new Set(["input", "select", "textarea"]);
var UNLABELLED_INPUT_TYPES = /* @__PURE__ */ new Set(["hidden", "submit", "reset", "button", "image"]);
function adjacentLabel(input, control) {
  const { source, kind } = input;
  const controlEnd = control.close ? control.close.end : control.open.end;
  for (const open of findOpenTags(source, "label", kind)) {
    const label = elementRange(source, open, kind, 2e3);
    if (!label?.close) continue;
    const between = label.close.end <= control.open.start ? source.slice(label.close.end, control.open.start) : open.start >= controlEnd ? source.slice(controlEnd, open.start) : null;
    if (between === null || between.trim().length > 0) continue;
    const content = source.slice(label.contentStart, label.contentEnd);
    if (/<(input|select|textarea|button)\b/i.test(content)) return null;
    const text = plainText(content);
    const dynamic = /\{(?!\/\*)[^}]+\}/.test(content.replace(/<[^>]*>/g, " "));
    if (text.length === 0 && !dynamic) return null;
    return { label, position: label.close.end <= control.open.start ? "before" : "after" };
  }
  return null;
}
var labelRule = (input) => {
  const { source, kind, tag } = input;
  const name = tag.tagName.toLowerCase();
  if (kind === "jsx" && tag.tagName !== name) return null;
  if (!CONTROLS.has(name)) return null;
  if (name === "input" && UNLABELLED_INPUT_TYPES.has((literal(tag, "type") ?? "").toLowerCase())) return null;
  if (literal(tag, "aria-label") || getAttr(tag, "aria-labelledby")) return null;
  const control = elementRange(source, tag, kind);
  if (!control) return null;
  const neighbor = adjacentLabel(input, control);
  if (!neighbor) return null;
  const labelTag = neighbor.label.open;
  const forName = kind === "jsx" ? "htmlFor" : "for";
  const labelFor = getAttr(labelTag, "for");
  const id = getAttr(tag, "id");
  const result = (edits, note2) => ({ rule: "label", edits, placeholder: false, note: note2 });
  if (labelFor) {
    if (id || labelFor.kind !== "literal" || !labelFor.value) return null;
    const value = labelFor.value;
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\bid\\s*=\\s*\\{?["']${escaped}["']`).test(source)) return null;
    const attr = attribute("id", value);
    if (!attr) return null;
    return result([insertAfterName(tag.nameEnd, attr)], `Adds \`id="${value}"\` so the existing label's \`${forName}\` points at this control.`);
  }
  if (id && id.kind === "literal" && id.value) {
    const attr = attribute(forName, id.value);
    if (!attr) return null;
    return result([insertAfterName(labelTag.nameEnd, attr)], `Associates the existing visible label with this control through \`${forName}\`/\`id\`.`);
  }
  if (id && id.kind === "expression") {
    return result(
      [insertAfterName(labelTag.nameEnd, `${forName}=${source.slice(id.start, id.end).replace(/^[^=]*=\s*/, "")}`)],
      `Associates the existing visible label with this control through \`${forName}\`/\`id\`.`
    );
  }
  const label = neighbor.label;
  const controlEnd = control.close ? control.close.end : control.open.end;
  const note = "Wraps the control in its existing visible `<label>`; the label text is unchanged.";
  if (neighbor.position === "before" && label.close) {
    const closeText = source.slice(label.close.start, label.close.end);
    return result(
      [
        { start: label.close.start, end: label.close.end, text: "" },
        { start: controlEnd, end: controlEnd, text: closeText }
      ],
      note
    );
  }
  const openText = source.slice(labelTag.start, labelTag.end);
  return result(
    [
      { start: tag.start, end: tag.start, text: openText },
      { start: labelTag.start, end: labelTag.end, text: "" }
    ],
    note
  );
};

// lib/fix/index.ts
function ruleFor(ruleId, element) {
  if (ruleId === "html-has-lang") return htmlLangRule;
  if (ruleId === "image-alt") return imageAltRule;
  if (ruleId === "label") return labelRule;
  if (isClickableDivOrSpan(element.tag)) return clickableRule;
  if (ruleId === "button-name" || ruleId === "link-name") return accessibleNameRule;
  return null;
}
function toSuggestion(file, finding, result) {
  if (result.edits.length === 0) return null;
  const source = file.content;
  const start = Math.min(...result.edits.map((edit) => edit.start));
  const end = Math.max(...result.edits.map((edit) => edit.end));
  const startLine = lineOf(source, start);
  const endLine = lineOf(source, end);
  const next = applyEdits(source, result.edits);
  const oldLines = source.split("\n");
  const newLines = next.split("\n");
  const tail = oldLines.length - endLine;
  const strip = (line) => line.replace(/\r$/, "");
  return {
    fingerprint: finding.fingerprint,
    ruleId: finding.ruleId,
    rule: result.rule,
    path: file.path,
    startLine,
    endLine,
    original: oldLines.slice(startLine - 1, endLine).map(strip),
    replacement: newLines.slice(startLine - 1, newLines.length - tail).map(strip),
    placeholder: result.placeholder,
    note: result.note
  };
}
function suggestForElement(finding, element, options = {}) {
  const rule = ruleFor(finding.ruleId, element);
  if (!rule) return null;
  const result = rule({ source: element.file.content, kind: element.kind, tag: element.tag, ruleId: finding.ruleId, lang: options.lang ?? "en" });
  return result ? toSuggestion(element.file, finding, result) : null;
}
function planSuggestions(findings, files, options = {}) {
  const plan = { suggestions: [], skipped: [] };
  const taken = /* @__PURE__ */ new Map();
  for (const finding of findings) {
    const skip = (reason) => plan.skipped.push({ fingerprint: finding.fingerprint, ruleId: finding.ruleId, reason });
    if (finding.status !== void 0 && finding.status !== "new") {
      skip("not-new");
      continue;
    }
    const mapped = mapFinding(finding.html, files);
    if (mapped.status !== "matched") {
      skip(mapped.status);
      continue;
    }
    if (!ruleFor(finding.ruleId, mapped.element)) {
      skip("unsupported-rule");
      continue;
    }
    const suggestion = suggestForElement(finding, mapped.element, options);
    if (!suggestion) {
      skip("no-safe-fix");
      continue;
    }
    const diff = mapped.element.file.diffLines;
    let inside = true;
    for (let line = suggestion.startLine; line <= suggestion.endLine; line += 1) if (!diff.has(line)) inside = false;
    if (!inside) {
      skip("outside-diff");
      continue;
    }
    const ranges = taken.get(suggestion.path) ?? [];
    if (ranges.some(([a, b]) => suggestion.startLine <= b && a <= suggestion.endLine)) {
      skip("overlaps");
      continue;
    }
    ranges.push([suggestion.startLine, suggestion.endLine]);
    taken.set(suggestion.path, ranges);
    plan.suggestions.push(suggestion);
  }
  return plan;
}

// lib/modelfix/orchestrator.ts
var NO_F1_PATCH = /* @__PURE__ */ new Set(["unsupported-rule", "no-safe-fix"]);
function routeFindings(findings, files, plan, sourceCommit) {
  const suggested = new Map(plan.suggestions.map((s) => [s.fingerprint, s]));
  const skipped = new Map(plan.skipped.map((s) => [s.fingerprint, s.reason]));
  return findings.map((finding) => {
    const base = { fingerprint: finding.fingerprint, ruleId: finding.ruleId, sourceCommit };
    const suggestion = suggested.get(finding.fingerprint);
    if (suggestion) {
      return { ...base, route: "f1", f1Skip: null, path: suggestion.path, startLine: suggestion.startLine, endLine: suggestion.endLine, model: null };
    }
    const f1Skip = skipped.get(finding.fingerprint) ?? null;
    if (f1Skip && NO_F1_PATCH.has(f1Skip) && MODEL_ELIGIBLE_RULES.has(finding.ruleId)) {
      const mapped = mapFinding(finding.html, files);
      if (mapped.status === "matched") {
        const { file, tag } = mapped.element;
        return {
          ...base,
          route: "model-eligible",
          f1Skip,
          path: file.path,
          startLine: lineOf(file.content, tag.start),
          endLine: lineOf(file.content, tag.end),
          model: { outcome: "models-off", provider: null }
        };
      }
    }
    return { ...base, route: "report-only", f1Skip, path: null, startLine: null, endLine: null, model: null };
  });
}
function draftRequest(route, files) {
  const file = files.find((item) => item.path === route.path);
  if (!file || route.startLine === null || route.endLine === null) return null;
  return {
    findingId: route.fingerprint,
    ruleId: route.ruleId,
    sourceCommit: route.sourceCommit,
    path: file.path,
    startLine: route.startLine,
    endLine: route.endLine,
    original: file.content.split("\n").slice(route.startLine - 1, route.endLine).map((line) => line.replace(/\r$/, "")),
    sourceBlobHash: gitBlobHash(file.content)
  };
}
async function withDeadline(timeoutMs, run) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject2) => {
    timer = setTimeout(() => {
      controller.abort();
      reject2(new Error("timeout"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
var MESSAGES = {
  disabled: "Model drafting is off. Rule-based suggestions only.",
  "no-eligible-findings": "Model drafting skipped: no eligible findings. Rule-based suggestions only.",
  "no-provider": "Model drafting skipped: no provider configured. Rule-based suggestions only.",
  "no-budget": "Model drafting skipped: no request budget or timeout configured. Rule-based suggestions only.",
  "over-budget": "Model drafting stopped: request budget used up. Rule-based suggestions only.",
  "adapters-failed": "Model drafting skipped: every provider failed. Rule-based suggestions only.",
  "no-verified-candidate": "Model drafting produced no verified candidate. Rule-based suggestions only.",
  "verified-unpublished": "Model drafting verified candidates in isolation; nothing was published. Rule-based suggestions only.",
  error: "Model drafting skipped after an internal error. Rule-based suggestions only."
};
function finish(status, routes, modelRequests, outcome, combined) {
  if (outcome) {
    for (const route of routes) if (route.model && route.model.provider === null && route.model.outcome !== "draft-rejected") route.model.outcome = outcome;
  }
  const run = { status, routes, modelRequests, message: MESSAGES[status] };
  if (combined !== void 0) run.combined = combined;
  return run;
}
var VERIFY_OUTCOME = {
  verified: "verified",
  rejected: "verify-rejected",
  stale: "stale-discarded"
};
async function safeVerify(run, findingIds) {
  try {
    return await run();
  } catch {
    return { verified: false, outcome: "rejected", reason: "error", detail: "verifier failed", findingIds, newFindings: 0 };
  }
}
async function runModelPath(input, routes) {
  const { config } = input;
  const eligible = routes.filter((route) => route.route === "model-eligible");
  if (!config.enabled) return finish("disabled", routes, 0, "models-off");
  if (eligible.length === 0) return finish("no-eligible-findings", routes, 0);
  const env = input.env ?? {};
  const allowed = new Set(config.providers);
  const adapters = (input.adapters ?? BUILTIN_ADAPTERS).filter((adapter) => {
    if (!allowed.has(adapter.id)) return false;
    try {
      return adapter.isConfigured(env) === true;
    } catch {
      return false;
    }
  });
  if (adapters.length === 0) return finish("no-provider", routes, 0, "no-provider");
  if (config.maxRequests <= 0 || config.timeoutMs <= 0) return finish("no-budget", routes, 0, "no-budget");
  const failed = /* @__PURE__ */ new Set();
  const verified = [];
  let requests = 0;
  let overBudget = false;
  for (const route of eligible) {
    const request = draftRequest(route, input.files);
    if (!request || !route.model) continue;
    const content = input.files.find((item) => item.path === request.path)?.content ?? "";
    const rejections = [];
    for (const adapter of adapters) {
      if (failed.has(adapter.id)) continue;
      if (requests >= config.maxRequests) {
        overBudget = true;
        break;
      }
      requests += 1;
      try {
        const draft = await withDeadline(config.timeoutMs, (signal) => adapter.draft({ ...request, original: [...request.original] }, signal));
        const result = validateDraft(draft, { request, content, repoRoot: input.repoRoot });
        if (!result.ok) {
          rejections.push(result.rejection.code);
          continue;
        }
        if (!input.verifier) {
          route.model = { outcome: "unverified-discarded", provider: adapter.id };
          break;
        }
        const candidate = { validated: result.value, ruleId: route.ruleId, targetHtml: findingHtml(input, route), sourceCommit: route.sourceCommit ?? "" };
        const verifier = input.verifier;
        const check = await safeVerify(() => verifier.verify(candidate), [route.fingerprint]);
        route.model = { outcome: VERIFY_OUTCOME[check.outcome], provider: adapter.id, verification: check.reason };
        if (check.verified) verified.push(candidate);
        break;
      } catch {
        failed.add(adapter.id);
      }
    }
    if (route.model.provider === null) {
      if (rejections.length > 0) route.model = { outcome: "draft-rejected", provider: null, rejections };
      else route.model.outcome = overBudget ? "over-budget" : "adapters-failed";
    }
  }
  if (failed.size === adapters.length) return finish("adapters-failed", routes, requests, "adapters-failed");
  if (overBudget) return finish("over-budget", routes, requests, "over-budget");
  if (verified.length === 0) return finish("no-verified-candidate", routes, requests);
  let combined = null;
  if (verified.length > 1 && input.verifier) {
    const verifier = input.verifier;
    combined = await safeVerify(() => verifier.verifyCombined(verified), verified.map((item) => item.validated.draft.findingId));
  }
  return finish("verified-unpublished", routes, requests, void 0, combined);
}
function findingHtml(input, route) {
  return input.findings.find((finding) => finding.fingerprint === route.fingerprint)?.html ?? "";
}
async function planWithModelFixes(input) {
  const plan = input.f1Plan ?? planSuggestions(input.findings, input.files, input.options ?? {});
  const sourceCommit = input.sourceCommit ?? null;
  let routes = [];
  try {
    routes = routeFindings(input.findings, input.files, plan, sourceCommit);
    return { plan, model: await runModelPath(input, routes) };
  } catch {
    return { plan, model: finish("error", routes, 0) };
  }
}
export {
  BUILTIN_ADAPTERS,
  DRAFT_LIMITS,
  HUMAN_REVIEW_FLAGS,
  MODEL_ELIGIBLE_RULES,
  MODEL_FIXES_OFF,
  REPO_CONFIG_FILE,
  failingAdapter,
  gitBlobHash,
  parseRepoConsent,
  parseSwitch,
  planWithModelFixes,
  requiredReviewFlags,
  resolveModelFixConfig,
  routeFindings,
  staticAdapter,
  stubAdapter,
  stubDraft,
  validateDraft
};
