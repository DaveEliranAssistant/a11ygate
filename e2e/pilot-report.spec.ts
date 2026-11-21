import { execFile } from 'node:child_process';
import { cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import pricing from '../config/pricing.json';
import { AUTOMATED_TESTING_DISCLAIMER } from '../lib/copy';
import { pdfInfo } from '../tests/pdf-info';
import { serveFixture } from './scan-server';

const repoRoot = path.resolve(__dirname, '..');
const cli = path.join(repoRoot, 'packages/cli/dist/cli.mjs');
const run = promisify(execFile);
const banned = /fixes everything|\bcompliant\b|\bcertified\b|\bguarantees?\b|\bconformant\b|lawsuit-proof/i;
// pdf.js on Linux runners returns ligature glyphs as separate items ("certi fi cation"); rejoin them before matching.
const rejoinLigatures = (text: string) => text.replace(/ (ffi|ffl|ff|fi|fl) /g, '$1');

test('pilot report compares three local scan packs and prints the results and draft quote', async ({}, testInfo) => {
  test.setTimeout(120_000);
  const cwd = testInfo.outputPath('pilot');
  const fixture = path.join(cwd, 'scan-site');
  await cp(path.join(repoRoot, 'fixtures/scan-site'), fixture, { recursive: true });
  const index = path.join(fixture, 'index.html');
  const kickoffHtml = await readFile(index, 'utf8');
  const midHtml = kickoffHtml.replace('<img src="/pixel.png" width="10" height="10">', '');
  const latestHtml = midHtml.replace('</main>', '<input type="text">\n</main>');
  const server = await serveFixture(fixture);
  const runCli = async (args: string[], exit = 0) => {
    const result = await run(process.execPath, [cli, ...args], {
      cwd, env: { ...process.env, A11YGATE_CHECKOUT_URL: '' }, timeout: 25_000,
    }).then(
      ({ stderr }) => ({ code: 0, stderr }),
      (error: { code?: number; stderr?: string; message: string }) => ({ code: error.code, stderr: error.stderr || error.message }),
    );
    expect(result.code, result.stderr).toBe(exit);
  };
  try {
    for (const [name, html, exit] of [
      ['kickoff', kickoffHtml, 1], ['mid', midHtml, 0], ['latest', latestHtml, 1],
    ] as const) {
      await writeFile(index, html);
      await runCli(['scan', server.origin, '--out-dir', name], exit);
      await runCli(['evidence', 'pack', '--from', name, '--out', `packs/${name}.zip`]);
    }
  } finally {
    await server.close();
  }

  const template = await readFile(path.join(repoRoot, 'docs/pilot/success-criteria.template.yml'), 'utf8');
  await writeFile(path.join(cwd, 'success-criteria.yml'), template.replace('min: 5', 'min: 1'));
  await runCli(['pilot', 'report', '--kickoff', 'packs/kickoff.zip', '--latest', 'packs/latest.zip',
    '--packs', 'packs', '--criteria', 'success-criteria.yml']);

  const results = await readFile(path.join(cwd, 'pilot-report/pilot-results.html'), 'utf8');
  expect(results).toContain('<th scope="row">critical</th><td>1</td><td>1</td>');
  expect(results).toContain('<th scope="row">Total</th><td>1</td><td>1</td>');
  expect(results).toContain('<th scope="row">New</th><td>1</td>');
  expect(results).toContain('<th scope="row">Fixed</th><td>1</td>');
  expect(results).toContain('<th scope="row">Remaining</th><td>0</td>');
  expect(results).toContain('Pages or flows covered</th><td>Met</td>');
  expect(results.match(/<td>Not measurable<\/td>/g)).toHaveLength(4);

  for (const file of ['pilot-results.pdf', 'quote.pdf']) {
    const { pages } = await pdfInfo(await readFile(path.join(cwd, 'pilot-report', file)));
    if (file === 'quote.pdf') expect(pages).toHaveLength(1);
    else expect(pages.length).toBeGreaterThan(1);
    for (const raw of pages) {
      const page = rejoinLigatures(raw);
      expect(page).toContain(AUTOMATED_TESTING_DISCLAIMER);
      expect(raw).not.toMatch(banned);
      expect(page).not.toMatch(banned);
    }
    const content = rejoinLigatures(pages.join(' '));
    expect(content).toContain(`$${pricing.priceUsdPerYear.toLocaleString('en-US')}/year`);
    expect(content).toContain('DRAFT — needs Eliran review before sending');
  }
});
