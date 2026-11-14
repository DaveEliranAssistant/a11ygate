import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseInteractionConfig, parseInteractionStates, scanInteractionStates, type InteractionState } from '@/lib/scan/interactions';
import { buildScanReport, groupByCriterion, groupBySeverity } from '@/lib/scan/report';
import { normalizeAxeResults } from '@/lib/scan/engines/normalized';
import { runScan } from '@/packages/cli/src/scan';
import { configProblems, parseConfigYaml } from '@/packages/cli/src/config-schema';
import { loadEffectiveConfig } from '@/packages/cli/src/effective-config';
import type { AxeResults } from '@/lib/types';
import type { PageRecord } from '@/lib/scan/crawl';
import type { Page } from 'playwright';

const state: InteractionState = { route: '/pricing', name: 'dialog-open', steps: [{ action: 'click', selector: '#open-dialog' }, { action: 'wait', selector: 'dialog[open]' }] };
const issue = (url: string, impact: 'minor' | 'serious' = 'serious'): AxeResults => ({ url, timestamp: '2026-01-01T00:00:00.000Z', testEngine: { version: '4.11.1' }, violations: [{ id: 'image-alt', impact, tags: ['wcag111'], help: 'Images need alternatives', helpUrl: 'https://example.test/rule', nodes: [{ target: ['#dialog-issue'], html: '<img id="dialog-issue">' }] }] });
const record = (url: string, result?: AxeResults): PageRecord => ({ url, finalUrl: url, status: 200, scanStatus: 'complete', ...(result ? { result } : {}) });
const report = (pages: PageRecord[]) => buildScanReport({ crawl: { pages, skipped: [] }, version: 'test', scannedAt: '2026-01-01T00:00:00Z', startUrl: 'http://fixture.test/pricing', failOn: 'serious', maxPages: 1, delayMs: 0, userAgent: 'test', robotsNote: '', interactions: true });

it('deduplicates the same issue across base and states before totals and grouping, retaining highest severity and state labels', () => {
  const url = 'http://fixture.test/pricing';
  const result = report([record(url, issue(url, 'minor')), record(url + '#dialog-open', issue(url + '#dialog-open')), record(url + '#dialog-again', issue(url + '#dialog-again'))]);
  expect(result.counts.findings).toBe(1);
  expect(result.counts.byImpact.serious).toBe(1);
  expect(result.findings[0].states).toEqual([url + '#dialog-open', url + '#dialog-again']);
  expect(result.sharedComponentGroups?.[0].findingCount).toBe(1);
  expect(groupByCriterion(result.findings)[0].findings).toHaveLength(1);
  expect(groupBySeverity(result.findings)[0].findings).toHaveLength(1);
  expect(result.results).toHaveLength(3); // independent raw evidence retained
});

it('merges multi-engine state observations without inflating confidence or shared grouping', () => {
  const url = 'http://fixture.test/pricing';
  const urls = [url, url + '#dialog-open', url + '#dialog-again'];
  const result = buildScanReport({ crawl: { pages: urls.map(u => record(u, issue(u))), skipped: [] }, version: 'test', scannedAt: '2026-01-01T00:00:00Z', startUrl: url, failOn: 'serious', maxPages: 1, delayMs: 0, userAgent: 'test', robotsNote: '', interactions: true,
    engineResults: urls.flatMap(u => ['axe', 'ibm'].map(engine => ({ url: u, engine, status: 'complete' as const, findings: normalizeAxeResults(issue(u)).map(f => ({ ...f, engine })) }))) });
  expect(result.counts.findings).toBe(1);
  expect(result.findings[0].states).toEqual(urls.slice(1));
  expect(result.findings[0].confidence).toEqual({ confirmedBy: 2, enginesRan: 2, agreement: 1 });
  expect(result.pages.map(p => p.findings)).toEqual([1, 1, 1]);
  expect(result.sharedComponentGroups?.[0].findingCount).toBe(1);
});

it('failed steps produce skipped state records with the failing step and reason, and incomplete coverage', async () => {
  const page = { url: () => 'http://fixture.test/pricing', goto: async () => ({ ok: () => true }), locator: () => ({ waitFor: async () => { throw Error('Selector was not visible'); } }) } as unknown as Page;
  const records = await scanInteractionStates(page, 'http://fixture.test/pricing', { states: [state], auto: false, budget: 2 }, async () => { throw Error('must not scan'); }, () => {}, 100);
  expect(records[0]).toMatchObject({ url: 'http://fixture.test/pricing#dialog-open', scanStatus: 'skipped', error: 'Step 1: Selector was not visible' });
  expect(report([record('http://fixture.test/pricing'), ...records]).verdict).toBe('ERROR');
});

it('counts wait steps and reports budget exhaustion without scanning partial states', async () => {
  let waits = 0;
  const page = { url: () => 'http://fixture.test/pricing', goto: async () => ({ ok: () => true }), locator: () => ({ waitFor: async () => { waits++; } }) } as unknown as Page;
  const steps = [{ action: 'wait' as const, selector: '#ready' }, { action: 'wait' as const, selector: '#other' }];
  const records = await scanInteractionStates(page, 'http://fixture.test/pricing', { states: [{ ...state, steps }], auto: false, budget: 1 }, async () => { throw Error('must not scan'); }, () => {}, 100);
  expect(waits).toBe(1);
  expect(records[0].error).toBe('Step 2: Interaction step budget exhausted.');
});

it('validates actions, labels, required keys, duplicate names and bounded plans', () => {
  expect(parseInteractionStates([state])).toEqual([state]);
  for (const value of [[{ ...state, name: 'auto-1' }], [state, state], [{ ...state, route: '//external.test' }], [{ ...state, steps: [{ action: 'type', selector: '#x' }] }], [{ ...state, steps: [{ action: 'press', selector: '#x' }] }]]) expect(() => parseInteractionStates(value)).toThrow();
  expect(configProblems('interactions:\n  - route: /pricing\n    name: open\n    steps:\n      - action: press\n        selector: "#open-dialog"\n')).not.toEqual([]);
});

it('loads nested YAML state lists and resolves CLI file > env > YAML without starting a browser', async () => {
  const yaml = 'interactions:\n  - route: /pricing\n    name: dialog-open\n    steps:\n      - action: click\n        selector: "#open-dialog"\n      - action: wait\n        selector: "dialog[open]"\n';
  expect(parseConfigYaml(yaml)).toEqual({ ok: true, value: { interactions: [state] } });
  expect(configProblems(yaml)).toEqual([]);
  const cwd = await mkdtemp(path.join(tmpdir(), 'r37-config-'));
  try {
    await writeFile(path.join(cwd, 'states.json'), JSON.stringify([state]));
    const config = loadEffectiveConfig('scan', ['--interactions', 'states.json'], { cwd, repoConfig: yaml, env: { A11YGATE_INTERACTIONS: '[]' } });
    expect(config.values.interactions).toEqual([state]);
    expect(config.sources.interactions).toBe('flag:--interactions');
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

it('validates bounded nested auto settings and resolves YAML, env and local JSON', async () => {
  const value = { auto: { depth: 2, maxStates: 3 } };
  expect(parseInteractionConfig(value)).toEqual(value);
  for (const auto of [{ depth: 0 }, { depth: 4 }, { depth: 1.5 }, { maxStates: 0 }, { maxStates: 101 }, { maxStates: '2' }, { unknown: 1 }]) {
    expect(() => parseInteractionConfig({ auto })).toThrow();
    expect(configProblems('interactions:\n  auto:\n' + Object.entries(auto).map(([k, v]) => `    ${k}: ${JSON.stringify(v)}\n`).join(''))).not.toEqual([]);
  }
  const yaml = 'interactions:\n  auto:\n    depth: 2\n    maxStates: 3\n';
  expect(configProblems(yaml)).toEqual([]);
  expect(loadEffectiveConfig('scan', [], { repoConfig: yaml, env: {} }).values.interactions).toEqual(value);
  expect(loadEffectiveConfig('scan', [], { repoConfig: null, env: { A11YGATE_INTERACTIONS: JSON.stringify(value) } }).values.interactions).toEqual(value);
  expect(loadEffectiveConfig('scan', ['--interactions', JSON.stringify(value)], { repoConfig: null, env: {} }).values.interactions).toEqual(value);
});

// Normal npm test never launches Chromium. Run explicitly with A11YGATE_BROWSER_TESTS=1.
describe.skipIf(process.env.A11YGATE_BROWSER_TESTS !== '1')('local SPA browser acceptance', () => {
  let server: Server | undefined;
  afterEach(async () => { await new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve()); server = undefined; });
  async function fixture(file = 'tests/fixtures/spa-interactions/index.html') {
    const html = await readFile(file, 'utf8');
    const requests: string[] = [];
    server = createServer((req, res) => { requests.push(req.url!); res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/pricing`;
    async function scan(flags: string[]) {
      let output = ''; let errors = '';
      const code = await runScan([url, '--ignore-robots', '--delay-ms', '0', '--json', '-', ...flags], { env: { NODE_ENV: 'test' }, stdout: s => { output += s; }, stderr: s => { errors += s; } });
      expect(output, errors).not.toBe('');
      return { code, report: JSON.parse(output) as ReturnType<typeof report> };
    }
    return { url, requests, scan };
  }
  it('finds only nested issues at depth 2, records paths, resets branches, and enforces maxStates', async () => {
    const { url, requests, scan } = await fixture('tests/fixtures/spa-interactions/nested.html');
    const run = (depth: number, maxStates = 20) => scan(['--interactions', JSON.stringify({ auto: { depth, maxStates } }), '--interaction-budget', '100']);
    const shallow = await run(1);
    expect(shallow.report.findings.some(f => f.selector === '#nested-issue')).toBe(false);
    const deep = await run(2);
    expect(deep.report.findings.find(f => f.selector === '#nested-issue')?.states?.map(decodeURI)).toEqual([url + '#menu>submenu-2']);
    expect(deep.report.pages.some(p => decodeURI(p.url).endsWith('#menu>submenu-2>third'))).toBe(false);
    expect((await run(3)).report.pages.some(p => decodeURI(p.url).endsWith('#menu>submenu-2>third'))).toBe(true);
    const limited = await run(2, 2);
    expect(limited.report.pages.filter(p => p.url.includes('#'))).toHaveLength(2);
    expect(deep.report.findings.some(f => f.selector === '#contaminated')).toBe(false);
    expect(deep.report.pages.filter(p => p.error?.includes('Destructive-looking'))).toHaveLength(5);
    const explicit = await scan(['--interactions', JSON.stringify([{ route: '/pricing', name: 'unsafe-child', steps: [{ action: 'click', selector: '#danger-child' }] }])]);
    expect(explicit.report.pages.at(-1)?.error).toContain('Destructive-looking');
    expect(requests.some(p => /danger|external|submitted/.test(p))).toBe(false);
  }, 120_000);
  it('preserves the complete R37 depth 1 output with explicit defaults', async () => {
    const { scan } = await fixture();
    const legacy = await scan(['--auto-interactions']);
    const configured = await scan(['--interactions', JSON.stringify({ auto: { depth: 1, maxStates: 20 } })]);
    // Runtime timestamps and durations are nondeterministic; all report evidence and labels must match.
    const stable = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (key, v) => /timestamp|scannedAt|durationMs/.test(key) ? undefined : v));
    expect(stable(configured)).toEqual(stable(legacy));
  }, 120_000);
  it('only detects the planted dialog issue after interaction, labels it, and dedupes repeated states', async () => {
    const { url, scan } = await fixture();
    const base = await scan([]);
    expect(base.report.findings.some(f => f.selector === '#dialog-issue')).toBe(false);
    const opened = await scan(['--interactions', JSON.stringify([state, { ...state, name: 'dialog-again' }])]);
    const findings = opened.report.findings.filter(f => f.selector === '#dialog-issue' && f.ruleId === 'image-alt');
    expect(findings).toHaveLength(1);
    expect(findings[0].pageUrl).toBe(url + '#dialog-open');
    expect(findings[0].states).toEqual([url + '#dialog-open', url + '#dialog-again']);
    expect(opened.code).toBe(1);
  }, 60_000);
  it('auto mode respects budget and never submits forms or follows links, scripted navigation or popups', async () => {
    const { requests, scan } = await fixture();
    const limited = await scan(['--auto-interactions', '--interaction-budget', '1']);
    expect(limited.report.pages.filter(p => p.url.includes('#auto-'))).toHaveLength(1);
    expect(limited.report.findings.some(f => f.selector === '#dialog-issue')).toBe(true);
    const all = await scan(['--auto-interactions', '--interaction-budget', '10']);
    expect(all.report.pages.filter(p => p.url.includes('#auto-')).length).toBeLessThanOrEqual(10);
    expect(all.report.pages.some(p => p.error?.includes('Submit/reset'))).toBe(true);
    expect(all.report.pages.some(p => p.error?.includes('Links'))).toBe(true);
    expect(requests.some(p => /submitted|external|followed|popup/.test(p))).toBe(false);
  }, 60_000);
  it('runs menu/tab/accordion and keyboard steps and reports a missing-selector state as skipped', async () => {
    const { scan } = await fixture();
    const states: InteractionState[] = ['menu', 'tab', 'accordion'].map(name => ({ route: '/pricing', name: name + '-open', steps: [{ action: 'press', selector: '#' + name, key: 'Enter' }, { action: 'wait', selector: '#' + name + '-panel' }] }));
    states.push({ route: '/pricing', name: 'missing', steps: [{ action: 'click', selector: '#missing' }] });
    const result = await scan(['--interactions', JSON.stringify(states)]);
    expect(result.report.pages.filter(p => p.scanStatus === 'complete')).toHaveLength(4);
    expect(result.report.pages.at(-1)).toMatchObject({ scanStatus: 'skipped', error: expect.stringContaining('Step 1:') });
    expect(result.code).toBe(2);
  }, 60_000);
});
