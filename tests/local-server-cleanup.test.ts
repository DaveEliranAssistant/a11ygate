import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import { withLocalServer } from '@/packages/cli/src/local-server';

vi.mock('node:child_process', () => ({ spawn: vi.fn(), execFile: vi.fn() }));
const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;

afterEach(() => {
  Object.defineProperty(process, 'platform', platformDescriptor);
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

for (const platform of ['win32', 'darwin', 'linux']) {
  describe(`process tree cleanup on ${platform}`, () => {
    function setup() {
      Object.defineProperty(process, 'platform', { value: platform });
      const child = Object.assign(new EventEmitter(), { pid: 12345, exitCode: null as number | null, signalCode: null as string | null });
      vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
      vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
        child.exitCode = 0;
        (args.at(-1) as (error: null) => void)(null);
        return {} as ReturnType<typeof execFile>;
      });
      const kill = vi.spyOn(process, 'kill').mockImplementation(() => { child.signalCode = 'SIGTERM'; return true; });
      const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
      function verify() {
        expect(spawn).toHaveBeenCalledWith('trusted command', expect.objectContaining({ detached: platform !== 'win32', shell: true }));
        if (platform === 'win32') {
          expect(execFile).toHaveBeenCalledExactlyOnceWith('taskkill', ['/PID', '12345', '/T', '/F'], { windowsHide: true }, expect.any(Function));
          expect(kill).not.toHaveBeenCalled();
        } else {
          expect(kill.mock.calls).toEqual([[-12345, 'SIGTERM'], [-12345, 'SIGKILL']]);
          expect(execFile).not.toHaveBeenCalled();
        }
        expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual(before);
      }
      return { child, kill, exit, verify };
    }
    for (const outcome of ['success', 'scan failure', 'timeout', 'early exit', 'spawn error', 'SIGINT', 'SIGTERM']) {
      it(`cleans up on ${outcome}`, async () => {
        const { child, exit, verify } = setup();
        const options = { start: 'trusted command', ...(outcome === 'timeout' || outcome === 'early exit' ? { waitOn: 'http://127.0.0.1:1', timeoutMs: outcome === 'timeout' ? 0 : 100 } : {}) };
        if (outcome === 'early exit') child.exitCode = 7;
        if (outcome === 'spawn error') queueMicrotask(() => child.emit('error', new Error('spawn failed')));
        const operation = withLocalServer(options, process.cwd(), process.env, async () => {
          if (outcome === 'scan failure') throw new Error('scan failed');
          if (outcome === 'SIGINT' || outcome === 'SIGTERM') {
            process.emit(outcome);
            // A simultaneous finally must share the in-flight cleanup operation.
          }
          if (outcome === 'spawn error') { await Promise.resolve(); throw new Error('spawn failed'); }
          return 42;
        });
        if (['scan failure', 'timeout', 'early exit', 'spawn error'].includes(outcome)) await expect(operation).rejects.toThrow();
        else expect(await operation).toBe(42);
        if (outcome === 'SIGINT' || outcome === 'SIGTERM') expect(exit).toHaveBeenCalledWith(outcome === 'SIGINT' ? 130 : 143);
        else expect(exit).not.toHaveBeenCalled();
        verify();
      });
    }
    it('does nothing without --start', async () => {
      setup();
      expect(await withLocalServer({}, process.cwd(), process.env, async () => 42)).toBe(42);
      expect(spawn).not.toHaveBeenCalled();
      expect(execFile).not.toHaveBeenCalled();
      expect(process.kill).not.toHaveBeenCalled();
    });
  });
}

it('waits for Windows taskkill completion before returning or exiting', async () => {
  Object.defineProperty(process, 'platform', { value: 'win32' });
  const child = Object.assign(new EventEmitter(), { pid: 12345, exitCode: 0, signalCode: null });
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  let finish!: (error: null) => void;
  vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
    finish = args.at(-1) as typeof finish;
    return {} as ReturnType<typeof execFile>;
  });
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  let done = false;
  const operation = withLocalServer({ start: 'command' }, process.cwd(), process.env, async () => { process.emit('SIGINT'); }).then(() => { done = true; });
  await Promise.resolve();
  expect(done).toBe(false);
  expect(exit).not.toHaveBeenCalled();
  finish(null);
  await operation;
  expect(exit).toHaveBeenCalledWith(130);
  expect(execFile).toHaveBeenCalledTimes(1);
});

it('handles a failed spawn with no PID and removes signal handlers', async () => {
  Object.defineProperty(process, 'platform', { value: 'win32' });
  const child = Object.assign(new EventEmitter(), { pid: undefined, exitCode: null, signalCode: null });
  const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
  vi.mocked(spawn).mockImplementation(() => {
    queueMicrotask(() => child.emit('error', new Error('ENOENT')));
    return child as unknown as ReturnType<typeof spawn>;
  });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('not ready')));
  try {
    await expect(withLocalServer({ start: 'missing', waitOn: 'http://127.0.0.1:1', timeoutMs: 1000 }, process.cwd(), process.env, vi.fn())).rejects.toThrow('ENOENT');
    expect(execFile).not.toHaveBeenCalled();
    expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual(before);
  } finally { vi.unstubAllGlobals(); }
});

for (const code of [128, 1, 'ENOENT']) {
  it(`handles taskkill error ${code} without leaking handlers`, async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const child = Object.assign(new EventEmitter(), { pid: 12345, exitCode: 0, signalCode: null });
    const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
      (args.at(-1) as (error: Error) => void)(Object.assign(new Error('taskkill failed'), { code }));
      return {} as ReturnType<typeof execFile>;
    });
    const operation = withLocalServer({ start: 'command' }, process.cwd(), process.env, async () => 42);
    if (code === 128) expect(await operation).toBe(42);
    else await expect(operation).rejects.toThrow('taskkill failed');
    expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual(before);
  });
}

for (const code of ['ESRCH', 'EPERM']) {
  it(`handles POSIX group kill error ${code}`, async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const child = Object.assign(new EventEmitter(), { pid: 12345, exitCode: 0, signalCode: null });
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('group kill failed'), { code }); });
    const operation = withLocalServer({ start: 'command' }, process.cwd(), process.env, async () => 42);
    if (code === 'ESRCH') expect(await operation).toBe(42);
    else await expect(operation).rejects.toThrow('group kill failed');
  });
}
