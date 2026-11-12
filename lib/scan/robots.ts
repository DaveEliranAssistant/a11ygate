/** Minimal robots.txt support: User-agent groups, Allow/Disallow with `*` and `$`, longest match wins. */

export type RobotsRule = { allow: boolean; pattern: string };
export type RobotsRules = { rules: RobotsRule[] };

type Group = { agents: string[]; rules: RobotsRule[] };

export const ROBOTS_AGENT = 'a11ygate';

export function parseRobots(text: string, agent = ROBOTS_AGENT): RobotsRules {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === 'disallow' || key === 'allow') {
      // An empty Disallow means "allow everything"; it adds no rule.
      if (value === '') continue;
      current.rules.push({ allow: key === 'allow', pattern: value });
    }
  }
  const name = agent.toLowerCase();
  // Honour both the wildcard group and any group naming A11yGate: the stricter union is the safe choice.
  const rules = groups
    .filter((group) => group.agents.some((a) => a === '*' || a.includes(name)))
    .flatMap((group) => group.rules);
  return { rules };
}

function patternToRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

/** `pathAndQuery` is URL pathname + search, e.g. `/private/a.html?x=1`. */
export function isAllowedByRobots(robots: RobotsRules | null, pathAndQuery: string): boolean {
  if (!robots || robots.rules.length === 0) return true;
  let best: RobotsRule | null = null;
  for (const rule of robots.rules) {
    if (!patternToRegExp(rule.pattern).test(pathAndQuery)) continue;
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}

export function robotsAllowsUrl(robots: RobotsRules | null, url: string): boolean {
  const parsed = new URL(url);
  return isAllowedByRobots(robots, parsed.pathname + parsed.search);
}

export type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal; redirect: 'follow' }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/**
 * Fetch `<origin>/robots.txt`. A 4xx response or an unreachable server means "no rules" (proceed);
 * a 5xx response is treated as unreachable too, as the task allows proceeding.
 */
export async function fetchRobots(origin: string, userAgent: string, fetchImpl: FetchLike, timeoutMs = 5000): Promise<{ rules: RobotsRules | null; note: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${origin}/robots.txt`, { headers: { 'user-agent': userAgent }, signal: controller.signal, redirect: 'follow' });
    if (!response.ok) return { rules: null, note: `robots.txt returned HTTP ${response.status}; no rules applied.` };
    const text = (await response.text()).slice(0, 512 * 1024);
    return { rules: parseRobots(text), note: 'robots.txt honoured.' };
  } catch {
    return { rules: null, note: 'robots.txt unreachable; proceeding without rules.' };
  } finally {
    clearTimeout(timer);
  }
}
