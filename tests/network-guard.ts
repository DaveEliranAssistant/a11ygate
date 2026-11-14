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
