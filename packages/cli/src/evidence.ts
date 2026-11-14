import { execFile } from 'node:child_process';
import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildEvidencePack, COMMIT_UNAVAILABLE_NOTE, secretEnvValues, type CommitInfo, type EnvLike, type PackInputFile } from '@/lib/evidence/pack';

export type EvidenceIo = {
  cwd?: string;
  stdout?: (chunk: string) => void;
  stderr?: (chunk: string) => void;
  now?: () => Date;
  version?: string;
  /** Resolves HEAD for the manifest; tests inject this to avoid spawning git. */
  gitHead?: (cwd: string) => Promise<string | null>;
  env?: EnvLike;
};

export type EvidenceOptions = { help: boolean; from?: string; out?: string; commit?: string };

const ENGINE_FILE = /^(axe|htmlcs|ibm|lighthouse)\.json$/;
const SCREENSHOT_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(png|jpe?g|webp)$/i;
/** Report files copied verbatim when present; everything else in --from is ignored (allowlist). */
const REPORT_FILES = ['a11ygate-scan.md', 'a11ygate-scan.html', 'a11ygate-scan.sarif', 'a11ygate-scan.junit.xml'];

export function evidenceHelpText(): string {
  return `a11ygate evidence pack — bundle one scan's outputs into a single zip

Usage:
  a11ygate evidence pack --from <scan-out-dir> [--out <file.zip>] [--commit <sha>]

Options:
  --from <dir>     The --out-dir of an a11ygate scan (must contain a11ygate-scan.json).
  --out <file>     Zip to write. Default: <dir>/a11ygate-evidence.zip.
  --commit <sha>   Commit SHA to record. Default: git HEAD of the current directory;
                   if neither is available the manifest records it as unavailable.

The pack contains report.md and report.html (scope, what automated testing cannot cover,
disclaimer), scan/ (JSON, Markdown, HTML, SARIF, JUnit), engines/<id>.json and screenshots/
when present, and manifest.json (versions, commit, UTC timestamps, SHA-256 of every file).
Only these known files are read; .env files, credentials and environment values are never
included. Packing is refused if a file appears to contain a credential.

Automated testing only. Not a WCAG audit, certification or legal advice.
`;
}

export function parseEvidenceArgs(argv: readonly string[]): { ok: true; options: EvidenceOptions } | { ok: false; error: string } {
  if (argv.includes('--help') || argv.includes('-h')) return { ok: true, options: { help: true } };
  if (argv[0] !== 'pack') return { ok: false, error: argv[0] ? `Unknown evidence command "${argv[0]}". Use: a11ygate evidence pack.` : 'Missing evidence command. Use: a11ygate evidence pack.' };
  const options: EvidenceOptions = { help: false };
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index] ?? '';
    const eq = token.indexOf('=');
    const name = eq === -1 ? token : token.slice(0, eq);
    if (name !== '--from' && name !== '--out' && name !== '--commit') {
      return { ok: false, error: token.startsWith('-') ? `Unknown evidence option ${token}.` : `Unexpected argument ${token}.` };
    }
    const value = eq === -1 ? argv[(index += 1)] : token.slice(eq + 1);
    if (!value || value.startsWith('-')) return { ok: false, error: `${name} needs a value.` };
    if (name === '--from') options.from = value;
    else if (name === '--out') options.out = value;
    else options.commit = value;
  }
  if (!options.from) return { ok: false, error: 'Pass the scan output directory with --from <dir>.' };
  if (options.out && !options.out.toLowerCase().endsWith('.zip')) return { ok: false, error: '--out must end in .zip.' };
  if (options.commit && !/^[0-9a-f]{7,64}$/i.test(options.commit)) return { ok: false, error: '--commit must be a hexadecimal commit SHA (7 to 64 characters).' };
  return { ok: true, options };
}

export function defaultGitHead(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', ['rev-parse', '--verify', 'HEAD'], { cwd, timeout: 5000, windowsHide: true }, (error, stdout) => {
      const sha = String(stdout ?? '').trim();
      resolve(!error && /^[0-9a-f]{40,64}$/i.test(sha) ? sha.toLowerCase() : null);
    });
  });
}

async function regularFile(file: string): Promise<boolean> {
  const info = await lstat(file).catch(() => null);
  return !!info && info.isFile();
}

function looksLikeImage(data: Uint8Array): boolean {
  const b = Buffer.from(data.subarray(0, 12));
  return b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    || (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    || (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP');
}

/** Reads only allowlisted scan outputs. Never walks arbitrary files. */
async function collectInputs(dir: string, warn: (message: string) => void): Promise<PackInputFile[]> {
  const files: PackInputFile[] = [];
  for (const name of REPORT_FILES) {
    const file = path.join(dir, name);
    if (await regularFile(file)) files.push({ path: `scan/${name}`, data: await readFile(file), source: 'copied' });
  }
  for (const [sub, pattern, check] of [
    ['engines', ENGINE_FILE, (data: Uint8Array) => { try { JSON.parse(Buffer.from(data).toString('utf8')); return true; } catch { return false; } }],
    ['screenshots', SCREENSHOT_FILE, looksLikeImage],
  ] as const) {
    const names = await readdir(path.join(dir, sub)).catch(() => [] as string[]);
    for (const name of names.sort()) {
      if (!pattern.test(name)) continue;
      const file = path.join(dir, sub, name);
      if (!(await regularFile(file))) { warn(`Skipped ${sub}/${name}: not a regular file.`); continue; }
      const data = await readFile(file);
      if (!check(data)) { warn(`Skipped ${sub}/${name}: unexpected content.`); continue; }
      files.push({ path: `${sub}/${name}`, data, source: 'copied' });
    }
  }
  return files;
}

export async function runEvidence(argv: readonly string[], io: EvidenceIo = {}): Promise<number> {
  const stdout = io.stdout ?? ((chunk: string) => process.stdout.write(chunk));
  const stderr = io.stderr ?? ((chunk: string) => process.stderr.write(chunk));
  const cwd = io.cwd ?? process.cwd();
  const now = io.now ?? (() => new Date());

  const parsed = parseEvidenceArgs(argv);
  if (!parsed.ok) {
    stderr(`${parsed.error}\nRun a11ygate evidence --help for usage.\n`);
    return 2;
  }
  const options = parsed.options;
  if (options.help) {
    stdout(evidenceHelpText());
    return 0;
  }

  const dir = path.resolve(cwd, options.from as string);
  const scanJsonPath = path.join(dir, 'a11ygate-scan.json');
  if (!(await regularFile(scanJsonPath))) {
    stderr(`${options.from}: no a11ygate-scan.json found. Run a11ygate scan <url> --out-dir ${options.from} first.\n`);
    return 2;
  }
  const scanJson = await readFile(scanJsonPath, 'utf8');
  const files = await collectInputs(dir, (message) => stderr(`${message}\n`));

  let commit: CommitInfo;
  if (options.commit) commit = { sha: options.commit.toLowerCase(), source: 'flag' };
  else {
    const head = await (io.gitHead ?? defaultGitHead)(cwd);
    commit = head ? { sha: head, source: 'git' } : { sha: null, source: 'unavailable', note: COMMIT_UNAVAILABLE_NOTE };
  }

  const result = buildEvidencePack({
    scanJson,
    files,
    toolVersion: io.version ?? '0.0.0',
    commit,
    packedAt: now(),
    envValues: secretEnvValues(io.env ?? process.env),
  });
  if (!result.ok) {
    stderr(`${result.error}\n`);
    return 2;
  }

  const out = path.resolve(cwd, options.out ?? path.join(options.from as string, 'a11ygate-evidence.zip'));
  try {
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, result.zip);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    stderr(`Could not write the evidence pack${code ? ` (${code})` : ''}.\n`);
    return 2;
  }
  if (!commit.sha) stderr('Note: commit SHA unavailable; recorded as unavailable in manifest.json.\n');
  stdout(`Wrote ${path.relative(cwd, out) || out} (${result.manifest.files.length + 1} files, manifest SHA-256 for each).\n`);
  return 0;
}
