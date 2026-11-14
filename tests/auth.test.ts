import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanMarkdown, scanHtml, type ScanReport } from '@/lib/scan/report';
import { renderScanHtml } from '@/lib/scan/report-html-v2';
import { AuthRedactor } from '@/lib/scan/redact';
import { envMapping, prepareAuth } from '@/packages/cli/src/auth';
import { parseScanArgs, runScan } from '@/packages/cli/src/scan';
import { doctorChecks } from '@/packages/cli/src/doctor';
import { blockNetwork } from './network-guard';

const noRobots = async () => ({ ok: false, status: 404, text: async () => '' });

describe('authentication configuration (no browser or network)', () => {
  it('counts not-authenticated pages separately in JSON, Markdown and both HTML summaries', async () => {
    const network = blockNetwork();
    let output = '';
    try {
      const code = await runScan(['https://site.test/', '--auth-check-must-have-selector', '#member', '--crawl', '3', '--delay-ms', '0', '--fail-on', 'none', '--json', '-'], {
        env: { NODE_ENV: 'test' }, fetch: noRobots, stdout: text => { output += text; }, stderr: () => {},
        engine: async ({ auth }) => {
          expect(auth?.check).toEqual({ mustHaveSelector: '#member' });
          return {
            visit: async url => url === 'https://site.test/' ? {
              status: 200, finalUrl: url, links: ['https://site.test/next', 'https://site.test/last'],
              result: { url, timestamp: '2026-11-14T00:00:00Z', testEngine: { version: '4' }, violations: [] },
            } : { status: 200, finalUrl: url, links: [], notAuthenticated: true, error: 'Not authenticated: explicit auth.check failed.' },
            close: async () => {},
          };
        },
      });
      expect(code).toBe(2);
      const report: ScanReport = JSON.parse(output);
      expect(report.counts).toMatchObject({ pagesScanned: 1, pagesFailed: 0, pagesNotAuthenticated: 2 });
      expect(report.results).toHaveLength(1);
      expect(report.pages.slice(1).map(page => page.scanStatus)).toEqual(['not-authenticated', 'not-authenticated']);
      for (const rendered of [scanMarkdown(report), scanHtml(report), renderScanHtml(report)]) expect(rendered).toContain('not authenticated: 2');
      expect(network.attempts).toEqual([]);
    } finally { network.restore(); }
  });

  it('doctor warns for auth without a check and accepts explicit checks', async () => {
    const network = blockNetwork();
    try {
      for (const hasCheck of [false, true]) {
        const findings = await doctorChecks({}, { env: {}, repoConfig: 'auth:\n  cookieEnv: [session=SESSION]\n' + (hasCheck ? '  check:\n    mustHaveSelector: "#member"\n' : ''), head: () => null, chromium: () => true, hasPackage: () => true });
        expect(findings.find(f => f.check === 'auth-screenshots')?.message).toContain('--no-screenshots');
        expect(findings.find(f => f.check === 'auth')).toMatchObject({ status: hasCheck ? 'pass' : 'unknown', message: expect.stringContaining(hasCheck ? 'Explicit auth.check' : 'without auth.check') });
      }
      expect(network.attempts).toEqual([]);
    } finally { network.restore(); }
  });

  it('rejects off-origin probe URLs before launching the browser', async () => {
    for (const url of ['https://other.test/', '//other.test/', 'https://user:pass@site.test/']) {
      await expect(prepareAuth({ authCheck: { url } }, '.', 'https://site.test', { NODE_ENV: 'test' })).rejects.toThrow('auth.check.url must be on the scan origin');
    }
  });

  it('accepts repeatable environment names and rejects literal credentials', () => {
    expect(parseScanArgs(['https://site.test', '--storage-state', 'state.json', '--session-storage=session.json', '--login-script=login.mjs', '--login-timeout-ms', '1200', '--cookie-env', 'session=TEST_SESSION', '--cookie-env', 'csrf=TEST_CSRF', '--header-env', 'Authorization=TEST_AUTH'])).toMatchObject({
      ok: true, options: { storageState: 'state.json', sessionStorage: 'session.json', loginScript: 'login.mjs', loginTimeoutMs: 1200, cookieEnv: ['session=TEST_SESSION', 'csrf=TEST_CSRF'], headerEnv: ['Authorization=TEST_AUTH'] },
    });
    for (const args of [['--cookie-env', 'session=literal value'], ['--header-env', 'Authorization=Bearer value'], ['--login-timeout-ms', '0'], ['--login-timeout-ms', '300001']]) {
      expect(parseScanArgs(['https://site.test', ...args]).ok).toBe(false);
    }
    expect(envMapping('session=SECRET_NAME')).toEqual({ name: 'session', env: 'SECRET_NAME' });
  });

  it('validates and redacts sessionStorage files without echoing invalid input', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'a11ygate-session-unit-'));
    const secret = randomBytes(24).toString('hex');
    try {
      const entry = { origin: 'https://site.test', sessionStorage: [{ name: 'session', value: secret }] };
      await writeFile(path.join(dir, 'session.json'), JSON.stringify({ origins: [entry] }));
      const auth = await prepareAuth({ sessionStorage: 'session.json' }, dir, 'https://site.test', { NODE_ENV: 'test' });
      expect(auth.sessionStorage?.origins.length).toBe(1);
      expect(auth.redactor.text(secret).includes(secret)).toBe(false);
      for (const state of [null, {}, { origins: [entry, entry] }, { origins: [{ ...entry, origin: 'https://site.test/path' }] }, { origins: [{ ...entry, sessionStorage: [{ name: 'session', value: 1 }] }] }]) {
        await writeFile(path.join(dir, 'session.json'), JSON.stringify(state));
        await expect(prepareAuth({ sessionStorage: 'session.json' }, dir, 'https://site.test', { NODE_ENV: 'test' })).rejects.toThrow('Could not read --session-storage: expected JSON');
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('fails closed on unset environment names without echoing their values', async () => {
    await expect(prepareAuth({ cookieEnv: ['session=MISSING'] }, '.', 'https://site.test', { NODE_ENV: 'test' })).rejects.toThrow('Missing environment variable');
    await expect(prepareAuth({ headerEnv: ['Cookie=TEST_VALUE'] }, '.', 'https://site.test', { NODE_ENV: 'test', TEST_VALUE: 'not-a-real-credential' })).rejects.toThrow('Unsupported injected header');
  });

  it('registers bearer and basic credentials even with neutral environment names', async () => {
    const secret = randomBytes(16).toString('hex');
    for (const value of [`Bearer ${secret}`, `Basic ${Buffer.from('test-user:' + secret).toString('base64')}`]) {
      const auth = await prepareAuth({ headerEnv: ['Authorization=VALUE'] }, '.', 'https://site.test', { NODE_ENV: 'test', VALUE: value });
      expect(auth.redactor.text(secret).includes(secret)).toBe(false);
    }
    const auth = await prepareAuth({}, '.', 'https://site.test', { NODE_ENV: 'test', TEST_PASSWORD: 'xyz' });
    expect(auth.redactor.text('xyz')).toBe('[REDACTED]');
  });

  it('redacts short, encoded, escaped and structured credentials', () => {
    const secret = randomBytes(20).toString('hex') + '+/<>&"';
    const redact = new AuthRedactor();
    redact.add(secret);
    const stateSecret = randomBytes(20).toString('hex');
    redact.storage({ cookies: [{ value: stateSecret }], origins: [{ localStorage: [{ value: 'local-storage-value' }] }] });
    const output = JSON.stringify(redact.object({
      html: `<img data-session='${secret}'>`, url: `https://site.test/?token=${encodeURIComponent(secret)}`,
      native: { cookies: [{ value: 'unknown-cookie' }], authorization: 'unknown-auth', accessToken: 'unknown-token' },
      other: [stateSecret, 'local-storage-value'], [secret]: secret,
    }));
    for (const value of [secret, encodeURIComponent(secret), stateSecret, 'local-storage-value', 'unknown-cookie', 'unknown-auth', 'unknown-token']) expect(output.includes(value)).toBe(false);
    expect(redact.text('Authorization: Bearer opaque\nCookie: session=opaque')).not.toContain('opaque');
    const short = new AuthRedactor();
    short.add('x');
    expect(short.text('x')).toBe('[REDACTED]');
  });

  it('redacts every writer and native evidence, including names unrelated to secrets', async () => {
    const network = blockNetwork();
    const dir = await mkdtemp(path.join(tmpdir(), 'a11ygate-auth-unit-'));
    const secret = randomBytes(24).toString('hex');
    let logs = '';
    try {
      const code = await runScan(['https://site.test', '--cookie-env', 'session=VALUE', '--out-dir', 'out', '--format', 'junit,sarif,gitlab-codequality'], {
        cwd: dir, env: { NODE_ENV: 'test', VALUE: secret }, fetch: noRobots,
        stdout: s => { logs += s; }, stderr: s => { logs += s; },
        engine: async ({ auth }) => {
          expect(auth?.cookies[0]?.value === secret).toBe(true);
          return {
            visit: async url => ({ status: 200, finalUrl: url, links: [], result: {
              url, timestamp: new Date().toISOString(), testEngine: { version: '4' }, toolOptions: {}, scanConfig: {}, scanStatus: 'complete',
              violations: [{ id: 'image-alt', impact: 'critical', tags: ['wcag111'], help: secret, helpUrl: `https://site.test/?token=${secret}`, nodes: [{ target: ['img'], html: `<img data-session="${secret}">` }] }],
            } }),
            rawEngineResults: [{ engine: 'axe', url: 'https://site.test', status: 'complete', native: { echoed: secret, cookies: [{ value: secret }] } }],
            close: async () => undefined,
          };
        },
      });
      expect(code).toBe(1);
      expect(logs.includes(secret)).toBe(false);
      for (const folder of ['out', 'out/engines']) for (const file of await readdir(path.join(dir, folder), { withFileTypes: true })) {
        if (file.isFile()) expect((await readFile(path.join(dir, folder, file.name), 'utf8')).includes(secret), file.name).toBe(false);
      }
      expect(network.attempts).toEqual([]);
    } finally { network.restore(); await rm(dir, { recursive: true, force: true }); }
  });

  it.each(['storage-state', 'session-storage'])('never overwrites a %s input through an output alias', async flag => {
    const dir = await mkdtemp(path.join(tmpdir(), 'a11ygate-auth-alias-'));
    try {
      const state = JSON.stringify({ cookies: [], origins: [] });
      await writeFile(path.join(dir, 'state.json'), state);
      const code = await runScan(['https://site.test', '--' + flag, 'state.json', '--json', 'state.json'], {
        cwd: dir, stdout: () => {}, stderr: () => {}, fetch: noRobots,
        engine: async () => ({ visit: async url => ({ status: 401, finalUrl: url, links: [], error: 'Not authenticated: access denied.' }), close: async () => {} }),
      });
      expect(code).toBe(2);
      expect(await readFile(path.join(dir, 'state.json'), 'utf8')).toBe(state);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
