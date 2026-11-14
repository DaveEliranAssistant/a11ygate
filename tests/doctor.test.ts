import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { doctorChecks, formatDoctor, runDoctor, type DoctorIo } from '@/packages/cli/src/doctor';
import { blockNetwork } from './network-guard';
let guard: ReturnType<typeof blockNetwork>;
beforeEach(() => { guard = blockNetwork(); });
afterEach(() => { expect(guard.attempts).toEqual([]); guard.restore(); });
const clean: DoctorIo = { env: {}, nodeVersion: '22.1.0', head: () => 'head', repoConfig: null, hasPackage: () => true, chromium: () => true };
const modelEnv = { GITHUB_REPOSITORY: 'owner/repo', GITHUB_TOKEN: 'secret-never-print', A11YGATE_MODEL_FIXES: 'on', A11YGATE_MODEL_PROVIDERS: 'stub', A11YGATE_GITHUB_PERMISSIONS: JSON.stringify({ contents: 'write', issues: 'write', 'pull-requests': 'write' }) };
const model: DoctorIo = { ...clean, repoConfig: 'modelFixes: true', env: modelEnv };
const check = async (id: string, io: DoctorIo, options = {}) => (await doctorChecks(options, io)).find(f => f.check === id)!;
const fakeApi = (setting = true) => vi.fn<typeof fetch>(async (url) => new Response(JSON.stringify(String(url).endsWith('/workflow') ? { can_approve_pull_request_reviews: setting } : {}), { status: 200 }));
describe('doctor preflight (no browser or network)', () => {
  it('detects a checkout different from PR head, using git HEAD rather than GITHUB_SHA', async () => {
    const finding = await check('checkout', { ...clean, env: { A11Y_HEAD_SHA: 'pr-head', GITHUB_SHA: 'head' } });
    expect(finding.status).toBe('fail');
    expect(finding.message).toContain('stale');
    expect(finding.link).toContain('#doctor-checkout');
  });
  it('detects missing mode-specific permissions from a supplied context', async () => {
    const finding = await check('permissions', { ...clean, env: { GITHUB_REPOSITORY: 'owner/repo', A11Y_COMMENT: 'true', GITHUB_TOKEN_PERMISSIONS: '{"contents":"read"}' } });
    expect(finding.status).toBe('fail');
    expect(finding.message).toContain('issues: write');
    expect(finding.message).toContain('pull-requests: write');
  });
  it('detects a 403 from the read-only repo probe without printing secrets or response bodies', async () => {
    const api = vi.fn<typeof fetch>(async () => new Response('secret-never-print', { status: 403 }));
    const findings = await doctorChecks({}, { ...model, fetch: api });
    expect(findings.find(f => f.check === 'permissions')?.status).toBe('fail');
    expect(findings.find(f => f.check === 'pr-creation')?.status).toBe('unknown');
    expect(formatDoctor(findings)).not.toContain('secret-never-print');
    expect(formatDoctor(findings)).toContain('does not prove PR creation is disabled');
  });
  it('detects disabled Actions PR creation through the documented read-only setting', async () => {
    const api = fakeApi(false);
    const finding = await check('pr-creation', { ...model, fetch: api });
    expect(finding.status).toBe('fail');
    expect(finding.message).toContain('Only the owner');
    expect(api.mock.calls.map(([url]) => url)).toEqual(['https://api.github.com/repos/owner/repo', 'https://api.github.com/repos/owner/repo/actions/permissions/workflow']);
    for (const [, init] of api.mock.calls) {
      expect(init?.method).toBe('GET');
      expect(init?.body).toBeUndefined();
      expect(init?.redirect).toBe('error');
    }
  });
  it('detects missing Playwright/Chromium without importing or launching Playwright in vitest', async () => {
    expect((await check('browser', { ...clean, chromium: () => false })).status).toBe('fail');
  });
  it('detects unsupported Node and accepts the supported minimum', async () => {
    expect((await check('node', { ...clean, nodeVersion: '18.20.0' })).status).toBe('fail');
    expect((await check('node', { ...clean, nodeVersion: '20.0.0' })).status).toBe('pass');
  });
  it('checks only requested optional engine peers from flags or config', async () => {
    const io = { ...clean, hasPackage: (name: string) => name === '@axe-core/playwright' };
    expect((await check('engines', io)).status).toBe('pass');
    expect((await check('engines', io, { engines: ['axe', 'lighthouse'] })).message).toContain('lighthouse, puppeteer-core');
    expect((await check('engines', { ...io, repoConfig: 'engines: [axe, ibm]' })).message).toContain('accessibility-checker-engine');
    expect((await check('engines', { ...io, repoConfig: 'engines:\n  - axe\n  - htmlcs\n' })).message).toContain('html_codesniffer');
  });
  it('detects model fixes without an allowlisted configured provider and allows explicit stub', async () => {
    const io = { ...model, env: { A11YGATE_MODEL_FIXES: 'on' } };
    expect((await check('provider', io)).status).toBe('fail');
    expect((await check('provider', { ...io, env: { ...io.env, A11YGATE_MODEL_PROVIDERS: 'stub' } })).status).toBe('pass');
    expect((await check('provider', { ...io, env: { ...io.env, A11YGATE_MODEL_PROVIDERS: 'groq', GROQ_API_KEY: 'fake', A11YGATE_MODEL_GROQ_MODEL: 'test-model' } })).status).toBe('pass');
    expect((await check('provider', { ...io, repoConfig: null })).status).toBe('skipped');
  });
  it('defaults to exit zero and fails with strict only when a check fails', async () => {
    const stdout = vi.fn();
    const io = { ...clean, nodeVersion: '18.0.0', stdout };
    expect(await runDoctor([], io)).toBe(0);
    expect(await runDoctor(['--strict'], io)).toBe(1);
    expect(await runDoctor(['--strict'], { ...clean, stdout })).toBe(0);
  });
  it('links every check to an existing section and passes a fully configured PR environment', async () => {
    const findings = await doctorChecks({}, {
      ...model,
      env: { ...modelEnv, A11Y_HEAD_SHA: 'head' },
      fetch: fakeApi(),
    });
    expect(findings.every(f => f.status === 'pass')).toBe(true);
    const guide = readFileSync('docs/integrations/github-action.md', 'utf8');
    for (const finding of findings) {
      expect(guide).toContain(`id="${finding.link.split('#')[1]}"`);
    }
  });
  it('prints the all checks passed snapshot in a clean environment', async () => {
    expect(formatDoctor(await doctorChecks({}, clean))).toMatchSnapshot();
  });
  it('never probes another repo, a custom API origin, redirects, or provider services', async () => {
    for (const env of [{ ...modelEnv, GITHUB_REPOSITORY: '../other' }, { ...modelEnv, GITHUB_API_URL: 'https://elsewhere.invalid' }, { ...modelEnv, GITHUB_TOKEN: undefined }]) {
      const api = fakeApi();
      await doctorChecks({}, { ...model, env, fetch: api });
      expect(api).not.toHaveBeenCalled();
    }
  });
  it('leaves unknown write scopes unknown even after a successful read', async () => {
    const findings = await doctorChecks({}, { ...model, env: { ...modelEnv, A11YGATE_GITHUB_PERMISSIONS: undefined, ACTIONS_RUNTIME_TOKEN: 'not-a-repo-permission-signal' }, fetch: fakeApi() });
    expect(findings.find(f => f.check === 'permissions')?.status).toBe('unknown');
    expect(formatDoctor(findings)).not.toContain('All checks passed');
  });
  it('does not require browsers/engine peers for the JSON-only Action', async () => {
    const findings = await doctorChecks({ browser: false }, { ...clean, chromium: () => { throw Error('must not run'); }, hasPackage: () => false });
    expect(findings.find(f => f.check === 'browser')?.status).toBe('skipped');
    expect(findings.find(f => f.check === 'engines')?.status).toBe('skipped');
  });
  it('reports failed probes without echoing exception text', async () => {
    const findings = await doctorChecks({}, { ...model, fetch: async () => { throw Error('secret-never-print'); } });
    expect(formatDoctor(findings)).not.toContain('secret-never-print');
    expect(findings.find(f => f.check === 'pr-creation')?.status).toBe('unknown');
  });
  it('validates doctor flags and help', async () => {
    const io = { ...clean, stdout: vi.fn(), stderr: vi.fn() };
    for (const args of [['--engines'], ['--engines=wrong'], ['--engines=toString'], ['--engines=__proto__'], ['--model-fixes=on=off'], ['--model-fixes=maybe'], ['--wat']])
      expect(await runDoctor(args, io)).toBe(2);
    expect(await runDoctor(['--help'], io)).toBe(0);
    expect(await runDoctor(['--engines=axe,ibm', '--model-fixes=off'], io)).toBe(0);
  });
});
