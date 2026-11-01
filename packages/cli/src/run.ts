import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './args';
import { helpText } from './help';
import { baselineDocument } from '@/lib/export-baseline';
import { prSummaryMarkdown } from '@/lib/export-markdown';
import { diffScans } from '@/lib/diff';
import { gateVerdict, verdictReason } from '@/lib/gate';
import { axeJsonTooLargeMessage, MAX_AXE_JSON_BYTES } from '@/lib/limits';
import { findingsFromResults, parseAxeDocuments } from '@/lib/parse';
import { inferProjectName } from '@/lib/project';
import type { AxeResults, DiffedFinding, Impact, Verdict } from '@/lib/types';

export type RunIo = {
  cwd?: string;
  stdout?: (chunk: string) => void;
  stderr?: (chunk: string) => void;
  now?: () => Date;
};

type ReadOk = { ok: true; documents: { name: string; text: string }[] };
type ReadFail = { ok: false; error: string };

function resolveInput(cwd: string, file: string): string {
  return path.resolve(cwd, file);
}

async function readDocuments(files: readonly string[], cwd: string): Promise<ReadOk | ReadFail> {
  const documents: { name: string; text: string }[] = [];
  for (const file of files) {
    const absolute = resolveInput(cwd, file);
    try {
      const info = await stat(absolute);
      if (!info.isFile()) return { ok: false, error: `${file}: not a file.` };
      if (info.size === 0) return { ok: false, error: `${file}: The file is empty.` };
      if (info.size > MAX_AXE_JSON_BYTES) {
        return { ok: false, error: `${file}: ${axeJsonTooLargeMessage()}` };
      }
      documents.push({ name: file, text: await readFile(absolute, 'utf8') });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return { ok: false, error: `${file}: file not found.` };
      return { ok: false, error: `${file}: could not read the file.` };
    }
  }
  return { ok: true, documents };
}

function writeFailure(file: string, error: unknown): string {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOENT') return `${file}: the directory does not exist.`;
  if (code === 'EISDIR') return `${file}: is a directory, not a file.`;
  return `${file}: could not write the file.`;
}

async function readVersion(): Promise<string> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, '..', 'package.json'),
    path.join(here, '..', '..', 'packages', 'cli', 'package.json'),
  ];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(await readFile(candidate, 'utf8')) as { name?: string; version?: string };
      if (parsed.name === 'a11ygate' && parsed.version) return parsed.version;
    } catch {
      // The bundle is copied into the action directory, so the package manifest may be elsewhere.
    }
  }
  return '0.0.0';
}

function findingJson(finding: DiffedFinding) {
  return {
    fingerprint: finding.fingerprint,
    ruleId: finding.ruleId,
    impact: finding.impact,
    path: finding.path,
    url: finding.url,
    selector: finding.selector,
    html: finding.html,
    help: finding.help,
    helpUrl: finding.helpUrl,
    tags: finding.tags,
  };
}

function reportJson(input: {
  version: string;
  projectName: string;
  verdict: Verdict;
  threshold: Impact;
  reason: string;
  generatedAt: string;
  diff: ReturnType<typeof diffScans>;
}): string {
  return `${JSON.stringify(
    {
      tool: 'a11ygate',
      version: input.version,
      projectName: input.projectName,
      verdict: input.verdict,
      threshold: input.threshold,
      reason: input.reason,
      generatedAt: input.generatedAt,
      counts: {
        new: input.diff.newFindings.length,
        fixed: input.diff.fixedFindings.length,
        stillOpen: input.diff.stillOpen.length,
      },
      findings: {
        new: input.diff.newFindings.map(findingJson),
        fixed: input.diff.fixedFindings.map(findingJson),
        stillOpen: input.diff.stillOpen.map(findingJson),
      },
    },
    null,
    2,
  )}\n`;
}

export async function run(argv: readonly string[], io: RunIo = {}): Promise<number> {
  const stdout = io.stdout ?? ((chunk: string) => process.stdout.write(chunk));
  const stderr = io.stderr ?? ((chunk: string) => process.stderr.write(chunk));
  const cwd = io.cwd ?? process.cwd();
  const now = io.now ?? (() => new Date());

  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    stderr(`${parsed.error}\n`);
    stderr('Run a11ygate --help for usage.\n');
    return 2;
  }

  const options = parsed.options;
  if (options.help) {
    stdout(helpText());
    return 0;
  }
  if (options.version) {
    stdout(`${await readVersion()}\n`);
    return 0;
  }
  if (options.current.length === 0) {
    stderr('Pass at least one current axe JSON file with --current.\n');
    return 2;
  }

  const currentRead = await readDocuments(options.current, cwd);
  if (!currentRead.ok) {
    stderr(`${currentRead.error}\n`);
    return 2;
  }
  const current = parseAxeDocuments(currentRead.documents);
  if (!current.ok) {
    stderr(`${current.error}\n`);
    return 2;
  }

  let baselineResults: AxeResults[] | null = null;
  let baselineSynthetic = false;
  if (options.baseline.length > 0) {
    const baselineRead = await readDocuments(options.baseline, cwd);
    if (!baselineRead.ok) {
      stderr(`${baselineRead.error}\n`);
      return 2;
    }
    const baseline = parseAxeDocuments(baselineRead.documents);
    if (!baseline.ok) {
      stderr(`${baseline.error}\n`);
      return 2;
    }
    baselineResults = baseline.results;
    baselineSynthetic = baseline.synthetic;
  }

  if (current.synthetic || baselineSynthetic) {
    stderr('Note: at least one file is marked as a synthetic fixture, not a real audit.\n');
  }

  const diff = diffScans(
    findingsFromResults(current.results),
    baselineResults ? findingsFromResults(baselineResults) : null,
  );
  const verdict = gateVerdict(diff.newFindings, options.threshold);
  const reason = verdictReason(diff.newFindings, options.threshold);
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
  });
  const json = reportJson({ version, projectName, verdict, threshold: options.threshold, reason, generatedAt, diff });

  if (options.updateBaseline) {
    try {
      await writeFile(resolveInput(cwd, options.updateBaseline), baselineDocument(current.results), 'utf8');
    } catch (error) {
      stderr(`${writeFailure(options.updateBaseline, error)}\n`);
      return 2;
    }
    stderr(`Wrote baseline ${options.updateBaseline}\n`);
  }

  if (options.markdown) {
    try {
      await writeFile(resolveInput(cwd, options.markdown), markdown, 'utf8');
    } catch (error) {
      stderr(`${writeFailure(options.markdown, error)}\n`);
      return 2;
    }
  }

  if (options.json && options.json !== '-') {
    try {
      await writeFile(resolveInput(cwd, options.json), json, 'utf8');
    } catch (error) {
      stderr(`${writeFailure(options.json, error)}\n`);
      return 2;
    }
  }

  stdout(options.json === '-' ? json : markdown);
  return verdict === 'FAIL' ? 1 : 0;
}
