import { isImpact, type Impact } from '@/lib/types';
import { mergeFormats, parseFormatList, type ReportFormat } from '@/lib/report-formats';

export type CliOptions = {
  help: boolean;
  version: boolean;
  current: string[];
  baseline: string[];
  threshold: Impact;
  markdown?: string;
  json?: string;
  updateBaseline?: string;
  manualEvidence?: string;
  formats: ReportFormat[];
  outDir?: string;
};

export type ParsedArgs = { ok: true; options: CliOptions } | { ok: false; error: string };

const VALUE_FLAGS: Record<string, 'current' | 'baseline' | 'threshold' | 'markdown' | 'json' | 'updateBaseline' | 'manualEvidence' | 'format' | 'outDir'> = {
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
  '--out-dir': 'outDir',
};

function flagName(token: string): { name: string; inline?: string } {
  const eq = token.indexOf('=');
  if (eq === -1) return { name: token };
  return { name: token.slice(0, eq), inline: token.slice(eq + 1) };
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  if (argv.includes('--help') || argv.includes('-h')) {
    return {
      ok: true,
      options: {
        help: true,
        version: false,
        current: [],
        baseline: [],
        threshold: 'serious',
        formats: [],
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
  let formats: ReportFormat[] = [];
  let outDir: string | undefined;
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

    const value = inline !== undefined ? inline : argv[index + 1];
    if (inline === undefined) index += 1;
    if (value === undefined || value.length === 0) {
      return { ok: false, error: `${name} needs a value.` };
    }
    const jsonFlag = name === '--json' || name === '-j';
    if (value.startsWith('-') && !(jsonFlag && value === '-')) {
      return { ok: false, error: `${name} needs a value.` };
    }

    if (field === 'current') current.push(value);
    else if (field === 'baseline') baseline.push(value);
    else if (field === 'threshold') thresholdText = value;
    else if (field === 'markdown') markdown = value;
    else if (field === 'json') json = value;
    else if (field === 'updateBaseline') updateBaseline = value;
    else if (field === 'manualEvidence') manualEvidence = value;
    else if (field === 'outDir') outDir = value;
    else {
      const parsed = parseFormatList(value);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      formats = mergeFormats(formats, parsed.formats);
    }
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
    options: { help, version: version && !help, current, baseline, threshold, markdown, json, updateBaseline, manualEvidence, formats, outDir },
  };
}
