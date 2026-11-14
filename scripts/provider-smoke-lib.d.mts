export type SmokeEnv = Record<string, string | undefined>;

export type SmokeTokens = { input: number | null; output: number | null; total: number | null };

export type SmokeResult = {
  provider: 'groq' | 'gemini' | 'cloudflare' | string;
  model: string | null;
  status: 'pass' | 'fail' | 'skipped';
  reason: string | null;
  missing?: string[];
  latencyMs: number | null;
  requests: number;
  httpStatus?: number | null;
  tokens: SmokeTokens | null;
  rejections?: string[];
  providerState?: string | null;
  error?: string;
};

export const PROVIDER_SECRETS: Readonly<Record<'groq' | 'gemini' | 'cloudflare', readonly string[]>>;
export const KNOWN_PROVIDERS: readonly string[];
export const CREDENTIAL_VARS: readonly string[];
export const REQUESTS_PER_PROVIDER: number;

export function missingSecrets(id: string, env: SmokeEnv): string[];
export function redactSecrets(text: string, env: SmokeEnv, extra?: readonly string[]): string;
export function tokenUsage(body: unknown): SmokeTokens | null;
export function smokeFixture(): { files: unknown[]; findings: unknown[] };

export function runProviderSmoke(options: {
  env: SmokeEnv;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  modelfix: any;
  providers?: string[];
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  now?: () => number;
  log?: (line: string) => void;
  failOnError?: boolean;
}): Promise<{ results: SmokeResult[]; exitCode: number }>;

export function smokeArtifact(results: SmokeResult[], generatedAt?: string): {
  schema: string;
  generatedAt: string;
  budget: { requestsPerProvider: number };
  results: SmokeResult[];
  note: string;
};

export function smokeSummary(results: SmokeResult[]): string;
