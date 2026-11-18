// A11Y-R66: pilot onboarding kit (docs/pilot/). Docs commands and links are covered by
// tests/docs-consistency.test.ts (it scans docs/**/*.md); this file checks the kit itself.
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import pricing from '@/config/pricing.json';
import schema from '@/schema/pilot-success.schema.json';

const yaml = createRequire(import.meta.url)('js-yaml') as { load: (text: string) => unknown };
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), 'utf8');
const pilotFiles = readdirSync(path.join(repoRoot, 'docs/pilot')).map((name) => `docs/pilot/${name}`).sort();
const markdownFiles = pilotFiles.filter((rel) => rel.endsWith('.md'));
const kitFiles = [...pilotFiles, 'schema/pilot-success.schema.json'];

const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);
type Json = Record<string, unknown>;
type PilotDoc = { pilot: Json; criteria: Json & { pagesOrFlowsCovered: Json } };
type SchemaNode = { description?: unknown; properties?: Record<string, SchemaNode> };
const template = () => yaml.load(read('docs/pilot/success-criteria.template.yml')) as PilotDoc;

describe('pilot kit files (A11Y-R66)', () => {
  it('has every kit file and is linked from the docs index', () => {
    expect(pilotFiles).toEqual([
      'docs/pilot/README.md',
      'docs/pilot/kickoff-checklist.md',
      'docs/pilot/pilot-terms.template.md',
      'docs/pilot/quickstart.md',
      'docs/pilot/success-criteria.template.yml',
    ]);
    expect(read('docs/README.md')).toContain('](pilot/README.md)');
    const index = read('docs/pilot/README.md');
    for (const name of ['quickstart.md', 'kickoff-checklist.md', 'success-criteria.template.yml', 'pilot-terms.template.md']) expect(index).toContain(`](${name})`);
  });

  it.each(kitFiles)('%s carries the disclaimer and makes no compliance claims', (rel) => {
    const text = read(rel);
    expect(text).toContain(AUTOMATED_TESTING_DISCLAIMER);
    expect(text).not.toMatch(/\bcompliant\b|\bcertified\b|\bguarantee[sd]?\b|\bconformant\b|lawsuit-proof|fixes everything/i);
  });

  it('keeps prices and pilot length in the docs equal to config/pricing.json', () => {
    const allowedPrices = new Set([pricing.priceUsdPerYear, pricing.pilot.priceUsd]);
    for (const rel of markdownFiles) {
      const text = read(rel);
      for (const match of text.matchAll(/\$\s?(\d[\d,]*)/g)) expect(allowedPrices, `${rel}: ${match[0]}`).toContain(Number((match[1] as string).replace(/,/g, '')));
      for (const match of text.matchAll(/(\d+)[- ]days?\b/g)) expect(Number(match[1]), `${rel}: ${match[0]}`).toBe(pricing.pilot.lengthDays);
    }
    for (const rel of ['docs/pilot/README.md', 'docs/pilot/pilot-terms.template.md']) {
      expect(read(rel), rel).toContain(`$${pricing.priceUsdPerYear} per year`);
      expect(read(rel), rel).toContain(`${pricing.pilot.lengthDays}-day pilot`);
    }
    expect(read('docs/pilot/pilot-terms.template.md')).toContain(`The pilot costs $${pricing.pilot.priceUsd}.`);
    expect(template().pilot.lengthDays).toBe(pricing.pilot.lengthDays);
  });

  it('the kickoff checklist covers authorization, least privilege, retention, deletion and revocation', () => {
    const text = read('docs/pilot/kickoff-checklist.md');
    for (const phrase of [
      'written scan authorization from the site owner',
      'least access needed',
      'storage state',
      'Environments listed',
      'primary contact',
      'Weekly check-in',
      'Retention period',
      'deletes all copies',
      'revokes the owner\'s repository and CI access',
    ]) expect(text, phrase).toContain(phrase);
  });

  it('the quickstart uses only the pilot commands and covers all four CI systems', () => {
    const text = read('docs/pilot/quickstart.md');
    for (const command of ['init', 'doctor', 'scan', 'baseline create', 'evidence pack']) expect(text, command).toContain(`a11ygate ${command}`);
    // R65 (init for GitLab/Azure) is not on main: those sections must not use init.
    expect(text).not.toMatch(/init[^\n]*--target\s+(gitlab|azure)/);
    for (const heading of ['### GitHub Actions', '### GitLab CI', '### Azure DevOps', '### Jenkins']) expect(text, heading).toContain(heading);
  });
});

describe('pilot success criteria schema (A11Y-R66)', () => {
  it('validates the template', () => {
    expect(validate(template()), JSON.stringify(validate.errors)).toBe(true);
  });

  const invalid: Array<[string, (doc: PilotDoc) => void]> = [
    ['gate answer written as a string', (doc) => { doc.criteria.gateRunsOnEveryPrToMain = 'yes'; }],
    ['negative unreviewed-finding limit', (doc) => { doc.criteria.maxUnreviewedNewSeriousOrCriticalMergedAfterWeek2 = -1; }],
    ['missing decision date', (doc) => { delete doc.pilot.decisionDate; }],
    ['unquoted YAML date (parsed as a Date)', (doc) => { doc.pilot.decisionDate = new Date('2026-12-21'); }],
    ['zero pages or flows covered', (doc) => { doc.criteria.pagesOrFlowsCovered.min = 0; }],
    ['unknown criterion (typo)', (doc) => { doc.criteria.evidencePackProducd = true; }],
  ];
  it.each(invalid)('rejects %s', (_name, mutate) => {
    const doc = template();
    mutate(doc);
    expect(validate(doc)).toBe(false);
  });

  it('documents every property for later consumers (R69)', () => {
    const walk = (node: SchemaNode, at: string): void => {
      for (const [key, child] of Object.entries(node.properties ?? {})) {
        expect(typeof child.description, `${at}.${key}`).toBe('string');
        walk(child, `${at}.${key}`);
      }
    };
    walk(schema as SchemaNode, '$');
  });
});

describe('pilot terms draft (A11Y-R66)', () => {
  const text = read('docs/pilot/pilot-terms.template.md');

  it('starts with the review banner and is never presented as final', () => {
    expect(text.split('\n')[0]).toBe('DRAFT — needs Eliran/legal review before use');
    expect(text).toContain('not final');
    expect(text).not.toMatch(/\bthis (?:document|file) is (?:the )?final\b|\bfinal version\b/i);
  });

  it('keeps all [[LEGAL REVIEW]] and [[MISSING]] markers', () => {
    // Sections that must stay open for legal review until a reviewed per-customer copy is made.
    const sections = text.split(/^## /m).slice(1);
    const needReview = ['1. Parties', '3. Price and billing', '5. Authorization to scan', '6. Data handling', '7. Access and end of pilot', '8. Limits of automated testing', '9. Law and disputes', '10. Acceptance'];
    for (const title of needReview) {
      const section = sections.find((s) => s.startsWith(title));
      expect(section, title).toBeDefined();
      expect(section, title).toContain('[[LEGAL REVIEW]]');
    }
    expect(text.match(/\[\[LEGAL REVIEW]]/g)?.length ?? 0).toBeGreaterThanOrEqual(10);
    expect(text.match(/\[\[MISSING]]/g)?.length ?? 0).toBeGreaterThanOrEqual(9);
  });

  it('states no auto-billing and conversion only on explicit written acceptance', () => {
    expect(text).toContain('nothing bills automatically');
    expect(text).toContain('explicit written acceptance');
  });
});
