import { debugDetail } from './fatal';
import { parseProjects, PROJECTS_SCHEMA_PATH } from './projects-schema';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { CONFIG_FILE, SCHEMA_PATH, SCHEMA_COMMENT, configProblems } from './config-schema';
import { loadEffectiveConfig, printableConfig } from './effective-config';
import { parseScanArgs } from './scan';
import { parseArgs } from './args';
export * from './config-schema';

export const CONFIG_HELP = `a11ygate config print [scan|ci|doctor] [flags]
  Show effective settings and sources; credential values are redacted.
a11ygate config validate [file]
a11ygate config validate --projects <file>
  Check .a11ygate.yml (or <file>) against ${SCHEMA_PATH}.
  With --projects, check against ${PROJECTS_SCHEMA_PATH}.
  Exit 0 when valid, 2 with plain-English errors otherwise. Never runs a scan.
  Editor autocomplete: add this first line to the file:
  ${SCHEMA_COMMENT}
${AUTOMATED_TESTING_DISCLAIMER}
`;

export async function runConfig(argv: readonly string[], io: { cwd?: string; stdout?: (text: string) => void; stderr?: (text: string) => void; env?: NodeJS.ProcessEnv } = {}): Promise<number> {
  const stdout = io.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = io.stderr ?? ((text: string) => process.stderr.write(text));
  if (argv.includes('--help') || argv.includes('-h')) { stdout(CONFIG_HELP); return 0; }
  if (argv[0] === 'print') {
    const command = ['scan', 'ci', 'doctor'].includes(argv[1] ?? '') ? argv[1] as 'scan' | 'ci' | 'doctor' : 'scan';
    const flags = argv.slice(command === argv[1] ? 2 : 1);
    try {
      const config = loadEffectiveConfig(command, flags, io);
      const invalid = () => new Error('Invalid options for config print; use scan/ci/doctor --help for supported arguments.');
      if (command === 'scan') {
        const parsed = parseScanArgs(config.values.url ? config.argv : ['https://config-print.invalid/', ...config.argv]);
        if (!parsed.ok) throw invalid();
        if (config.values.url) config.values.url = parsed.options.url;
        config.values.maxPages = parsed.options.maxPages;
        if (parsed.options.sitemap) config.values.sitemap = parsed.options.sitemap;
        config.values.formats = parsed.options.formats;
      } else if (command === 'ci') {
        const parsed = parseArgs(config.argv);
        if (!parsed.ok) throw invalid();
        config.values.baseline = parsed.options.baseline;
        config.values.formats = parsed.options.formats;
      } else if (!config.argv.every((arg, i) => ['--strict', '--engines', '--model-fixes'].includes(arg) || ['--engines', '--model-fixes'].includes(config.argv[i - 1] ?? ''))) throw invalid();
      stdout(JSON.stringify({ command, config: printableConfig(config, io.env), disclaimer: AUTOMATED_TESTING_DISCLAIMER }, null, 2) + '\n');
      return 0;
    } catch (error) { stderr(`${(error as Error).message}\n${debugDetail(error)}`); return 2; }
  }
  const projectsMode = argv[0] === 'validate' && argv[1] === '--projects' && argv.length === 3;
  if (!projectsMode && (argv[0] !== 'validate' || argv.length > 2 || argv[1]?.startsWith('-'))) {
    stderr('Usage: a11ygate config validate [file]. Run a11ygate config --help.\n');
    return 2;
  }
  const file = (projectsMode ? argv[2] : argv[1]) ?? CONFIG_FILE;
  const schemaPath = projectsMode ? PROJECTS_SCHEMA_PATH : SCHEMA_PATH;
  let text: string;
  try { text = await readFile(path.resolve(io.cwd ?? process.cwd(), file), 'utf8'); }
  catch (error) {
    stderr(`${file}: ${(error as NodeJS.ErrnoException).code === 'ENOENT' ? 'file not found' : 'could not read the file'}.\n`);
    return 2;
  }
  const problems = projectsMode ? parseProjects(text).errors : configProblems(text);
  if (problems.length) {
    stderr(`${file} has ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n${problems.map((p) => `  - ${p}`).join('\n')}\nSchema: ${schemaPath}\n`);
    return 2;
  }
  stdout(`${file} is valid against ${schemaPath}.\n${projectsMode ? AUTOMATED_TESTING_DISCLAIMER + '\n' : ''}`);
  return 0;
}
