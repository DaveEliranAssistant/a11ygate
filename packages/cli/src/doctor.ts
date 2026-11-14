import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { adaptersForEnv } from '@/lib/modelfix/adapters';
import { resolveModelFixConfig } from '@/lib/modelfix/config';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
type Env = Readonly<Record<string, string | undefined>>;
export type DoctorFinding = {
  check: string;
  status: 'pass' | 'fail' | 'unknown' | 'skipped';
  message: string;
  link: string;
};
export type DoctorIo = {
  cwd?: string;
  env?: Env;
  nodeVersion?: string;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  head?: () => string | null;
  repoConfig?: string | null;
  hasPackage?: (name: string) => boolean;
  chromium?: () => boolean;
  fetch?: typeof fetch;
};
const GUIDE = 'https://github.com/DaveEliranAssistant/a11ygate/blob/main/docs/integrations/github-action.md#';
const sections: Record<string, string> = { checkout: 'doctor-checkout', permissions: 'doctor-permissions', 'pr-creation': 'doctor-pr-creation', browser: 'doctor-browser', node: 'doctor-node', engines: 'doctor-engines', provider: 'doctor-provider' };
const PEERS: Record<string, string[]> = { axe: ['@axe-core/playwright'], htmlcs: ['html_codesniffer'], ibm: ['accessibility-checker-engine'], lighthouse: ['lighthouse', 'puppeteer-core'] };
const yes = (value?: string) => /^(on|true|1|yes)$/i.test(value ?? '');
// Only the small, documented engines list is read; no YAML tags, scripts or dependencies execute.
export function configuredEngines(text: string): string[] | undefined {
  text = text.replace(/[ \t]+#.*$/gm, '');
  const flow = /^engines:\s*\[([^\]\n]*)\]/m.exec(text);
  const block = /^engines:\s*\n((?:[ \t]+-[^\n]*\n?)+)/m.exec(text);
  const value = flow?.[1] ?? block?.[1].replace(/^[ \t]+-\s*/gm, ',');
  return value === undefined ? undefined : value.split(',').map(x => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}
export async function doctorChecks(options: {
  engines?: string[];
  modelFixes?: string;
  browser?: boolean;
} = {}, io: DoctorIo = {}): Promise<DoctorFinding[]> {
  const env = io.env ?? process.env;
  const cwd = io.cwd ?? env.GITHUB_WORKSPACE ?? process.cwd();
  const require = createRequire(path.join(cwd, 'package.json'));
  const hasPackage = io.hasPackage ?? ((name: string) => { try {
    require.resolve(name);
    return true;
  }
  catch {
    return false;
  } });
  let config = io.repoConfig;
  if (config === undefined) {
    try {
      config = readFileSync(path.join(cwd, '.a11ygate.yml'), 'utf8');
    }
    catch {
      config = null;
    }
  }
  const engines = options.engines ?? configuredEngines(config ?? '') ?? ['axe'];
  const model = resolveModelFixConfig({ repoConfig: config, flag: options.modelFixes ?? env.A11Y_MODEL_FIXES, env });
  const findings: DoctorFinding[] = [];
  const add = (check: string, status: DoctorFinding['status'], message: string) => findings.push({ check, status, message, link: GUIDE + sections[check] });
  let head: string | null = null;
  try {
    head = io.head ? io.head() : execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  }
  catch { /* reported below */ }
  let event: {
    pull_request?: {
      head?: {
        sha?: string;
        repo?: {
          full_name?: string;
        };
      };
    };
  } = {};
  try {
    if (env.GITHUB_EVENT_PATH)
      event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  }
  catch { /* no trusted head */ }
  const prHead = env.A11Y_HEAD_SHA || event.pull_request?.head?.sha;
  add('checkout', !prHead ? 'skipped' : !head ? 'unknown' : head === prHead ? 'pass' : 'fail', !prHead ? 'No pull request head SHA is available.' : !head ? 'Could not read the checked-out commit.' : head === prHead ? 'The checkout matches the pull request head.' : 'The checkout differs from the pull request head. The verifier will discard model-fix candidates as stale; check out github.event.pull_request.head.sha.');
  const major = Number((io.nodeVersion ?? process.versions.node).replace(/^v/, '').split('.')[0]);
  add('node', major >= 20 ? 'pass' : 'fail', major >= 20 ? 'Node meets the CLI requirement (20+; the Action uses 22).' : 'Node is unsupported. Use Node 20 or newer for the CLI; use Node 22 for the Action.');
  const needsBrowser = options.browser ?? true;
  if (needsBrowser) {
    let browser = false;
    try {
      browser = io.chromium ? io.chromium() : existsSync(require('playwright').chromium.executablePath());
    }
    catch { /* missing peer */ }
    add('browser', browser ? 'pass' : 'fail', browser ? 'Playwright Chromium is installed.' : 'Playwright or its Chromium executable is missing. Run npm install --save-dev playwright, then npx playwright install chromium.');
  }
  else
    add('browser', 'skipped', 'Reading axe JSON needs no browser; model verification is off.');
  const missing = engines.flatMap(id => Object.hasOwn(PEERS, id) ? PEERS[id].filter(name => !hasPackage(name)) : [`unknown engine: ${id}`]);
  add('engines', !needsBrowser ? 'skipped' : missing.length ? 'fail' : 'pass', !needsBrowser ? 'Reading axe JSON needs no engine peers.' : missing.length ? `Requested engine peers are missing: ${missing.join(', ')}. Install the named packages before scanning.` : 'All requested engine peers are installed.');
  const configured = adaptersForEnv(env).some(adapter => model.providers.includes(adapter.id) && adapter.isConfigured(env));
  add('provider', !model.enabled ? 'skipped' : configured ? 'pass' : 'fail', !model.enabled ? 'Model fixes are off or repository consent is absent.' : configured ? 'An allowlisted model provider is configured.' : 'Model fixes are on but no allowlisted provider is configured. Set the provider credentials and model ID; allowlist stub explicitly only for offline demos.');
  const repo = env.GITHUB_REPOSITORY;
  const token = env.A11Y_TOKEN || env.GITHUB_TOKEN;
  const required: Record<string, string> = { contents: model.enabled ? 'write' : 'read' };
  if (yes(env.A11Y_COMMENT) || model.enabled)
    required.issues = 'write';
  if ((yes(env.A11Y_COMMENT) && yes(env.A11Y_SUGGEST_FIXES ?? 'true')) || model.enabled)
    required['pull-requests'] = 'write';
  if (yes(env.A11YGATE_SARIF_UPLOAD))
    required['security-events'] = 'write';
  let permissions: Record<string, string> | null = null;
  try {
    const parsed = JSON.parse(env.A11YGATE_GITHUB_PERMISSIONS ?? env.GITHUB_TOKEN_PERMISSIONS ?? 'null');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      permissions = parsed;
  }
  catch { /* unknown */ }
  const fork = event.pull_request?.head?.repo?.full_name && event.pull_request.head.repo.full_name !== repo;
  const denied = permissions ? Object.entries(required).filter(([scope, level]) => permissions[scope] !== 'write' && !(level === 'read' && permissions[scope] === 'read')).map(([scope, level]) => `${scope}: ${level}`) : fork ? Object.entries(required).filter(([, level]) => level === 'write').map(([scope]) => `${scope}: write`) : [];
  add('permissions', denied.length ? 'fail' : permissions ? 'pass' : repo ? 'unknown' : 'skipped', denied.length ? `The job token lacks required workflow permissions: ${denied.join(', ')}. Set permissions for the enabled modes; fork tokens cannot gain write scopes.` : permissions ? 'The supplied job-token permissions cover the enabled modes.' : repo ? 'Job-token write scopes cannot be verified safely. Supply a permissions context; the runtime token does not prove repository access.' : 'No GitHub repository context; workflow permissions do not apply.');
  const permissionFinding = findings[findings.length - 1];
  let setting: boolean | undefined;
  let settingDetail = 'The repository setting could not be verified without a token and current repository context.';
  if (repo && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) && !repo.split('/').some(part => part === '.' || part === '..') && token && (!env.GITHUB_API_URL || env.GITHUB_API_URL === 'https://api.github.com')) {
    // Fixed public GitHub API only. Never follow redirects, use another repository, or echo responses/errors.
    const get = async (suffix: string) => (io.fetch ?? fetch)(`https://api.github.com/repos/${repo}${suffix}`, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5000), headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' } });
    try {
      const response = await get('');
      if (response.status === 403 || response.status === 401) {
        permissionFinding.status = 'fail';
        permissionFinding.message = 'GitHub denied the read-only repository probe. Check the job token and workflow permissions; no write was attempted.';
      }
    }
    catch {
      permissionFinding.status = denied.length ? 'fail' : 'unknown';
      permissionFinding.message += ' The read-only repository probe was unavailable.';
    }
    if (model.enabled && env.A11Y_MODEL_PUBLISH !== 'review-suggestion') {
      try {
        const response = await get('/actions/permissions/workflow');
        if (response.ok) {
          const data = await response.json();
          if (typeof data.can_approve_pull_request_reviews === 'boolean')
            setting = data.can_approve_pull_request_reviews;
        }
        settingDetail = response.status === 403 ? 'GitHub denied the read-only settings probe (403). This does not prove PR creation is disabled; an owner must check the setting.' : 'The repository setting could not be verified. An owner must check it; no PR was created.';
      }
      catch {
        settingDetail = 'The read-only settings probe was unavailable. An owner must check the setting.';
      }
    }
  }
  const needsPr = model.enabled && env.A11Y_MODEL_PUBLISH !== 'review-suggestion';
  add('pr-creation', !needsPr ? 'skipped' : setting === undefined ? 'unknown' : setting ? 'pass' : 'fail', !needsPr ? 'Model-fix draft PR publishing is off.' : setting === undefined ? settingDetail : setting ? 'The repository allows Actions to create and approve pull requests.' : 'Actions PR creation is disabled. Model-fix draft PRs will fall back to report-only. Only the owner should decide whether to enable Allow GitHub Actions to create and approve pull requests.');
  return findings;
}
export function formatDoctor(findings: DoctorFinding[]): string {
  return `A11yGate doctor\n${findings.map(f => `[${f.status.toUpperCase()}] ${f.check}: ${f.message}\n  ${f.link}`).join('\n')}\n${findings.some(f => f.status === 'fail' || f.status === 'unknown') ? 'Preflight findings above need attention; unknown checks are not proof of a working setup.' : 'All checks passed (applicable checks only).'}\n${AUTOMATED_TESTING_DISCLAIMER}\n`;
}
export async function runDoctor(argv: readonly string[], io: DoctorIo = {}): Promise<number> {
  const stdout = io.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = io.stderr ?? ((text: string) => process.stderr.write(text));
  if (argv.includes('--help') || argv.includes('-h')) {
    stdout('Usage: a11ygate doctor [--strict] [--engines axe,htmlcs,ibm,lighthouse] [--model-fixes on|off]\nNode 20+; Action Node 22. Reads engines from .a11ygate.yml when omitted.\nDefault exits 0; --strict exits 1 for failed checks. Unknown checks are reported separately.\n');
    return 0;
  }
  let strict = false;
  let engines: string[] | undefined;
  let modelFixes: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    const equals = token.indexOf('=');
    const name = equals === -1 ? token : token.slice(0, equals);
    const inline = equals === -1 ? undefined : token.slice(equals + 1);
    if (name === '--strict' && inline === undefined) {
      strict = true;
      continue;
    }
    if (name !== '--engines' && name !== '--model-fixes') {
      stderr(`Unknown doctor option ${name}.\n`);
      return 2;
    }
    const value = inline ?? argv[++i];
    if (!value || value.startsWith('-')) {
      stderr(`${name} needs a value.\n`);
      return 2;
    }
    if (name === '--engines') {
      engines = value.split(',').map(id => id.trim());
      if (engines.some(id => !Object.hasOwn(PEERS, id)) || new Set(engines).size !== engines.length) {
        stderr('Use a unique comma-separated list of axe,htmlcs,ibm,lighthouse.\n');
        return 2;
      }
    }
    else {
      if (!['on', 'off'].includes(value)) {
        stderr('--model-fixes needs on or off.\n');
        return 2;
      }
      modelFixes = value;
    }
  }
  const findings = await doctorChecks({ engines, modelFixes }, io);
  stdout(formatDoctor(findings));
  return strict && findings.some(f => f.status === 'fail') ? 1 : 0;
}
