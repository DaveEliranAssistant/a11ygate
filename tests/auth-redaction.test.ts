import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasAuthCredentials, prepareAuth } from '@/packages/cli/src/auth';
import { runScan } from '@/packages/cli/src/scan';
import { guardLocalhostNetwork } from './network-guard';

const ORIGIN = 'https://site.test';

describe('hasAuthCredentials (no browser or network)', () => {
  it('is false for an unauthenticated scan, even though prepareAuth always returns an object', async () => {
    const auth = await prepareAuth({}, tmpdir(), ORIGIN, { NODE_ENV: 'test' });
    expect(auth).toBeTruthy();
    expect(hasAuthCredentials(auth)).toBe(false);
    expect(hasAuthCredentials(undefined)).toBe(false);
  });

  it('is false when only auth.check is configured', async () => {
    const auth = await prepareAuth({ authCheck: { mustHaveSelector: '#member' } }, tmpdir(), ORIGIN, { NODE_ENV: 'test' });
    expect(auth.check).toBeDefined();
    expect(hasAuthCredentials(auth)).toBe(false);
  });

  it('is true for each credential or session source', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'a11ygate-auth-'));
    try {
      await writeFile(path.join(dir, 'state.json'), JSON.stringify({ cookies: [{ name: 'sid', value: 'state-secret', url: ORIGIN }], origins: [] }));
      await writeFile(path.join(dir, 'session.json'), JSON.stringify({ origins: [{ origin: ORIGIN, sessionStorage: [{ name: 'token', value: 'session-secret' }] }] }));
      const env = { NODE_ENV: 'test' as const, A11Y_COOKIE: 'cookie-secret', A11Y_HEADER: 'Bearer header-secret' };
      for (const options of [
        { cookieEnv: ['sid=A11Y_COOKIE'] },
        { headerEnv: ['authorization=A11Y_HEADER'] },
        { storageState: 'state.json' },
        { sessionStorage: 'session.json' },
        { loginScript: 'login.mjs' },
      ]) expect(hasAuthCredentials(await prepareAuth(options, dir, ORIGIN, env)), JSON.stringify(options)).toBe(true);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

// Browser integration is deliberately opt-in: npm test never launches Chromium by default.
describe.skipIf(process.env.A11YGATE_CRAWL_BROWSER_TESTS !== '1')('site cookie redaction in a real browser scan', () => {
  let server: Server;
  let origin: string;
  let guard: ReturnType<typeof guardLocalhostNetwork>;
  const noRobots = async () => ({ ok: false, status: 404, text: async () => '' });

  beforeAll(async () => {
    guard = guardLocalhostNetwork();
    server = createServer((req, res) => {
      if (req.url === '/') {
        // A non-secret site cookie whose value also appears in page markup, plus a session cookie the site rotates.
        res.setHeader('set-cookie', ['consent=consent-yes-1; Path=/', 'rotated=rotated-token-456; Path=/']);
        res.setHeader('content-type', 'text/html');
        res.end('<!doctype html><html lang="en"><head><title>Home</title></head><body><main><h1>Home</h1><img src="/consent-yes-1.png"><img src="/rotated-token-456.png"><img src="/injected-session-789.png"></main></body></html>');
        return;
      }
      res.writeHead(404).end();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    guard.restore();
  });

  async function scan(args: string[], env: NodeJS.ProcessEnv): Promise<string> {
    let out = '';
    await runScan([`${origin}/`, '--json=-', '--fail-on', 'none', '--engines', 'axe', ...args], { env, fetch: noRobots, stdout: (s) => { out += s; }, stderr: () => undefined });
    return out;
  }

  it('does not redact site cookies on an unauthenticated scan', async () => {
    const out = await scan([], { NODE_ENV: 'test' });
    expect(out).toContain('consent-yes-1');
    expect(out).toContain('rotated-token-456');
    expect(out).toContain('injected-session-789');
    expect(out).not.toContain('[REDACTED]');
  });

  it('still redacts injected and site-set cookies on an authenticated scan', async () => {
    const out = await scan(['--cookie-env', 'sid=A11Y_SESSION'], { NODE_ENV: 'test', A11Y_SESSION: 'injected-session-789' });
    expect(out).not.toContain('injected-session-789');
    expect(out).not.toContain('rotated-token-456');
    expect(out).toContain('[REDACTED]');
  });
});
