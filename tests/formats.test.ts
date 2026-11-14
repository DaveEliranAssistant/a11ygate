import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { validateXML } from 'xmllint-wasm';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { parseJenkinsJunit, toJunit } from '@/lib/export-junit';
import { toSarif } from '@/lib/export-sarif';
import { compareScans } from '@/lib/compare';
import { parseAxeJson } from '@/lib/parse';
import {
  formatReportFromGate,
  formatReportFromScan,
  parseFormatList,
  type FormatReport,
} from '@/lib/report-formats';
import { buildScanReport } from '@/lib/scan/report';
import type { CrawlResult } from '@/lib/scan/crawl';
import { parseArgs } from '@/packages/cli/src/args';
import { parseScanArgs, runScan, type ScanEngineFactory } from '@/packages/cli/src/scan';
import { run } from '@/packages/cli/src/run';
import { minimalResult } from './helpers';
import { readFileSync } from 'node:fs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const currentPath = path.join(repoRoot, 'fixtures/demo-shop-current.json');
const baselinePath = path.join(repoRoot, 'fixtures/demo-shop-baseline.json');
const junitXsd = readFileSync(new URL('./schemas/junit-4.xsd', import.meta.url), 'utf8');
const sarifSchema = JSON.parse(readFileSync(new URL('./schemas/sarif-schema-2.1.0.json', import.meta.url), 'utf8')) as object;

const CLAIM_RE = /fixes everything|WCAG\/EAA compliant|\bcertified\b|\bguarantee\b/i;

function formatReportFixture(): FormatReport {
  return {
    toolName: 'A11yGate',
    version: '0.1.0',
    generatedAt: '2026-10-31T12:00:00.000Z',
    command: 'scan',
    verdict: 'FAIL',
    reason: '2 findings at or above serious: image-alt, color-contrast.',
    startUrl: 'https://demo.shop/',
    pages: ['https://demo.shop/', 'https://demo.shop/about'],
    findings: [
      {
        ruleId: 'image-alt',
        impact: 'critical',
        help: 'Images must have alternate text',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/image-alt',
        tags: ['wcag2a', 'wcag111', 'cat.text-alternatives'],
        wcag: [{ number: '1.1.1', name: 'Non-text Content', level: 'A', wcag: '2.1' }],
        pageUrl: 'https://demo.shop/',
        selector: 'img.hero',
        html: '<img class="hero" src="/x.png">',
        fingerprint: 'image-alt|img.hero|/',
      },
      {
        ruleId: 'image-alt',
        impact: 'critical',
        help: 'Images must have alternate text',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/image-alt',
        tags: ['wcag2a', 'wcag111', 'cat.text-alternatives'],
        wcag: [{ number: '1.1.1', name: 'Non-text Content', level: 'A', wcag: '2.1' }],
        pageUrl: 'https://demo.shop/',
        selector: 'img.footer',
        html: '<img class="footer">',
        fingerprint: 'image-alt|img.footer|/',
      },
      {
        ruleId: 'color-contrast',
        impact: 'serious',
        help: 'Elements must have sufficient color contrast',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast',
        tags: ['wcag2aa', 'wcag143'],
        wcag: [{ number: '1.4.3', name: 'Contrast (Minimum)', level: 'AA', wcag: '2.1' }],
        pageUrl: 'https://demo.shop/about',
        selector: '.price-tag',
        html: '<span class="price-tag">€12</span>',
        fingerprint: 'color-contrast|.price-tag|/about',
      },
    ],
  };
}

async function validateJunit(xml: string): Promise<void> {
  const result = await validateXML({ xml, schema: junitXsd });
  expect(result.valid, (result.errors ?? []).map((error) => error.message ?? String(error)).join('\n')).toBe(true);
}

function validateSarif(log: unknown): void {
  // The official SARIF 2.1.0 schema has a typo in two `language` patterns (a stray ']'),
  // which is not a valid JS Unicode RegExp. Disable unicodeRegExp so Ajv can compile the schema as published.
  const ajv = new Ajv({ strict: false, allErrors: true, unicodeRegExp: false });
  addFormats(ajv);
  const validate = ajv.compile(sarifSchema);
  const ok = validate(log);
  expect(ok, JSON.stringify(validate.errors, null, 2)).toBe(true);
}

describe('report format flags', () => {
  it('parses repeated and comma-separated --format values', () => {
    expect(parseFormatList('junit')).toEqual({ ok: true, formats: ['junit'] });
    expect(parseFormatList('junit,sarif,json,md')).toEqual({ ok: true, formats: ['junit', 'sarif', 'json', 'md'] });
    expect(parseFormatList('junit, junit')).toEqual({ ok: true, formats: ['junit'] });
    expect(parseFormatList('xml')).toMatchObject({ ok: false, error: expect.stringContaining('Unknown format') });

    const parsed = parseArgs(['--current', 'a.json', '--format', 'junit,sarif', '--format', 'md', '--out-dir', 'out']);
    expect(parsed).toMatchObject({ ok: true, options: { formats: ['junit', 'sarif', 'md'], outDir: 'out', current: ['a.json'] } });

    const scan = parseScanArgs(['https://demo.shop/', '--format', 'junit', '--out-dir', 'out']);
    expect(scan).toMatchObject({ ok: true, options: { formats: ['junit'], outDir: 'out' } });
    expect(parseScanArgs(['https://demo.shop/', '--format', 'sarif'])).toMatchObject({
      ok: false,
      error: expect.stringContaining('--format requires --out-dir'),
    });
  });
});

describe('JUnit output', () => {
  it('groups one testcase per rule × page, puts the disclaimer in testsuite properties, and matches the snapshot', async () => {
    const xml = toJunit(formatReportFixture());
    await validateJunit(xml);
    expect(xml).toContain(AUTOMATED_TESTING_DISCLAIMER);
    expect(xml).not.toMatch(CLAIM_RE);
    expect(xml).toMatchSnapshot();

    const suites = parseJenkinsJunit(xml);
    expect(suites).toHaveLength(1);
    const suite = suites[0]!;
    expect(suite.name).toBe('A11yGate');
    expect(suite.tests).toBe(2);
    expect(suite.failures).toBe(2);
    expect(suite.errors).toBe(0);
    expect(suite.properties.disclaimer).toBe(AUTOMATED_TESTING_DISCLAIMER);
    expect(suite.cases.map((item) => [item.classname, item.name, item.status, item.type])).toEqual([
      ['https://demo.shop/', 'image-alt', 'failed', 'image-alt'],
      ['https://demo.shop/about', 'color-contrast', 'failed', 'color-contrast'],
    ]);
    const imageAlt = suite.cases[0]!;
    expect(imageAlt.message).toContain('2 instances');
    expect(imageAlt.body).toContain('img.hero');
    expect(imageAlt.body).toContain('img.footer');
  });

  it('emits a passing no-violations testcase for a clean page and is still schema-valid', async () => {
    const report = formatReportFixture();
    report.findings = report.findings.filter((finding) => finding.pageUrl === 'https://demo.shop/');
    const xml = toJunit(report);
    await validateJunit(xml);
    const suite = parseJenkinsJunit(xml)[0]!;
    expect(suite.tests).toBe(2);
    expect(suite.failures).toBe(1);
    expect(suite.cases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ classname: 'https://demo.shop/about', name: 'no-violations', status: 'passed' }),
      ]),
    );
  });

  it('parses a checked-in Jenkins JUnit plugin fixture', async () => {
    const xml = await readFile(new URL('./fixtures/formats/jenkins-plugin.junit.xml', import.meta.url), 'utf8');
    await validateJunit(xml);
    const suites = parseJenkinsJunit(xml);
    expect(suites[0]).toMatchObject({
      name: 'A11yGate',
      tests: 2,
      failures: 1,
      properties: { disclaimer: AUTOMATED_TESTING_DISCLAIMER },
    });
    expect(suites[0]?.cases.map((item) => item.status)).toEqual(['failed', 'passed']);
  });
});

describe('SARIF 2.1.0 output', () => {
  it('validates against the official schema, has rule metadata, WCAG tags and URL+selector locations, and matches the snapshot', () => {
    const text = toSarif(formatReportFixture());
    const log = JSON.parse(text) as {
      version: string;
      runs: Array<{
        tool: { driver: { rules: Array<{ id: string; properties?: { tags?: string[] } }> } };
        taxonomies?: Array<{ name: string; taxa: Array<{ id: string }> }>;
        results: Array<{
          ruleId: string;
          locations: Array<{
            physicalLocation: { artifactLocation: { uri: string }; region?: { message?: { text?: string } } };
            logicalLocations?: Array<{ fullyQualifiedName: string }>;
          }>;
        }>;
        properties: { disclaimer: string };
      }>;
    };
    expect(log.version).toBe('2.1.0');
    validateSarif(log);
    expect(text).toContain(AUTOMATED_TESTING_DISCLAIMER);
    expect(text).not.toMatch(CLAIM_RE);
    expect(text).toMatchSnapshot();

    const run = log.runs[0]!;
    expect(run.properties.disclaimer).toBe(AUTOMATED_TESTING_DISCLAIMER);
    expect(run.tool.driver.rules.map((rule) => rule.id)).toEqual(['color-contrast', 'image-alt']);
    expect(run.tool.driver.rules.find((rule) => rule.id === 'image-alt')?.properties?.tags).toEqual(
      expect.arrayContaining(['accessibility', 'wcag111', 'WCAG 1.1.1']),
    );
    expect(run.taxonomies?.[0]?.name).toBe('WCAG');
    expect(run.taxonomies?.[0]?.taxa.map((taxon) => taxon.id)).toEqual(['1.1.1', '1.4.3']);
    expect(run.results).toHaveLength(3);
    const first = run.results[0]!;
    expect(first.ruleId).toBe('image-alt');
    expect(first.locations[0]?.physicalLocation.artifactLocation.uri).toBe('a11ygate-pages/demo.shop/index.html');
    expect(first.locations[0]?.logicalLocations?.[1]?.fullyQualifiedName).toBe('https://demo.shop/');
    expect(first.locations[0]?.logicalLocations?.[0]?.fullyQualifiedName).toBe('img.footer');
    expect(first.locations[0]?.physicalLocation.region?.message?.text).toBe('selector: img.footer');
    const contrast = run.results.find((item) => item.ruleId === 'color-contrast')!;
    expect(contrast.locations[0]?.physicalLocation.artifactLocation.uri).toBe('a11ygate-pages/demo.shop/about/index.html');
    expect(contrast.locations[0]?.logicalLocations?.[1]?.fullyQualifiedName).toBe('https://demo.shop/about');
    expect(contrast.locations[0]?.logicalLocations?.[0]?.fullyQualifiedName).toBe('.price-tag');
  });

  it('uses a source file and line when a finding is mapped', () => {
    const report = formatReportFixture();
    report.findings = [
      {
        ...report.findings[0]!,
        source: { file: 'app/hero.tsx', startLine: 24, startColumn: 5 },
      },
    ];
    const log = JSON.parse(toSarif(report)) as {
      runs: Array<{ results: Array<{ locations: Array<{ physicalLocation: { artifactLocation: { uri: string }; region: { startLine: number } } }> }> }>;
    };
    validateSarif(log);
    const loc = log.runs[0]!.results[0]!.locations[0]!.physicalLocation;
    expect(loc.artifactLocation.uri).toBe('app/hero.tsx');
    expect(loc.region.startLine).toBe(24);
  });
});

describe('formats from scan and gate reports', () => {
  it('renders JUnit and SARIF from a scan report and from the demo-shop gate fixtures', async () => {
    const result = minimalResult();
    const crawl: CrawlResult = {
      pages: [
        { url: result.url, finalUrl: result.url, status: 200, scanStatus: 'complete', result },
        { url: 'https://demo.shop/about', finalUrl: 'https://demo.shop/about', status: 200, scanStatus: 'complete', result: minimalResult({ url: 'https://demo.shop/about', violations: [] }) },
      ],
      skipped: [],
    };
    const scan = buildScanReport({
      crawl,
      version: '0.1.0',
      scannedAt: '2026-10-31T12:00:00.000Z',
      startUrl: 'https://demo.shop/products',
      failOn: 'serious',
      maxPages: 2,
      delayMs: 0,
      userAgent: 'A11yGate/test',
      robotsNote: 'robots.txt honoured.',
    });
    const fromScan = formatReportFromScan(scan);
    const scanJunit = toJunit(fromScan);
    await validateJunit(scanJunit);
    validateSarif(JSON.parse(toSarif(fromScan)));

    const current = parseAxeJson(await readFile(currentPath, 'utf8'));
    const baseline = parseAxeJson(await readFile(baselinePath, 'utf8'));
    expect(current.ok && baseline.ok).toBe(true);
    if (!current.ok || !baseline.ok) return;
    const diff = compareScans(current.results, baseline.results);
    const fromGate = formatReportFromGate({
      version: '0.1.0',
      generatedAt: '2026-10-31T12:00:00.000Z',
      projectName: 'demo.shop',
      verdict: 'FAIL',
      reason: 'new findings',
      currentResults: current.results,
      findings: [...diff.newFindings, ...diff.stillOpen],
    });
    expect(fromGate.findings.length).toBeGreaterThan(0);
    const gateJunit = toJunit(fromGate);
    await validateJunit(gateJunit);
    validateSarif(JSON.parse(toSarif(fromGate)));
    const suite = parseJenkinsJunit(gateJunit)[0]!;
    expect(suite.failures).toBe(suite.cases.filter((item) => item.status === 'failed').length);
    expect(suite.tests).toBe(suite.cases.length);
  });
});

describe('CLI --format does not change exit codes', () => {
  async function capture(args: string[], cwd: string) {
    let stdout = '';
    let stderr = '';
    const code = await run(args, {
      cwd,
      now: () => new Date('2026-10-31T12:00:00.000Z'),
      stdout: (chunk) => {
        stdout += chunk;
      },
      stderr: (chunk) => {
        stderr += chunk;
      },
    });
    return { code, stdout, stderr };
  }

  it('ci and the default command write JUnit and SARIF and still exit 1 on the demo fixtures', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'a11ygate-fmt-'));
    try {
      const without = await capture(['--current', currentPath, '--baseline', baselinePath], dir);
      const withFormats = await capture(
        ['ci', '--current', currentPath, '--baseline', baselinePath, '--format', 'junit,sarif,json,md', '--out-dir', 'out'],
        dir,
      );
      expect(without.code).toBe(1);
      expect(withFormats.code).toBe(1);
      expect(withFormats.stdout).toBe(without.stdout);
      const xml = await readFile(path.join(dir, 'out/a11ygate.junit.xml'), 'utf8');
      const sarif = await readFile(path.join(dir, 'out/a11ygate.sarif'), 'utf8');
      await validateJunit(xml);
      validateSarif(JSON.parse(sarif));
      expect(xml).toContain(AUTOMATED_TESTING_DISCLAIMER);
      expect(sarif).toContain(AUTOMATED_TESTING_DISCLAIMER);
      expect(await readFile(path.join(dir, 'out/a11ygate.json'), 'utf8')).toContain('"verdict": "FAIL"');
      expect(await readFile(path.join(dir, 'out/a11ygate.md'), 'utf8')).toContain('**Verdict: FAIL**');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects --format without --out-dir and accepts ci --help', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'a11ygate-fmt-bad-'));
    try {
      const missing = await capture(['--current', currentPath, '--format', 'junit'], dir);
      expect(missing.code).toBe(2);
      expect(missing.stderr).toContain('--format requires --out-dir');
      const help = await capture(['ci', '--help'], dir);
      expect(help.code).toBe(0);
      expect(help.stdout).toContain('--format');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('scan --format writes the extra files and keeps the fail-on exit code', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'a11ygate-scan-fmt-'));
    const origin = 'https://site.test';
    const engine: ScanEngineFactory = async () => ({
      visit: async (url) => ({
        status: 200,
        finalUrl: url,
        contentType: 'text/html',
        links: [],
        result: minimalResult({ url }),
      }),
      close: async () => undefined,
    });
    try {
      const quiet = { cwd: dir, stdout: () => undefined, stderr: () => undefined, version: '0.1.0', fetch: async () => ({ ok: false, status: 404, text: async () => '' }), sleep: async () => undefined, engine };
      expect(await runScan([origin, '--out-dir', 'out', '--format', 'junit,sarif'], quiet)).toBe(1);
      await validateJunit(await readFile(path.join(dir, 'out/a11ygate-scan.junit.xml'), 'utf8'));
      validateSarif(JSON.parse(await readFile(path.join(dir, 'out/a11ygate-scan.sarif'), 'utf8')));
      expect(await readFile(path.join(dir, 'out/a11ygate-scan.json'), 'utf8')).toContain('site-scan');
      expect(await runScan([origin, '--out-dir', 'out2', '--format', 'junit', '--fail-on', 'none'], quiet)).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

