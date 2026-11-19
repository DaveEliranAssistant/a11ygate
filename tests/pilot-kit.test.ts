// A11Y-R66: pilot onboarding kit (docs/pilot/). Docs commands and links are covered by
// tests/docs-consistency.test.ts (it scans docs/**/*.md); this file checks the kit itself.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

  it('every CI example scans the same URL and crawl scope the baseline was created from', () => {
    const text = read('docs/pilot/quickstart.md');
    const ci = text.slice(text.indexOf('## 6. Wire the gate into CI'), text.indexOf('## 7.'));
    const sections = ci.split(/^### /m).slice(1);
    expect(sections).toHaveLength(4);
    // Steps 3 and 4 (first scan and baseline) use this URL and scope.
    const before = text.slice(0, text.indexOf('## 6.'));
    expect(before).toContain('a11ygate scan http://127.0.0.1:4173/ --crawl 10');
    for (const section of sections) {
      const title = section.split('\n')[0];
      expect(section, title).toContain('http://127.0.0.1:4173/');
      expect(section, title).toMatch(/--crawl 10|crawl: 10/);
      // The templates' defaults (port 3000, one page) would turn every baseline finding into a new one.
      for (const block of section.matchAll(/```(?:sh|yaml)\n([\s\S]*?)```/g)) {
        expect(block[1], title).not.toMatch(/127\.0\.0\.1:3000|--crawl 1\b|crawl: 1\b/);
      }
    }
  });

  it('documents the GitHub starter permissions exactly as init generates them, and how to reduce them', async () => {
    const { githubStarter } = await import('@/packages/cli/src/init');
    const generated = githubStarter({ target: 'github', url: 'http://127.0.0.1:4173/', crawl: 10, failOn: 'serious', baseline: 'a11y', yes: true, force: false } as Parameters<typeof githubStarter>[0]);
    const permissions = /^permissions:\n(?:  .+\n)+/m.exec(generated)?.[0];
    expect(permissions).toBeDefined();
    const text = read('docs/pilot/quickstart.md');
    expect(text).toContain(permissions as string);
    expect(text).toContain('```yaml\npermissions:\n  contents: read\n```');
    expect(generated).toContain('A11YGATE_URL: "http://127.0.0.1:4173/"');
    // The reduction advice depends on which steps need write scopes.
    expect(generated).not.toMatch(/github-script|gh (?:issue|pr) /);
    expect(generated).toContain('upload-sarif');
  });
});

// The R62 checker (tests/docs-consistency.test.ts) recognizes `a11ygate <command>` but not a
// direct `node <path>/cli.mjs <command>` call. This additive check covers those calls in the kit.
describe('pilot docs direct bundle invocations (A11Y-R66)', () => {
  const CLI = path.join(repoRoot, 'packages/cli/dist/cli.mjs');
  const help = (args: string[]): string => {
    try {
      return execFileSync(process.execPath, [CLI, ...args, '--help'], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' }, timeout: 30_000 });
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string };
      return `${failed.stdout ?? ''}${failed.stderr ?? ''}`;
    }
  };

  it('every `node .../cli.mjs <command>` command and flag exists in that command\'s --help', () => {
    expect(existsSync(CLI), 'run npm run cli:build first').toBe(true);
    const commands = new Set([...help([]).matchAll(/^\s+a11ygate \[?([a-z]+)]?/gm)].map((m) => m[1] as string));
    const problems: string[] = [];
    let invocations = 0;
    for (const rel of markdownFiles) {
      for (const match of read(rel).matchAll(/\bnode\s+\S*cli\.mjs((?:[ \t]+[^\s;&`|]+)*)/g)) {
        const tokens = (match[1] ?? '').trim().split(/[ \t]+/).filter(Boolean);
        const command = tokens[0] ?? '';
        if (!command) continue; // a bare path, e.g. "`a11ygate` means `node .../cli.mjs`"
        if (!commands.has(command)) {
          problems.push(`${rel}: unknown command "${command}" in \`${match[0]}\``);
          continue;
        }
        invocations += 1;
        const commandHelp = help([command]);
        for (const flag of (match[1] ?? '').match(/(?<![\w-])--[a-z0-9][a-z0-9-]*/g) ?? []) {
          if (!new RegExp(`(?<![\\w-])${flag}(?![\\w-])`).test(commandHelp)) problems.push(`${rel}: ${flag} not in "a11ygate ${command} --help" (\`${match[0]}\`)`);
        }
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
    expect(invocations).toBeGreaterThanOrEqual(1);
  }, 60_000);
});

describe('pilot success criteria schema (A11Y-R66)', () => {
  it('validates the template', () => {
    expect(validate(template()), JSON.stringify(validate.errors)).toBe(true);
  });

  const invalid: Array<[string, (doc: PilotDoc) => void]> = [
    ['gate answer written as a string', (doc) => { doc.criteria.gateRunsOnEveryPrToMain = 'yes'; }],
    ['negative unreviewed-finding limit', (doc) => { doc.criteria.maxUnreviewedNewSeriousOrCriticalMergedAfterWeek2 = -1; }],
    ['unreviewed-finding limit above the spec value 0', (doc) => { doc.criteria.maxUnreviewedNewSeriousOrCriticalMergedAfterWeek2 = 1; }],
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
    // Each clause keeps its own marker: moving a marker to another line must fail.
    const clauses: Array<[string, string, string]> = [
      ['1. Parties', '- Provider: [[MISSING]] (business/legal entity name', '[[LEGAL REVIEW]]'],
      ['3. Price and billing', '- Taxes, invoicing entity and payment terms', '[[LEGAL REVIEW]]'],
      ['5. Authorization to scan', '- Customer responsibilities for the authorization:', '[[LEGAL REVIEW]]'],
      ['6. Data handling', '- Personal data, data-processing terms and cross-border transfer:', '[[LEGAL REVIEW]]'],
      ['6. Data handling', "- Confidentiality of the Customer's code, findings and reports:", '[[LEGAL REVIEW]]'],
      ['7. Access and end of pilot', '- Either party may end the pilot early by written notice:', '[[LEGAL REVIEW]]'],
      ['8. Limits of automated testing', '- Warranties, disclaimers and limitation of liability:', '[[LEGAL REVIEW]]'],
      ['9. Law and disputes', '- Governing law, jurisdiction and dispute resolution:', '[[LEGAL REVIEW]]'],
      ['10. Acceptance', '- Signature blocks, date and method of acceptance', '[[LEGAL REVIEW]]'],
      ['1. Parties', '- Provider:', '[[MISSING]]'],
      ['1. Parties', '- Customer:', '[[MISSING]]'],
      ['3. Price and billing', '- Taxes, invoicing entity and payment terms', '[[MISSING]]'],
      ['6. Data handling', '- The Provider keeps copies only if the Customer agrees', '[[MISSING]]'],
      ['10. Acceptance', '- Signature blocks, date and method of acceptance', '[[MISSING]]'],
    ];
    for (const [title, clause, marker] of clauses) {
      const section = sections.find((s) => s.startsWith(title)) ?? '';
      const line = section.split('\n').find((l) => l.startsWith(clause));
      expect(line, `${title}: ${clause}`).toBeDefined();
      expect(line, `${title}: ${clause}`).toContain(marker);
    }
    expect(text.match(/\[\[LEGAL REVIEW]]/g)?.length ?? 0).toBeGreaterThanOrEqual(10);
    expect(text.match(/\[\[MISSING]]/g)?.length ?? 0).toBeGreaterThanOrEqual(9);
  });

  it('states no auto-billing and conversion only on explicit written acceptance', () => {
    expect(text).toContain('nothing bills automatically');
    expect(text).toContain('explicit written acceptance');
  });
});
