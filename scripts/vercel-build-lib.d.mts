export function databaseUrlFrom(env: Record<string, string | undefined>): string | null;

export function redactConnectionStrings(text: string, secrets?: readonly (string | undefined)[]): string;

export function runVercelBuild(options: {
  env: Record<string, string | undefined>;
  migrate: () => Promise<{ ok: boolean; message?: string }>;
  build: () => Promise<number>;
  log?: (line: string) => void;
  error?: (line: string) => void;
}): Promise<number>;
