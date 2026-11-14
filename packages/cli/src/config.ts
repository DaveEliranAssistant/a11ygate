import { readFile } from 'node:fs/promises';
import path from 'node:path';
import schemaJson from '../../../schema/a11ygate.schema.json';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';

/**
 * `.a11ygate.yml` loading and validation against schema/a11ygate.schema.json.
 *
 * The CLI bundle may not include node_modules, so this reads a deliberately small YAML subset:
 * `key: value` mappings (nested by indentation), `- item` and `[a, b]` lists, quoted or plain
 * scalars and comments. Anchors, tags, flow mappings and block scalars are refused, never executed.
 */

export const CONFIG_FILE = '.a11ygate.yml';
export const SCHEMA_PATH = 'schema/a11ygate.schema.json';
export const SCHEMA_URL = 'https://raw.githubusercontent.com/DaveEliranAssistant/a11ygate/main/schema/a11ygate.schema.json';
export const SCHEMA_COMMENT = `# yaml-language-server: $schema=${SCHEMA_URL}`;

export type JsonSchema = {
  type?: string;
  enum?: readonly unknown[];
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean;
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  minItems?: number;
  uniqueItems?: boolean;
  pattern?: string;
  description?: string;
  'x-cli'?: string[];
};
export const CONFIG_SCHEMA = schemaJson as unknown as JsonSchema;

type Yaml = string | number | boolean | null | Yaml[] | { [key: string]: Yaml };
type Line = { indent: number; text: string; number: number };
class YamlError extends Error {}

function stripComment(text: string): string {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === quote && !(quote === '"' && text[i - 1] === '\\')) quote = null; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === '#' && (i === 0 || /\s/.test(text[i - 1]!))) return text.slice(0, i).trimEnd();
  }
  return text.trimEnd();
}

function scalar(raw: string, line: number): Yaml {
  const text = raw.trim();
  if (/^[&*!|>{]/.test(text)) throw new YamlError(`line ${line}: anchors, aliases, tags, block scalars and {…} mappings are not supported in .a11ygate.yml.`);
  if (text.startsWith('"')) {
    try { const value = JSON.parse(text); if (typeof value === 'string') return value; } catch { /* below */ }
    throw new YamlError(`line ${line}: unterminated or invalid double-quoted string.`);
  }
  if (text.startsWith("'")) {
    if (text.length < 2 || !text.endsWith("'")) throw new YamlError(`line ${line}: unterminated single-quoted string.`);
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (text.startsWith('[')) {
    if (!text.endsWith(']')) throw new YamlError(`line ${line}: a [ list must close with ] on the same line.`);
    const inner = text.slice(1, -1).trim();
    return inner ? inner.split(',').map((item) => scalar(item, line)) : [];
  }
  if (text === '' || text === '~' || text === 'null') return null;
  if (text === 'true' || text === 'false') return text === 'true';
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text;
}

function parseBlock(lines: Line[], start: number, indent: number): [Yaml, number] {
  const first = lines[start]!;
  if (first.text.startsWith('- ') || first.text === '-') {
    const list: Yaml[] = [];
    let i = start;
    while (i < lines.length && lines[i]!.indent === indent && (lines[i]!.text.startsWith('- ') || lines[i]!.text === '-')) {
      const item = lines[i]!.text.slice(1).trim();
      if (/^[^\s'"[]*:(\s|$)/.test(item)) throw new YamlError(`line ${lines[i]!.number}: lists of mappings are not supported in .a11ygate.yml.`);
      list.push(scalar(item, lines[i]!.number));
      i++;
    }
    return [list, i];
  }
  const map: { [key: string]: Yaml } = {};
  let i = start;
  while (i < lines.length && lines[i]!.indent === indent) {
    const { text, number } = lines[i]!;
    const match = /^("[^"]*"|'[^']*'|[^\s:'"#-][^:]*?)\s*:(?:\s+(.*))?$/.exec(text);
    if (!match) throw new YamlError(`line ${number}: expected "key: value".`);
    const key = match[1]!.replace(/^(['"])(.*)\1$/, '$2');
    if (Object.hasOwn(map, key)) throw new YamlError(`line ${number}: duplicate key '${key}'.`);
    const rest = (match[2] ?? '').trim();
    i++;
    if (rest) { map[key] = scalar(rest, number); continue; }
    if (i < lines.length && lines[i]!.indent > indent) {
      const [value, next] = parseBlock(lines, i, lines[i]!.indent);
      map[key] = value;
      i = next;
    } else if (i < lines.length && lines[i]!.indent === indent && lines[i]!.text.startsWith('- ')) {
      const [value, next] = parseBlock(lines, i, indent);
      map[key] = value;
      i = next;
    } else map[key] = null;
  }
  return [map, i];
}

export type ParsedConfig = { ok: true; value: unknown } | { ok: false; errors: string[] };

export function parseConfigYaml(text: string): ParsedConfig {
  const lines: Line[] = [];
  const raw = text.replace(/^﻿/, '').split(/\r?\n/);
  for (let index = 0; index < raw.length; index++) {
    const source = raw[index]!;
    if (/^\t/.test(source)) return { ok: false, errors: [`line ${index + 1}: use spaces, not tabs, for indentation.`] };
    const content = stripComment(source);
    if (!content.trim() || (lines.length === 0 && content.trim() === '---')) continue;
    if (content.trim() === '---' || content.trim() === '...') return { ok: false, errors: [`line ${index + 1}: use a single YAML document.`] };
    lines.push({ indent: content.length - content.trimStart().length, text: content.trim(), number: index + 1 });
  }
  if (lines.length === 0) return { ok: true, value: {} };
  try {
    const [value, next] = parseBlock(lines, 0, lines[0]!.indent);
    if (next < lines.length) throw new YamlError(`line ${lines[next]!.number}: unexpected indentation.`);
    return { ok: true, value };
  } catch (error) {
    if (error instanceof YamlError) return { ok: false, errors: [error.message] };
    throw error;
  }
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length]!;
}

/** Closest known key: same letters ignoring case and -/_ (model-fixes → modelFixes), else a small typo. */
export function suggestKey(key: string, known: readonly string[]): string | undefined {
  const fold = (s: string) => s.toLowerCase().replace(/[-_\s]/g, '');
  const exact = known.find((candidate) => fold(candidate) === fold(key));
  if (exact) return exact;
  let best: string | undefined;
  let bestScore = Infinity;
  for (const candidate of known) {
    const score = distance(fold(key), fold(candidate));
    if (score < bestScore) { best = candidate; bestScore = score; }
  }
  return best && bestScore <= Math.max(2, Math.floor(fold(key).length / 3)) ? best : undefined;
}

const show = (value: unknown) => typeof value === 'string' ? `'${value}'` : JSON.stringify(value);
const typeName = (value: unknown) => value === null ? 'nothing' : Array.isArray(value) ? 'a list' : typeof value === 'object' ? 'a mapping' : typeof value === 'number' ? (Number.isInteger(value) ? 'a whole number' : 'a number') : typeof value === 'boolean' ? 'true/false' : 'text';
const expected: Record<string, string> = { string: 'text', integer: 'a whole number', number: 'a number', boolean: 'true or false', array: 'a list, e.g. [a, b]', object: 'a mapping of keys' };

function matchesType(type: string, value: unknown): boolean {
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return !!value && typeof value === 'object' && !Array.isArray(value);
  return typeof value === type;
}

function check(schema: JsonSchema, value: unknown, where: string, errors: string[]): void {
  const label = where || 'the config';
  if (schema.type && !matchesType(schema.type, value)) {
    const hint = schema.type === 'boolean' && (value === 'true' || value === 'false') ? ` (remove the quotes: ${value})` : '';
    errors.push(`'${label}' must be ${expected[schema.type] ?? schema.type}, but got ${typeName(value)}${value !== null && typeof value !== 'object' ? ` ${show(value)}` : ''}${hint}.`);
    return;
  }
  if (schema.enum && !schema.enum.includes(value as never)) {
    errors.push(`'${label}' has invalid value ${show(value)} — use one of: ${schema.enum.join(', ')}.`);
    return;
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`'${label}' must be at least ${schema.minimum}, but got ${value}.`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`'${label}' must be at most ${schema.maximum}, but got ${value}.`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`'${label}' must not be empty.`);
    else if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`'${label}' has an invalid format: ${show(value)}. ${schema.description ?? ''}`.trimEnd());
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`'${label}' needs at least ${schema.minItems} item${schema.minItems === 1 ? '' : 's'}.`);
    if (schema.uniqueItems) {
      const duplicate = value.find((item, index) => value.indexOf(item) !== index);
      if (duplicate !== undefined) errors.push(`'${label}' lists ${show(duplicate)} more than once.`);
    }
    if (schema.items) value.forEach((item, index) => check(schema.items!, item, `${label}[${index}]`, errors));
  }
  if (schema.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    const properties = schema.properties ?? {};
    const known = Object.keys(properties);
    for (const [key, child] of Object.entries(value)) {
      const childWhere = where ? `${where}.${key}` : key;
      if (Object.hasOwn(properties, key)) check(properties[key]!, child, childWhere, errors);
      else if (schema.additionalProperties === false) {
        const suggestion = suggestKey(key, known);
        errors.push(`unknown key '${childWhere}'${suggestion ? ` — did you mean '${where ? `${where}.` : ''}${suggestion}'?` : ` — known keys${where ? ` under '${where}'` : ''}: ${known.join(', ')}.`}`);
      }
    }
  }
}

/** Plain-English problems with a parsed config value; empty when valid. */
export function validateConfig(value: unknown, schema: JsonSchema = CONFIG_SCHEMA): string[] {
  if (value === null || value === undefined) return [];
  const errors: string[] = [];
  check(schema, value, '', errors);
  return errors;
}

/** Parse + validate `.a11ygate.yml` text. Empty array means valid. */
export function configProblems(text: string): string[] {
  const parsed = parseConfigYaml(text);
  return parsed.ok ? validateConfig(parsed.value) : parsed.errors;
}

export const CONFIG_HELP = `a11ygate config validate [file]
  Check .a11ygate.yml (or <file>) against ${SCHEMA_PATH}.
  Exit 0 when valid, 2 with plain-English errors otherwise. Never runs a scan.
  Editor autocomplete: add this first line to the file:
  ${SCHEMA_COMMENT}
${AUTOMATED_TESTING_DISCLAIMER}
`;

export async function runConfig(argv: readonly string[], io: { cwd?: string; stdout?: (text: string) => void; stderr?: (text: string) => void } = {}): Promise<number> {
  const stdout = io.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = io.stderr ?? ((text: string) => process.stderr.write(text));
  if (argv.includes('--help') || argv.includes('-h')) { stdout(CONFIG_HELP); return 0; }
  if (argv[0] !== 'validate' || argv.length > 2 || argv[1]?.startsWith('-')) {
    stderr('Usage: a11ygate config validate [file]. Run a11ygate config --help.\n');
    return 2;
  }
  const file = argv[1] ?? CONFIG_FILE;
  let text: string;
  try { text = await readFile(path.resolve(io.cwd ?? process.cwd(), file), 'utf8'); }
  catch (error) {
    stderr(`${file}: ${(error as NodeJS.ErrnoException).code === 'ENOENT' ? 'file not found' : 'could not read the file'}.\n`);
    return 2;
  }
  const problems = configProblems(text);
  if (problems.length) {
    stderr(`${file} has ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n${problems.map((p) => `  - ${p}`).join('\n')}\nSchema: ${SCHEMA_PATH}\n`);
    return 2;
  }
  stdout(`${file} is valid against ${SCHEMA_PATH}.\n`);
  return 0;
}
