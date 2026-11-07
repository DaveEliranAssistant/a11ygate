import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CI_AXE_SNIPPET, CI_CLI_COMMANDS, CI_WORKFLOW, CLI_PACKAGE } from '@/lib/copy';
import { WAITLIST_SUCCESS } from '@/lib/waitlist/messages';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const readme = read('../README.md');

describe('landing and README adoption copy', () => {
  it('names the published CLI version from the package manifest', () => {
    const cli = JSON.parse(read('../packages/cli/package.json')) as { name: string; version: string };
    expect(CLI_PACKAGE).toBe(`${cli.name}@${cli.version}`);
    expect(readme).toContain(CLI_PACKAGE);
  });

  it('drops the stale unpublished wording from the README', () => {
    expect(readme).not.toContain('Neither is published yet');
    expect(readme).not.toContain('not on npm yet');
    expect(readme).not.toContain('Unreleased coverage and manual-evidence increment');
    expect(readme).toContain('[Give feedback](https://github.com/DaveEliranAssistant/a11ygate/discussions/categories/ideas)');
  });

  it('reuses the commands documented in the README', () => {
    expect(readme).toContain(CI_AXE_SNIPPET);
    expect(readme.replace('            a11y-results/cart.json\n', '')).toContain(CI_WORKFLOW);
    expect(CI_CLI_COMMANDS).toContain('npx @qe-atlas/a11ygate --current');
    expect(CI_CLI_COMMANDS).toContain('--baseline a11y/baseline.json');
  });

  it('tells a new signup not to wait', () => {
    expect(WAITLIST_SUCCESS).toContain('You are on the waitlist.');
    expect(WAITLIST_SUCCESS).toContain('You do not need to wait.');
  });
});
