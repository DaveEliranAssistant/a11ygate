import { spawn } from 'node:child_process';

/** Trusted shell command, owned process group, bounded readiness and cleanup. */
export async function withLocalServer<T>(options: { start?: string; waitOn?: string; timeoutMs?: number }, cwd: string, env: NodeJS.ProcessEnv, work: () => Promise<T>): Promise<T> {
  const child = options.start ? spawn(options.start, { cwd, env, shell: true, detached: process.platform !== 'win32', stdio: 'ignore' }) : undefined;
  let failure: Error | undefined;
  child?.once('error', (error) => { failure = error; });
  const kill = (signal: NodeJS.Signals) => {
    if (!child?.pid) return;
    try { if (process.platform === 'win32') child.kill(signal); else process.kill(-child.pid, signal); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  };
  const interrupt = () => { kill('SIGKILL'); process.exit(130); };
  if (child) { process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt); }
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
      kill('SIGTERM');
      // The shell can exit before grandchildren; always kill the entire group after grace.
      await new Promise((resolve) => setTimeout(resolve, 300));
      kill('SIGKILL');
      if (child.pid && child.exitCode === null && child.signalCode === null) await new Promise<void>((resolve) => child.once('exit', () => resolve()));
      process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
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
