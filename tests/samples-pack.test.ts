// A11Y-R79 (d): the committed sample deliverables pack stays small. Content checks need Chromium and live in
// e2e/samples.spec.ts.
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SAMPLE_FILES, SCREENSHOT_CHECKS } from '../scripts/build-samples.mjs';

const dir = path.join(__dirname, '..', 'docs', 'samples');
const MAX_BYTES = 3 * 1024 * 1024;

async function totalBytes(target: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(target, { withFileTypes: true })) {
    const full = path.join(target, entry.name);
    total += entry.isDirectory() ? await totalBytes(full) : (await stat(full)).size;
  }
  return total;
}

describe('docs/samples (A11Y-R79)', () => {
  it('has every sample, the screenshot checks and the README, and nothing else', async () => {
    expect((await readdir(dir)).sort()).toEqual([...SAMPLE_FILES, SCREENSHOT_CHECKS, 'README.md'].sort());
  });

  it('is at most 3 MB in total', async () => {
    expect(await totalBytes(dir)).toBeLessThanOrEqual(MAX_BYTES);
  });
});
