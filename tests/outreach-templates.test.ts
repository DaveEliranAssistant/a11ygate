// A11Y-R77: outreach kit drafts (docs/pilot/outreach/). Docs only: nothing here renders or sends
// a message. Relative links in these files are covered by the docs link check in
// tests/docs-consistency.test.ts (it scans docs/**/*.md); this file checks the templates themselves.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import pricing from '@/config/pricing.json';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const DIR = 'docs/pilot/outreach';
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), 'utf8');

const TEMPLATES = [
  'warm-intro-request.md',
  'first-touch-email.md',
  'first-touch-linkedin.md',
  'follow-up-1.md',
  'follow-up-2.md',
  'demo-invite.md',
  'post-demo-recap.md',
  'pilot-proposal.md',
  'conversion-email.md',
  'objections.md',
].map((name) => `${DIR}/${name}`);
const FILES = [`${DIR}/README.md`, ...TEMPLATES];

const BANNER = '> **DRAFT.** Eliran sends this himself. Review before sending.';
const HE_STUB = '[[HE: Eliran to write]]';

/**
 * The one placeholder allowlist (documented in docs/pilot/outreach/README.md for A11Y-R78).
 * Sample values are fictional; the longest one per placeholder is used for the LinkedIn length check.
 * price_usd_per_year and pilot_length_days use the config values (and a longer fictional value).
 */
const PLACEHOLDERS: Record<string, string[]> = {
  prospect_first_name: ['Dana', 'Alexandra'],
  prospect_company: ['Example Ltd', 'Example Retail Group Ltd'],
  prospect_role: ['VP Engineering', 'Head of Frontend Platform'],
  contact_first_name: ['Noa', 'Jonathan'],
  sender_name: ['Eliran', 'Eliran (A11yGate)'],
  why_now: ['your team is hiring a frontend lead', 'your careers page lists accessibility work in 2026'],
  why_now_source: ['https://example.com/jobs', 'https://example.com/careers/frontend-lead-v26'],
  price_usd_per_year: [String(pricing.priceUsdPerYear), '99999'],
  pilot_length_days: [String(pricing.pilot.lengthDays), '999'],
  ci_system: ['GitHub Actions', 'Azure DevOps'],
  demo_slots: ['Tue 10:00 or Wed 14:00 (IST)'],
  demo_date: ['Tuesday 2 December, 10:00 IST'],
  meeting_link: ['https://example.com/meet/abc-defg-hij'],
  observed_summary: ['- The demo app: the gate passed on existing debt and failed on one new unlabeled button.'],
  proposed_scope: ['- Pages: /, /products, /checkout (staging)'],
  pilot_start_date: ['2026-12-01'],
  decision_date: ['2026-12-21'],
  kickoff_checklist_link: ['https://example.com/shared/kickoff-checklist'],
  success_criteria_link: ['https://example.com/shared/success-criteria.yml'],
  pilot_results_attachment: ['pilot-results.pdf'],
  quote_attachment: ['quote.pdf'],
  payment_option: ['invoice on request'],
};
/** Own names only: a `Set` lookup, so inherited names such as `constructor` or `__proto__` are never "known". */
const KNOWN_PLACEHOLDERS: ReadonlySet<string> = new Set(Object.keys(PLACEHOLDERS));
const samplesFor = (name: string) => (KNOWN_PLACEHOLDERS.has(name) ? (PLACEHOLDERS[name] as string[]) : []);
const longest = (name: string) => [...samplesFor(name)].sort((a, b) => b.length - a.length)[0] as string;

const BANNED_CLAIMS =
  /\bcomplian(?:t|ce)\b|\bcertified\b|\bguarantee|\bconformant\b|\bconformance\b|lawsuit-proof|fix(?:es)? everything|100% accessible|accessibe|userway|audioeye|equalweb|level access|essential accessibility|max access|deque|siteimprove|monsido|silktide|allyable|recite me/i;

const placeholdersIn = (text: string) => [...text.matchAll(/\{\{\s*([^}]*?)\s*}}/g)].map((m) => m[1] as string);
/** Placeholder names in `text` that are not on the allowlist (empty = all good). */
const unknownPlaceholders = (text: string) => placeholdersIn(text).filter((name) => !KNOWN_PLACEHOLDERS.has(name));
/** Same check a template file gets: unknown names plus malformed braces. */
const placeholderProblems = (text: string) => ({
  unknown: unknownPlaceholders(text),
  malformed: /\{\{|}}|\{[a-z_]+}/.test(text.replace(/\{\{[a-z_]+}}/g, '')),
});
const message = (text: string) => {
  const match = /<!-- message:start -->\n([\s\S]*?)\n<!-- message:end -->/.exec(text);
  return match?.[1];
};
/** Copy units: blocks meant to be pasted or forwarded on their own (an objection answer, a forwardable blurb). */
const COPY_UNIT = /<!-- copy:start -->\n([\s\S]*?)\n<!-- copy:end -->/g;
const copyUnits = (text: string) => [...text.matchAll(COPY_UNIT)].map((m) => m[1] as string);
const stripCopyMarkers = (text: string) => text.replace(/^<!-- copy:(?:start|end) -->$/gm, '');
/** Strips a leading Markdown quote marker so quoted blurbs are compared on their text. */
const unquote = (unit: string) => unit.replace(/^> ?/gm, '');
/** Returns the copy units that do not end with the exact disclaimer (empty = all good). */
const unitsMissingDisclaimer = (text: string) =>
  copyUnits(text).filter((unit) => !unquote(unit).trimEnd().endsWith(AUTOMATED_TESTING_DISCLAIMER));
const render = (text: string) => text.replace(/\{\{([a-z_]+)}}/g, (_, name: string) => longest(name));

describe('outreach kit files (A11Y-R77)', () => {
  it('has exactly the README and the ten templates, and is linked from the pilot kit and docs index', () => {
    const names = readdirSync(path.join(repoRoot, DIR)).map((name) => `${DIR}/${name}`).sort();
    expect(names).toEqual([...FILES].sort());
    const readme = read(`${DIR}/README.md`);
    for (const rel of TEMPLATES) expect(readme, rel).toContain(`](${path.basename(rel)})`);
    expect(read('docs/pilot/README.md')).toContain('](outreach/README.md)');
    expect(read('docs/README.md')).toContain('](pilot/outreach/README.md)');
  });

  it.each(FILES)('(a) %s has the DRAFT banner, the exact disclaimer and the Hebrew stub', (rel) => {
    const text = read(rel);
    expect(text.split('\n')[2], rel).toBe(BANNER);
    expect(text).toContain(AUTOMATED_TESTING_DISCLAIMER);
    expect(text).toContain(HE_STUB);
  });

  it.each(TEMPLATES)('(a) %s: the message block ends with the untranslated disclaimer; the Hebrew part is a stub only', (rel) => {
    const text = read(rel);
    const body = message(text);
    expect(body, rel).toBeDefined();
    expect(stripCopyMarkers(body as string).trimEnd().endsWith(AUTOMATED_TESTING_DISCLAIMER), rel).toBe(true);
    // No Hebrew text anywhere: Hebrew is written by Eliran, never machine-translated.
    expect(text).not.toMatch(/[֐-׿]/);
    const he = text.slice(text.indexOf('(HE)'));
    expect(he).toContain(HE_STUB);
    expect(he).not.toContain('<!-- message:start -->');
  });

  it.each(FILES)('(a) %s: every copy unit (pasted or forwarded on its own) ends with the exact disclaimer', (rel) => {
    const text = read(rel);
    const starts = text.match(/<!-- copy:start -->/g)?.length ?? 0;
    const ends = text.match(/<!-- copy:end -->/g)?.length ?? 0;
    expect(ends, rel).toBe(starts);
    expect(copyUnits(text).length, rel).toBe(starts);
    expect(unitsMissingDisclaimer(text), rel).toEqual([]);
  });

  it('(a) every objection answer is its own copy unit with the disclaimer, and the instructions say to keep it', () => {
    const text = read(`${DIR}/objections.md`);
    const body = message(text) as string;
    const questions = body.match(/^\*\*"/gm)?.length ?? 0;
    expect(questions).toBeGreaterThanOrEqual(10);
    const units = copyUnits(text);
    expect(units.length).toBe(questions);
    for (const unit of units) expect(unit.match(/^\*\*"/gm)?.length, unit).toBe(1);
    // Nothing in the answers sits outside a copy unit.
    expect(body.replace(COPY_UNIT, '').trim()).toBe('');
    expect(text).toContain('include the disclaimer line in every reply');
  });

  it('(a) the forwardable warm-intro blurb carries the disclaimer inside the blurb itself', () => {
    const text = read(`${DIR}/warm-intro-request.md`);
    const units = copyUnits(message(text) as string);
    expect(units).toHaveLength(1);
    const blurb = unquote(units[0] as string);
    expect(blurb).toContain('runs A11yGate');
    expect(blurb.trimEnd().endsWith(AUTOMATED_TESTING_DISCLAIMER)).toBe(true);
    // No other quoted snippet in the message outside a copy unit.
    expect((message(text) as string).replace(COPY_UNIT, '')).not.toMatch(/^(?:> |")/m);
  });

  it('(a) the copy-unit check fails when the disclaimer is removed (negative case)', () => {
    for (const rel of [`${DIR}/objections.md`, `${DIR}/warm-intro-request.md`]) {
      const text = read(rel);
      const firstUnit = copyUnits(text)[0] as string;
      const stripped = firstUnit.replace(/\n(?:> ?)?Automated testing only\. Not a WCAG audit, certification or legal advice\.$/, '');
      expect(stripped, rel).not.toBe(firstUnit);
      const broken = text.replace(firstUnit, stripped);
      expect(unitsMissingDisclaimer(broken), rel).toHaveLength(1);
      // A reworded disclaimer is not accepted either.
      const reworded = text.replace(firstUnit, firstUnit.replace('legal advice.', 'legal advice'));
      expect(unitsMissingDisclaimer(reworded), rel).toHaveLength(1);
    }
  });

  it.each(FILES)('(a) %s uses only allowlisted placeholders, all well-formed', (rel) => {
    const text = read(rel);
    // Single-brace or unclosed variants would slip past a renderer.
    expect(placeholderProblems(text), rel).toEqual({ unknown: [], malformed: false });
  });

  it('(a) inherited object names are not allowlisted placeholders (negative case)', () => {
    const inherited = ['constructor', '__proto__', 'toString', 'hasOwnProperty'];
    // An `in` check would accept these: they live on Object.prototype, not in the allowlist.
    for (const name of inherited) expect(name in PLACEHOLDERS, name).toBe(true);
    for (const name of inherited) {
      expect(KNOWN_PLACEHOLDERS.has(name), name).toBe(false);
      expect(unknownPlaceholders(`Hi {{${name}}},`), name).toEqual([name]);
      expect(samplesFor(name), name).toEqual([]);
    }
    // A real template with these names planted fails the per-file check.
    const rel = `${DIR}/first-touch-email.md`;
    const text = read(rel);
    expect(placeholderProblems(text).unknown).toEqual([]);
    const planted = text.replace('Hi {{prospect_first_name}},', `Hi {{prospect_first_name}}, ${inherited.map((n) => `{{${n}}}`).join(' ')}`);
    expect(planted).not.toBe(text);
    expect(placeholderProblems(planted).unknown).toEqual(inherited);
  });

  it('(a) the README documents every allowlisted placeholder, and every one is used by a template', () => {
    const readme = read(`${DIR}/README.md`);
    const used = new Set(TEMPLATES.flatMap((rel) => placeholdersIn(read(rel))));
    for (const name of Object.keys(PLACEHOLDERS)) {
      expect(readme, name).toContain(`\`{{${name}}}\``);
      expect(used.has(name), `${name} unused`).toBe(true);
    }
  });

  it.each(FILES)('(a) %s has no literal price or pilot length', (rel) => {
    const text = read(rel);
    expect(text).not.toMatch(/\$\s?\d/);
    expect(text).not.toMatch(new RegExp(`\\b${pricing.priceUsdPerYear}\\b`));
    expect(text).not.toMatch(/\b(?:USD|EUR|ILS|NIS)\s?\d|\d\s?(?:USD|EUR|ILS|NIS)\b|[€₪]\s?\d/i);
    expect(text).not.toMatch(new RegExp(`\\b${pricing.pilot.lengthDays}\\b`));
    expect(text).not.toMatch(/\b(?:three|3)[- ]weeks?\b|\b\d+[- ]days?\b/i);
  });

  it.each(TEMPLATES)('(a) %s mentions price only through the placeholder', (rel) => {
    const text = read(rel);
    if (/\bper year\b|\bpaid plan\b/i.test(message(text) ?? '')) expect(text).toContain('{{price_usd_per_year}}');
    if (/\bpilot\b/i.test(message(text) ?? '') && /\bfree\b/i.test(message(text) ?? '')) expect(text, rel).toContain('{{pilot_length_days}}');
  });

  // "Followed by" = the next placeholder after {{why_now}}, on the same line, is {{why_now_source}}.
  it.each(FILES)('(a) %s: every {{why_now}} is followed by {{why_now_source}} on the same line', (rel) => {
    const lines = read(rel).split('\n');
    let count = 0;
    for (const line of lines) {
      const names = placeholdersIn(line);
      names.forEach((name, i) => {
        if (name !== 'why_now') return;
        count += 1;
        expect(names[i + 1], `${rel}: ${line}`).toBe('why_now_source');
      });
      if (names.includes('why_now_source')) expect(names[names.indexOf('why_now_source') - 1], `${rel}: ${line}`).toBe('why_now');
    }
    expect(count, rel).toBeGreaterThanOrEqual(1);
  });

  it.each(TEMPLATES)('(a) %s carries the {{why_now}} slot in the message itself', (rel) => {
    expect(message(read(rel)), rel).toContain('{{why_now}}');
  });

  it.each(FILES)('(b) %s passes the banned-claims and vendor-name grep', (rel) => {
    expect(read(rel).match(BANNED_CLAIMS)?.[0], rel).toBeUndefined();
  });

  it('(b) the grep catches the claims and vendor names it is meant to catch', () => {
    for (const bad of ['WCAG compliant', 'EAA compliance', 'certified', 'guaranteed', 'conformant', 'lawsuit-proof', 'fixes everything', 'AccessiBe', 'UserWay']) {
      expect(BANNED_CLAIMS.test(bad), bad).toBe(true);
    }
  });

  it('positions A11yGate as not an overlay and states it does not make a site meet a law or standard', () => {
    const objections = read(`${DIR}/objections.md`);
    expect(objections).toContain('not an overlay widget');
    expect(objections).toContain('does not make a site meet any law or standard');
    expect(objections).toContain('](../../what-a11ygate-does-not-do.md)');
    expect(objections).toContain('](../../known-limits.md)');
  });

  it('the pilot proposal is free, converts only on a written yes, bills nothing automatically and links the kit', () => {
    const text = read(`${DIR}/pilot-proposal.md`);
    const body = message(text) as string;
    expect(body).toContain('the pilot is free');
    expect(body).toContain('nothing is billed automatically');
    expect(body).toContain('only if you say yes in writing');
    expect(body).toContain('{{kickoff_checklist_link}}');
    expect(body).toContain('{{success_criteria_link}}');
    expect(text).toContain('](../kickoff-checklist.md)');
    expect(text).toContain('](../success-criteria.template.yml)');
    expect(text).toMatch(/draft that needs Eliran\/legal review/);
  });

  it('the pilot proposal: the customer revokes access, deletion follows the agreed schedule, wording is DRAFT for legal review', () => {
    const text = read(`${DIR}/pilot-proposal.md`);
    const body = message(text) as string;
    expect(text.split('\n')[2]).toBe(BANNER);
    expect(text).toContain('> **DRAFT: wording pending legal review.**');
    expect(text.indexOf('DRAFT: wording pending legal review')).toBeLessThan(text.indexOf('<!-- message:start -->'));
    expect(body).toContain('At the end you revoke the access you granted');
    expect(body).toContain('you revoke the access you granted, and we delete any copies we hold on the agreed retention schedule');
    expect(body).toContain('delete them at the end of the retention period agreed at kickoff, then confirm the deletion in writing');
    // No promise that the operator revokes the customer's access, and no invented retention period.
    expect(body).not.toMatch(/\bwe (?:will )?(?:remove|revoke) (?:the |your )?access\b|\baccess is (?:revoked|removed)\b/i);
    expect(body).not.toMatch(/\b\d+\s*(?:days?|weeks?|months?|years?)\b/i);
  });

  it('no outreach file promises an evidence pack on every run (packs are made at pilot milestones)', () => {
    for (const rel of FILES) {
      expect(read(rel), rel).not.toMatch(/(?:each|every) (?:CI )?(?:run|scan|pull request)[^.]*evidence pack|evidence pack[^.]*(?:on|for|per|with|after) (?:each|every) (?:CI )?(?:run|build|scan|pull request)/i);
    }
    const email = message(read(`${DIR}/first-touch-email.md`)) as string;
    expect(email).toContain('A new finding at or above your threshold (serious or critical by default) fails the check');
    expect(email).toContain('so does a setup or scan error, such as an unreadable baseline');
    expect(email).toContain('When a run produces a scan report, the CI job uploads it as a build artifact in your own CI, whether the check passed or failed.');
    expect(email).toContain('At the pilot milestones (kickoff, mid-pilot and the decision date) I also make an evidence pack');
  });

  it('no outreach file makes an unconditional CI or access claim (gate also fails on setup/scan errors; the customer revokes access)', () => {
    for (const rel of FILES) {
      const text = read(rel);
      // "fails only on/when ..." hides that setup or scan errors fail the check too.
      expect(text, rel).not.toMatch(/\b(?:fails?|blocks?)\b[^.]*\bonly (?:when|on|if)\b|\bonly (?:fails?|blocks?)\b/i);
      // Reports are uploaded only when a run produces one.
      expect(text, rel).not.toMatch(/\b(?:each|every) (?:CI )?(?:run|build|scan)\b[^.]*\b(?:keeps|uploads|produces|leaves)\b/i);
      // The customer revokes the access they granted; we can't.
      expect(text, rel).not.toMatch(/\baccess (?:is|will be|gets) (?:revoked|removed)\b|\bwe (?:will )?(?:remove|revoke) (?:the |your )?access\b|\brevoked at the end\b/i);
    }
    const objection = copyUnits(read(`${DIR}/objections.md`)).find((unit) => unit.includes('What does it cost'));
    expect(objection).toContain('you revoke the access you granted');
    expect(objection).toContain('we delete any copies we hold on the retention schedule agreed at kickoff');
  });

  it('the README says never send automatically, Eliran only, and per-prospect copies outside the repo', () => {
    const text = read(`${DIR}/README.md`);
    expect(text).toContain('**Never send automatically.**');
    expect(text).toContain('Eliran sends every message himself');
    expect(text).toContain('live **outside this repository**');
  });

  it('(c) the LinkedIn message renders at 300 characters or fewer with the longest sample values', () => {
    const body = message(read(`${DIR}/first-touch-linkedin.md`)) as string;
    const rendered = render(body);
    expect(rendered).not.toMatch(/\{\{/);
    expect(rendered).toContain(AUTOMATED_TESTING_DISCLAIMER);
    expect([...rendered].length, rendered).toBeLessThanOrEqual(300);
    // The documented limits for the two free-text slots match the longest samples used here.
    expect(longest('why_now').length).toBe(50);
    expect(longest('why_now_source').length).toBe(45);
  });
});
