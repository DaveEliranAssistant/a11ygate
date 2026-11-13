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
function applySuggestion(source, suggestion) {
  const lines = source.split("\n");
  const eol = lines.length > 1 && lines[0].endsWith("\r") ? "\r" : "";
  const replacement = suggestion.replacement.map((line) => line + eol);
  lines.splice(suggestion.startLine - 1, suggestion.endLine - suggestion.startLine + 1, ...replacement);
  return lines.join("\n");
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
function sourceKind(path) {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? "";
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
var PLACEHOLDER = "TODO(a11ygate)";

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
var NAME_PLACEHOLDER = `${PLACEHOLDER}: add accessible name`;
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
  const placeholder = attr.includes(PLACEHOLDER);
  const note = placeholder ? `No title, icon name or nearby text to reuse, so this adds a \`${PLACEHOLDER}\` placeholder. Replace it with the real name before merging.` : title ? "Copies the existing `title` into `aria-label`." : `Derives \`aria-label\` from the ${icon?.from}. Confirm it describes what the control does.`;
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
  const todo = `${PLACEHOLDER}: confirm "${value}" is the main language of this document`;
  const comment = kind === "html" ? `<!-- ${todo} -->` : `{/* ${todo} */}`;
  const edits = existing ? [{ start: existing.start, end: existing.end, text: `lang="${value}"` }] : [insertAfterName(tag.nameEnd, `lang="${value}"`)];
  edits.push({ start: tag.end, end: tag.end, text: comment });
  return {
    rule: "html-has-lang",
    edits,
    placeholder: true,
    note: `Sets \`lang="${value}"\` from the configured default and adds a \`${PLACEHOLDER}\` comment to confirm the language.`
  };
};

// lib/fix/rules/image-alt.ts
var ALT_TODO = `${PLACEHOLDER}: write alt text that describes this image, or confirm it is decorative and keep alt=""`;
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
    note: `Adds \`alt=""\` and a \`${PLACEHOLDER}\` comment. A human must write a real description, or confirm the image is decorative.`
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

// lib/fix/diff.ts
function patchLines(patch) {
  const lines = /* @__PURE__ */ new Set();
  let right = 0;
  let inHunk = false;
  for (const line of String(patch ?? "").split("\n")) {
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (header) {
      right = Number(header[1]);
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("+") || line.startsWith(" ")) {
      lines.add(right);
      right += 1;
    } else if (line === "") {
      continue;
    }
  }
  return lines;
}
function unifiedDiffLines(diff) {
  const files = /* @__PURE__ */ new Map();
  const chunks = String(diff ?? "").split(/^diff --git /m);
  for (const chunk of chunks) {
    const target = /^\+\+\+ (?:b\/)?(.+)$/m.exec(chunk);
    if (!target || target[1].trim() === "/dev/null") continue;
    const at = chunk.indexOf("\n@@");
    if (at < 0) continue;
    files.set(target[1].trim(), patchLines(chunk.slice(at + 1)));
  }
  return files;
}

// lib/fix/comment.ts
var SUGGESTION_MARKER_PREFIX = "<!-- a11ygate-suggestion:";
function suggestionMarker(fingerprint) {
  const safe = String(fingerprint ?? "").replace(/[^\w:.@/+=-]/g, "_").slice(0, 200);
  return `${SUGGESTION_MARKER_PREFIX}${safe} -->`;
}
function fence(lines) {
  let ticks = "```";
  while (lines.some((line) => line.includes(ticks))) ticks += "`";
  return ticks;
}
function buildSuggestionBody(suggestion) {
  const ticks = fence(suggestion.replacement);
  const parts = [
    suggestionMarker(suggestion.fingerprint),
    `**A11yGate rule-based suggestion** for axe \`${suggestion.ruleId}\``,
    "",
    suggestion.note,
    "",
    `${ticks}suggestion`,
    ...suggestion.replacement,
    ticks,
    ""
  ];
  if (suggestion.placeholder) {
    parts.push(`Text marked \`${PLACEHOLDER}\` is a placeholder, not final text. Replace it before merging.`, "");
  }
  parts.push(
    "_Review before clicking **Apply suggestion**. A11yGate never commits changes. This is an automated check of one finding, not a full accessibility review._"
  );
  return `${parts.join("\n")}
`;
}
function findSuggestionComment(comments, fingerprint) {
  const marker = suggestionMarker(fingerprint);
  for (const comment of comments) {
    if (!comment || typeof comment.id !== "number" || typeof comment.body !== "string") continue;
    if (comment.body.includes(marker)) return comment;
  }
  return null;
}

// lib/fix/index.ts
var SUPPORTED_RULES = ["label", "button-name", "link-name", "image-alt", "html-has-lang"];
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
export {
  PLACEHOLDER,
  SUGGESTION_MARKER_PREFIX,
  SUPPORTED_RULES,
  applyEdits,
  applySuggestion,
  buildSuggestionBody,
  findSuggestionComment,
  mapFinding,
  patchLines,
  planSuggestions,
  ruleFor,
  sourceKind,
  suggestForElement,
  suggestionMarker,
  toSuggestion,
  unifiedDiffLines
};
