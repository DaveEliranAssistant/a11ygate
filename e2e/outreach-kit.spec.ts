import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import pricing from '../config/pricing.json';
import { AUTOMATED_TESTING_DISCLAIMER } from '../lib/copy';
import { pdfInfo } from '../tests/pdf-info';

test('(f) the packaged outreach CLI prints the offer and disclaimer in selectable PDF text', async () => {
  const root = path.resolve(__dirname, '..');
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'a11ygate-outreach-pdf-'));
  try {
    const fixture = path.join(root, 'tests/fixtures/outreach/prospect.example.yml');
    const { stdout } = await promisify(execFile)(process.execPath, [
      path.join(root, 'packages/cli/dist/cli.mjs'), 'outreach', 'kit', '--prospect', fixture, '--out-dir', 'kit',
    ], { cwd, timeout: 25_000 });
    expect(stdout).toContain(AUTOMATED_TESTING_DISCLAIMER);
    const { pages } = await pdfInfo(await readFile(path.join(cwd, 'kit/one-pager.pdf')));
    const text = pages.join(' ').replace(/ (ffi|ffl|ff|fi|fl) /g, '$1');
    expect(text).toContain('Example Widgets Ltd');
    expect(text).toContain(AUTOMATED_TESTING_DISCLAIMER);
    expect(text).toContain(`free ${pricing.pilot.lengthDays}-day pilot`);
    expect(text).toContain(`USD ${pricing.priceUsdPerYear} per year`);
    expect(text).toContain('https://example.com/news');
    expect(text).toContain('A11YGATE_URL');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
