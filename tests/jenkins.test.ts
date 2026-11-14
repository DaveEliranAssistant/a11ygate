import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { parseJenkinsJunit } from '@/lib/export-junit';
import { parseScanArgs, runScan, type ScanEngineFactory } from '@/packages/cli/src/scan';
import { minimalResult } from './helpers';
import { validateXML } from 'xmllint-wasm';
import { readFileSync } from 'node:fs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const jenkinsRoot = path.join(repoRoot, 'integrations/jenkins');
const junitXsd = readFileSync(new URL('./schemas/junit-4.xsd', import.meta.url), 'utf8');

const ORIGIN = 'http://127.0.0.1:4173';
const IMAGE_ALT = {
  id: 'image-alt',
  impact: 'serious' as const,
  tags: ['wcag2a', 'wcag111'],
  help: 'Images must have alternative text',
  helpUrl: 'https://dequeuniversity.com/rules/axe/4.14/image-alt',
  nodes: [{ target: ['img'], html: '<img src="product.png" width="200" height="200">' }],
};

function javaMajor(javaHomeOrBin: string): number {
  const bin = javaHomeOrBin.endsWith('java') ? javaHomeOrBin : path.join(javaHomeOrBin, 'bin/java');
  const probe = spawnSync(bin, ['-version'], { encoding: 'utf8' });
  const output = `${probe.stdout}${probe.stderr}`;
  return Number(/version "(\d+)/.exec(output)?.[1] ?? 0);
}

/** JenkinsPipelineUnit 1.31 + Gradle 8.14 need Java 21–24 (not 25 / class-file 69). */
function resolveJava21Home(): string | undefined {
  const candidates = [
    process.env.JAVA_HOME_21_X64,
    process.env.JAVA_HOME_21_arm64,
    process.env.JAVA_HOME,
    '/usr/lib/jvm/temurin-21-jdk-amd64',
    '/usr/lib/jvm/temurin-21-jdk-arm64',
    '/usr/lib/jvm/zulu-21-amd64',
    '/opt/hostedtoolcache/Java_Temurin-Hotspot_jdk/21',
  ].filter((value): value is string => !!value);
  for (const home of candidates) {
    if (existsSync(path.join(home, 'bin/java')) && javaMajor(home) === 21) return home;
  }
  return undefined;
}

describe('Jenkins example pipelines', () => {
  it('the declarative and scripted Jenkinsfiles call a11yGate with the same contract and the disclaimer', async () => {
    const declarative = await readFile(path.join(repoRoot, 'examples/jenkins/Jenkinsfile'), 'utf8');
    const scripted = await readFile(path.join(repoRoot, 'examples/jenkins/Jenkinsfile.scripted'), 'utf8');
    for (const text of [declarative, scripted]) {
      expect(text).toContain("a11yGate(");
      expect(text).toContain('formats: [\'junit\', \'sarif\', \'json\', \'md\']');
      expect(text).toContain("cli: 'node packages/cli/dist/cli.mjs'");
      expect(text).toContain('outDir: \'a11y-results\'');
      expect(text).toContain(AUTOMATED_TESTING_DISCLAIMER);
      expect(text).not.toMatch(/fixes everything|WCAG\/EAA compliant|\bcertified\b|\bguarantee\b/i);
    }
    const step = await readFile(path.join(jenkinsRoot, 'vars/a11yGate.groovy'), 'utf8');
    expect(step).toContain("def call(Map args");
    expect(step).toContain('junit allowEmptyResults: true');
    expect(step).toContain('archiveArtifacts');
    expect(step).toContain("unstable('A11yGate found issues");
    expect(step).toContain(AUTOMATED_TESTING_DISCLAIMER);
  });

  it('scan --format junit,sarif exits 1 on the bad fixture findings and 0 on the clean fixture, with valid reports', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'a11ygate-jenkins-'));
    const quiet = {
      cwd: dir,
      stdout: () => undefined,
      stderr: () => undefined,
      version: '0.1.0',
      fetch: async () => ({ ok: false, status: 404, text: async () => '' }),
      sleep: async () => undefined,
    };
    const badEngine: ScanEngineFactory = async () => ({
      visit: async (url) => ({
        status: 200,
        finalUrl: url,
        contentType: 'text/html',
        links: [],
        result: minimalResult({ url, violations: [IMAGE_ALT] }),
      }),
      close: async () => undefined,
    });
    const cleanEngine: ScanEngineFactory = async () => ({
      visit: async (url) => ({
        status: 200,
        finalUrl: url,
        contentType: 'text/html',
        links: [],
        result: minimalResult({ url, violations: [] }),
      }),
      close: async () => undefined,
    });
    try {
      expect(parseScanArgs([`${ORIGIN}/`, '--format', 'junit,sarif', '--out-dir', 'a11y-results'])).toMatchObject({
        ok: true,
        options: { formats: ['junit', 'sarif'], outDir: 'a11y-results' },
      });
      expect(await runScan([`${ORIGIN}/`, '--out-dir', 'bad', '--format', 'junit,sarif', '--fail-on', 'serious'], { ...quiet, engine: badEngine })).toBe(1);
      expect(await runScan([`${ORIGIN}/`, '--out-dir', 'clean', '--format', 'junit,sarif', '--fail-on', 'serious'], { ...quiet, engine: cleanEngine })).toBe(0);

      const badXml = await readFile(path.join(dir, 'bad/a11ygate-scan.junit.xml'), 'utf8');
      const xsd = await validateXML({ xml: badXml, schema: junitXsd });
      expect(xsd.valid, (xsd.errors ?? []).map((error) => error.message ?? String(error)).join('\n')).toBe(true);
      const badSuite = parseJenkinsJunit(badXml)[0]!;
      expect(badSuite.failures).toBeGreaterThan(0);
      expect(badSuite.properties.disclaimer).toBe(AUTOMATED_TESTING_DISCLAIMER);
      // The step treats CLI exit 1 as UNSTABLE and exit 0 as SUCCESS.
      expect(badSuite.failures > 0).toBe(true);

      const cleanXml = await readFile(path.join(dir, 'clean/a11ygate-scan.junit.xml'), 'utf8');
      const cleanXsd = await validateXML({ xml: cleanXml, schema: junitXsd });
      expect(cleanXsd.valid).toBe(true);
      const cleanSuite = parseJenkinsJunit(cleanXml)[0]!;
      expect(cleanSuite.failures).toBe(0);
      expect(JSON.parse(await readFile(path.join(dir, 'bad/a11ygate-scan.sarif'), 'utf8')).version).toBe('2.1.0');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('JenkinsPipelineUnit (Groovy)', () => {
  it('runs the shared-library parameter tests with Gradle when Java is available', () => {
    const javaHome = resolveJava21Home();
    if (!javaHome) {
      // Gradle 8.14 cannot run on the Java 25 default of some runners (class-file major 69).
      // Use JAVA_HOME_21_X64 or a Java 21 install; the 7 PipelineUnit tests were verified locally on Temurin 21.
      console.warn('Skipping JenkinsPipelineUnit tests: no Java 21 home found.');
      return;
    }
    const result = spawnSync('./gradlew', ['test', '--quiet'], {
      cwd: jenkinsRoot,
      encoding: 'utf8',
      env: { ...process.env, JAVA_HOME: javaHome },
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
  }, 180_000);
});

