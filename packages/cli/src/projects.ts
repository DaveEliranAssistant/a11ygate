import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { escapeXml } from '@/lib/export-junit';
import type { ScanReport } from '@/lib/scan/report';
import { AuthRedactor } from '@/lib/scan/redact';
import { secretEnvValues } from '@/lib/evidence/secrets';
import { loadEffectiveConfig } from './effective-config';
import { assertSafeOutputs } from './output-paths';
import { parseProjects, PROJECTS_SCHEMA_PATH } from './projects-schema';
import { parseScanArgs, runScan, type ScanIo } from './scan';

const SUMMARY_FILES = ['a11ygate-projects.json', 'a11ygate-projects.md', 'a11ygate-projects.html', 'a11ygate-projects.junit.xml'];
const SCAN_FILES = ['a11ygate-scan.json', 'a11ygate-scan.md', 'a11ygate-scan.html', 'a11ygate-scan.junit.xml', 'a11ygate-scan.sarif', 'a11ygate-scan.gitlab-codequality.json', 'codequality-decided.json', ...['axe', 'htmlcs', 'ibm', 'lighthouse'].map(id => `engines/${id}.json`), 'project-result.json'];
type ProjectResult = {
  name: string; status: 'passed' | 'failed' | 'errored'; exitCode: number; outputDir: string;
  counts: { pagesScanned: number; pagesFailed: number; findings: number; new: number; existing: number };
  reason: string;
};

/** Multi-project mode deliberately has its own flags and never changes single-project dispatch. */
export async function runProjects(argv: readonly string[], io: ScanIo = {}): Promise<number> {
  const stdout = io.stdout ?? ((s: string) => process.stdout.write(s));
  const stderr = io.stderr ?? ((s: string) => process.stderr.write(s));
  const cwd = io.cwd ?? process.cwd();
  const redactor = new AuthRedactor();
  for (const value of secretEnvValues(io.env ?? process.env, 1)) redactor.add(value);
  try {
    const flags = new Map<string, string>();
    for (let i = 0; i < argv.length; i++) {
      const token = argv[i]!;
      const equal = token.indexOf('=');
      const key = equal < 0 ? token : token.slice(0, equal);
      if (!['--projects', '--parallel', '--out-dir'].includes(key) || flags.has(key)) throw new Error(`Unknown or repeated multi-project option ${key}.`);
      const value = equal < 0 ? argv[++i] : token.slice(equal + 1);
      if (!value || value.startsWith('-')) throw new Error(`${key} needs a value.`);
      flags.set(key, value);
    }
    const parallel = flags.get('--parallel') ?? '1';
    if (!/^[1-8]$/.test(parallel)) throw new Error('--parallel must be a whole number from 1 to 8.');
    if (!flags.get('--projects')) throw new Error('--projects needs a file.');
    const file = path.resolve(cwd, flags.get('--projects')!);
    const parsed = parseProjects(await readFile(file, 'utf8'));
    if (parsed.errors.length) throw new Error(`${PROJECTS_SCHEMA_PATH}:\n${parsed.errors.join('\n')}`);
    const outDir = path.resolve(cwd, flags.get('--out-dir') ?? 'a11ygate-projects');
    const projects = parsed.projects.map(project => ({ ...project, config: path.resolve(path.dirname(file), project.config) }));
    // Protect every project's inputs from every project's outputs, including aliases.
    const inputs = [file, ...projects.map(p => p.config)];
    for (const project of projects) {
      try {
        const repoConfig = await readFile(project.config, 'utf8');
        const effective = loadEffectiveConfig('scan', [], { ...io, cwd: path.dirname(project.config), repoConfig });
        for (const key of ['baseline', 'auth.storageState', 'auth.sessionStorage', 'auth.loginScript']) {
          if (typeof effective.values[key] === 'string' && effective.values[key]) inputs.push(path.resolve(path.dirname(project.config), effective.values[key] as string));
        }
      } catch { /* Invalid/missing project config is isolated and reported below. */ }
    }
    const outputs = [...SUMMARY_FILES.map(f => path.join(outDir, f)), ...projects.flatMap(p => SCAN_FILES.map(f => path.join(outDir, p.name, f)))];
    await assertSafeOutputs(cwd, inputs, outputs);
    const results: ProjectResult[] = new Array(projects.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(Number(parallel), projects.length) }, async () => {
      while (next < projects.length) {
        const index = next++;
        const project = projects[index]!;
        const dir = path.join(outDir, project.name);
        let report: ScanReport | undefined;
        let exitCode = 2;
        try {
          const repoConfig = await readFile(project.config, 'utf8');
          const projectIo = { ...io, cwd: path.dirname(project.config), repoConfig };
          const effective = loadEffectiveConfig('scan', ['--out-dir', dir, '--format', 'junit'], projectIo);
          const options = parseScanArgs(effective.argv);
          if (!options.ok) throw new Error(options.error);
          exitCode = await runScan(['--out-dir', dir, '--format', 'junit'], {
            ...projectIo, stdout: () => {},
            stderr: s => stderr(`[${project.name}] ${redactor.text(s)}`),
            onReport: value => { report = value; },
          });
        } catch {
          // Do not echo thrown config/browser/auth errors: they may contain credentials.
          stderr(`[${project.name}] Project could not start; check its configuration and local dependencies.\n`);
        }
        const counts = report?.counts;
        const result: ProjectResult = {
          name: project.name, status: exitCode === 2 ? 'errored' : exitCode === 1 ? 'failed' : 'passed', exitCode,
          outputDir: project.name,
          counts: { pagesScanned: counts?.pagesScanned ?? 0, pagesFailed: counts?.pagesFailed ?? 0, findings: counts?.findings ?? 0,
            new: report?.findings.filter(f => f.baselineStatus !== 'existing').length ?? 0,
            existing: report?.findings.filter(f => f.baselineStatus === 'existing').length ?? 0 },
          reason: exitCode === 2 ? 'Project errored; inspect this run’s project diagnostics. Saved reports may be absent when startup failed.' : report?.reason ?? 'Project completed.',
        };
        results[index] = result;
        try {
          await mkdir(dir, { recursive: true });
          await writeFile(path.join(dir, 'project-result.json'), JSON.stringify({ ...result, disclaimer: AUTOMATED_TESTING_DISCLAIMER }, null, 2) + '\n');
        } catch {
          result.status = 'errored';
          result.exitCode = 2;
          result.reason = 'Could not write project result.';
          stderr(`[${project.name}] Could not write project result.\n`);
        }
      }
    }));
    const exitCode = Math.max(...results.map(p => p.exitCode));
    const counts = { projects: results.length, passed: 0, failed: 0, errored: 0, pagesScanned: 0, pagesFailed: 0, findings: 0, new: 0, existing: 0 };
    for (const project of results) {
      counts[project.status]++;
      for (const key of ['pagesScanned', 'pagesFailed', 'findings', 'new', 'existing'] as const) counts[key] += project.counts[key];
    }
    const summary = { tool: 'a11ygate', kind: 'multi-project', schemaVersion: 1, generatedAt: (io.now?.() ?? new Date()).toISOString(), exitCode, counts, projects: results, disclaimer: AUTOMATED_TESTING_DISCLAIMER };
    const markdown = `# A11yGate projects\n\n${AUTOMATED_TESTING_DISCLAIMER}\n\n${counts.passed} passed, ${counts.failed} failed, ${counts.errored} errored. Exit code: ${exitCode}.\n\nPages scanned: ${counts.pagesScanned}; pages failed: ${counts.pagesFailed}; findings: ${counts.findings} (${counts.new} new, ${counts.existing} existing).\n\n| Project | Result | Findings | Reports |\n| --- | --- | --- | --- |\n${results.map(p => `| ${p.name} | ${p.status} | ${p.counts.findings} | [Output](${p.name}/project-result.json) |`).join('\n')}\n`;
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>A11yGate projects</title></head><body><h1>A11yGate projects</h1><p>${escapeXml(AUTOMATED_TESTING_DISCLAIMER)}</p><p>${counts.passed} passed, ${counts.failed} failed, ${counts.errored} errored. Exit code: ${exitCode}.</p><p>Pages scanned: ${counts.pagesScanned}; pages failed: ${counts.pagesFailed}; findings: ${counts.findings} (${counts.new} new, ${counts.existing} existing).</p><table><caption>Project results</caption><thead><tr><th scope="col">Project</th><th scope="col">Result</th><th scope="col">Findings</th><th scope="col">Reports</th></tr></thead><tbody>${results.map(p => `<tr><th scope="row">${escapeXml(p.name)}</th><td>${p.status}</td><td>${p.counts.findings}</td><td><a href="${p.name}/project-result.json">${escapeXml(p.name)} output</a></td></tr>`).join('')}</tbody></table></body></html>\n`;
    // Project-level gate cases preserve threshold/baseline outcomes, including startup errors.
    const junit = `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="A11yGate projects" tests="${counts.projects}" failures="${counts.failed}" errors="${counts.errored}">\n${results.map(p => `  <testsuite name="${escapeXml(p.name)}" tests="1" failures="${p.status === 'failed' ? 1 : 0}" errors="${p.status === 'errored' ? 1 : 0}"><properties><property name="disclaimer" value="${escapeXml(AUTOMATED_TESTING_DISCLAIMER)}"/></properties><testcase name="project-gate" classname="${escapeXml(p.name)}">${p.status === 'passed' ? '' : `<${p.status === 'errored' ? 'error' : 'failure'} message="${escapeXml(p.reason)}"/>`}</testcase></testsuite>`).join('\n')}\n</testsuites>\n`;
    for (const [i, content] of [JSON.stringify(summary, null, 2) + '\n', markdown, html, junit].entries()) await writeFile(path.join(outDir, SUMMARY_FILES[i]!), content);
    stdout(markdown);
    return exitCode;
  } catch (error) {
    stderr(`Multi-project run failed: ${redactor.text(error instanceof Error ? error.message : 'Unknown error')}\n${AUTOMATED_TESTING_DISCLAIMER}\n`);
    return 2;
  }
}
