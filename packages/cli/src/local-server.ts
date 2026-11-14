import { execFile, spawn } from 'node:child_process';

/** Trusted shell command, owned process group, bounded readiness and cleanup. */
export async function withLocalServer<T>(options: { start?: string; waitOn?: string; timeoutMs?: number }, cwd: string, env: NodeJS.ProcessEnv, work: () => Promise<T>): Promise<T> {
  const child = options.start ? spawn(options.start, { cwd, env, shell: true, detached: process.platform !== 'win32', stdio: 'ignore' }) : undefined;
  let failure: Error | undefined;
  child?.once('error', (error) => { failure = error; });
  const killGroup = (signal: NodeJS.Signals) => {
    if (!child?.pid) return;
    try { process.kill(-child.pid, signal); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  };
  let cleanupPromise: Promise<void> | undefined;
  const cleanup = () => cleanupPromise ??= (async () => {
    if (!child?.pid) return;
    if (process.platform === 'win32') {
      // Await taskkill: exiting the CLI first can leave npm/Node grandchildren alive.
      await new Promise<void>((resolve, reject) => {
        execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, (error) => {
          // taskkill returns 128 when the process has already disappeared.
          if (error && error.code !== 128) reject(error);
          else resolve();
        });
      });
    } else {
      killGroup('SIGTERM');
      // The shell can exit before grandchildren; always escalate the whole group.
      await new Promise((resolve) => setTimeout(resolve, 300));
      killGroup('SIGKILL');
    }
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    }
  })();
  const interrupt = (code: number) => {
    void cleanup().then(() => process.exit(code), () => {
      process.stderr.write('Failed to stop the local server process tree.\n');
      process.exit(1);
    });
  };
  const onInterrupt = () => interrupt(130);
  const onTerminate = () => interrupt(143);
  if (child) { process.on('SIGINT', onInterrupt); process.on('SIGTERM', onTerminate); }
  try {
    if (options.waitOn) {
      const deadline = Date.now() + (options.timeoutMs ?? 30_000);
      let ready = false;
      while (Date.now() < deadline) {
        if (failure) throw failure;
        if (child && child.exitCode !== null) throw new Error(`Start command exited before readiness (${child.exitCode}).`);
        try {
          const response = await fetch(options.waitOn, { signal: AbortSignal.timeout(Math.min(1000, Math.max(1, deadline - Date.now()))), redirect: 'error' });
          ready = response.ok;
          await response.body?.cancel();
        } catch { /* Retry connection failures until the deadline. */ }
        if (ready) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!ready) throw new Error(`Timed out waiting for ${options.waitOn}.`);
    }
    if (failure) throw failure;
    return await work();
  } finally {
    if (child) {
      try { await cleanup(); }
      finally {
        process.removeListener('SIGINT', onInterrupt);
        process.removeListener('SIGTERM', onTerminate);
      }
    }
  }
}

export function storyUrls(index: unknown, base: string): string[] {
  const entries = (index as { entries?: Record<string, { id?: string; type?: string }> })?.entries;
  if (!entries || typeof entries !== 'object') throw new Error('Storybook index.json needs entries.');
  const ids = Object.values(entries).filter((entry) => entry.type === 'story').map((entry) => entry.id);
  if (!ids.length || ids.length > 1000 || ids.some((id) => typeof id !== 'string' || !id)) throw new Error('Storybook index must contain 1–1000 valid stories.');
  return [...new Set(ids)].map((id) => new URL(`iframe.html?id=${encodeURIComponent(id!)}&viewMode=story`, base).href);
}
