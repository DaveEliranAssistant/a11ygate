import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { AxeResults } from '@/lib/types';
import type { EnginePageResult } from '@/lib/scan/engines/types';
import { writeFileAtomic } from './atomic-write';

// Keep defaults narrow: only explicitly volatile attributes and ISO timestamps.
export const DEFAULT_DOM_NORMALIZERS = [
  String.raw`<(?:input|meta)\b(?=[^>]*\b(?:name|id)\s*=\s*["'](?:_?csrf(?:[-_]?token)?|authenticity_token|__RequestVerificationToken)["'])[^>]*>`,
  String.raw`\bnonce\s*=\s*(?:"[^"]*"|'[^']*')`,
  String.raw`\b(?:data-csrf-token|csrf-token|data-timestamp)\s*=\s*(?:"[^"]*"|'[^']*')`,
  String.raw`\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b`,
];
export function normalizeDom(dom: string, patterns: readonly string[] = DEFAULT_DOM_NORMALIZERS): string {
  return patterns.reduce((text, pattern) => text.replace(new RegExp(pattern, 'gi'), ''), dom);
}
const stableJson = (value: unknown) => JSON.stringify(value, (_key, child) => child && typeof child === 'object' && !Array.isArray(child) ? Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b))) : child);
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export type CacheMark = { scanId: string; note: string };
export type CachedAnalysis = {
  result?: AxeResults;
  engineResults: EnginePageResult[];
  rawEngineResults: { engine: string; url: string; status: string; native?: unknown; error?: string }[];
};
type Compatibility = { engineVersions: Record<string, string>; ruleConfig: unknown };
type Entry = { compatibility?: Compatibility; schemaVersion: 1; key: string; domHash: string; scanId: string; analysis: CachedAnalysis };
export type IncrementalOptions = { dir: string; config: unknown; compatibility?: Compatibility; patterns?: string[]; warn: (message: string) => void; sanitize?: (analysis: CachedAnalysis) => CachedAnalysis };

/** Resolve installed runtime peers, never a bundled/build-time engine version. Unknown means no reuse. */
export function installedEngineVersions(engines: readonly string[]): Record<string, string> | undefined {
  const require = createRequire(import.meta.url);
  const packages: Record<string, string> = { axe: 'axe-core', htmlcs: 'html_codesniffer', ibm: 'accessibility-checker-engine', lighthouse: 'lighthouse' };
  try {
    return Object.fromEntries(['playwright', ...(engines.includes('axe') ? ['@axe-core/playwright'] : []), ...engines.map(id => packages[id]!)].map(name => {
      const resolver = name === 'axe-core' ? createRequire(require.resolve('@axe-core/playwright')) : require;
      let dir = path.dirname(resolver.resolve(name));
      while (true) {
        try {
          const info = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as { name?: string; version?: string };
          if (info.name === name && typeof info.version === 'string') return [name, info.version];
        } catch { /* Walk up from entry points whose package metadata is not exported. */ }
        const parent = path.dirname(dir);
        if (parent === dir) throw new Error('Missing version');
        dir = parent;
      }
    }));
  } catch { return undefined; }
}

function parseEntry(text: string): Entry {
  const envelope = JSON.parse(text) as { payload: string; sha256: string };
  if (typeof envelope.payload !== 'string' || hash(envelope.payload) !== envelope.sha256) throw new Error('Checksum mismatch');
  const entry = JSON.parse(envelope.payload) as Entry;
  if (entry.schemaVersion !== 1 || typeof entry.key !== 'string' || typeof entry.domHash !== 'string' || typeof entry.scanId !== 'string' || !entry.analysis || !Array.isArray(entry.analysis.engineResults) || !Array.isArray(entry.analysis.rawEngineResults)) throw new Error('Invalid cache entry');
  return entry;
}

export class IncrementalCache {
  readonly scanId = randomUUID();
  readonly pages: Record<string, CacheMark> = {};
  private validated?: Promise<boolean>;
  constructor(private readonly options: IncrementalOptions) {}
  private async validateFiles(): Promise<boolean> {
    try {
      const files = (await readdir(this.options.dir)).filter(file => /^[a-f0-9]{64}\.json$/.test(file));
      await Promise.all(files.map(async file => parseEntry(await readFile(path.join(this.options.dir, file), 'utf8'))));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
      this.options.warn('Incremental cache unreadable or corrupted; ignored cache and running a full scan.');
      return false;
    }
  }
  async analyze(url: string, dom: string, run: () => Promise<CachedAnalysis>): Promise<CachedAnalysis> {
    const key = hash(stableJson({ url, config: this.options.config, patterns: this.options.patterns ?? DEFAULT_DOM_NORMALIZERS }));
    const domHash = hash(normalizeDom(dom, this.options.patterns));
    const file = path.join(this.options.dir, `${hash(url)}.json`);
    try {
      const valid = await (this.validated ??= this.validateFiles());
      const entry = valid ? parseEntry(await readFile(file, 'utf8')) : undefined;
      if (entry && entry.key === key && entry.domHash === domHash) {
        this.pages[url] = { scanId: entry.scanId, note: `from cache (DOM unchanged since ${entry.scanId})` };
        return structuredClone(entry.analysis);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.options.warn('Incremental cache unreadable or corrupted; ignored cached page and running engines again.');
    }
    const analysis = await run();
    // Failed or partial analysis must never become reusable evidence.
    if ((analysis.result || analysis.engineResults.length) && analysis.engineResults.every(r => r.status === 'complete') && analysis.rawEngineResults.every(r => r.status === 'complete')) {
      const payload = JSON.stringify({ schemaVersion: 1, key, domHash, scanId: this.scanId, compatibility: this.options.compatibility, analysis: this.options.sanitize?.(analysis) ?? analysis } satisfies Entry);
      try {
        await mkdir(this.options.dir, { recursive: true, mode: 0o700 });
        await writeFileAtomic(file, JSON.stringify({ payload, sha256: hash(payload) }));
      } catch { this.options.warn('Incremental cache could not be written; scan findings are still available.'); }
    }
    return analysis;
  }
}
