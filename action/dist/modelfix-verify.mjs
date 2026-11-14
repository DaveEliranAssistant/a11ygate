// lib/modelfix-verify/verify.ts
import { readFile, realpath, writeFile } from "node:fs/promises";
import path3 from "node:path";

// lib/modelfix/apply.ts
function applyDrafts(content, drafts) {
  const next = content.split("\n");
  for (const draft of [...drafts].sort((a, b) => b.startLine - a.startLine)) {
    next.splice(draft.startLine - 1, draft.endLine - draft.startLine + 1, ...draft.replacement);
  }
  return next.join("\n");
}

// lib/modelfix/validate.ts
import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

// lib/modelfix/types.ts
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
  for (const key2 of Object.keys(record)) {
    if (MULTI_FILE_KEYS.has(key2)) return { code: "extra-file", detail: `draft carries extra file entries (${key2})` };
    if (!DRAFT_KEYS.includes(key2)) return { code: "schema", detail: `unknown field ${key2}` };
  }
  for (const key2 of DRAFT_KEYS) if (!(key2 in record)) return { code: "schema", detail: `missing field ${key2}` };
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
  const lines2 = content.split("\n").map((line) => line.replace(/\r$/, ""));
  if (draft.endLine > lines2.length) return reject("range-mismatch", "range is past the end of the file");
  const actual = lines2.slice(draft.startLine - 1, draft.endLine);
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

// lib/modelfix-verify/git.ts
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path2 from "node:path";
var WORKTREE_PREFIX = "a11ygate-modelfix-";
var FULL_SHA = /^[0-9a-f]{40}$/;
function isFullSha(value) {
  return FULL_SHA.test(value);
}
function git(repoRoot, args) {
  return new Promise((resolve, reject2) => {
    execFile(
      "git",
      ["-c", "core.hooksPath=/dev/null", "-c", "core.autocrlf=false", "-c", "core.fsmonitor=false", ...args],
      {
        cwd: repoRoot,
        shell: false,
        timeout: 6e4,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" }
      },
      (error, stdout) => error ? reject2(new Error(`git ${args[0]} failed`)) : resolve(String(stdout))
    );
  });
}
async function resolveCommit(repoRoot, ref) {
  try {
    const sha = (await git(repoRoot, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])).trim();
    return isFullSha(sha) ? sha : null;
  } catch {
    return null;
  }
}
async function blobAt(repoRoot, commit, file) {
  try {
    const sha = (await git(repoRoot, ["rev-parse", "--verify", "--quiet", `${commit}:${file}`])).trim();
    return isFullSha(sha) ? sha : null;
  } catch {
    return null;
  }
}
async function createWorktree(repoRoot, commit) {
  const dir = await mkdtemp(path2.join(tmpdir(), WORKTREE_PREFIX));
  const tree = path2.join(dir, "tree");
  let removed = false;
  const remove = async () => {
    if (removed) return;
    removed = true;
    await git(repoRoot, ["worktree", "remove", "--force", tree]).catch(() => void 0);
    await rm(dir, { recursive: true, force: true }).catch(() => void 0);
    await git(repoRoot, ["worktree", "prune"]).catch(() => void 0);
  };
  try {
    await git(repoRoot, ["worktree", "add", "--detach", "--force", tree, commit]);
  } catch (error) {
    await remove();
    throw error;
  }
  return { dir, tree, remove };
}

// lib/modelfix-verify/verify.ts
function result(candidates, reason, detail, newFindings = 0, evidence) {
  const outcome = reason === "verified" ? "verified" : STALE.has(reason) ? "stale" : "rejected";
  const out = { verified: reason === "verified", outcome, reason, detail, findingIds: candidates.map((item) => item.validated.draft.findingId), newFindings };
  if (reason === "verified" && evidence) Object.assign(out, evidence);
  return out;
}
var STALE = /* @__PURE__ */ new Set(["head-moved", "commit-missing", "blob-mismatch", "original-mismatch"]);
var key = (finding) => `${finding.route}\0${finding.ruleId}\0${finding.selector}`;
function lines(content) {
  return content.split("\n");
}
function sameHtml(a, b) {
  const norm = (text) => text.replace(/\s+/g, " ").trim();
  const x = norm(a);
  const y = norm(b);
  return Boolean(x && y) && (x === y || x.startsWith(y) || y.startsWith(x));
}
function locateTargets(candidates, pre) {
  const prepared = [];
  for (const candidate of candidates) {
    const matches = pre.findings.filter(
      (finding) => finding.kind === "violation" && finding.ruleId === candidate.ruleId && (candidate.targetSelector ? finding.selector === candidate.targetSelector : sameHtml(finding.html, candidate.targetHtml))
    );
    if (matches.length !== 1) return null;
    prepared.push({ candidate, route: matches[0].route, selector: matches[0].selector });
  }
  return prepared;
}
function overlapping(candidates) {
  const drafts = candidates.map((item) => item.validated.draft);
  return drafts.some((a, i) => drafts.some((b, j) => i < j && a.path === b.path && a.startLine <= b.endLine && b.startLine <= a.endLine));
}
function renderFailed(scan, routes) {
  return routes.some((route) => scan.status[route] !== 200);
}
async function run(candidates, options) {
  if (candidates.length === 0 || options.routes.length === 0) return result(candidates, "bad-input", "no candidates or no routes");
  const commit = candidates[0].sourceCommit;
  if (candidates.some((item) => item.sourceCommit !== commit)) return result(candidates, "bad-input", "candidates are pinned to different commits");
  if (!isFullSha(commit)) return result(candidates, "commit-missing", "scanned commit is not a full SHA");
  if (await resolveCommit(options.repoRoot, commit) !== commit) return result(candidates, "commit-missing", "scanned commit not found");
  if (await resolveCommit(options.repoRoot, options.headRef ?? "HEAD") !== commit) return result(candidates, "head-moved", "head no longer points at the scanned commit");
  if (overlapping(candidates)) return result(candidates, "overlapping-candidates", "candidates overlap in one file");
  for (const { validated } of candidates) {
    if (await blobAt(options.repoRoot, commit, validated.draft.path) !== validated.draft.sourceBlobHash) {
      return result(candidates, "blob-mismatch", "file at the scanned commit differs from the draft source");
    }
  }
  const worktree = await createWorktree(options.repoRoot, commit);
  try {
    const root = await realpath(worktree.tree);
    const resolve = (file) => {
      const full = path3.resolve(root, ...file.split("/"));
      if (!full.startsWith(root + path3.sep)) throw new Error("path outside worktree");
      return full;
    };
    const renderRoot = options.renderDir ? resolve(options.renderDir) : root;
    const contents = /* @__PURE__ */ new Map();
    for (const { validated } of candidates) {
      const { draft } = validated;
      const file = resolve(draft.path);
      if (!(await realpath(file).catch(() => "")).startsWith(root + path3.sep)) {
        return result(candidates, "invalid-draft", "path does not resolve inside the worktree");
      }
      const content = contents.get(draft.path) ?? await readFile(file, "utf8");
      contents.set(draft.path, content);
      if (gitBlobHash(content) !== draft.sourceBlobHash) return result(candidates, "blob-mismatch", "checked-out file differs from the draft source");
      const actual = lines(content).slice(draft.startLine - 1, draft.endLine).map((line) => line.replace(/\r$/, ""));
      if (actual.length !== draft.original.length || actual.some((line, index) => line !== draft.original[index])) {
        return result(candidates, "original-mismatch", "original text no longer matches at the range");
      }
      const request = { findingId: draft.findingId, ruleId: "", sourceCommit: commit, path: draft.path, startLine: draft.startLine, endLine: draft.endLine, original: draft.original, sourceBlobHash: draft.sourceBlobHash };
      if (!validateDraft(draft, { request, content, repoRoot: root }).ok) return result(candidates, "invalid-draft", "draft failed re-validation at the scanned commit");
    }
    if (options.build) await options.build(root);
    const pre = await options.rescanner.scan({ root: renderRoot, routes: options.routes });
    if (renderFailed(pre, options.routes)) return result(candidates, "render-failed", "pre-patch render failed");
    const targets = locateTargets(candidates, pre);
    if (!targets) return result(candidates, "target-not-reproduced", "target finding not found exactly once in the pre-patch scan");
    const patchedBlobs = [];
    for (const [file, content] of contents) {
      const patched = applyDrafts(content, candidates.map((item) => item.validated.draft).filter((draft) => draft.path === file));
      await writeFile(resolve(file), patched, "utf8");
      patchedBlobs.push({ path: file, blobHash: gitBlobHash(patched) });
    }
    await git(root, ["add", "--", ...contents.keys()]);
    const treeHash = (await git(root, ["write-tree"])).trim();
    if (!isFullSha(treeHash)) return result(candidates, "error", "could not record the verified tree");
    if (options.build) await options.build(root);
    const post = await options.rescanner.scan({ root: renderRoot, routes: options.routes, probes: targets.map(({ route, selector }) => ({ route, selector })) });
    if (renderFailed(post, options.routes) || pre.engineVersion && post.engineVersion !== pre.engineVersion) {
      return result(candidates, "render-failed", "post-patch render or scan failed");
    }
    const preKeys = new Set(pre.findings.filter((finding) => finding.kind === "violation").map(key));
    const fresh = post.findings.filter((finding) => finding.kind === "violation" && !preKeys.has(key(finding)));
    for (const target of targets) {
      const same = post.findings.filter((finding) => finding.route === target.route && finding.ruleId === target.candidate.ruleId && finding.selector === target.selector);
      if (same.some((finding) => finding.kind === "violation")) return result(candidates, "target-persists", "target finding still reported after the patch", fresh.length);
      if (same.length > 0) return result(candidates, "target-inconclusive", "target check inconclusive after the patch", fresh.length);
      if (post.missing.some((probe) => probe.route === target.route && probe.selector === target.selector)) {
        return result(candidates, "target-missing", "target element no longer renders visibly", fresh.length);
      }
    }
    if (fresh.length > 0) return result(candidates, "new-finding", `${fresh.length} new finding(s) after the patch`, fresh.length);
    return result(candidates, "verified", "target cleared and no new findings in the tested routes", 0, { treeHash, patchedBlobs });
  } finally {
    await worktree.remove();
  }
}
async function guarded(candidates, options) {
  try {
    return await run(candidates, options);
  } catch {
    return result(candidates, "error", "verifier failed");
  }
}
function verifyCandidate(candidate, options) {
  return guarded([candidate], options);
}
function verifyCombined(candidates, options) {
  return guarded(candidates, options);
}
function createIsolatedVerifier(options) {
  return {
    verify: (candidate) => verifyCandidate(candidate, options),
    verifyCombined: (candidates) => verifyCombined(candidates, options)
  };
}

// lib/modelfix-verify/rescan.ts
import { readFile as readFile2, realpath as realpath2 } from "node:fs/promises";
import { createServer } from "node:http";
import path4 from "node:path";

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

// lib/types.ts
var IMPACTS = ["minor", "moderate", "serious", "critical"];

// lib/limits.ts
var MAX_AXE_JSON_BYTES = 8 * 1024 * 1024;

// lib/scan/report.ts
var FAIL_ON_VALUES = [...IMPACTS, "none"];
var AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa", "best-practice"];

// lib/modelfix-verify/rescan.ts
var TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg"
};
async function serveDirectory(root) {
  const base = await realpath2(root);
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    let relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    if (!relative || relative.endsWith("/")) relative += "index.html";
    const send = (status, body, type = "text/plain; charset=utf-8") => {
      res.writeHead(status, { "content-type": type });
      res.end(body);
    };
    realpath2(path4.resolve(base, relative)).then(async (file) => {
      if (!file.startsWith(base + path4.sep)) return send(403, "forbidden");
      return send(200, await readFile2(file), TYPES[path4.extname(file).toLowerCase()] ?? "application/octet-stream");
    }).catch(() => send(404, "not found"));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    })
  };
}
function selectorOf(target) {
  return target.map((part) => Array.isArray(part) ? part.map(String).join(" ") : String(part)).join(" ");
}
function createLocalAxeRescanner(options = {}) {
  const tags = [...options.tags ?? AXE_TAGS];
  const load = options.load ?? (async () => ({ playwright: await import("playwright"), axe: await import("@axe-core/playwright") }));
  let browser = null;
  let AxeBuilder = null;
  async function ready() {
    if (!browser || !AxeBuilder) {
      const { playwright, axe: axeModule } = await load();
      AxeBuilder = axeModule.default ?? axeModule.AxeBuilder;
      browser = await playwright.chromium.launch({ headless: true });
    }
    return { browser, AxeBuilder };
  }
  return {
    tags,
    async scan({ root, routes, probes = [] }) {
      const { browser: chromium, AxeBuilder: Builder } = await ready();
      const server = await serveDirectory(root);
      const context = await chromium.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "light", serviceWorkers: "block" });
      const result2 = { status: {}, findings: [], missing: [], engineVersion: "" };
      try {
        await context.route("**/*", (route) => new URL(route.request().url()).origin === server.origin ? route.continue() : route.abort());
        for (const route of routes) {
          const page = await context.newPage();
          try {
            const response = await page.goto(new URL(route.replace(/^\/+/, ""), `${server.origin}/`).toString(), { waitUntil: "load" });
            result2.status[route] = response?.status() ?? 0;
            if (result2.status[route] !== 200) continue;
            const run2 = await new Builder({ page }).withTags(tags).analyze();
            result2.engineVersion = run2.testEngine.version;
            for (const [kind, list] of [["violation", run2.violations], ["incomplete", run2.incomplete]]) {
              for (const rule of list) {
                for (const node of rule.nodes) result2.findings.push({ route, ruleId: rule.id, selector: selectorOf(node.target), html: node.html, kind });
              }
            }
            for (const probe of probes.filter((item) => item.route === route)) {
              const handle = await page.$(probe.selector).catch(() => null);
              if (!handle || !await handle.isVisible()) result2.missing.push(probe);
            }
          } finally {
            await page.close();
          }
        }
      } finally {
        await context.close();
        await server.close();
      }
      return result2;
    },
    async close() {
      const open = browser;
      browser = null;
      if (open) await open.close();
    }
  };
}

// lib/modelfix-verify/action.ts
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path5 from "node:path";
import { pathToFileURL } from "node:url";
var MAX_ROUTES = 20;
var SAFE_ROUTE = /^[A-Za-z0-9._~/-]*$/;
var SAFE_TAG = /^[a-z0-9-]+$/;
function asList(value) {
  if (Array.isArray(value)) return value.filter((item) => item && typeof item === "object");
  return value && typeof value === "object" ? [value] : [];
}
function routeFromUrl(url) {
  if (typeof url !== "string" || !url) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  let route;
  try {
    route = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
  } catch {
    return null;
  }
  if (!SAFE_ROUTE.test(route) || route.split("/").includes("..")) return null;
  return route === "" || route.endsWith("/") ? `${route}index.html` : route;
}
function rescanPlanFromAxeInputs(inputs) {
  const routes = [];
  const tagSets = /* @__PURE__ */ new Set();
  let tags = null;
  for (const input of inputs) {
    for (const item of asList(input)) {
      const route = routeFromUrl(item.url);
      if (route !== null && !routes.includes(route) && routes.length < MAX_ROUTES) routes.push(route);
      const runOnly = item.toolOptions?.runOnly;
      const values = Array.isArray(runOnly?.values) ? runOnly.values.filter((value) => typeof value === "string" && SAFE_TAG.test(value)) : [];
      if (runOnly?.type === "tag" && values.length > 0) {
        const keyed = [...values].sort().join(",");
        tagSets.add(keyed);
        tags = [...values];
      } else {
        tagSets.add("");
      }
    }
  }
  return { routes, tags: tagSets.size === 1 && tags ? tags : null };
}
function workspaceLoader(workspace) {
  return async () => {
    const fromWorkspace = async (name) => {
      const require2 = createRequire(path5.join(workspace, "package.json"));
      return import(pathToFileURL(require2.resolve(name)).href);
    };
    const load = async (name) => {
      try {
        return await fromWorkspace(name);
      } catch {
        return import(name);
      }
    };
    const playwright = await load("playwright");
    const axe = await load("@axe-core/playwright");
    return { playwright: playwright.default?.chromium ? playwright.default : playwright, axe };
  };
}
async function createActionVerifier(input) {
  const routes = [...input.routes];
  if (routes.length === 0) {
    input.warn("A11yGate model verifier skipped: no local routes could be derived from the scanned pages. Drafts are discarded.");
    return null;
  }
  if (!input.workspace || !existsSync(path5.join(input.workspace, ".git"))) {
    input.warn("A11yGate model verifier skipped: the workspace is not a git checkout. Drafts are discarded.");
    return null;
  }
  if (!/^[0-9a-f]{40}$/.test(input.headSha) || await resolveCommit(input.workspace, "HEAD") !== input.headSha) {
    input.warn(
      "A11yGate model verifier skipped: the checkout is not the pull request head commit (use actions/checkout with ref: ${{ github.event.pull_request.head.sha }}). Drafts are discarded."
    );
    return null;
  }
  const load = input.load ?? workspaceLoader(input.workspace);
  let warned = false;
  const guardedLoad = async () => {
    try {
      return await load();
    } catch (error) {
      if (!warned) {
        warned = true;
        input.warn("A11yGate model verifier could not load Playwright or @axe-core/playwright. Verification fails closed; nothing is published.");
      }
      throw error;
    }
  };
  const inner = createLocalAxeRescanner({ tags: input.tags ?? void 0, load: guardedLoad });
  const rescanner = {
    tags: inner.tags,
    async scan(request) {
      try {
        return await inner.scan(request);
      } catch (error) {
        if (!warned) {
          warned = true;
          input.warn("A11yGate model verifier could not start a local Chromium re-scan (is Playwright Chromium installed?). Verification fails closed; nothing is published.");
        }
        throw error;
      }
    },
    close: () => inner.close().catch(() => void 0)
  };
  const verifier = createIsolatedVerifier({ repoRoot: input.workspace, rescanner, routes, headRef: "HEAD" });
  return { verifier, routes, close: () => rescanner.close() };
}
export {
  WORKTREE_PREFIX,
  createActionVerifier,
  createIsolatedVerifier,
  createLocalAxeRescanner,
  rescanPlanFromAxeInputs,
  routeFromUrl,
  serveDirectory,
  verifyCandidate,
  verifyCombined,
  workspaceLoader
};
