import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import pricing from '@/config/pricing.json';
import demo from '@/fixtures/demo-shop-current.json';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { parseScanReport } from '@/lib/scan/baseline';
import { esc, topFixes } from '@/lib/scan/report-html-v2';
import type { ScanReport } from '@/lib/scan/report';
import { normalizeUrl } from '@/lib/scan/url';
import schema from '@/schema/outreach-prospect.schema.json';
import type { CiTarget } from './ci-targets';
import { parseConfigYaml, validateConfig } from './config-schema';
import { defaultGitHead } from './evidence';
import { renderCiStarter } from './init';
import { MAX_INPUT_JSON_BYTES, readJsonInput } from './input-file';
import { assertSafeOutputs, assertUntrackedOutputs, privateOutputDir } from './output-paths';
import { outreachTemplates } from './outreach-templates';
import { isOwnProspectHost } from './prospect';
import { printProspectPdf, writeBinaryAtomic } from './report-pdf';
import type { RunIo } from './run';

const HELP = `Usage: a11ygate outreach kit --prospect <prospect.yml> [--scan-dir <prospect-out>] [--out-dir <dir>] [--allow-in-repo]

Render outreach drafts, a one-pager (HTML and PDF), sample results and a manifest offline.
Default output: ~/a11ygate-prospects/<company-slug>/. Use --allow-in-repo to
write inside a git work tree with an ignore file. Requires Playwright Chromium.
--scan-dir reads the local scan JSON and approval manifest from a prospect run.

${AUTOMATED_TESTING_DISCLAIMER}
`;

const ciNames = {
  github: 'GitHub Actions',
  gitlab: 'GitLab CI',
  'azure-devops': 'Azure DevOps',
  jenkins: 'Jenkins',
  other: 'your CI system',
};

type Prospect = {
  company: string;
  contact_role: string;
  ci_system: CiTarget | 'other';
  stack: string;
  why_now: string;
  why_now_source: string;
  warm_path: string;
  authorized_by?: string;
  authorization_note?: string;
};

const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const hasText = (value: unknown): value is string => typeof value === 'string' && !!value.trim();

function parseProspect(text: string): Prospect {
  const parsed = parseConfigYaml(text);
  if (!parsed.ok) throw new Error(parsed.errors.join(' '));
  const errors = validateConfig(parsed.value, schema);
  if (!parsed.value || errors.length) throw new Error(errors.join(' ') || 'Expected a prospect mapping.');
  const prospect = parsed.value as Prospect;
  if (Boolean(prospect.authorized_by) !== Boolean(prospect.authorization_note)) {
    throw new Error('Provide both authorized_by and authorization_note in the prospect profile.');
  }
  if (!normalizeUrl(prospect.why_now_source)) throw new Error('why_now_source must be an HTTP(S) URL without credentials.');
  return prospect;
}

function markdownText(value: string): string {
  return esc(value.replace(/[\r\n]+/g, ' ')).replace(/[\\`*_[\]~]/g, '\\$&');
}

function renderDrafts(prospect: Prospect, offer: typeof pricing): Record<string, string> {
  const values: Record<string, string> = {
    prospect_company: markdownText(prospect.company),
    prospect_role: markdownText(prospect.contact_role),
    prospect_first_name: '[Add first name]',
    contact_first_name: '[Add intro contact]',
    sender_name: 'Eliran',
    why_now: markdownText(prospect.why_now),
    why_now_source: esc(prospect.why_now_source),
    price_usd_per_year: String(offer.priceUsdPerYear),
    pilot_length_days: String(offer.pilot.lengthDays),
    ci_system: ciNames[prospect.ci_system],
    demo_slots: '[Add demo times]',
    demo_date: '[Add agreed demo time]',
    meeting_link: '[Add meeting link]',
    observed_summary: '[Summarize what was shown on the call]',
    proposed_scope: '[Add agreed pages, flows and environments]',
    pilot_start_date: '[Add pilot start date]',
    decision_date: '[Add decision date]',
    kickoff_checklist_link: '[Add kickoff checklist link]',
    success_criteria_link: '[Add success criteria link]',
    pilot_results_attachment: 'pilot-results.pdf',
    quote_attachment: 'quote.pdf',
    payment_option: 'invoice on request',
  };
  return Object.fromEntries(Object.entries(outreachTemplates).map(([name, template]) => {
    // The original docs links must keep working after the drafts leave the repository.
    const linked = template.replace(/\]\((\.\.\/[^)]+)\)/g, (_, relative: string) =>
      `](https://github.com/DaveEliranAssistant/a11ygate/blob/main/${path.posix.normalize('docs/pilot/outreach/' + relative)})`);
    let draft = linked.replace(/\{\{([a-z_]+)}}/g, (_, key: string) => {
      if (!Object.hasOwn(values, key)) throw new Error(`Unknown outreach placeholder ${key}.`);
      return values[key]!;
    });
    if (name === 'warm-intro-request.md') {
      draft = draft.replace('## Message (EN)', () => `**Private warm-path note:** ${markdownText(prospect.warm_path)}\n\n## Message (EN)`);
    }
    return [name, draft];
  }));
}

function document(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${esc(title)}</title>
<style>
body{font:1rem/1.5 system-ui,sans-serif;color:#18232e;max-width:48rem;margin:2rem auto;padding:0 1.25rem;overflow-wrap:anywhere}
h1,h2{line-height:1.2} h2{margin-top:1.4em}
pre{background:#f1f4f7;padding:1rem;white-space:pre-wrap;tab-size:2}
footer{margin-top:2rem;border-top:1px solid #acb8c3;padding-top:.6rem}
@media print{body{font-size:10.5pt;margin:0;padding:0}pre{font-size:8pt}h2{break-after:avoid}}
</style>
</head>
<body>
<main>
<h1>${esc(title)}</h1>
${body}
</main>
<footer>${AUTOMATED_TESTING_DISCLAIMER}</footer>
</body>
</html>
`;
}

function onePager(prospect: Prospect, offer: typeof pricing): string {
  const ci = prospect.ci_system;
  // Keep GitHub expression braces literal in the copied code and escaped in the HTML source.
  const starter = ci === 'other'
    ? '<p>See the <a href="https://github.com/DaveEliranAssistant/a11ygate/tree/main/docs/integrations">integration guides</a> for CI setup.</p>'
    : `<p>Review the starter and configure it for your authorized environment.</p>
<pre><code>${esc(renderCiStarter(ci)).replaceAll('{', '&#123;')}</code></pre>`;
  const pilot = offer.pilot.priceUsd === 0
    ? `free ${offer.pilot.lengthDays}-day pilot`
    : `${offer.pilot.lengthDays}-day pilot at ${offer.currency} ${offer.pilot.priceUsd}`;
  return document(`A11yGate for ${prospect.company}`, `<p>A11yGate is a CI gate with evidence. It records existing automated accessibility findings as a baseline, flags new findings at your chosen threshold, and keeps reports in CI.</p>
<p>Prepared for ${esc(prospect.contact_role)} · ${esc(prospect.stack)}</p>
<h2>Pilot offer</h2>
<p>Start with a ${esc(pilot)}. At the decision date, review the results against the agreed success criteria. The paid plan costs ${esc(offer.currency)} ${offer.priceUsdPerYear} per year and starts only with your written approval. There is no automatic billing.</p>
<h2>Why now</h2>
<p>${esc(prospect.why_now)} <a href="${esc(prospect.why_now_source)}">${esc(prospect.why_now_source)}</a></p>
<h2>CI starter for ${esc(ciNames[ci])}</h2>
${starter}`);
}

function sampleResults(report?: ScanReport): string {
  const heading = report ? `${report.startUrl} · ${report.scannedAt}` : 'Sample from our demo app, not your site';
  const issues = report
    ? topFixes(report.findings).map(issue => `<li><code>${esc(issue.ruleId)}</code> · ${esc(issue.impact ?? 'Unknown impact')} · ${issue.occurrences} occurrence(s)</li>`)
    : demo.flatMap(result => result.violations).map(issue =>
      `<li><code>${esc(issue.id)}</code> · ${esc(issue.impact)} · ${esc(issue.help)}</li>`);
  return document('Top accessibility issues', `<p>${esc(heading)}</p>
${report ? '' : '<p>These synthetic Demo Shop fixture results illustrate what the gate can report.</p>'}
${issues.length ? `<ul>\n${issues.join('\n')}\n</ul>` : '<p>The scan recorded no findings on the pages it analyzed.</p>'}`);
}

type ScanEvidence = {
  report: ScanReport;
  authorizedBy: string | null;
  authorizationNote: string | null;
  manifestHash: string;
  scanHash: string;
  inputs: string[];
};

async function readEvidence(dir: string): Promise<ScanEvidence> {
  const manifestPath = path.join(dir, 'prospect-manifest.json');
  const scanPath = path.join(dir, 'a11ygate-scan.json');
  const manifest = await readJsonInput(dir, manifestPath, value => {
    const record = value as Record<string, unknown> | null;
    if (record?.schemaVersion !== 1 || !hasText(record.startUrl) || !normalizeUrl(record.startUrl)
      || !hasText(record.scannedAt) || !['url', 'saved-scan'].includes(String(record.source))) {
      throw new Error('Expected a manifest from a11ygate prospect.');
    }
    return record;
  }, 64 * 1024);
  const authorizedBy = hasText(manifest.authorizedBy) ? manifest.authorizedBy : null;
  const authorizationNote = hasText(manifest.authorizationNote) ? manifest.authorizationNote : null;
  const approved = !!authorizedBy && !!authorizationNote;
  const requireApproval = (url: string) => {
    if (!isOwnProspectHost(url) && !approved) {
      throw new Error('The prospect manifest needs both authorizedBy and authorizationNote for a non-own host.');
    }
  };
  requireApproval(String(manifest.startUrl));
  if (manifest.source !== 'url' && !isOwnProspectHost(String(manifest.startUrl))) {
    throw new Error('For a non-own host, use the manifest from the approved prospect URL run.');
  }
  if ((await stat(scanPath)).size > MAX_INPUT_JSON_BYTES) throw new Error('The scan JSON exceeds the input size limit.');
  const scanBytes = await readFile(scanPath);
  const scanHash = sha256(scanBytes);
  if (manifest.scanSha256 !== undefined && manifest.scanSha256 !== scanHash) {
    throw new Error('The scan JSON does not match the digest in the prospect manifest.');
  }
  let report: ScanReport;
  try {
    report = parseScanReport(JSON.parse(scanBytes.toString('utf8').replace(/^\uFEFF/, '')));
  } catch {
    throw new Error('Expected a valid a11ygate-scan.json alongside the prospect manifest.');
  }
  if (report.startUrl !== manifest.startUrl || report.scannedAt !== manifest.scannedAt) {
    throw new Error('The scan URL and timestamp must match the prospect manifest.');
  }
  const origin = new URL(report.startUrl).origin;
  for (const url of [...report.pages.filter(page => page.scanStatus === 'complete').flatMap(page => [page.url, page.finalUrl]), ...report.findings.map(finding => finding.pageUrl)]) {
    if (!normalizeUrl(url) || new URL(url).origin !== origin) {
      throw new Error('The scan includes URLs outside the prospect manifest’s origin.');
    }
  }
  return {
    report,
    authorizedBy: approved ? authorizedBy : null,
    authorizationNote: approved ? authorizationNote : null,
    manifestHash: sha256(JSON.stringify(manifest)),
    scanHash,
    inputs: [manifestPath, scanPath],
  };
}

export async function runOutreach(argv: readonly string[], io: RunIo = {}, offer = pricing): Promise<number> {
  const stdout = io.stdout ?? ((s: string) => process.stdout.write(s));
  const stderr = io.stderr ?? ((s: string) => process.stderr.write(s));
  const cwd = io.cwd ?? process.cwd();
  if (argv.includes('--help') || argv.includes('-h')) { stdout(HELP); return 0; }
  if (argv[0] !== 'kit') { stderr(HELP); return 2; }
  try {
    const { values } = parseArgs({
      args: argv.slice(1),
      options: {
        prospect: { type: 'string' },
        'scan-dir': { type: 'string' },
        'out-dir': { type: 'string' },
        'allow-in-repo': { type: 'boolean' },
      },
    });
    if (!hasText(values.prospect)) throw new Error('--prospect needs a file.');
    for (const flag of ['scan-dir', 'out-dir'] as const) {
      if (values[flag] !== undefined && !hasText(values[flag])) throw new Error(`--${flag} needs a directory.`);
    }
    const profilePath = path.resolve(cwd, values.prospect);
    if ((await stat(profilePath)).size > 64 * 1024) throw new Error('The prospect profile exceeds the input size limit.');
    const profile = await readFile(profilePath);
    const prospect = parseProspect(profile.toString('utf8'));
    const slug = prospect.company.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').slice(0, 80).replace(/^-+|-+$/g, '') || `prospect-${sha256(prospect.company).slice(0, 12)}`;
    const requested = path.resolve(cwd, values['out-dir'] ?? path.join(os.homedir(), 'a11ygate-prospects', slug));
    const { canonical: output, inRepo, workTree } = await privateOutputDir(requested, values['allow-in-repo']);
    const evidence = values['scan-dir'] ? await readEvidence(path.resolve(cwd, values['scan-dir'])) : undefined;
    const files: Record<string, string | Buffer> = {
      ...renderDrafts(prospect, offer),
      'one-pager.html': onePager(prospect, offer),
      'sample-results.html': sampleResults(evidence?.report),
    };
    const ignorePath = path.join(output, '.gitignore');
    const writeIgnore = inRepo || values['allow-in-repo'];
    const outputs = [...Object.keys(files), 'manifest.json', 'one-pager.pdf', ...(writeIgnore ? ['.gitignore'] : [])];
    const outputPaths = outputs.map(name => path.join(output, name));
    if (workTree) await assertUntrackedOutputs(workTree, outputPaths);
    await assertSafeOutputs(cwd, [profilePath, ...(evidence?.inputs ?? [])], outputPaths);
    for (const name of outputs) {
      const info = await lstat(path.join(output, name)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
      if (info && !info.isFile()) throw new Error(`Output ${name} must be a regular file.`);
    }
    const previousIgnore = writeIgnore
      ? await readFile(ignorePath, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return '';
      })
      : '';
    const commit = await defaultGitHead(cwd);
    const inputs = {
      prospectSha256: sha256(profile),
      ...(evidence ? { prospectManifestSha256: evidence.manifestHash, scanSha256: evidence.scanHash } : { demoSha256: sha256(JSON.stringify(demo)) }),
    };
    files['one-pager.pdf'] = await printProspectPdf(String(files['one-pager.html']), evidence?.report.scannedAt ?? '1970-01-01');
    files['manifest.json'] = JSON.stringify({
      schemaVersion: 1,
      inputsHash: sha256(JSON.stringify({ inputs, config: offer })),
      inputs,
      config: offer,
      commit,
      realSiteData: !!evidence,
      authorizedBy: evidence?.authorizedBy ?? null,
      authorizationNote: evidence?.authorizationNote ?? null,
      files: outputs.filter(name => name !== '.gitignore'),
      disclaimer: AUTOMATED_TESTING_DISCLAIMER,
    }, null, 2) + '\n';

    await mkdir(output, { recursive: true, mode: 0o700 });
    if (writeIgnore && !previousIgnore.trimEnd().endsWith('\n*') && previousIgnore.trimEnd() !== '*') {
      await writeBinaryAtomic(ignorePath, Buffer.from(`${previousIgnore ? previousIgnore.trimEnd() + '\n' : ''}*\n`));
    }
    for (const [name, bytes] of Object.entries(files)) await writeBinaryAtomic(path.join(output, name), Buffer.from(bytes));
    stdout(`Wrote outreach kit to ${output}\n${AUTOMATED_TESTING_DISCLAIMER}\n`);
    return 0;
  } catch (error) {
    stderr(`Outreach kit failed: ${error instanceof Error ? error.message : String(error)}\n${AUTOMATED_TESTING_DISCLAIMER}\n`);
    return 2;
  }
}
