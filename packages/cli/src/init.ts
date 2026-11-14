import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { runBaseline } from './baseline';
import { JENKINS_TEMPLATE } from './init-templates';
import type { RunIo } from './run';

export const INIT_HELP = `a11ygate init [--yes] [--target github|jenkins] [options]
  --url <url>          Site you own or are authorized to test. Default: http://127.0.0.1:4173/
  --crawl <n>          0 = start URL only; 1–20 = same-origin crawl. Default: 10.
  --fail-on <impact>   minor, moderate, serious, critical, or none. Default: serious.
  --baseline <input>  Opt in: run baseline create on a saved scan report or output directory.
                      Writes .a11ygate-baseline.json; never starts a scan.
  --yes               No prompts; use flags and defaults (works without a TTY).
  --force             Replace existing regular starter files. Symlinks are refused.
  -h, --help          Show this help.
Without --yes, prompts require a TTY. Existing files are skipped unless --force.
Generated config records setup choices; scan flags in the CI file apply them.
${AUTOMATED_TESTING_DISCLAIMER}
`;

type Options = { target: string; url: string; crawl: number; failOn: string; baseline?: string; yes: boolean; force: boolean };
const impacts = ['serious', 'critical', 'moderate', 'minor', 'none'];
const defaultUrl = 'http://127.0.0.1:4173/';
// Source build with scan support; published 0.1.0 lacks scan. Review this ref when upgrading.
const toolRef = '3fc98754c66dbe9947e3df8588281aa1258fb66e';

export function githubStarter(options: Options): string {
  return `# Scan only a site you own or are authorized to test.
# Start your local application before the scan step (including a readiness check).
# ${AUTOMATED_TESTING_DISCLAIMER}
name: A11yGate

on:
  pull_request:

permissions:
  contents: read
  issues: write
  pull-requests: write
  security-events: write

jobs:
  a11y:
    runs-on: ubuntu-latest
    env:
      A11YGATE_URL: ${JSON.stringify(options.url)}
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      # Source build until scan ships in a published CLI release.
      - uses: actions/checkout@v4
        with:
          repository: DaveEliranAssistant/a11ygate
          ref: ${toolRef}
          path: .a11ygate-tool
          persist-credentials: false
      - name: Install scanner
        working-directory: .a11ygate-tool
        run: |
          npm ci
          npm run cli:build
          npx playwright install --with-deps chromium
      # Add your application's install/build/start commands here for loopback scans.
      - name: Scan authorized site
        run: node .a11ygate-tool/packages/cli/dist/cli.mjs scan "$A11YGATE_URL"${options.crawl ? ` --crawl ${options.crawl}` : ''} --fail-on ${options.failOn}${options.baseline ? ' --baseline .a11ygate-baseline.json' : ''} --format junit,sarif,json,md --out-dir a11y-results
      - name: Archive reports
        if: \${{ !cancelled() }}
        uses: actions/upload-artifact@v4
        with:
          name: a11ygate-results
          path: a11y-results/
      # Fork PR tokens cannot upload SARIF. Code scanning availability depends on the repository.
      - name: Upload SARIF
        if: \${{ !cancelled() && github.event.pull_request.head.repo.full_name == github.repository }}
        uses: github/codeql-action/upload-sarif@v4
        with:
          sarif_file: a11y-results/a11ygate-scan.sarif
          category: a11ygate
`;
}

export function jenkinsStarter(options: Options): string {
  // URL is validated below, including quotes that the shared library wraps in shell quotes.
  const choices = [options.failOn, ...impacts.filter((impact) => impact !== options.failOn)];
  return JENKINS_TEMPLATE
    .replace(defaultUrl, options.url)
    .replace("['serious', 'critical', 'moderate', 'minor', 'none']", `[${choices.map((impact) => `'${impact}'`).join(', ')}]`)
    .replace('crawl: 10,', `crawl: ${options.crawl || 'false'},${options.baseline ? "\n          baseline: '.a11ygate-baseline.json'," : ''}`);
}

function validate(options: Options) {
  if (!['github', 'jenkins'].includes(options.target)) throw new Error('--target must be github or jenkins.');
  const url = new URL(options.url);
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || /[\s\x00-\x1f\x7f'"\\`$]/.test(options.url)) {
    throw new Error('--url must be an HTTP(S) URL without credentials, whitespace, quotes, or shell interpolation; percent-encode special URL characters.');
  }
  if (!Number.isInteger(options.crawl) || options.crawl < 0 || options.crawl > 20) throw new Error('--crawl must be a whole number from 0 to 20.');
  if (!impacts.includes(options.failOn)) throw new Error('--fail-on must be minor, moderate, serious, critical, or none.');
}

/** Never traverse a symlink outside the project, even with --force. */
async function writeStarter(cwd: string, file: string, content: string, force: boolean, stdout: (text: string) => void) {
  const root = await realpath(cwd);
  const parts = file.split('/');
  let parent = root;
  for (const part of parts.slice(0, -1)) {
    parent = path.join(parent, part);
    await mkdir(parent).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
    const info = await lstat(parent);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`${file}: parent must be a real directory.`);
  }
  const destination = path.join(parent, parts.at(-1)!);
  const info = await lstat(destination).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; return null; });
  if (info && !force) { stdout(`Skipped existing ${file} (use --force to replace).\n`); return false; }
  if (info && (!info.isFile() || info.isSymbolicLink())) throw new Error(`${file}: refusing to replace a symlink or non-regular file.`);
  try {
    await writeFile(destination, content, { encoding: 'utf8', flag: force ? 'w' : 'wx' });
  } catch (error) {
    if (!force && (error as NodeJS.ErrnoException).code === 'EEXIST') { stdout(`Skipped existing ${file}.\n`); return false; }
    throw error;
  }
  stdout(`Wrote ${file}\n`);
  return true;
}

export async function runInit(argv: readonly string[], io: RunIo = {}): Promise<number> {
  const stdout = io.stdout ?? ((s: string) => process.stdout.write(s));
  const stderr = io.stderr ?? ((s: string) => process.stderr.write(s));
  if (argv.includes('--help') || argv.includes('-h')) { stdout(INIT_HELP); return 0; }
  const options: Options = { target: 'github', url: defaultUrl, crawl: 10, failOn: 'serious', yes: false, force: false };
  const supplied = new Set<string>();
  try {
    for (let i = 0; i < argv.length; i++) {
      const flag = argv[i];
      if (flag === '--yes') options.yes = true;
      else if (flag === '--force') options.force = true;
      else if (['--target', '--url', '--crawl', '--fail-on', '--baseline'].includes(flag)) {
        const value = argv[++i];
        if (!value || value.startsWith('-')) throw new Error(`${flag} needs a value.`);
        supplied.add(flag);
        if (flag === '--target') options.target = value;
        if (flag === '--url') options.url = value;
        if (flag === '--crawl') { if (!/^\d+$/.test(value)) throw new Error('--crawl needs a whole number.'); options.crawl = Number(value); }
        if (flag === '--fail-on') options.failOn = value;
        if (flag === '--baseline') options.baseline = value;
      } else throw new Error(`Unknown init argument ${flag}. Run a11ygate init --help.`);
    }
    if (!options.yes) {
      if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Interactive init requires a TTY. Use --yes with flags for scripted setup.');
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      try {
        if (!supplied.has('--target')) options.target = (await prompt.question('CI target (github/jenkins) [github]: ')).trim() || options.target;
        if (!supplied.has('--url')) options.url = (await prompt.question(`URL you are authorized to test [${defaultUrl}]: `)).trim() || options.url;
        if (!supplied.has('--crawl')) {
          const answer = (await prompt.question('Crawl pages (0 = start URL only, maximum 20) [10]: ')).trim();
          if (answer && !/^\d+$/.test(answer)) throw new Error('--crawl needs a whole number.');
          options.crawl = answer ? Number(answer) : options.crawl;
        }
        if (!supplied.has('--fail-on')) options.failOn = (await prompt.question('Fail on (minor/moderate/serious/critical/none) [serious]: ')).trim() || options.failOn;
        if (!supplied.has('--baseline')) {
          const answer = (await prompt.question('Create fingerprint baseline from an existing scan report? (y/N): ')).trim();
          if (/^y(es)?$/i.test(answer)) options.baseline = (await prompt.question('Scan JSON or output directory [a11ygate-scan.json]: ')).trim() || 'a11ygate-scan.json';
        }
      } finally { prompt.close(); }
    }
    validate(options);
    const cwd = io.cwd ?? process.cwd();
    // Baselines deliberately retain baseline create's exclusive-create rule, even with --force.
    if (options.baseline) {
      const existing = await lstat(path.join(cwd, '.a11ygate-baseline.json')).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; return null; });
      if (existing) stdout('Skipped existing .a11ygate-baseline.json (baseline creation never replaces evidence).\n');
      else if (await runBaseline(['create', options.baseline, '--output', '.a11ygate-baseline.json'], io) !== 0) return 2;
    }
    const config = `# ${AUTOMATED_TESTING_DISCLAIMER}\n# Setup choices; scan uses the explicit flags in the generated CI file.\nengines: [axe]\nmodelFixes: false\nurl: ${JSON.stringify(options.url)}\ncrawl: ${options.crawl}\nfailOn: ${options.failOn}\n${options.baseline ? 'baseline: .a11ygate-baseline.json\n' : ''}`;
    await writeStarter(cwd, '.a11ygate.yml', config, options.force, stdout);
    await writeStarter(cwd, options.target === 'github' ? '.github/workflows/a11ygate.yml' : 'Jenkinsfile', options.target === 'github' ? githubStarter(options) : jenkinsStarter(options), options.force, stdout);
    stdout('Review the starter before committing. Start your local app before scanning; only scan authorized sites.\n');
    if (options.target === 'jenkins') stdout("Configure the 'a11ygate' shared library and provision Node 20+, the source CLI at packages/cli/dist/cli.mjs, and Playwright Chromium on the agent. See docs/integrations/jenkins.md.\n");
    stdout(`${AUTOMATED_TESTING_DISCLAIMER}\n`);
    return 0;
  } catch (error) {
    stderr(`Could not initialize A11yGate: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}
