// lib/scan/interactions.ts
function parseInteractionStates(value) {
  if (!Array.isArray(value) || value.length > 100) throw new Error("interactions (top level): must be a list of at most 100 states.");
  const names = /* @__PURE__ */ new Set();
  for (const [index, state] of value.entries()) {
    const at = `interactions[${index}]`;
    if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error(`${at}: each interaction must be an object with route, name and steps.`);
    const extra = Object.keys(state).find((k) => !["route", "name", "steps"].includes(k));
    if (extra !== void 0) throw new Error(`${at}: unknown field ${JSON.stringify(extra.slice(0, 40))}; allowed fields are route, name and steps.`);
    if (typeof state.route !== "string" || !state.route.startsWith("/") || state.route.startsWith("//") || /[#\s]/.test(state.route)) throw new Error(`${at}.route: must be a same-site path starting with / (no #, spaces or //).`);
    if (typeof state.name !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(state.name) || state.name.startsWith("auto-")) throw new Error(`${at}.name: must be 1\u201380 letters, numbers, _ or - (auto- is reserved).`);
    if (!Array.isArray(state.steps) || state.steps.length < 1 || state.steps.length > 100) throw new Error(`${at}.steps: must be a list of 1\u2013100 steps.`);
    const label = state.route + "#" + state.name;
    if (names.has(label)) throw new Error(`${at}.name: interaction state labels (route + name) must be unique.`);
    names.add(label);
    for (const [stepIndex, step] of state.steps.entries()) {
      const stepAt = `${at}.steps[${stepIndex}]`;
      if (!step || typeof step !== "object" || Array.isArray(step)) throw new Error(`${stepAt}: each step must be an object with action and selector.`);
      const stepExtra = Object.keys(step).find((k) => !["action", "selector", "key"].includes(k));
      if (stepExtra !== void 0) throw new Error(`${stepAt}: unknown field ${JSON.stringify(stepExtra.slice(0, 40))}; allowed fields are action, selector and key.`);
      if (!["click", "press", "wait"].includes(step.action)) throw new Error(`${stepAt}.action: must be click, press or wait.`);
      if (typeof step.selector !== "string" || !step.selector.trim() || step.selector.length > 512) throw new Error(`${stepAt}.selector: must be a non-empty selector of at most 512 characters.`);
      if (step.action === "press" ? typeof step.key !== "string" || !step.key.trim() || step.key.length > 80 : step.key !== void 0) throw new Error(`${stepAt}.key: ${step.action === "press" ? "press needs a key of at most 80 characters" : "only press steps take a key"}.`);
    }
  }
  return value;
}

// lib/modelfix/config.ts
var ON = /* @__PURE__ */ new Set(["on", "true", "1", "yes"]);
var OFF = /* @__PURE__ */ new Set(["off", "false", "0", "no"]);
var MAX_REQUEST_CAP = 100;
var MAX_TIMEOUT_MS = 12e4;
var MAX_COST_USD = 100;
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
  const allowPaid = parseSwitch(env.A11YGATE_MODEL_ALLOW_PAID).value === "on";
  const costText = String(env.A11YGATE_MODEL_MAX_COST_USD ?? "").trim();
  let maxCostUsd = 0;
  if (costText) {
    if (/^\d+(\.\d+)?$/.test(costText) && Number(costText) <= MAX_COST_USD) maxCostUsd = Number(costText);
    else warnings.push(`A11YGATE_MODEL_MAX_COST_USD must be a number from 0 to ${MAX_COST_USD}; using 0.`);
  }
  const base = { repo, requested, providers, maxRequests: maxRequests ?? 0, timeoutMs: timeoutMs ?? 0, allowPaid, maxCostUsd, warnings };
  if (requested === null) return { ...base, enabled: false, reason: "default-off" };
  if (requested === "off") return { ...base, enabled: false, reason: "turned-off" };
  if (repo === "missing") return { ...base, enabled: false, reason: "repo-missing" };
  if (repo === "denied") return { ...base, enabled: false, reason: "repo-denied" };
  if (repo === "invalid") return { ...base, enabled: false, reason: "repo-invalid" };
  return { ...base, enabled: true, reason: "enabled" };
}
var MODEL_FIXES_OFF = resolveModelFixConfig({});

// packages/cli/src/effective-config.ts
import { readFileSync } from "node:fs";
import path from "node:path";

// schema/a11ygate.schema.json
var a11ygate_schema_default = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://raw.githubusercontent.com/DaveEliranAssistant/a11ygate/main/schema/a11ygate.schema.json",
  title: "A11yGate repository config (.a11ygate.yml)",
  description: "Effective repository settings for A11yGate. CLI flags override environment variables, which override this file and then defaults. Scan consumes all live-scan settings; ci and the Action consume saved-result report settings; doctor consumes engines and modelFixes. See docs/configuration.md for command scopes and the modelFixes consent boundary. Automated testing only. Not a WCAG audit, certification or legal advice.",
  type: "object",
  additionalProperties: false,
  properties: {
    url: {
      description: "Start URL of a site you own or are authorized to test. HTTP(S) only, no credentials in the URL.",
      type: "string",
      pattern: "^https?://[^\\s@/]+(/\\S*)?$",
      "x-cli": ["--url"]
    },
    crawl: {
      description: "0 = start URL only; 1-20 = same-origin crawl page limit.",
      type: "integer",
      minimum: 0,
      maximum: 20,
      "x-cli": ["--crawl"]
    },
    maxPages: {
      description: "Explicit crawl page budget overriding crawl, regardless of which source supplies crawl.",
      type: "integer",
      minimum: 1,
      maximum: 1e3,
      "x-cli": ["--max-pages"]
    },
    maxDepth: {
      description: "Maximum link depth; start URL and sitemap seeds have depth zero.",
      type: "integer",
      minimum: 0,
      maximum: 1e3,
      "x-cli": ["--max-depth"]
    },
    timeoutMs: {
      description: "Whole-page navigation and analysis deadline in milliseconds.",
      type: "integer",
      minimum: 1,
      maximum: 3e5,
      "x-cli": ["--timeout-ms"]
    },
    concurrency: {
      description: "Maximum active browser pages; global delay still spaces starts and retries.",
      type: "integer",
      minimum: 1,
      maximum: 8,
      "x-cli": ["--concurrency"]
    },
    recycleEvery: {
      description: "Open a fresh browser context every n pages to bound Chromium memory on long scans. Absent: one context for the whole scan. See docs/perf/.",
      type: "integer",
      minimum: 1,
      maximum: 1e3,
      "x-cli": ["--recycle-every"]
    },
    sitemap: {
      description: "Same-origin sitemap URL or path. Enables crawling (20 pages unless crawl or maxPages is set).",
      type: "string",
      minLength: 1,
      "x-cli": ["--sitemap"]
    },
    include: {
      description: "Include globs for live scans; CLI lists replace environment or YAML lists.",
      type: "array",
      items: { type: "string", minLength: 1 },
      "x-cli": ["--include"]
    },
    exclude: {
      description: "Exclude globs for live scans; exclusions win.",
      type: "array",
      items: { type: "string", minLength: 1 },
      "x-cli": ["--exclude"]
    },
    ignoreRobots: {
      description: "Opt out of robots.txt rules for an authorized live scan; default false.",
      type: "boolean",
      "x-cli": ["--ignore-robots"]
    },
    failOn: {
      description: "Lowest impact that fails the scan; none never fails on findings.",
      type: "string",
      enum: ["minor", "moderate", "serious", "critical", "none"],
      "x-cli": ["--fail-on"]
    },
    engines: {
      description: "Scan engines. axe is bundled with the scan peers; htmlcs, ibm and lighthouse need their optional peer packages.",
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { type: "string", enum: ["axe", "htmlcs", "ibm", "lighthouse"] },
      "x-cli": ["--engines"]
    },
    modelFixes: {
      description: "Repository opt-in for experimental model-assisted Action suggestions and doctor checks. Off unless exactly true; a flag or environment variable cannot override a missing or false repository consent. An explicit off disables it.",
      type: "boolean",
      "x-cli": ["--model-fixes"]
    },
    baseline: {
      description: "Baseline file: fingerprint baseline for scan; axe JSON baseline for ci and the Action. Usually .a11ygate-baseline.json for scan.",
      type: "string",
      minLength: 1,
      "x-cli": ["--baseline", "-b"]
    },
    formats: {
      description: "Extra report formats written to outDir.",
      type: "array",
      uniqueItems: true,
      items: { type: "string", enum: ["junit", "sarif", "json", "md", "gitlab-codequality"] },
      "x-cli": ["--format"]
    },
    outDir: {
      description: "Directory for scan or ci reports.",
      type: "string",
      minLength: 1,
      "x-cli": ["--out-dir"]
    },
    delayMs: {
      description: "Polite delay between crawled pages, in milliseconds.",
      type: "integer",
      minimum: 0,
      maximum: 6e4,
      "x-cli": ["--delay-ms"]
    },
    reportVersion: {
      description: "HTML report layout version.",
      type: "integer",
      enum: [1, 2],
      "x-cli": ["--report-version"]
    },
    auth: {
      description: "Authenticated scans. Never put credentials here: name environment variables instead.",
      type: "object",
      additionalProperties: false,
      properties: {
        check: {
          description: "Explicit auth verification, replacing login heuristics. Optional same-origin URL is probed once; selectors and forbidden redirect are checked on every page.",
          type: "object",
          additionalProperties: false,
          properties: {
            url: { type: "string", minLength: 1, "x-cli": ["--auth-check-url"] },
            mustHaveSelector: { type: "string", minLength: 1, "x-cli": ["--auth-check-must-have-selector"] },
            mustNotHaveSelector: { type: "string", minLength: 1, "x-cli": ["--auth-check-must-not-have-selector"] },
            mustNotRedirectTo: { type: "string", minLength: 1, "x-cli": ["--auth-check-must-not-redirect-to"] }
          }
        },
        storageState: {
          description: "Playwright storage-state JSON file (keep it out of version control).",
          type: "string",
          minLength: 1,
          "x-cli": ["--storage-state"]
        },
        loginScript: {
          description: "Login script run in an isolated worker before scanning.",
          type: "string",
          minLength: 1,
          "x-cli": ["--login-script"]
        },
        loginTimeoutMs: {
          description: "Login script timeout in milliseconds.",
          type: "integer",
          minimum: 1,
          maximum: 3e5,
          "x-cli": ["--login-timeout-ms"]
        },
        cookieEnv: {
          description: "Cookies as NAME=ENV_VAR_NAME; the value is read from the environment.",
          type: "array",
          items: { type: "string", pattern: "^[!#$%&'*+.^_`|~0-9A-Za-z-]+=[A-Za-z_][A-Za-z0-9_]*$" },
          "x-cli": ["--cookie-env"]
        },
        headerEnv: {
          description: "Headers as NAME=ENV_VAR_NAME; the value is read from the environment.",
          type: "array",
          items: { type: "string", pattern: "^[!#$%&'*+.^_`|~0-9A-Za-z-]+=[A-Za-z_][A-Za-z0-9_]*$" },
          "x-cli": ["--header-env"]
        }
      }
    },
    keyboard: { type: "boolean", description: "Opt-in keyboard focus heuristics; needs human review.", "x-cli": ["--keyboard"] },
    keyboardBudget: { type: "integer", minimum: 1, maximum: 1e3, description: "Maximum Tab presses per page (default 100).", "x-cli": ["--keyboard-budget"] },
    interactions: {
      description: "Opt-in route states. --interactions reads this list from a local JSON file.",
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "route",
          "name",
          "steps"
        ],
        properties: {
          route: {
            type: "string",
            pattern: "^/(?!/)[^#\\s]*$"
          },
          name: {
            type: "string",
            pattern: "^(?!auto-)[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$"
          },
          steps: {
            type: "array",
            minItems: 1,
            maxItems: 100,
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "action",
                "selector"
              ],
              properties: {
                action: {
                  type: "string",
                  enum: [
                    "click",
                    "press",
                    "wait"
                  ]
                },
                selector: {
                  type: "string",
                  minLength: 1,
                  maxLength: 512
                },
                key: {
                  type: "string",
                  minLength: 1,
                  maxLength: 80
                }
              },
              allOf: [
                {
                  if: {
                    properties: {
                      action: {
                        const: "press"
                      }
                    }
                  },
                  then: {
                    required: [
                      "key"
                    ],
                    properties: {
                      key: {}
                    }
                  },
                  else: {
                    not: {
                      required: [
                        "key"
                      ],
                      properties: {
                        key: {}
                      }
                    }
                  }
                }
              ]
            }
          }
        }
      },
      "x-cli": [
        "--interactions"
      ]
    },
    autoInteractions: {
      description: "Opt in to opening collapsed controls and popup buttons, individually.",
      type: "boolean",
      "x-cli": [
        "--auto-interactions"
      ]
    },
    interactionBudget: {
      description: "Maximum attempted interaction steps per route, shared by explicit and auto states. Default 10.",
      type: "integer",
      minimum: 1,
      maximum: 100,
      "x-cli": [
        "--interaction-budget"
      ]
    }
  }
};

// packages/cli/src/config-schema.ts
var CONFIG_FILE = ".a11ygate.yml";
var SCHEMA_URL = "https://raw.githubusercontent.com/DaveEliranAssistant/a11ygate/main/schema/a11ygate.schema.json";
var SCHEMA_COMMENT = `# yaml-language-server: $schema=${SCHEMA_URL}`;
var CONFIG_SCHEMA = a11ygate_schema_default;
var YamlError = class extends Error {
};
function stripComment(text) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote && !(quote === '"' && text[i - 1] === "\\")) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "#" && (i === 0 || /\s/.test(text[i - 1]))) return text.slice(0, i).trimEnd();
  }
  return text.trimEnd();
}
function scalar(raw, line) {
  const text = raw.trim();
  if (/^[&*!|>{]/.test(text)) throw new YamlError(`line ${line}: anchors, aliases, tags, block scalars and {\u2026} mappings are not supported in .a11ygate.yml.`);
  if (text.startsWith('"')) {
    try {
      const value = JSON.parse(text);
      if (typeof value === "string") return value;
    } catch {
    }
    throw new YamlError(`line ${line}: unterminated or invalid double-quoted string.`);
  }
  if (text.startsWith("'")) {
    if (text.length < 2 || !text.endsWith("'")) throw new YamlError(`line ${line}: unterminated single-quoted string.`);
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (text.startsWith("[")) {
    try {
      const value = JSON.parse(text);
      if (Array.isArray(value)) return value;
    } catch {
    }
    if (!text.endsWith("]")) throw new YamlError(`line ${line}: a [ list must close with ] on the same line.`);
    const inner = text.slice(1, -1).trim();
    return inner ? inner.split(",").map((item) => scalar(item, line)) : [];
  }
  if (text === "" || text === "~" || text === "null") return null;
  if (text === "true" || text === "false") return text === "true";
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text;
}
function parseBlock(lines, start, indent) {
  const first = lines[start];
  if (first.text.startsWith("- ") || first.text === "-") {
    const list = [];
    let i2 = start;
    while (i2 < lines.length && lines[i2].indent === indent && (lines[i2].text.startsWith("- ") || lines[i2].text === "-")) {
      const item = lines[i2].text.slice(1).trim();
      if (item === "" || /^[^\s'"[]*:(\s|$)/.test(item)) {
        const begin = i2++;
        while (i2 < lines.length && lines[i2].indent > indent) i2++;
        const children = lines.slice(begin + 1, i2);
        const nested = item ? [{ indent: indent + 2, text: item, number: lines[begin].number }, ...children] : children;
        if (!nested.length) throw new YamlError(`line ${lines[begin].number}: empty list item.`);
        const [value, next] = parseBlock(nested, 0, nested[0].indent);
        if (next !== nested.length) throw new YamlError(`line ${lines[begin].number}: unexpected list indentation.`);
        list.push(value);
        continue;
      }
      list.push(scalar(item, lines[i2].number));
      i2++;
    }
    return [list, i2];
  }
  const map = {};
  let i = start;
  while (i < lines.length && lines[i].indent === indent) {
    const { text, number } = lines[i];
    const match = /^("[^"]*"|'[^']*'|[^\s:'"#-][^:]*?)\s*:(?:\s+(.*))?$/.exec(text);
    if (!match) throw new YamlError(`line ${number}: expected "key: value".`);
    const key = match[1].replace(/^(['"])(.*)\1$/, "$2");
    if (key === "__proto__") throw new YamlError(`line ${number}: the key '__proto__' is not allowed.`);
    if (Object.hasOwn(map, key)) throw new YamlError(`line ${number}: duplicate key '${key}'.`);
    const rest = (match[2] ?? "").trim();
    i++;
    if (rest) {
      map[key] = scalar(rest, number);
      continue;
    }
    if (i < lines.length && lines[i].indent > indent) {
      const [value, next] = parseBlock(lines, i, lines[i].indent);
      map[key] = value;
      i = next;
    } else if (i < lines.length && lines[i].indent === indent && lines[i].text.startsWith("- ")) {
      const [value, next] = parseBlock(lines, i, indent);
      map[key] = value;
      i = next;
    } else map[key] = null;
  }
  return [map, i];
}
function parseConfigYaml(text) {
  const lines = [];
  const raw = text.replace(/^﻿/, "").split(/\r?\n/);
  for (let index = 0; index < raw.length; index++) {
    const source = raw[index];
    if (/^\t/.test(source)) return { ok: false, errors: [`line ${index + 1}: use spaces, not tabs, for indentation.`] };
    const content = stripComment(source);
    if (!content.trim() || lines.length === 0 && content.trim() === "---") continue;
    if (content.trim() === "---" || content.trim() === "...") return { ok: false, errors: [`line ${index + 1}: use a single YAML document.`] };
    lines.push({ indent: content.length - content.trimStart().length, text: content.trim(), number: index + 1 });
  }
  if (lines.length === 0) return { ok: true, value: {} };
  try {
    const [value, next] = parseBlock(lines, 0, lines[0].indent);
    if (next < lines.length) throw new YamlError(`line ${lines[next].number}: unexpected indentation.`);
    return { ok: true, value };
  } catch (error) {
    if (error instanceof YamlError) return { ok: false, errors: [error.message] };
    throw error;
  }
}
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}
function suggestKey(key, known) {
  const fold = (s) => s.toLowerCase().replace(/[-_\s]/g, "");
  const exact = known.find((candidate) => fold(candidate) === fold(key));
  if (exact) return exact;
  let best;
  let bestScore = Infinity;
  for (const candidate of known) {
    const score = distance(fold(key), fold(candidate));
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best && bestScore <= Math.max(2, Math.floor(fold(key).length / 3)) ? best : void 0;
}
var show = (value) => typeof value === "string" ? `'${value}'` : JSON.stringify(value);
var typeName = (value) => value === null ? "nothing" : Array.isArray(value) ? "a list" : typeof value === "object" ? "a mapping" : typeof value === "number" ? Number.isInteger(value) ? "a whole number" : "a number" : typeof value === "boolean" ? "true/false" : "text";
var expected = { string: "text", integer: "a whole number", number: "a number", boolean: "true or false", array: "a list, e.g. [a, b]", object: "a mapping of keys" };
function matchesType(type, value) {
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  if (type === "array") return Array.isArray(value);
  if (type === "object") return !!value && typeof value === "object" && !Array.isArray(value);
  return typeof value === type;
}
function check(schema, value, where, errors) {
  const label = where || "the config";
  if (schema.type && !matchesType(schema.type, value)) {
    const hint = schema.type === "boolean" && (value === "true" || value === "false") ? ` (remove the quotes: ${value})` : "";
    errors.push(`'${label}' must be ${expected[schema.type] ?? schema.type}, but got ${typeName(value)}${value !== null && typeof value !== "object" ? ` ${show(value)}` : ""}${hint}.`);
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`'${label}' has invalid value ${show(value)} \u2014 use one of: ${schema.enum.join(", ")}.`);
    return;
  }
  if (typeof value === "number") {
    if (schema.minimum !== void 0 && value < schema.minimum) errors.push(`'${label}' must be at least ${schema.minimum}, but got ${value}.`);
    if (schema.maximum !== void 0 && value > schema.maximum) errors.push(`'${label}' must be at most ${schema.maximum}, but got ${value}.`);
  }
  if (typeof value === "string") {
    if (schema.maxLength !== void 0 && value.length > schema.maxLength) errors.push(`'${label}' is too long.`);
    if (schema.minLength !== void 0 && value.length < schema.minLength) errors.push(`'${label}' must not be empty.`);
    else if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`'${label}' has an invalid format: ${show(value)}. ${schema.description ?? ""}`.trimEnd());
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== void 0 && value.length < schema.minItems) errors.push(`'${label}' needs at least ${schema.minItems} item${schema.minItems === 1 ? "" : "s"}.`);
    if (schema.maxItems !== void 0 && value.length > schema.maxItems) errors.push(`'${label}' has too many items.`);
    if (schema.uniqueItems) {
      const duplicate = value.find((item, index) => value.indexOf(item) !== index);
      if (duplicate !== void 0) errors.push(`'${label}' lists ${show(duplicate)} more than once.`);
    }
    if (schema.items) value.forEach((item, index) => check(schema.items, item, `${label}[${index}]`, errors));
  }
  if (schema.type === "object" && value && typeof value === "object" && !Array.isArray(value)) {
    const properties = schema.properties ?? {};
    const known = Object.keys(properties);
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) errors.push(`'${label}.${key}' is required.`);
    if (properties.action && properties.key) {
      const step = value;
      if (step.action === "press" !== Object.hasOwn(step, "key")) errors.push(`'${label}' needs key only for press actions.`);
    }
    for (const [key, child] of Object.entries(value)) {
      const childWhere = where ? `${where}.${key}` : key;
      if (Object.hasOwn(properties, key)) check(properties[key], child, childWhere, errors);
      else if (schema.additionalProperties === false) {
        const suggestion = suggestKey(key, known);
        errors.push(`unknown key '${childWhere}'${suggestion ? ` \u2014 did you mean '${where ? `${where}.` : ""}${suggestion}'?` : ` \u2014 known keys${where ? ` under '${where}'` : ""}: ${known.join(", ")}.`}`);
      }
    }
  }
}
function validateConfig(value, schema = CONFIG_SCHEMA) {
  if (value === null || value === void 0) return [];
  const errors = [];
  check(schema, value, "", errors);
  return errors;
}

// lib/scan/redact.ts
var AuthRedactor = class {
  values = /* @__PURE__ */ new Set();
  add(value) {
    if (typeof value !== "string" || !value) return;
    this.values.add(value);
    this.values.add(encodeURIComponent(value));
    this.values.add(Buffer.from(value).toString("base64"));
    try {
      this.values.add(decodeURIComponent(value));
    } catch {
    }
    this.values.add(JSON.stringify(value).slice(1, -1));
    this.values.add(value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"));
  }
  storage(state) {
    for (const cookie of state.cookies ?? []) this.add(cookie.value);
    for (const origin of state.origins ?? []) for (const entry of [...origin.localStorage ?? [], ...origin.sessionStorage ?? []]) this.add(entry.value);
  }
  text(input) {
    let output = input;
    for (const value of [...this.values].filter(Boolean).sort((a, b) => b.length - a.length)) {
      output = output.split(/(\[REDACTED\])/).map((part) => part === "[REDACTED]" ? part : part.split(value).join("[REDACTED]")).join("");
    }
    return output.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]").replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED]").replace(/([?&](?:access_token|id_token|token|api_key|apikey|password|secret|client_secret)=)[^&\s"'<>]+/gi, "$1[REDACTED]").replace(/((?:authorization|proxy-authorization|set-cookie|cookie)\s*:\s*)[^\r\n<>]+/gi, "$1[REDACTED]");
  }
  /** Redact before rendering, so escaping cannot hide credentials from the filter. */
  object(input) {
    const visit = (value) => {
      if (typeof value === "string") return this.text(value);
      if (Array.isArray(value)) return value.map(visit);
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [
        this.text(key),
        /^(?:cookies?|set-cookie|authorization|proxy-authorization|.*token|password|secret|client_secret)$/i.test(key) ? "[REDACTED]" : visit(item)
      ]));
      return value;
    };
    return visit(input);
  }
};

// lib/evidence/secrets.ts
var SECRET_ENV_NAME = /(COOKIE|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|API_?KEY|ACCESS_?KEY|AUTH)/i;
function secretEnvValues(env = process.env, minimumLength = 8) {
  return Object.entries(env).filter(([name, value]) => SECRET_ENV_NAME.test(name) && typeof value === "string" && value.length >= minimumLength).map(([, value]) => value);
}

// packages/cli/src/effective-config.ts
var scan = ["scan"];
var reports = ["scan", "ci"];
var CONFIG_WIRING = {
  keyboard: { flag: "--keyboard", commands: scan, default: false },
  keyboardBudget: { flag: "--keyboard-budget", commands: scan, default: 100 },
  interactions: { flag: "--interactions", commands: scan, default: [] },
  autoInteractions: { flag: "--auto-interactions", commands: scan, default: false },
  interactionBudget: { flag: "--interaction-budget", commands: scan, default: 10 },
  url: { flag: "--url", commands: scan, default: "" },
  crawl: { flag: "--crawl", commands: scan, default: 0 },
  maxPages: { flag: "--max-pages", commands: scan, default: 1 },
  maxDepth: { flag: "--max-depth", commands: scan, default: null },
  timeoutMs: { flag: "--timeout-ms", commands: scan, default: 3e4 },
  concurrency: { flag: "--concurrency", commands: scan, default: 1 },
  recycleEvery: { flag: "--recycle-every", commands: scan, default: null },
  sitemap: { flag: "--sitemap", commands: scan, default: null },
  include: { flag: "--include", commands: scan, default: [] },
  exclude: { flag: "--exclude", commands: scan, default: [] },
  ignoreRobots: { flag: "--ignore-robots", commands: scan, default: false },
  failOn: { flag: "--fail-on", commands: reports, aliases: ["--threshold", "-t"], default: "serious", env: ["A11Y_THRESHOLD"] },
  engines: { flag: "--engines", commands: ["scan", "doctor"], default: ["axe"] },
  modelFixes: { flag: "--model-fixes", commands: ["doctor"], default: false, env: ["A11Y_MODEL_FIXES"], reason: "Repository consent is mandatory; scan/ci do not generate model fixes. The Action uses this switch for suggestions." },
  baseline: { flag: "--baseline", aliases: ["-b"], commands: reports, default: null, env: ["A11Y_BASELINE"] },
  formats: { flag: "--format", commands: reports, default: [] },
  outDir: { flag: "--out-dir", commands: reports, default: null },
  delayMs: { flag: "--delay-ms", commands: scan, default: 1e3 },
  reportVersion: { flag: "--report-version", commands: scan, default: 2 },
  "auth.check.url": { flag: "--auth-check-url", commands: scan, default: null },
  "auth.check.mustHaveSelector": { flag: "--auth-check-must-have-selector", commands: scan, default: null },
  "auth.check.mustNotHaveSelector": { flag: "--auth-check-must-not-have-selector", commands: scan, default: null },
  "auth.check.mustNotRedirectTo": { flag: "--auth-check-must-not-redirect-to", commands: scan, default: null },
  "auth.storageState": { flag: "--storage-state", commands: scan, default: null },
  "auth.loginScript": { flag: "--login-script", commands: scan, default: null },
  "auth.loginTimeoutMs": { flag: "--login-timeout-ms", commands: scan, default: 3e4 },
  "auth.cookieEnv": { flag: "--cookie-env", commands: scan, default: [] },
  "auth.headerEnv": { flag: "--header-env", commands: scan, default: [] }
};
function configEnvName(key) {
  return "A11YGATE_" + key.replace(/([a-z])([A-Z])/g, "$1_$2").replace(/\./g, "_").toUpperCase();
}
function schemaAt(key) {
  return key.split(".").reduce((node, part) => node.properties[part], CONFIG_SCHEMA);
}
function get(object, key) {
  return key.split(".").reduce((node, part) => node && typeof node === "object" ? node[part] : void 0, object);
}
function decode(text, schema) {
  if (schema.type === "array") {
    if (text.trim().startsWith("[")) {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
    return text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  }
  if (schema.type === "integer") return /^\d+$/.test(text) ? Number(text) : text;
  if (schema.type === "boolean") {
    if (/^(true|on|1|yes)$/i.test(text)) return true;
    if (/^(false|off|0|no)$/i.test(text)) return false;
  }
  return text;
}
function loadEffectiveConfig(command, argv = [], io = {}) {
  const env = io.env ?? process.env;
  let repoConfig = io.repoConfig;
  if (repoConfig === void 0) {
    try {
      repoConfig = readFileSync(path.join(io.cwd ?? process.cwd(), CONFIG_FILE), "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw new Error("Could not read .a11ygate.yml.");
      repoConfig = null;
    }
  }
  const parsed = parseConfigYaml(repoConfig ?? "");
  const problems = parsed.ok ? validateConfig(parsed.value) : parsed.errors;
  if (problems.length) {
    const first = problems[0];
    const line = /^line \d+/.exec(first)?.[0];
    const key = /'([^']+)'/.exec(first)?.[1];
    const at = [line, key && `field '${key}'`].filter(Boolean).join(", ");
    throw new Error(`Invalid .a11ygate.yml${at ? ` (${at})` : ""}. Run a11ygate config validate to check its schema.`);
  }
  const yaml = parsed.ok ? parsed.value : {};
  const values = {};
  const sources = {};
  for (const [key, wiring] of Object.entries(CONFIG_WIRING)) {
    values[key] = structuredClone(wiring.default);
    sources[key] = "default";
    const value = get(yaml, key);
    if (value !== void 0) {
      values[key] = value;
      sources[key] = CONFIG_FILE;
    }
    for (const name of [...wiring.env ?? [], configEnvName(key)]) {
      const text = env[name];
      if (text === void 0 || text === "") continue;
      const value2 = decode(text.trim(), schemaAt(key));
      if (validateConfig(value2, schemaAt(key)).length) throw new Error(`Invalid ${name}; see the config schema for the expected type/range.`);
      values[key] = value2;
      sources[key] = `env:${name}`;
    }
  }
  try {
    parseInteractionStates(values.interactions);
  } catch (error) {
    throw new Error(`${sources.interactions ?? CONFIG_FILE}: ${error.message}`, { cause: error });
  }
  const remaining = [];
  const supplied = /* @__PURE__ */ new Set();
  let hasPositionalUrl = false;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    const [name] = token.split("=");
    const entry = Object.entries(CONFIG_WIRING).find(([, w]) => w.commands.includes(command) && [w.flag, ...w.aliases ?? []].includes(name));
    if (!entry) {
      if (command === "scan" && !token.startsWith("-")) {
        if (supplied.has("url")) throw new Error("Pass one scan URL.");
        values.url = token;
        sources.url = "flag:positional";
        supplied.add("url");
        hasPositionalUrl = true;
        remaining.push(token);
      } else {
        remaining.push(token);
        if (token.startsWith("-") && !token.includes("=") && !["--help", "-h", "--version", "--strict"].includes(token) && argv[i + 1] && (!argv[i + 1].startsWith("-") || argv[i + 1] === "-")) remaining.push(argv[++i]);
      }
      continue;
    }
    const [key, wiring] = entry;
    if (key === "url" && supplied.has("url")) throw new Error("Pass one scan URL.");
    const schema = schemaAt(key);
    let text = token.includes("=") ? token.slice(token.indexOf("=") + 1) : void 0;
    if (key === "crawl" && text === void 0 && !/^\d+$/.test(argv[i + 1] ?? "")) text = "20";
    else if (schema.type === "boolean" && key !== "modelFixes") text ??= "true";
    else if (text === void 0) text = argv[++i];
    if (text === void 0) throw new Error(`${name} needs a value.`);
    if (["ignoreRobots", "autoInteractions", "keyboard"].includes(key) && token.includes("=")) throw new Error(`${name} takes no value.`);
    let value = key === "interactions" ? (() => {
      const inline = text.trim().startsWith("[");
      const source = inline ? "--interactions" : text;
      let raw;
      if (inline) raw = text;
      else {
        try {
          raw = readFileSync(path.resolve(io.cwd ?? process.cwd(), text), "utf8");
        } catch (error) {
          throw new Error(`Invalid --interactions (${source}: ${error.code === "ENOENT" ? "file not found" : "could not read the file"}); provide a readable local JSON file containing route states.`, { cause: error });
        }
      }
      let json;
      try {
        json = JSON.parse(raw.replace(/^\uFEFF/, ""));
      } catch {
        throw new Error(`Invalid --interactions (${source}: not valid JSON); provide a readable local JSON file containing route states.`);
      }
      try {
        return parseInteractionStates(json);
      } catch (error) {
        throw new Error(`Invalid --interactions (${source}: ${error.message.replace(/\.$/, "")}).`, { cause: error });
      }
    })() : schema.type === "array" && !["engines", "formats"].includes(key) ? [text] : decode(text, schema);
    if (key === "formats" && Array.isArray(value)) value = [...new Set(value)];
    if (!(key === "crawl" && typeof value === "number" && value > 20) && validateConfig(value, schema).length) {
      if (key === "engines") throw new Error("Invalid --engines. Use a comma-separated list of axe,htmlcs,ibm,lighthouse.");
      throw new Error(`Invalid ${name}; see the config schema for the expected type/range.`);
    }
    if (schema.type === "array" && !["engines", "interactions"].includes(key) && supplied.has(key)) {
      const items = [...values[key], ...value];
      values[key] = key === "formats" ? [...new Set(items)] : items;
    } else values[key] = value;
    sources[key] = `flag:${name}`;
    supplied.add(key);
    if (key === "url") continue;
    remaining.push(command === "ci" && key === "failOn" ? "--threshold" : wiring.flag);
    if (schema.type !== "boolean" || key === "modelFixes") remaining.push(text);
  }
  if (values.modelFixes && get(yaml, "modelFixes") !== true) {
    values.modelFixes = false;
    sources.modelFixes = "repository-consent:denied";
  }
  const prefix = [];
  for (const [key, wiring] of Object.entries(CONFIG_WIRING)) {
    if (!wiring.commands.includes(command) || supplied.has(key) || sources[key] === "default") continue;
    const value = values[key];
    if (key === "url") continue;
    if (key === "crawl" && value === 0) {
      prefix.push("--crawl", "1");
      continue;
    }
    const flag = command === "ci" && key === "failOn" ? "--threshold" : wiring.flag;
    if (schemaAt(key).type === "boolean") {
      if (key === "modelFixes") prefix.push(flag, value ? "on" : "off");
      else if (value) prefix.push(flag);
    } else if (key === "interactions") prefix.push(flag, JSON.stringify(value));
    else if (Array.isArray(value)) {
      if (["engines", "formats"].includes(key)) {
        if (value.length) prefix.push(flag, value.join(","));
      } else for (const item of value) prefix.push(flag, String(item));
    } else prefix.push(flag, String(value));
  }
  if (command === "scan" && !hasPositionalUrl) {
    if (values.url) prefix.push(String(values.url));
  }
  if (sources.maxPages === "default") {
    if (sources.crawl !== "default") {
      values.maxPages = Math.max(1, Math.min(20, Number(values.crawl)));
      sources.maxPages = `${sources.crawl} (crawl)`;
    } else if (values.sitemap) {
      values.maxPages = 20;
      sources.maxPages = `${sources.sitemap} (sitemap)`;
    }
  }
  if (typeof values.crawl === "number") values.crawl = Math.min(20, values.crawl);
  return { values, sources, argv: [...prefix, ...remaining], repoConfig };
}
function printableConfig(config, env = process.env) {
  const redactor = new AuthRedactor();
  for (const value of secretEnvValues(env, 1)) redactor.add(value);
  for (const key of ["auth.cookieEnv", "auth.headerEnv"]) {
    for (const mapping of config.values[key]) redactor.add(env[mapping.slice(mapping.indexOf("=") + 1)]);
  }
  const values = { ...config.values };
  for (const key of ["url", "sitemap"]) {
    if (typeof values[key] !== "string" || !values[key]) continue;
    const url = new URL(values[key], typeof values.url === "string" && values.url ? values.url : "https://config-print.invalid");
    for (const parameter of [...url.searchParams.keys()]) url.searchParams.set(parameter, "[REDACTED]");
    if (url.hash) url.hash = "[REDACTED]";
    values[key] = url.href;
  }
  return redactor.object(Object.fromEntries(Object.keys(CONFIG_WIRING).map((key) => [key, { value: values[key], source: config.sources[key], appliesTo: CONFIG_WIRING[key].commands, ...CONFIG_WIRING[key].reason ? { note: CONFIG_WIRING[key].reason } : {} }])));
}
function effectiveModelFixConfig(config, env = process.env) {
  const parsed = parseConfigYaml(config.repoConfig ?? "");
  const consent = parsed.ok && get(parsed.value, "modelFixes") === true;
  return resolveModelFixConfig({ repoConfig: consent ? "modelFixes: true" : null, flag: config.values.modelFixes ? "on" : "off", env: { ...env, A11YGATE_MODEL_FIXES: void 0 } });
}
export {
  CONFIG_WIRING,
  configEnvName,
  effectiveModelFixConfig,
  loadEffectiveConfig,
  printableConfig
};
