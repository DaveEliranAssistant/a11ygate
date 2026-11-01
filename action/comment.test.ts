import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MARKER, buildCommentBody, findA11yComment } from './comment.mjs';

describe('pull request comment', () => {
  it('keeps one marker and the summary counts', () => {
    const body = buildCommentBody('| New | 2 |\n| Fixed | 3 |\n| Still open | 5 |\n');
    expect(body.startsWith(MARKER)).toBe(true);
    expect(body).toContain('| New | 2 |');
    expect(body).toContain('| Still open | 5 |');
    expect(findA11yComment([{ id: 9, body }])).toMatchObject({ id: 9 });
    expect(findA11yComment([{ id: 4, body: 'unrelated' }])).toBeNull();
  });

  it('truncates a summary that would exceed the comment limit', () => {
    const body = buildCommentBody('x'.repeat(80_000));
    expect(body.length).toBeLessThanOrEqual(65_000);
    expect(body.startsWith(MARKER)).toBe(true);
    expect(body).toContain('truncated');
  });

  it('declares the composite action contract', () => {
    const source = readFileSync(new URL('./action.yml', import.meta.url), 'utf8');
    expect(source).toContain("using: composite");
    expect(source).toContain('run.mjs');
    expect(source).toContain('current:');
    expect(source).toContain('baseline:');
    expect(source).toContain('threshold:');
    expect(source).toContain('comment:');
    const runner = readFileSync(new URL('./run.mjs', import.meta.url), 'utf8');
    expect(runner).toContain('GITHUB_STEP_SUMMARY');
    expect(runner).toContain('upsertComment');
  });
});
