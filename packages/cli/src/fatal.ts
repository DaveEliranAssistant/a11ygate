/** `--debug` (or A11YGATE_DEBUG=1) shows stack traces for unexpected errors; by default only the message is printed. */
export function debugRequested(argv: readonly string[], env: Record<string, string | undefined> = process.env): boolean {
  return argv.includes('--debug') || env.A11YGATE_DEBUG === '1';
}

export function stripDebugFlag(argv: readonly string[]): string[] {
  return argv.filter((arg) => arg !== '--debug');
}

export function formatFatal(error: unknown, debug: boolean): string {
  const message = error instanceof Error ? error.message || 'A11yGate failed.' : 'A11yGate failed.';
  if (debug && error instanceof Error && error.stack) return `${error.stack}\n`;
  return `${message}${debug ? '' : '\nRun again with --debug for details.'}\n`;
}

let debugEnabled = false;

/** Set once by the CLI entry point from `--debug` / A11YGATE_DEBUG=1. */
export function setDebug(on: boolean): void {
  debugEnabled = on;
}

export function isDebug(): boolean {
  return debugEnabled;
}

/**
 * For errors a command catches and reports itself (malformed input files, setup failures):
 * empty by default, or the stack trace (and any `cause` chain) under `--debug`. Append after the message line.
 */
export function debugDetail(error: unknown): string {
  if (!debugEnabled) return '';
  const lines: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 5; depth++) {
    lines.push(`${depth ? 'Caused by: ' : ''}${current.stack ?? current.message}`);
    current = (current as Error & { cause?: unknown }).cause;
  }
  return lines.length ? `${lines.join('\n')}\n` : '';
}
