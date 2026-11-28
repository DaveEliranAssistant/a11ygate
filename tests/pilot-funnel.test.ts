// A11Y-R70: offline "prospect -> pilot -> paid" dry run on fixtures, plus the owner-runbook
// checklist. Runs in plain `npm test` without Chromium: the scan transport is a stubbed
// fixture site on a loopback URL and only the PDF printer is mocked (as in pilot-report.test.ts).
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import pricing from '@/config/pricing.json';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { PILOT_EVIDENCE_FILE } from '@/lib/evidence/pack';
import { readZip } from '@/lib/evidence/zip';
import type { VisitOutcome } from '@/lib/scan/crawl';
import type { FetchLike } from '@/lib/scan/robots';
import type { AxeResults } from '@/lib/types';
import { runEvidence } from '@/packages/cli/src/evidence';
import { printProspectPdf } from '@/packages/cli/src/report-pdf';
import { run } from '@/packages/cli/src/run';
import { runScan } from '@/packages/cli/src/scan';
import { blockNetwork } from './network-guard';

vi.mock('@/packages/cli/src/report-pdf', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/packages/cli/src/report-pdf')>(),
  printProspectPdf: vi.fn(),
}));

const SITE = 'http://127.0.0.1:4173/';
const BANNED = /fixes everything|\bcompliant\b|\bcertified\b|\bguarantees?\b|\bconformant\b|lawsuit-proof/i;
const version = '0.2.0';

type Violation = AxeResults['violations'][number];
const finding = (id: string, impact: Violation['impact'], target: string): Violation =>
  ({ id, impact, tags: [], help: id, helpUrl: '', nodes: [{ target: [target], html: '<div></div>' }] });
const IMAGE = finding('image-alt', 'critical', 'img.hero');
const LABEL = finding('label', 'serious', '#email');
const CONTRAST = finding('color-contrast', 'serious', 'p.faint');
const REGION = finding('region', 'moderate', '#promo');

/** Fixture site: two pages on a loopback URL; no socket is opened. */
function fixtureEngine(home: Violation[], contact: Violation[], scannedAt: string) {
  const pages: Record<string, { links: string[]; violations: Violation[] }> = {
    '/': { links: ['/contact.html'], violations: home },
    '/contact.html': { links: ['/'], violations: contact },
  };
  return async () => ({
    visit: async (url: string): Promise<VisitOutcome> => {
      const page = pages[new URL(url).pathname];
      if (!page) return { status: 404, finalUrl: url, links: [], error: 'HTTP 404' };
      return {
        status: 200, finalUrl: url, links: page.links.map(link => new URL(link, url).href),
        result: { url, timestamp: scannedAt, testEngine: { version: '4.14.0' }, violations: page.violations },
      };
    },
    close: async () => undefined,
  });
}
/**
 * Every file the funnel writes (and every entry inside each evidence pack) must match exactly one
 * rule. `required` artifacts are customer-facing and must carry the disclaimer. `exempt` ones are
 * listed with the reason they are not required to; a file matching no rule fails the test.
 */
type Rule = { pattern: RegExp; required: true } | { pattern: RegExp; required: false; reason: string };
const ARTIFACT_RULES: Rule[] = [
  { pattern: /^owner\/prospect-out\/prospect-summary\.html$/, required: true },
  { pattern: /^owner\/prospect-out\/prospect-manifest\.json$/, required: true },
  { pattern: /^customer-repo\/\.gitlab-ci\.a11ygate\.yml$/, required: true },
  // A11Y-R72: init also writes the root pipeline with the merge_request_event rule.
  { pattern: /^customer-repo\/\.gitlab-ci\.yml$/, required: true },
  { pattern: /^customer-repo\/\.a11ygate\.yml$/, required: true },
  { pattern: /^customer-repo\/a11ygate-pilot\/(KICKOFF\.md|success-criteria\.yml)$/, required: true },
  { pattern: /(^|\/)a11ygate-scan\.html$/, required: true },
  { pattern: /\.zip!\/(report\.md|report\.html|manifest\.json)$/, required: true },
  { pattern: /^customer-repo\/pilot-report\/(pilot-results|quote)\.html$/, required: true },
  { pattern: /(^|\/)a11ygate-scan\.md$/, required: true },
  { pattern: /(^|\/)a11ygate-scan\.json$/, required: false, reason: 'machine-readable scan report' },
  { pattern: /(^|\/)engines\/axe\.json$/, required: false, reason: 'raw axe engine output' },
  { pattern: /(^|\/)a11ygate-pilot-evidence\.json$/, required: false, reason: 'machine-readable pilot evidence input' },
  { pattern: /(^|\/)a11ygate-scan\.(sarif|junit\.xml)$/, required: false, reason: 'machine-readable CI formats (SARIF, JUnit)' },
  { pattern: /^customer-repo\/\.a11ygate-baseline\.json$/, required: false, reason: 'machine-readable fingerprint baseline' },
  { pattern: /\.pdf$/, required: false, reason: 'PDF printer is mocked here; its HTML source is checked above and PDFs in prospect/pilot-report tests' },
];
/** Generated artifacts expected to lack the disclaimer. */
const EXPECTED_WITHOUT_DISCLAIMER = [
  'customer-repo/kickoff/a11ygate-scan.json', 'customer-repo/kickoff/engines/axe.json',
  'customer-repo/latest/a11ygate-pilot-evidence.json', 'customer-repo/latest/engines/axe.json', 'customer-repo/mid/engines/axe.json',
  'customer-repo/packs/kickoff.zip!/engines/axe.json', 'customer-repo/packs/kickoff.zip!/scan/a11ygate-scan.json',
  'customer-repo/packs/latest.zip!/engines/axe.json',
  'customer-repo/packs/latest.zip!/scan/a11ygate-pilot-evidence.json', 'customer-repo/packs/mid.zip!/engines/axe.json',
  'customer-repo/pilot-report/pilot-results.pdf', 'customer-repo/pilot-report/quote.pdf',
  'owner/prospect-out/prospect-summary.pdf', 'owner/prospect-scan/a11ygate-scan.json',
  'owner/prospect-scan/engines/axe.json',
].sort();

async function listArtifacts(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      const rel = path.relative(root, file).split(path.sep).join('/');
      if (entry.isDirectory()) await walk(file);
      else if (file.endsWith('.zip')) for (const e of readZip(await readFile(file))) out.set(`${rel}!/${e.path}`, Buffer.from(e.data).toString('utf8'));
      else out.set(rel, await readFile(file, 'utf8'));
    }
  };
  await walk(root);
  return out;
}

const noRobots: FetchLike = async () => ({ ok: false, status: 404, text: async () => '' });

it('runs prospect -> init --pilot -> scan -> baseline -> gate fail -> 3 evidence packs -> pilot report -> quote offline', async () => {
  const network = blockNetwork();
  const root = await mkdtemp(path.join(process.cwd(), '.pilot-funnel-test-'));
  const stderr = vi.fn();
  const stdout = vi.fn();
  const artifacts = new Map<string, string>();
  const keep = async (name: string, file: string) => artifacts.set(name, await readFile(file, 'utf8'));
  vi.mocked(printProspectPdf).mockResolvedValue(Buffer.from('PDF stub'));
  try {
    const work = path.join(root, 'owner');
    const repo = path.join(root, 'customer-repo');
    await mkdir(work);
    await mkdir(repo);
    const scan = async (cwd: string, outDir: string, day: string, home: Violation[], contact: Violation[], extra: string[] = []) => {
      const scannedAt = `2026-12-${day}T10:00:00.000Z`;
      return runScan([SITE, '--crawl', '2', '--delay-ms', '0', '--out-dir', outDir, ...extra], {
        cwd, stdout, stderr, version, fetch: noRobots, sleep: async () => undefined,
        now: () => new Date(scannedAt), engine: fixtureEngine(home, contact, scannedAt),
      });
    };

    // 1. Prospect summary from a saved scan of the fixture (an own host, so no approval is needed).
    expect(await scan(work, 'prospect-scan', '01', [IMAGE], [LABEL]), JSON.stringify(stderr.mock.calls)).toBe(1);
    expect(await run(['prospect', '--from', 'prospect-scan', '--company', 'Fixture Shop', '--offer'], { cwd: work, stdout, stderr }),
      JSON.stringify(stderr.mock.calls)).toBe(0);
    await keep('prospect-summary.html', path.join(work, 'prospect-out/prospect-summary.html'));
    await keep('prospect-manifest.json', path.join(work, 'prospect-out/prospect-manifest.json'));
    const prospect = artifacts.get('prospect-summary.html')!;
    expect(prospect).toContain(`$${pricing.priceUsdPerYear.toLocaleString('en-US')}/yr`);
    expect(prospect).toContain(`${pricing.pilot.lengthDays}-day free pilot`);
    expect(JSON.parse(artifacts.get('prospect-manifest.json')!)).toMatchObject({ source: 'saved-scan', offer: true, company: 'Fixture Shop' });

    // 2. Pilot starter in the customer's (temporary) repository.
    expect(await run(['init', '--yes', '--target', 'gitlab', '--pilot', '--url', SITE, '--crawl', '2'], { cwd: repo, stdout, stderr }),
      JSON.stringify(stderr.mock.calls)).toBe(0);
    for (const file of ['.gitlab-ci.a11ygate.yml', '.gitlab-ci.yml', '.a11ygate.yml', 'a11ygate-pilot/success-criteria.yml', 'a11ygate-pilot/KICKOFF.md']) {
      await keep(file, path.join(repo, file));
    }
    expect(artifacts.get('a11ygate-pilot/success-criteria.yml')).toContain(`lengthDays: ${pricing.pilot.lengthDays}`);

    // 3. Kickoff scan and fingerprint baseline.
    expect(await scan(repo, 'kickoff', '01', [IMAGE], [LABEL])).toBe(1);
    expect(await run(['baseline', 'create', 'kickoff', '--output', '.a11ygate-baseline.json'], { cwd: repo, stdout, stderr }),
      JSON.stringify(stderr.mock.calls)).toBe(0);

    // 4. A regression in week 1: a new serious finding fails the gate against the baseline.
    expect(await scan(repo, 'mid', '09', [IMAGE, CONTRAST], [LABEL], ['--baseline', '.a11ygate-baseline.json'])).toBe(1);
    const gate = JSON.parse(await readFile(path.join(repo, 'mid/a11ygate-scan.json'), 'utf8'));
    expect(JSON.stringify(gate)).toContain('color-contrast');
    // Week 3: the regression and the image finding are fixed, a moderate one is new: gate passes.
    expect(await scan(repo, 'latest', '20', [REGION], [LABEL], ['--baseline', '.a11ygate-baseline.json'])).toBe(0);
    await writeFile(path.join(repo, 'latest', PILOT_EVIDENCE_FILE), JSON.stringify({
      schemaVersion: 1, baselineCommitted: true,
      gate: { targetBranch: 'main', from: '2026-12-01', through: '2026-12-21', required: true, pullRequests: 3, gateRuns: 3 },
      postWeekTwoMerges: { targetBranch: 'main', from: '2026-12-15', through: '2026-12-21', unreviewedNewSeriousOrCritical: 0 },
      evidenceDeliveredOn: '2026-12-20',
    }));
    for (const name of ['kickoff', 'mid', 'latest']) await keep(`${name}/a11ygate-scan.html`, path.join(repo, name, 'a11ygate-scan.html'));

    // 5. Three evidence packs (git metadata stubbed so the temp repo needs no git history).
    await mkdir(path.join(repo, 'packs'));
    for (const [name, day] of [['kickoff', 1], ['mid', 9], ['latest', 21]] as const) {
      expect(await runEvidence(['pack', '--from', name, '--out', `packs/${name}.zip`], {
        cwd: repo, stdout, stderr, version, env: {}, now: () => new Date(`2026-12-${String(day).padStart(2, '0')}T12:00:00Z`),
        gitHead: async () => String(day).padStart(40, '0'),
        gitCommitMeta: async () => ({ committedAt: `2026-12-${String(day).padStart(2, '0')}T08:00:00Z`, branch: 'main' }),
      }), JSON.stringify(stderr.mock.calls)).toBe(0);
      const entries = readZip(await readFile(path.join(repo, 'packs', `${name}.zip`)));
      for (const entry of ['report.md', 'report.html']) {
        const data = entries.find(e => e.path === entry)?.data;
        expect(data, `${name}.zip!/${entry}`).toBeDefined();
        artifacts.set(`${name}.zip!/${entry}`, Buffer.from(data!).toString('utf8'));
      }
    }

    // 6. Pilot results and the draft renewal quote.
    const pilotArgs = ['pilot', 'report', '--kickoff', 'packs/kickoff.zip', '--latest', 'packs/latest.zip', '--packs', 'packs',
      '--criteria', 'a11ygate-pilot/success-criteria.yml', '--customer', 'Fixture Shop'];
    expect(await run(pilotArgs, { cwd: repo, stdout, stderr, now: () => new Date('2026-12-21T10:00:00Z'), env: { NODE_ENV: 'test' } }),
      JSON.stringify(stderr.mock.calls)).toBe(0);
    await keep('pilot-results.html', path.join(repo, 'pilot-report/pilot-results.html'));
    await keep('quote.html', path.join(repo, 'pilot-report/quote.html'));
    const results = artifacts.get('pilot-results.html')!;
    expect(results).toMatch(/<caption>Trend runs[\s\S]*kickoff.zip[\s\S]*mid.zip[\s\S]*latest.zip/);
    expect(results).toContain('Fingerprint baseline committed</th><td>Met</td>');
    const quote = artifacts.get('quote.html')!;
    expect(quote).toContain(`$${pricing.priceUsdPerYear.toLocaleString('en-US')}/year`);
    expect(quote).toContain(`${pricing.termMonths} months`);
    expect(quote).toContain('Fixture Shop');
    expect(quote).toContain('invoice on request'); // no A11YGATE_CHECKOUT_URL configured
    expect(vi.mocked(printProspectPdf)).toHaveBeenCalledTimes(3); // prospect summary, pilot results, quote

    // Every customer-visible artifact carries the disclaimer and no compliance claim.
    // 18 since A11Y-R72: init also writes the root .gitlab-ci.yml.
    expect([...artifacts.keys()]).toHaveLength(18);
    for (const [name, text] of artifacts) {
      expect(text, name).toContain(AUTOMATED_TESTING_DISCLAIMER);
      expect(text, name).not.toMatch(BANNED);
    }

    // Every generated text artifact is classified; customer-facing ones carry the disclaimer.
    const all = await listArtifacts(root);
    const without: string[] = [];
    for (const [name, text] of all) {
      const rule = ARTIFACT_RULES.find(r => r.pattern.test(name));
      expect(rule, `unclassified artifact: ${name}`).toBeDefined();
      if (rule!.required) expect(text, name).toContain(AUTOMATED_TESTING_DISCLAIMER);
      else expect(rule!.reason.length, name).toBeGreaterThan(0);
      if (!text.includes(AUTOMATED_TESTING_DISCLAIMER)) without.push(name);
      expect(text, name).not.toMatch(BANNED);
    }
    for (const name of artifacts.keys()) expect(all.has(name) || [...all.keys()].some(k => k.endsWith(`/${name}`)), name).toBe(true);
    expect(without.sort()).toEqual(EXPECTED_WITHOUT_DISCLAIMER);
    expect(network.attempts).toEqual([]);
  } finally {
    vi.mocked(printProspectPdf).mockReset();
    await rm(root, { recursive: true, force: true });
    network.restore();
  }
}, 60_000);

/**
 * Every BLOCKED-on-Eliran item recorded in the A11Y-R63..R69 STATUS lines (hand-kept copy;
 * the tasks file is owned by the orchestrator). Each needle must appear in the runbook checklist.
 */
const BLOCKED_ITEMS: Record<string, string[]> = {
  R63: ['Choose the payment provider', 'Create the payment-provider account and the $990/yr product', 'Tax, VAT and invoicing setup',
    'A11YGATE_CHECKOUT_URL', 'A11YGATE_PRICING_ENABLED=1'],
  R64: ['A11YGATE_PILOT_REQUEST_URL', 'read the waitlist database', 'Approve turning `A11YGATE_PRICING_ENABLED` on in production'],
  R65: ['merge_request_event'],
  R66: ['Legal review of `docs/pilot/pilot-terms.template.md`', 'Business and legal entity details', 'Default retention period for scan outputs'],
  R67: ['Approve each real prospect', '--authorized-by', '--authorization-note', 'Send every prospect report yourself'],
  R69: ['Quote legal and tax wording', 'Invoice issuer details', 'Send any quote to a customer yourself'],
  npm: ['npm login', 'publish 0.2.0'],
};

it('lists every BLOCKED-on-Eliran item from R63-R69 as a runbook checkbox', async () => {
  const runbook = await readFile('docs/pilot/owner-runbook.md', 'utf8');
  const checkboxes = runbook.split('\n').filter(line => /^\s*- \[ \] /.test(line)).join('\n');
  for (const [task, needles] of Object.entries(BLOCKED_ITEMS)) {
    for (const needle of needles) expect(checkboxes, `${task}: ${needle}`).toContain(needle);
  }
  expect(runbook).toContain(AUTOMATED_TESTING_DISCLAIMER);
  expect(runbook).not.toMatch(BANNED);
  for (const step of ['Approve the prospect scan', 'Send the prospect report', 'Kickoff', 'Week 1', 'Week 2', 'Week 3', 'Pilot report', 'Quote', 'Checkout link or invoice']) {
    expect(runbook, step).toMatch(new RegExp(`^##+ .*${step}`, 'mi'));
  }
});
