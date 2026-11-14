import { attribution } from '@/lib/scan/engines/dedupe';
import { FORMAT_DISCLAIMER, type FormatFinding, type FormatReport } from '@/lib/report-formats';

/** XML 1.0 forbids most C0 controls; strip them so the document stays well-formed. */
function xmlSafe(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

export function escapeXml(value: string): string {
  return xmlSafe(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export type JunitCase = {
  classname: string;
  name: string;
  findings: FormatFinding[];
};

export function groupFindingsByRuleAndPage(findings: readonly FormatFinding[]): JunitCase[] {
  const groups = new Map<string, JunitCase>();
  for (const finding of findings) {
    const key = `${finding.pageUrl}\0${finding.ruleId}`;
    const existing = groups.get(key);
    if (existing) {
      existing.findings.push(finding);
      continue;
    }
    groups.set(key, { classname: finding.pageUrl, name: finding.ruleId, findings: [finding] });
  }
  return [...groups.values()].sort(
    (a, b) => a.classname.localeCompare(b.classname) || a.name.localeCompare(b.name),
  );
}

function failureMessage(group: JunitCase): string {
  const first = group.findings[0];
  const impact = first?.impact ?? 'unspecified';
  const help = first?.help ?? group.name;
  const count = group.findings.length;
  const extra = count > 1 ? ` (${count} instances)` : '';
  return `${group.name}: ${help} (${impact})${extra}`;
}

function failureBody(group: JunitCase): string {
  const lines = [FORMAT_DISCLAIMER, failureMessage(group)];
  for (const finding of group.findings) {
    const wcag =
      finding.wcag.length > 0
        ? finding.wcag.map((item) => `WCAG ${item.number} ${item.name} (${item.level})`).join('; ')
        : 'best practice (no WCAG success criterion mapped)';
    lines.push(
      `- ${finding.pageUrl} — ${finding.selector} — ${wcag}`,
      `  element: ${finding.html}`,
      attribution(finding),
      finding.helpUrl ? `  guidance: ${finding.helpUrl}` : '',
      finding.status ? `  status: ${finding.status}` : '',
    );
  }
  return lines.filter((line) => line.length > 0).join('\n');
}

function property(name: string, value: string): string {
  return `    <property name="${escapeXml(name)}" value="${escapeXml(value)}"/>`;
}

/**
 * JUnit XML (Jenkins JUnit plugin / dtkit junit-4 schema).
 * One testcase per axe rule × page. A testcase fails when that pair has violations.
 * Pages that were scanned with no violations get a passing testcase named "no-violations".
 */
export function toJunit(report: FormatReport): string {
  const failed = groupFindingsByRuleAndPage(report.findings);
  const failedPages = new Set(failed.map((item) => item.classname));
  const passing: JunitCase[] = report.pages
    .filter((page) => !failedPages.has(page))
    .map((page) => ({ classname: page, name: 'no-violations', findings: [] }));
  const cases = [...failed, ...passing].sort(
    (a, b) => a.classname.localeCompare(b.classname) || a.name.localeCompare(b.name),
  );
  const failures = failed.filter((g) => g.findings.some((f) => f.baselineStatus !== 'existing')).length;
  const tests = cases.length;
  const timestamp = escapeXml(report.generatedAt);
  const properties = [
    property('disclaimer', FORMAT_DISCLAIMER),
    property('tool', report.toolName),
    property('version', report.version),
    property('verdict', report.verdict),
    property('reason', report.reason),
    property('command', report.command),
  ];
  if (report.baseline) properties.push(...Object.entries(report.baseline).map(([key, value]) => property(`baseline-${key}`, String(value))));
  if (report.engines) properties.push(property('engines-used', report.engines.used.join(', ')), property('engines-errored', JSON.stringify(report.engines.errored)));
  if (report.startUrl) properties.push(property('startUrl', report.startUrl));
  if (report.projectName) properties.push(property('projectName', report.projectName));

  const testcases = cases.map((item) => {
    const attrs = `classname="${escapeXml(item.classname)}" name="${escapeXml(item.name)}" time="0"`;
    if (item.findings.length === 0 || item.findings.every((f) => f.baselineStatus === 'existing')) return `    <testcase ${attrs}/>`;
    const failingItem = { ...item, findings: item.findings.filter((f) => f.baselineStatus !== 'existing') };
    const type = escapeXml(item.name);
    const message = escapeXml(failureMessage(failingItem));
    const body = escapeXml(failureBody(failingItem));
    return `    <testcase ${attrs}>\n      <failure message="${message}" type="${type}">${body}</failure>\n    </testcase>`;
  });

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<testsuite name="A11yGate" tests="${tests}" failures="${failures}" errors="0" skipped="0" time="0" timestamp="${timestamp}" hostname="a11ygate">\n` +
    `  <properties>\n${properties.join('\n')}\n  </properties>\n` +
    `${testcases.join('\n')}\n` +
    `</testsuite>\n`
  );
}

export type JenkinsJunitCase = {
  name: string;
  classname?: string;
  time?: string;
  status: 'passed' | 'failed' | 'error' | 'skipped';
  message?: string;
  type?: string;
  body?: string;
};

export type JenkinsJunitSuite = {
  name: string;
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
  timestamp?: string;
  hostname?: string;
  properties: Record<string, string>;
  cases: JenkinsJunitCase[];
};

/**
 * Reads the same core fields the Jenkins JUnit plugin uses from a testsuite(s) document.
 * This is a fixture helper, not a reimplementation of the plugin.
 */
export function parseJenkinsJunit(xml: string): JenkinsJunitSuite[] {
  const suites: JenkinsJunitSuite[] = [];
  const suiteRe = /<testsuite\b([^>]*)>([\s\S]*?)<\/testsuite>/g;
  let match: RegExpExecArray | null;
  while ((match = suiteRe.exec(xml))) {
    const attrs = parseAttrs(match[1] ?? '');
    const body = match[2] ?? '';
    const properties: Record<string, string> = {};
    const propBlock = body.match(/<properties\b[^>]*>([\s\S]*?)<\/properties>/);
    if (propBlock) {
      const propRe = /<property\b([^>]*)\/>/g;
      let prop: RegExpExecArray | null;
      while ((prop = propRe.exec(propBlock[1] ?? ''))) {
        const pa = parseAttrs(prop[1] ?? '');
        if (pa.name !== undefined) properties[unescapeXml(pa.name)] = unescapeXml(pa.value ?? '');
      }
    }
    const cases: JenkinsJunitCase[] = [];
    const caseRe = /<testcase\b([^>]*)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
    let cse: RegExpExecArray | null;
    while ((cse = caseRe.exec(body))) {
      const ca = parseAttrs(cse[1] ?? '');
      const inner = cse[2] ?? '';
      let status: JenkinsJunitCase['status'] = 'passed';
      let message: string | undefined;
      let type: string | undefined;
      let text: string | undefined;
      const failure = inner.match(/<(failure|error|skipped)\b([^>]*)>([\s\S]*?)<\/\1>/) ?? inner.match(/<(failure|error|skipped)\b([^>]*)\/>/);
      if (failure) {
        status = failure[1] === 'failure' ? 'failed' : failure[1] === 'error' ? 'error' : 'skipped';
        const fa = parseAttrs(failure[2] ?? '');
        message = fa.message !== undefined ? unescapeXml(fa.message) : undefined;
        type = fa.type !== undefined ? unescapeXml(fa.type) : undefined;
        text = failure[3] !== undefined ? unescapeXml(failure[3]) : undefined;
      }
      cases.push({
        name: unescapeXml(ca.name ?? ''),
        classname: ca.classname !== undefined ? unescapeXml(ca.classname) : undefined,
        time: ca.time,
        status,
        message,
        type,
        body: text,
      });
    }
    suites.push({
      name: unescapeXml(attrs.name ?? ''),
      tests: Number(attrs.tests ?? cases.length),
      failures: Number(attrs.failures ?? 0),
      errors: Number(attrs.errors ?? 0),
      skipped: Number(attrs.skipped ?? 0),
      timestamp: attrs.timestamp,
      hostname: attrs.hostname,
      properties,
      cases,
    });
  }
  return suites;
}

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([:\w.-]+)\s*=\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) attrs[match[1] ?? ''] = match[2] ?? '';
  return attrs;
}

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
