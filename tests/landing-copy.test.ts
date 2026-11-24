import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import pricing from '@/config/pricing.json';
import {
  AUTOMATED_TESTING_DISCLAIMER,
  CI_AXE_SNIPPET,
  CI_CLI_COMMANDS,
  CI_WORKFLOW,
  CLI_NPM_PACKAGE,
  CLI_NPM_PUBLISHED_VERSION,
  CLI_NPM_SENTENCE,
} from '@/lib/copy';
import { PILOT_REQUEST_HEADING, PILOT_REQUEST_INTRO, WAITLIST_SUCCESS } from '@/lib/waitlist/messages';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const readme = read('../README.md');

describe('landing and README adoption copy', () => {
  it('names the CLI version npm serves, not the manifest version on main', () => {
    // Registry state, checked by hand (`npm view @qe-atlas/a11ygate dist-tags` = { latest: '0.1.0' }).
    // Deliberately not read from packages/cli/package.json: main can be ahead of npm.
    expect(CLI_NPM_PUBLISHED_VERSION).toBe('0.1.0');
    expect(CLI_NPM_SENTENCE).toBe(
      'The CLI on npm is @qe-atlas/a11ygate@0.1.0. Newer features are on main, not yet on npm.',
    );
    expect(npmClaimProblems(CLI_NPM_SENTENCE)).toEqual([]);
    expect(readme).toContain(`\`${CLI_NPM_PACKAGE}\``);
    expect(npmClaimProblems(readme)).toEqual([]);
  });

  it('renders the npm sentence from the constant and rejects the old 0.2.0 claim', () => {
    const source = read('../components/CiCommands.tsx');
    expect(source).toContain('The CLI on npm is <code>{CLI_NPM_PACKAGE}</code>. {CLI_NPM_UNRELEASED_NOTE}');
    expect(npmClaimProblems(source)).toEqual([]);
    expect(npmClaimProblems('The CLI is on npm as @qe-atlas/a11ygate@0.2.0.')).toEqual([
      '@qe-atlas/a11ygate@0.2.0',
    ]);
    expect(npmClaimProblems('`@qe-atlas/a11ygate@0.2.0` is on the npm `next` tag')).not.toEqual([]);
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

/** Any pinned @qe-atlas/a11ygate@<version> other than the published one, or a claim about an npm `next` tag. */
function npmClaimProblems(text: string): string[] {
  const pinned = [...text.matchAll(/@qe-atlas\/a11ygate@(\d+\.\d+\.\d+(?:-[\w.]+)?)/g)]
    .filter((match) => match[1] !== CLI_NPM_PUBLISHED_VERSION)
    .map((match) => match[0]);
  const nextTag = /npm `?next`? tag|a11ygate@next/.test(text) ? ['npm next tag'] : [];
  return [...pinned, ...nextTag];
}

const BANNED_CLAIMS =
  /\bcomplian(?:t|ce)\b|\bcertified\b|\bguarantee|\bconformant\b|lawsuit-proof|fixes everything|accessibe|userway|audioeye|equalweb|level access|essential accessibility|max access/i;

async function renderOffer(pilotHref = '/#waitlist-heading'): Promise<string> {
  const { PilotOffer } = await import('@/components/PilotOffer');
  return renderToStaticMarkup(createElement(PilotOffer, { pilotHref }));
}

const visibleText = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, ' ');

describe('flag-gated pilot offer', () => {
  afterEach(() => {
    vi.doUnmock('@/config/pricing.json');
    vi.resetModules();
  });

  it('shows the price, pilot length, positioning, CTA and disclaimer from config', async () => {
    const text = visibleText(await renderOffer());
    expect(text).toContain('Accessibility gate in your CI, with evidence for every release');
    expect(text).toContain("It is not an overlay widget; it doesn't change your site at runtime.");
    expect(text).toContain('$990 per year');
    expect(text).toContain('Start with a free 3-week pilot');
    expect(text).toContain('Nothing is billed automatically.');
    expect(text).toContain('Request a free pilot');
    expect(text).toContain('See pricing');
    expect(text).toContain(AUTOMATED_TESTING_DISCLAIMER);
    expect(pricing.priceUsdPerYear).toBe(990);
  });

  it('changes the rendered price when the pricing config changes', async () => {
    vi.resetModules();
    vi.doMock('@/config/pricing.json', () => ({
      default: { ...pricing, priceUsdPerYear: 1234, pilot: { ...pricing.pilot, lengthDays: 10 } },
    }));
    const text = visibleText(await renderOffer());
    expect(text).toContain('$1,234 per year');
    expect(text).toContain('Start with a free 2-week pilot');
    expect(text).toContain('Enable the gate on pull requests');
    expect(text).toContain('Week 2, results review:');
    expect(text).not.toContain('Week 3');
    expect(text).not.toContain('$990');
  });

  it('shows the configured price for a one-week pilot and keeps all steps in that week', async () => {
    vi.resetModules();
    vi.doMock('@/config/pricing.json', () => ({
      default: { ...pricing, pilot: { lengthDays: 7, priceUsd: 100 } },
    }));
    const text = visibleText(await renderOffer());
    expect(text).toContain('Start with a 1-week pilot for $100');
    expect(text).toContain('Request a pilot');
    expect(text).not.toContain('free');
    expect(text).toContain('Week 1, setup and baseline:');
    expect(text).toContain('Enable the gate on pull requests');
    expect(text).toContain('Results review:');
    expect(text).not.toContain('Week 2');
  });

  it('links the CTA to the given pilot URL and the secondary link to /pricing', async () => {
    const html = await renderOffer('https://forms.example.test/pilot');
    expect(html).toMatch(/<a class="button button-ink" href="https:\/\/forms\.example\.test\/pilot" rel="noopener">Request a free pilot<\/a>/);
    expect(html).toContain('href="/pricing"');
    expect(await renderOffer('mailto:pilot@example.test')).toContain('href="mailto:pilot@example.test">Request a free pilot');
  });

  it('lists only CI integrations that exist on main', async () => {
    const { SUPPORTED_CI } = await import('@/components/PilotOffer');
    const evidence: Record<string, string> = {
      'GitHub Actions': '../docs/integrations/github-action.md',
      Jenkins: '../integrations/jenkins',
      'GitLab CI/CD': '../integrations/gitlab',
      'Azure DevOps': '../integrations/azure-devops',
      CircleCI: '../integrations/circleci',
      'Bitbucket Pipelines': '../integrations/bitbucket',
    };
    expect([...SUPPORTED_CI].sort()).toEqual(Object.keys(evidence).sort());
    for (const path of Object.values(evidence)) expect(() => readFileSync(new URL(path, import.meta.url))).not.toThrow(/ENOENT/);
  });

  it('passes the banned-claims grep on the offer, pilot form copy and npm sentence', async () => {
    const copy = [
      visibleText(await renderOffer()),
      PILOT_REQUEST_HEADING,
      PILOT_REQUEST_INTRO,
      CLI_NPM_SENTENCE,
      read('../components/PilotOffer.tsx'),
    ];
    for (const text of copy) expect(text.match(BANNED_CLAIMS)?.[0], text.slice(0, 80)).toBeUndefined();
    expect(BANNED_CLAIMS.test('WCAG compliant')).toBe(true);
  });

  it('titles the reused waitlist form as a pilot request read by a person', () => {
    expect(PILOT_REQUEST_HEADING).toBe('Request a free pilot');
    expect(PILOT_REQUEST_INTRO).toContain('A person reads each request.');
    expect(PILOT_REQUEST_INTRO).toContain('There is no automated follow-up.');
  });
});
