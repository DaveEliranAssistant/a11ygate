import { describe, expect, it } from 'vitest';
import { reviveScan } from '@/lib/storage';
import { minimalResult } from './helpers';

describe('stored scans', () => {
  it('revives a valid saved scan and drops unknown axe fields', () => {
    const raw = JSON.stringify({
      projectName: 'demo.shop',
      currentSynthetic: false,
      baselineSynthetic: false,
      currentResults: [minimalResult()],
      baselineResults: null,
      threshold: 'serious',
      groupBy: 'page',
      generatedAt: '2026-10-31T12:00:00.000Z',
    });
    const scan = reviveScan(raw);
    expect(scan?.projectName).toBe('demo.shop');
    expect(scan?.groupBy).toBe('page');
    expect(scan?.baselineResults).toBeNull();
    expect(scan?.currentResults[0]?.violations[0]?.id).toBe('color-contrast');
  });

  it('rejects corrupt or incomplete saved scans', () => {
    expect(reviveScan('{')).toBeNull();
    expect(reviveScan('null')).toBeNull();
    expect(
      reviveScan(
        JSON.stringify({
          projectName: 'demo.shop',
          currentSynthetic: false,
          baselineSynthetic: false,
          currentResults: [minimalResult()],
          baselineResults: null,
          threshold: 'blocker',
          groupBy: 'rule',
          generatedAt: '2026-10-31T12:00:00.000Z',
        }),
      ),
    ).toBeNull();
  });
});
