import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { vi } from 'vitest';

/**
 * Blocks and counts every outbound network attempt (fetch/undici, http(s),
 * raw sockets, TLS) for the duration of a test. Equivalent to nock's
 * `disableNetConnect`, without adding a dependency.
 */
export function blockNetwork() {
  const attempts: string[] = [];
  const deny = (kind: string) =>
    function denied(): never {
      attempts.push(kind);
      throw new Error(`Blocked outbound network access (${kind}) in a test.`);
    };
  const spies = [
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => deny('fetch')()),
    vi.spyOn(http, 'request').mockImplementation(deny('http.request')),
    vi.spyOn(http, 'get').mockImplementation(deny('http.get')),
    vi.spyOn(https, 'request').mockImplementation(deny('https.request')),
    vi.spyOn(https, 'get').mockImplementation(deny('https.get')),
    vi.spyOn(net, 'connect').mockImplementation(deny('net.connect')),
    vi.spyOn(net, 'createConnection').mockImplementation(deny('net.createConnection')),
    vi.spyOn(tls, 'connect').mockImplementation(deny('tls.connect')),
    vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(deny('socket.connect')),
  ];
  return {
    attempts,
    restore: () => {
      for (const spy of spies) spy.mockRestore();
    },
  };
}

/** Allow only literal loopback/localhost targets; record and reject everything else. */
export function guardLocalhostNetwork() {
  const attempts: string[] = [];
  const assertHost = (host: string) => {
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
      attempts.push(host);
      throw new Error(`Blocked non-localhost network access: ${host}`);
    }
  };
  const nativeFetch = globalThis.fetch;
  const nativeConnect = net.Socket.prototype.connect;
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assertHost(url.hostname);
    // Tests must opt into redirect handling explicitly, avoiding hidden off-host hops.
    return nativeFetch(input, { ...init, redirect: init?.redirect ?? 'manual' });
  });
  const connectSpy = vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(function (this: net.Socket, ...args: unknown[]) {
    // Node's net.createConnection uses normalized arguments in a nested array.
    const normalized = Array.isArray(args[0]) ? args[0] : args;
    const first = normalized[0];
    if (typeof first === 'object' && first !== null) {
      const options = first as { host?: string; path?: string };
      if (options.path) throw new Error('Unix sockets are not permitted in network fixture tests.');
      assertHost(options.host ?? 'localhost');
    } else if (typeof first === 'number') assertHost(typeof normalized[1] === 'string' ? normalized[1] : 'localhost');
    else throw new Error('Unrecognized socket address in fixture test.');
    return Reflect.apply(nativeConnect, this, args);
  } as typeof nativeConnect);
  return { attempts, restore: () => { connectSpy.mockRestore(); fetchSpy.mockRestore(); } };
}
