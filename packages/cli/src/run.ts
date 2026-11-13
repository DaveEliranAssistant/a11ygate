import { readFile, realpath, stat, lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './args';
import { helpText } from './help';
import { runScan } from './scan';
import { baselineDocument, baselineReview } from '@/lib/export-baseline';
import { buildEvidenceReport, inferReportFormat, parseSiteScan, renderEvidenceReport, type SiteScanSource } from '@/lib/evidence-report';
import { findingGuidance } from '@/lib/guidance';
import { parseManualEvidence, type ManualCheck } from '@/lib/manual-evidence';
import { prSummaryMarkdown } from '@/lib/export-markdown';
import { compareScans } from '@/lib/compare';
import { gateVerdict, verdictReason } from '@/lib/gate';
import { axeJsonTooLargeMessage, MAX_AXE_JSON_BYTES } from '@/lib/limits';
import { parseAxeDocuments } from '@/lib/parse';
import { inferProjectName } from '@/lib/project';
import type { AxeResults, DiffedFinding, Impact, Verdict } from '@/lib/types';

export type RunIo = {
  cwd?: string;
  stdout?: (chunk: string) => void;
  stderr?: (chunk: string) => void;
  now?: () => Date;
  env?: Record<string, string | undefined>;
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
      if (parsed.name === '@qe-atlas/a11ygate' && parsed.version) return parsed.version;
    } catch {
      // The bundle is copied into the action directory, so the package manifest may be elsewhere.
    }
  }
  return '0.0.0';
}

function findingJson(finding: DiffedFinding) {
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
  diff: ReturnType<typeof compareScans>;
  currentResults: AxeResults[];
  manualChecks: ManualCheck[];
  synthetic: boolean;
}): string {
  return `${JSON.stringify(
    {
      tool: 'a11ygate',
      schemaVersion: 2,
      releaseStatus: 'unreleased-source-build',
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
      manualEvidenceNotice: 'Self-reported human evidence, not identity-verified or automatically assessed; never improves the automated gate. Unrecorded scopes remain unassessed.',
      counts: {
        new: input.diff.newFindings.length,
        fixed: input.diff.fixedFindings.length,
        stillOpen: input.diff.stillOpen.length,
      },
      findings: {
        new: input.diff.newFindings.map(findingJson),
        fixed: input.diff.fixedFindings.map(findingJson),
        stillOpen: input.diff.stillOpen.map(findingJson),
        unassessed: (input.diff.unassessed ?? []).map(findingJson),
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
  const env = io.env ?? process.env;

  if (argv[0] === 'scan') return runScan(argv.slice(1), { ...io, version: await readVersion() });

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
  // `report --scan` reads the scan JSON's raw axe results as current input and --previous-scan as the baseline.
  const currentFiles = options.scan ? [options.scan] : options.current;
  const baselineFiles = options.scan ? (options.previousScan ? [options.previousScan] : []) : options.baseline;
  if (currentFiles.length === 0) {
    stderr(
      options.command === 'report'
        ? 'Pass a scan JSON with --scan, or at least one current axe JSON file with --current.\n'
        : 'Pass at least one current axe JSON file with --current.\n',
    );
    return 2;
  }

  const reportOut = options.out && options.out !== '-' ? options.out : undefined;
  // Resolve symlinks and inode aliases before any output can overwrite input evidence.
  try {
  const identify = async (file: string) => {
    const absolute = resolveInput(cwd, file);
    const canonical = await realpath(absolute).catch(async () => {
      if ((await lstat(absolute).catch(() => null))?.isSymbolicLink()) throw new Error('Dangling symlinks are not safe output/input paths.');
      return path.join(await realpath(path.dirname(absolute)).catch(() => path.dirname(absolute)), path.basename(absolute));
    });
    const info = await stat(absolute).catch(() => null);
    return {canonical, inode: info ? `${info.dev}:${info.ino}` : null};
  };
  const inputs = await Promise.all([...currentFiles, ...baselineFiles, ...(options.manualEvidence ? [options.manualEvidence] : [])].map(identify));
  const baselineProtectedInputs = await Promise.all([...currentFiles, ...(options.manualEvidence ? [options.manualEvidence] : [])].map(identify));
  const outputs = [reportOut, options.markdown, options.json === '-' ? undefined : options.json, options.updateBaseline, options.updateBaseline ? options.updateBaseline + '.review.json' : undefined].filter((x): x is string => !!x);
  const seen: Awaited<ReturnType<typeof identify>>[] = [];
  for (const output of outputs) {
    const id = await identify(output);
    const same = (x: typeof id) => x.canonical === id.canonical || !!(id.inode && x.inode === id.inode);
    const protectedInputs = output === options.updateBaseline ? baselineProtectedInputs : inputs;
    if (protectedInputs.some(same) || seen.some(same)) {
      stderr('Output paths must be distinct and must not overwrite input evidence.\n');
      return 2;
    }
    seen.push(id);
  }
  } catch (error) {
    stderr((error instanceof Error ? error.message : 'Unsafe output path.') + '\n');
    return 2;
  }

  const currentRead = await readDocuments(currentFiles, cwd);
  if (!currentRead.ok) {
    stderr(`${currentRead.error}\n`);
    return 2;
  }
  let siteScan: SiteScanSource | null = null;
  if (options.scan) {
    const parsedScan = parseSiteScan(currentRead.documents[0]?.text ?? '');
    if (!parsedScan.ok) {
      stderr(`${options.scan}: ${parsedScan.error}\n`);
      return 2;
    }
    siteScan = parsedScan.scan;
  }
  const current = parseAxeDocuments(currentRead.documents);
  if (!current.ok) {
    stderr(`${current.error}\n`);
    return 2;
  }

  let baselineResults: AxeResults[] | null = null;
  let baselineSynthetic = false;
  let previousScan: SiteScanSource | null = null;
  if (baselineFiles.length > 0) {
    const baselineRead = await readDocuments(baselineFiles, cwd);
    if (!baselineRead.ok) {
      stderr(`${baselineRead.error}\n`);
      return 2;
    }
    if (options.previousScan) {
      const parsedPrevious = parseSiteScan(baselineRead.documents[0]?.text ?? '');
      if (!parsedPrevious.ok) {
        stderr(`${options.previousScan}: ${parsedPrevious.error}\n`);
        return 2;
      }
      previousScan = parsedPrevious.scan;
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

  let manualChecks: ManualCheck[] = [];
  if (options.manualEvidence) {
    const manualRead = await readDocuments([options.manualEvidence], cwd);
    if (!manualRead.ok) { stderr(manualRead.error + '\n'); return 2; }
    const manual = parseManualEvidence(manualRead.documents[0].text);
    if (!manual.ok) { stderr(manual.error + '\n'); return 2; }
    manualChecks = manual.checks;
  }
  const diff = compareScans(current.results, baselineResults);
  const verdict = gateVerdict(diff.newFindings, options.threshold, diff.coverage);
  const reason = verdict === 'INCOMPLETE'
    ? 'Missing, failed or materially incomparable scan coverage prevents a regression PASS.'
    : verdictReason(diff.newFindings, options.threshold);
  const projectName = inferProjectName(current.results);
  const generatedAt = options.generatedAt ?? now().toISOString();
  const version = await readVersion();

  if (options.command === 'report') {
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
      diff,
    });
    const rendered = renderEvidenceReport(report, options.format ?? inferReportFormat(reportOut));
    if (!reportOut) {
      stdout(rendered);
      return 0;
    }
    try {
      await writeFile(resolveInput(cwd, reportOut), rendered, 'utf8');
    } catch (error) {
      stderr(`${writeFailure(reportOut, error)}\n`);
      return 2;
    }
    stderr(`Wrote evidence report ${reportOut}\n`);
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
    synthetic: current.synthetic || baselineSynthetic,
  });
  const json = reportJson({ version, projectName, verdict, threshold: options.threshold, reason, generatedAt, diff, currentResults: current.results, manualChecks, synthetic: current.synthetic || baselineSynthetic });

  if (options.updateBaseline) {
    if (diff.coverage?.status === 'incomplete') {
      stderr('Refusing baseline update: scan coverage is incomplete. Existing baseline is unchanged.\n');
      return 2;
    }
    try {
      await writeFile(resolveInput(cwd, options.updateBaseline + '.review.json'), JSON.stringify(baselineReview(current.results, diff), null, 2) + '\n', 'utf8');
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
  return verdict === 'FAIL' ? 1 : verdict === 'INCOMPLETE' ? 2 : 0;
}
