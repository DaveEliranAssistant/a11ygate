import { isReportFormat, type ReportFormat } from '@/lib/evidence-report';
import { isImpact, type Impact } from '@/lib/types';

export type CliCommand = 'gate' | 'report';

export type CliOptions = {
  command: CliCommand;
  help: boolean;
  version: boolean;
  current: string[];
  baseline: string[];
  threshold: Impact;
  markdown?: string;
  json?: string;
  updateBaseline?: string;
  manualEvidence?: string;
  format?: ReportFormat;
  out?: string;
  generatedAt?: string;
  commit?: string;
  branch?: string;
};

export type ParsedArgs = { ok: true; options: CliOptions } | { ok: false; error: string };

type ValueField =
  | 'current'
  | 'baseline'
  | 'threshold'
  | 'markdown'
  | 'json'
  | 'updateBaseline'
  | 'manualEvidence'
  | 'format'
  | 'out'
  | 'generatedAt'
  | 'commit'
  | 'branch';

const VALUE_FLAGS: Record<string, ValueField> = {
  '--current': 'current',
  '-c': 'current',
  '--baseline': 'baseline',
  '-b': 'baseline',
  '--threshold': 'threshold',
  '-t': 'threshold',
  '--markdown': 'markdown',
  '-m': 'markdown',
  '--json': 'json',
  '-j': 'json',
  '--update-baseline': 'updateBaseline',
  '--manual-evidence': 'manualEvidence',
  '--format': 'format',
  '-f': 'format',
  '--out': 'out',
  '-o': 'out',
  '--generated-at': 'generatedAt',
  '--commit': 'commit',
  '--branch': 'branch',
};

const GATE_ONLY: readonly ValueField[] = ['markdown', 'json', 'updateBaseline', 'manualEvidence'];
const REPORT_ONLY: readonly ValueField[] = ['format', 'out', 'generatedAt', 'commit', 'branch'];

function flagName(token: string): { name: string; inline?: string } {
  const eq = token.indexOf('=');
  if (eq === -1) return { name: token };
  return { name: token.slice(0, eq), inline: token.slice(eq + 1) };
}

export function parseArgs(input: readonly string[]): ParsedArgs {
  const command: CliCommand = input[0] === 'report' ? 'report' : 'gate';
  const argv = command === 'report' ? input.slice(1) : input;
  if (argv.includes('--help') || argv.includes('-h')) {
    return {
      ok: true,
      options: {
        command,
        help: true,
        version: false,
        current: [],
        baseline: [],
        threshold: 'serious',
      },
    };
  }

  const current: string[] = [];
  const baseline: string[] = [];
  let threshold: Impact = 'serious';
  let markdown: string | undefined;
  let json: string | undefined;
  let updateBaseline: string | undefined;
  let manualEvidence: string | undefined;
  let formatText: string | undefined;
  let out: string | undefined;
  let generatedAtText: string | undefined;
  let commit: string | undefined;
  let branch: string | undefined;
  let help = false;
  let version = false;
  let thresholdText: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? '';
    if (token === '--') {
      return { ok: false, error: 'Unexpected extra arguments.' };
    }
    if (token === '--help' || token === '-h') {
      help = true;
      continue;
    }
    if (token === '--version') {
      version = true;
      continue;
    }

    const { name, inline } = flagName(token);
    const field = VALUE_FLAGS[name];
    if (!field) {
      if (token.startsWith('-')) return { ok: false, error: `Unknown option ${token}.` };
      return { ok: false, error: `Unexpected argument ${token}.` };
    }
    if (command === 'report' && GATE_ONLY.includes(field)) {
      return { ok: false, error: `${name} is not available with a11ygate report. Use --format and --out.` };
    }
    if (command === 'gate' && REPORT_ONLY.includes(field)) {
      return { ok: false, error: `${name} is only available with a11ygate report.` };
    }

    const value = inline !== undefined ? inline : argv[index + 1];
    if (inline === undefined) index += 1;
    if (value === undefined || value.length === 0) {
      return { ok: false, error: `${name} needs a value.` };
    }
    const stdoutFlag = field === 'json' || field === 'out';
    if (value.startsWith('-') && !(stdoutFlag && value === '-')) {
      return { ok: false, error: `${name} needs a value.` };
    }

    if (field === 'current') current.push(value);
    else if (field === 'baseline') baseline.push(value);
    else if (field === 'threshold') thresholdText = value;
    else if (field === 'markdown') markdown = value;
    else if (field === 'json') json = value;
    else if (field === 'updateBaseline') updateBaseline = value;
    else if (field === 'manualEvidence') manualEvidence = value;
    else if (field === 'format') formatText = value;
    else if (field === 'out') out = value;
    else if (field === 'generatedAt') generatedAtText = value;
    else if (field === 'commit') commit = value;
    else branch = value;
  }

  let format: ReportFormat | undefined;
  if (formatText !== undefined) {
    if (!isReportFormat(formatText)) {
      return { ok: false, error: `Unknown report format "${formatText}". Use html, md, or json.` };
    }
    format = formatText;
  }

  let generatedAt: string | undefined;
  if (generatedAtText !== undefined) {
    const parsedDate = new Date(generatedAtText);
    if (!/^\d{4}-\d{2}-\d{2}T/.test(generatedAtText) || Number.isNaN(parsedDate.getTime())) {
      return { ok: false, error: '--generated-at needs an ISO 8601 date-time such as 2026-11-10T09:00:00Z.' };
    }
    generatedAt = parsedDate.toISOString();
  }

  if (!help && !version && thresholdText !== undefined) {
    if (!isImpact(thresholdText)) {
      return {
        ok: false,
        error: `Unknown impact threshold "${thresholdText}". Use minor, moderate, serious, or critical.`,
      };
    }
    threshold = thresholdText;
  }

  return {
    ok: true,
    options: {
      command,
      help,
      version: version && !help,
      current,
      baseline,
      threshold,
      markdown,
      json,
      updateBaseline,
      manualEvidence,
      format,
      out,
      generatedAt,
      commit,
      branch,
    },
  };
}
