import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import pricing from '@/config/pricing.json';
import { getCheckoutUrl } from '@/lib/billing';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { PILOT_EVIDENCE_FILE } from '@/lib/evidence/pack';
import { quoteHtml } from '@/lib/scan/pilot-report';
import { buildScanReport } from '@/lib/scan/report';
import type { AxeResults } from '@/lib/types';
import { runEvidence } from '@/packages/cli/src/evidence';
import { run } from '@/packages/cli/src/run';
import { blockNetwork } from './network-guard';
import { printProspectPdf } from '@/packages/cli/src/report-pdf';

vi.mock('@/packages/cli/src/report-pdf', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/packages/cli/src/report-pdf')>(),
  printProspectPdf: vi.fn(),
}));

const now = () => new Date('2026-12-21T10:00:00Z');
const stdout = () => {};
const testEnv = { NODE_ENV: 'test' } as const;
const criteriaPath = 'a11ygate-pilot/success-criteria.yml';
const customer = 'Fixture <Shop>';
const checkout = 'https://checkout.example.test/order?source=pilot&term=year';
const banned = /fixes everything|\bcompliant\b|\bcertified\b|\bguarantees?\b|\bconformant\b|lawsuit-proof/i;

it('uses the configured amount and term and selects payment from the validated environment', () => {
  const changed = { ...pricing, priceUsdPerYear: 1300, termMonths: 18 };
  const warn = vi.fn();
  const html = quoteHtml(customer, '2026-12-21', getCheckoutUrl({}, warn), changed);
  expect(html).toContain('$1,300/year');
  expect(html).toContain('18 months');
  expect(html).toContain('invoice on request');
  expect(warn).not.toHaveBeenCalled();
  expect(quoteHtml(customer, '2026-12-21', getCheckoutUrl({ A11YGATE_CHECKOUT_URL: checkout }, warn)))
    .toContain('href="https://checkout.example.test/order?source=pilot&amp;term=year"');
  for (const value of ['http://checkout.example.test/', 'https://user:password@checkout.example.test/']) {
    expect(quoteHtml(customer, '2026-12-21', getCheckoutUrl({ A11YGATE_CHECKOUT_URL: value }, warn))).toContain('invoice on request');
  }
  expect(warn).toHaveBeenCalledTimes(2);
});

const site = 'http://localhost/';
const contact = new URL('contact.html', site).href;

function findings(rule: string, impact: 'moderate' | 'serious' | 'critical', selectors: string[]): AxeResults['violations'][number] {
  return { id: rule, impact, tags: [], help: rule, helpUrl: '', nodes: selectors.map(selector => ({ target: [selector], html: '<div></div>' })) };
}

async function pack(cwd: string, name: string, day: number, scanDay: number, violations: AxeResults['violations'], evidence?: object) {
  const scannedAt = `2026-12-${scanDay}T10:00:00Z`;
  const dir = path.join(cwd, name);
  await mkdir(dir);
  const pages = [site, contact].map((url, index) => ({
    url, finalUrl: url, status: 200, scanStatus: 'complete' as const,
    result: { url, timestamp: scannedAt, testEngine: { version: '4.0.0' }, violations: index === 0 ? violations : [] },
  }));
  const report = buildScanReport({
    crawl: { pages, skipped: [] }, version: '0.2.0', scannedAt, startUrl: site, failOn: 'serious',
    maxPages: 2, delayMs: 0, userAgent: 'A11yGate/test', robotsNote: 'Robots rules honoured.',
  });
  await writeFile(path.join(dir, 'a11ygate-scan.json'), JSON.stringify(report));
  if (evidence) await writeFile(path.join(dir, PILOT_EVIDENCE_FILE), JSON.stringify({ schemaVersion: 1, ...evidence }));
  const stderr = vi.fn();
  expect(await runEvidence(['pack', '--from', name, '--out', `packs/${name}.zip`], {
    cwd, now: () => new Date(`2026-12-${Math.max(day, scanDay)}T12:00:00Z`), stdout, stderr, version: '0.2.0', env: {}, gitHead: async () => String(day).padStart(40, '0'),
    gitCommitMeta: async () => ({ committedAt: `2026-12-${String(day).padStart(2, '0')}T08:00:00Z`, branch: 'main' }),
  }), JSON.stringify(stderr.mock.calls)).toBe(0);
}

it('compares three packs, grades the targets, and writes the HTML goldens without Chromium', async () => {
  const network = blockNetwork();
  const cwd = await mkdtemp(path.join(process.cwd(), '.pilot-report-test-'));
  try {
    await mkdir(path.join(cwd, 'packs'));
    await mkdir(path.join(cwd, 'a11ygate-pilot'));
    const template = await readFile('docs/pilot/success-criteria.template.yml', 'utf8');
    const criteria = template.replace('min: 5', 'min: 2').replace('list: []', 'list: ["/contact.html"]');
    await writeFile(path.join(cwd, criteriaPath), criteria);
    const image = findings('image-alt', 'critical', ['img']);
    const label = findings('label', 'serious', ['#email']);
    const region = findings('region', 'moderate', ['#promo']);
    await pack(cwd, 'kickoff', 1, 18, [image, label]);
    await pack(cwd, 'mid', 9, 11, [label], {
      gate: { targetBranch: 'main', from: '2026-12-01', through: '2026-12-09', required: true, pullRequests: 2, gateRuns: 2 },
    });
    await pack(cwd, 'latest', 21, 20, [label, region], {
      baselineCommitted: true,
      gate: { targetBranch: 'main', from: '2026-12-01', through: '2026-12-21', required: true, pullRequests: 4, gateRuns: 3 },
      postWeekTwoMerges: { targetBranch: 'main', from: '2026-12-15', through: '2026-12-21', unreviewedNewSeriousOrCritical: 0 },
      evidenceDeliveredOn: '2026-12-19',
    });
    const stderr = vi.fn();
    const io = { cwd, now, stdout, stderr, env: testEnv };
    const args = ['pilot', 'report', '--kickoff', 'packs/kickoff.zip', '--latest', 'packs/latest.zip',
      '--criteria', criteriaPath, '--customer', customer];
    vi.mocked(printProspectPdf).mockResolvedValue(Buffer.from('PDF stub'));
    expect(await run([...args, '--packs', 'packs'], io), JSON.stringify(stderr.mock.calls)).toBe(0);
    const html = await readFile(path.join(cwd, 'pilot-report/pilot-results.html'), 'utf8');
    const quote = await readFile(path.join(cwd, 'pilot-report/quote.html'), 'utf8');
    expect(html).toContain('<th scope="row">critical</th><td>1</td><td>0</td>');
    expect(html).toContain('<th scope="row">moderate</th><td>0</td><td>1</td>');
    expect(html).toContain('<th scope="row">serious</th><td>1</td><td>1</td>');
    expect(html).toContain('<th scope="row">Total</th><td>2</td><td>2</td>');
    for (const label of ['New', 'Fixed', 'Remaining']) expect(html).toContain(`<th scope="row">${label}</th><td>1</td>`);
    expect(html).toMatch(/<caption>Trend runs[\s\S]*kickoff.zip[\s\S]*mid.zip[\s\S]*latest.zip/);
    expect(html).toContain('Oldest first by commit time.');
    expect(html).toContain('Required gate runs on every PR to main</th><td>Not met</td>');
    expect(html).toContain('Fingerprint baseline committed</th><td>Met</td>');
    expect(html).toContain('findings merged after week 2</th><td>Met</td>');
    expect(html).toContain('Pages or flows covered</th><td>Met</td>');
    expect(html).toContain('handed to customer before the decision date</th><td>Met</td>');
    expect(html).toContain('packs/latest.zip!/scan/a11ygate-pilot-evidence.json#gate');
    for (const artifact of [html, quote]) {
      expect(artifact).toMatchSnapshot();
      expect(artifact).toContain(AUTOMATED_TESTING_DISCLAIMER);
      expect(artifact).not.toMatch(banned);
    }
    await writeFile(path.join(cwd, criteriaPath), template);
    // The kickoff ZIP lacks optional evidence. HTML must survive failed printing.
    vi.mocked(printProspectPdf).mockRejectedValueOnce(new Error('Chromium executable missing'));
    expect(await run([...args.slice(0, -2).map(arg => arg === 'packs/latest.zip' ? 'packs/kickoff.zip' : arg),
      '--out-dir', 'missing'], { ...io, env: { ...testEnv, A11YGATE_CHECKOUT_URL: checkout } })).toBe(2);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('HTML saved to missing. Could not print PDFs (Chromium executable missing).'));
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('npx playwright install chromium'));
    const missing = await readFile(path.join(cwd, 'missing/pilot-results.html'), 'utf8');
    expect(missing.match(/<td>Not measurable<\/td>/g)).toHaveLength(4);
    expect(missing).toContain('Pages or flows covered</th><td>Not met</td>');
    expect(missing).toContain('No PR-gate activity was recorded in these packs.');
    expect(await readFile(path.join(cwd, 'missing/quote.html'), 'utf8')).toContain('https://checkout.example.test/order?source=pilot&amp;term=year');
    expect(network.attempts).toEqual([]);
  } finally {
    vi.mocked(printProspectPdf).mockReset();
    await rm(cwd, { recursive: true, force: true });
    network.restore();
  }
}, 30_000);
