import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {
  GITHUB_SARIF_LIMITS,
  automationDetailsId,
  githubArtifactUri,
  gzipByteLength,
  primaryLocationLineHash,
  toSarif,
  type SarifLog,
} from '@/lib/export-sarif';
import type { FormatFinding, FormatReport } from '@/lib/report-formats';
import type { Impact } from '@/lib/types';

const sarifSchema = JSON.parse(readFileSync(new URL('./schemas/sarif-schema-2.1.0.json', import.meta.url), 'utf8')) as object;
const ajv = new Ajv({ strict: false, allErrors: true, unicodeRegExp: false });
addFormats(ajv);
const validate = ajv.compile(sarifSchema);

function validateSarif(log: unknown) {
  const ok = validate(log);
  if (!ok) throw new Error(ajv.errorsText(validate.errors));
}

function finding(overrides: Partial<FormatFinding> & Pick<FormatFinding, 'ruleId' | 'selector'>): FormatFinding {
  return {
    impact: 'serious',
    help: 'Elements must have sufficient color contrast',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast',
    tags: ['wcag2aa', 'wcag143'],
    wcag: [{ number: '1.4.3', name: 'Contrast (Minimum)', level: 'AA', wcag: '2.1' }],
    pageUrl: 'https://demo.shop/',
    html: '<span class="price">9</span>',
    fingerprint: `${overrides.ruleId}|${overrides.selector}|/`,
    ...overrides,
  };
}

function report(findings: FormatFinding[], extras: Partial<FormatReport> = {}): FormatReport {
  return {
    toolName: 'A11yGate',
    version: '0.1.0',
    generatedAt: '2026-11-14T07:00:00.000Z',
    command: 'scan',
    verdict: 'FAIL',
    reason: 'findings present',
    startUrl: 'https://demo.shop/',
    pages: ['https://demo.shop/'],
    findings,
    ...extras,
  };
}

describe('GitHub code scanning SARIF limits', () => {
  it('cites the official GitHub documentation for each enforced limit', () => {
    expect(GITHUB_SARIF_LIMITS.docs.sarifSupport).toBe(
      'https://docs.github.com/en/code-security/reference/code-scanning/sarif-files/sarif-support',
    );
    expect(GITHUB_SARIF_LIMITS.docs.fileTooLarge).toBe(
      'https://docs.github.com/en/code-security/reference/code-scanning/sarif-files/troubleshoot-sarif-uploads/file-too-large',
    );
    expect(GITHUB_SARIF_LIMITS.docs.resultsExceedLimit).toBe(
      'https://docs.github.com/en/code-security/reference/code-scanning/sarif-files/troubleshoot-sarif-uploads/results-exceed-limit',
    );
    expect(GITHUB_SARIF_LIMITS.maxGzipBytes).toBe(10 * 1024 * 1024);
    expect(GITHUB_SARIF_LIMITS.maxRunsPerFile).toBe(20);
    expect(GITHUB_SARIF_LIMITS.maxResultsPerRun).toBe(25_000);
    expect(GITHUB_SARIF_LIMITS.retainedResultsPerRun).toBe(5_000);
    expect(GITHUB_SARIF_LIMITS.maxTagsPerRule).toBe(20);
  });

  it('emits a stable primaryLocationLineHash so the same finding on two runs does not duplicate an alert', () => {
    // https://docs.github.com/en/code-security/reference/code-scanning/sarif-files/sarif-support
    // "Fingerprint generation": Code scanning only uses primaryLocationLineHash
    // to detect when two results are logically identical across runs.
    const first = finding({ ruleId: 'color-contrast', selector: '.price-tag', pageUrl: 'https://demo.shop/about' });
    const second: FormatFinding = {
      ...first,
      help: 'updated help text should not change the fingerprint',
      html: '<span class="price-tag">changed copy</span>',
    };
    const hashA = primaryLocationLineHash(first);
    const hashB = primaryLocationLineHash(second);
    expect(hashA).toBe(hashB);
    expect(hashA).toMatch(/^[0-9a-f]{16}:\d+$/);

    const log1 = JSON.parse(toSarif(report([first], { generatedAt: '2026-11-14T07:00:00.000Z' }))) as SarifLog;
    const log2 = JSON.parse(toSarif(report([second], { generatedAt: '2026-11-14T08:00:00.000Z' }))) as SarifLog;
    validateSarif(log1);
    validateSarif(log2);
    const fp1 = log1.runs[0]!.results[0]!.partialFingerprints.primaryLocationLineHash;
    const fp2 = log2.runs[0]!.results[0]!.partialFingerprints.primaryLocationLineHash;
    expect(fp1).toBe(hashA);
    expect(fp2).toBe(fp1);
    expect(Object.keys(log1.runs[0]!.results[0]!.partialFingerprints)).toContain('primaryLocationLineHash');
  });

  it('gives a different fingerprint when the rule, path or selector changes', () => {
    const base = finding({ ruleId: 'image-alt', selector: 'img.hero' });
    const other = finding({ ruleId: 'image-alt', selector: 'img.footer' });
    expect(primaryLocationLineHash(base)).not.toBe(primaryLocationLineHash(other));
  });

  it('sets automationDetails.id as a11ygate/<engine>/ so each engine is its own category', () => {
    // https://docs.github.com/en/code-security/reference/code-scanning/sarif-files/sarif-support
    // runAutomationDetails.id is parsed as category/run-id; a trailing slash
    // sets the category (here a11ygate/axe) without a distinct run id.
    expect(automationDetailsId('axe')).toBe('a11ygate/axe/');
    expect(automationDetailsId('htmlcs')).toBe('a11ygate/htmlcs/');
    expect(automationDetailsId('IBM Equal Access')).toBe('a11ygate/ibm-equal-access/');

    const axe = finding({ ruleId: 'image-alt', selector: 'img.hero', engines: ['axe'], confidence: { confirmedBy: 1, enginesRan: 2, agreement: 0.5 } });
    const htmlcs = finding({
      ruleId: 'WCAG.Principle1.Guideline1_1.1_1_1.H37',
      selector: 'img.hero',
      engines: ['htmlcs'],
      confidence: { confirmedBy: 1, enginesRan: 2, agreement: 0.5 },
    });
    const log = JSON.parse(
      toSarif(
        report([axe, htmlcs], {
          engines: { used: ['axe', 'htmlcs'], errored: [] },
        }),
      ),
    ) as SarifLog;
    validateSarif(log);
    expect(log.runs.map((run) => run.automationDetails.id)).toEqual(['a11ygate/axe/', 'a11ygate/htmlcs/']);
    expect(log.runs[0]!.results).toHaveLength(1);
    expect(log.runs[1]!.results).toHaveLength(1);
  });

  it('defaults a single run to the a11ygate/axe/ category when no engine is recorded', () => {
    const log = JSON.parse(toSarif(report([finding({ ruleId: 'image-alt', selector: 'img.hero' })]))) as SarifLog;
    expect(log.runs).toHaveLength(1);
    expect(log.runs[0]!.automationDetails.id).toBe('a11ygate/axe/');
    expect(log.runs[0]!.properties.engine).toBe('axe');
  });

  it('keeps at most 5,000 results per run, highest severity first, per GitHub truncation', () => {
    // https://docs.github.com/en/code-security/reference/code-scanning/sarif-files/troubleshoot-sarif-uploads/results-exceed-limit
    // Results per run: maximum 25,000; only the top 5,000 are retained, prioritized by severity.
    expect(GITHUB_SARIF_LIMITS.docs.resultsExceedLimit).toContain('results-exceed-limit');
    const findings: FormatFinding[] = [];
    for (let i = 0; i < 5002; i++) {
      const impact: Impact = i < 10 ? 'critical' : i < 20 ? 'serious' : 'minor';
      findings.push(
        finding({
          ruleId: 'color-contrast',
          selector: `.n-${i}`,
          impact,
          fingerprint: `color-contrast|.n-${i}|/`,
        }),
      );
    }
    const log = JSON.parse(toSarif(report(findings))) as SarifLog;
    validateSarif(log);
    expect(log.runs).toHaveLength(1);
    expect(log.runs[0]!.results).toHaveLength(GITHUB_SARIF_LIMITS.retainedResultsPerRun);
    expect(log.runs[0]!.properties.truncatedResults).toBe(2);
    expect(log.runs[0]!.properties.retainedResults).toBe(5_000);
    const levels = log.runs[0]!.results.map((result) => result.level);
    expect(levels.filter((level) => level === 'error').length).toBe(20);
    expect(levels[0]).toBe('error');
    expect(levels.at(-1)).toBe('note');
  });

  it('caps rule tags at 20 (GitHub hard limit; only 10 are displayed)', () => {
    // https://docs.github.com/en/code-security/reference/code-scanning/sarif-files/sarif-support
    // Tags per rule: maximum 20; only 10 tags will be included in the UI.
    const tags = Array.from({ length: 30 }, (_, i) => `tag-${i}`);
    const log = JSON.parse(
      toSarif(
        report([
          finding({
            ruleId: 'image-alt',
            selector: 'img.hero',
            tags,
            wcag: [
              { number: '1.1.1', name: 'Non-text Content', level: 'A', wcag: '2.1' },
              { number: '4.1.2', name: 'Name, Role, Value', level: 'A', wcag: '2.1' },
            ],
          }),
        ]),
      ),
    ) as SarifLog;
    validateSarif(log);
    const ruleTags = log.runs[0]!.tool.driver.rules[0]!.properties as { tags: string[] };
    expect(ruleTags.tags.length).toBeLessThanOrEqual(GITHUB_SARIF_LIMITS.maxTagsPerRule);
    expect(ruleTags.tags).toEqual(['accessibility', 'WCAG 1.1.1', 'WCAG 4.1.2', ...tags.slice(0, 17)]);
    expect(ruleTags.tags).toHaveLength(20);
  });

  it('caps runs per file at 20', () => {
    // https://docs.github.com/en/code-security/reference/code-scanning/sarif-files/sarif-support
    // Runs per file: maximum 20.
    const findings = Array.from({ length: 25 }, (_, i) =>
      finding({
        ruleId: 'image-alt',
        selector: `img.${i}`,
        engines: [`engine-${i}`],
        confidence: { confirmedBy: 1, enginesRan: 1, agreement: 1 },
        fingerprint: `image-alt|img.${i}|/`,
      }),
    );
    const log = JSON.parse(toSarif(report(findings))) as SarifLog;
    validateSarif(log);
    expect(log.runs.length).toBe(GITHUB_SARIF_LIMITS.maxRunsPerFile);
  });


  it('rewrites page URLs to repo-relative paths so GitHub does not reject the https scheme', () => {
    // GitHub code scanning relativizes artifact URIs against the Actions
    // checkout (file://). An https page URL is rejected:
    // "SARIF URI scheme \"https\" did not match the checkout URI scheme \"file\"".
    // https://github.com/github/codeql-action/issues/754
    // https://docs.github.com/en/code-security/reference/code-scanning/sarif-files/sarif-support
    const page = finding({ ruleId: 'image-alt', selector: 'img.hero', pageUrl: 'https://demo.shop/products?q=1' });
    const mapped = finding({
      ...page,
      source: { file: 'app/hero.tsx', startLine: 24, startColumn: 5 },
    });
    expect(githubArtifactUri(page)).toBe('a11ygate-pages/demo.shop/products/index-b4811faa.html');
    expect(githubArtifactUri(page)).not.toMatch(/^[a-zA-Z][a-zA-Z0-9+.-]*:/);
    expect(githubArtifactUri(mapped)).toBe('app/hero.tsx');

    const log = JSON.parse(toSarif(report([page, mapped]))) as SarifLog;
    validateSarif(log);
    const uris = log.runs.flatMap((run) =>
      run.results.flatMap((result) => result.locations.map((location) => location.physicalLocation.artifactLocation.uri)),
    );
    expect(uris.some((uri) => uri.startsWith('https:'))).toBe(false);
    expect(uris).toEqual(expect.arrayContaining(['a11ygate-pages/demo.shop/products/index-b4811faa.html', 'app/hero.tsx']));
    const urlFinding = log.runs[0]!.results.find((result) => result.properties.pageUrl === 'https://demo.shop/products?q=1')!;
    expect(urlFinding.locations[0]!.logicalLocations[1]!.fullyQualifiedName).toBe('https://demo.shop/products?q=1');
    expect(urlFinding.message.text).toContain('https://demo.shop/products?q=1');
  });

  it('shrinks a SARIF payload until the gzip size is under GitHub’s 10 MB cap', () => {
    // https://docs.github.com/en/code-security/reference/code-scanning/sarif-files/troubleshoot-sarif-uploads/file-too-large
    // "For each gzip-compressed SARIF file, SARIF upload supports a maximum size of 10 MB."
    expect(GITHUB_SARIF_LIMITS.maxGzipBytes).toBe(10 * 1024 * 1024);
    const noise = (seed: string, length = 8000) => {
      let out = '';
      let block = seed;
      while (out.length < length) {
        block = createHash('sha256').update(block).digest('hex');
        out += block;
      }
      return out.slice(0, length);
    };
    const important = finding({
      ruleId: 'image-alt',
      selector: 'img.hero',
      impact: 'critical',
      fingerprint: 'image-alt|img.hero|/',
    });
    const bulkyFindings = [important, ...[0, 1, 2].map((i) =>
      finding({
        ruleId: 'color-contrast',
        selector: `.huge-${i}`,
        html: noise(`html-${i}`),
        help: `contrast help ${noise(`help-${i}`, 2000)}`,
        fingerprint: `color-contrast|.huge-${i}|/`,
        impact: 'minor',
      }),
    )];
    const overBudget = toSarif(report(bulkyFindings));
    expect(gzipByteLength(overBudget)).toBeGreaterThan(2000);

    const limited = toSarif(report(bulkyFindings), {
      limits: { maxGzipBytes: 2000 },
    });
    expect(gzipByteLength(limited)).toBeLessThanOrEqual(2000);
    const log = JSON.parse(limited) as SarifLog;
    validateSarif(log);
    expect(log.runs[0]!.results.some((result) => result.ruleId === 'image-alt')).toBe(true);
    const notes = log.runs[0]!.results.filter((result) => result.level === 'note');
    expect(notes.length).toBeLessThan(3);
  });
});
