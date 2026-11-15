import { componentGroupKey, groupSharedComponents, type SharedComponentGroup } from '@/lib/group';
import type { ScanFinding } from './report';

/** Reviewer decisions on a likely shared component group (R39). Stored in the fingerprint baseline. */
export const REVIEW_DECISIONS = ['to-fix', 'accepted-risk', 'false-positive'] as const;
export type ReviewDecisionKind = (typeof REVIEW_DECISIONS)[number];

export type GroupDecision = {
  /** Short, stable id derived from groupKey; shown to reviewers. */
  group: string;
  /** Full component group key from lib/group.ts componentGroupKey; used for matching. */
  groupKey: string;
  ruleId: string;
  normalizedSelector: string;
  decision: ReviewDecisionKind;
  reason?: string;
  /** Inclusive last day (YYYY-MM-DD) an accepted-risk decision applies. */
  expires?: string;
  /** git user.name of the reviewer, read from local git config. */
  by: string;
  /** YYYY-MM-DD the decision was recorded. */
  at: string;
};

export type AppliedReviewDecision = GroupDecision & { expired: boolean; suppressesGate: boolean };

export const REVIEW_DECISION_NOTICE = 'Groups are heuristic likely shared components (matching rule, normalized selector path and similar HTML); review examples before deciding. A decision records a reviewer judgement; it does not establish a root cause, a fix or conformance. Decided findings remain listed. Accepted-risk and false-positive decisions exclude matching findings from the gate; to-fix and expired accepted-risk decisions gate as usual.';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Deterministic short id (two FNV-1a 32-bit passes) so it works in the browser bundle too. */
export function groupId(groupKey: string): string {
  const fnv = (seed: number) => {
    let h = seed >>> 0;
    for (let i = 0; i < groupKey.length; i++) { h ^= groupKey.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  };
  return `g-${fnv(0x811c9dc5)}${fnv(0x050c5d1f)}`;
}

export function today(now: Date): string { return now.toISOString().slice(0, 10); }

export function isExpired(decision: Pick<GroupDecision, 'decision' | 'expires'>, now: Date): boolean {
  return decision.decision === 'accepted-risk' && !!decision.expires && today(now) > decision.expires;
}

export function validateGroupDecision(value: unknown): GroupDecision {
  const d = value as Partial<GroupDecision> | null;
  const str = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
  if (!d || typeof d !== 'object' || !str(d.group) || !str(d.groupKey) || typeof d.ruleId !== 'string' || typeof d.normalizedSelector !== 'string' ||
      !(REVIEW_DECISIONS as readonly string[]).includes(d.decision as string) || !str(d.by) || typeof d.at !== 'string' || !isIsoDate(d.at)) {
    throw new Error('Invalid group decision.');
  }
  if (d.reason !== undefined && typeof d.reason !== 'string') throw new Error('Invalid group decision reason.');
  if (d.decision !== 'to-fix' && !str(d.reason)) throw new Error(`A ${d.decision} decision needs a reason.`);
  if (d.expires !== undefined && (typeof d.expires !== 'string' || !isIsoDate(d.expires))) throw new Error('Group decision expiry must be YYYY-MM-DD.');
  if (d.expires !== undefined && d.decision !== 'accepted-risk') throw new Error('Only accepted-risk decisions can expire.');
  if (groupId(d.groupKey as string) !== d.group) throw new Error('Group decision id does not match its group key.');
  return d as GroupDecision;
}

export function createGroupDecision(group: Pick<SharedComponentGroup, 'key' | 'ruleId' | 'normalizedSelector'>, input: {
  decision: ReviewDecisionKind; reason?: string; expires?: string; by: string; now: Date;
}): GroupDecision {
  const reason = input.reason?.trim();
  return validateGroupDecision({
    group: groupId(group.key), groupKey: group.key, ruleId: group.ruleId, normalizedSelector: group.normalizedSelector,
    decision: input.decision, ...(reason ? { reason } : {}), ...(input.expires ? { expires: input.expires } : {}),
    by: input.by.trim(), at: today(input.now),
  });
}

/** Audit trail entry kept in the baseline's history[] (R44). Entries are appended, never rewritten. */
export const DECISION_HISTORY_ACTIONS = ['record', 'remove', 'prune'] as const;
export type DecisionHistoryAction = (typeof DECISION_HISTORY_ACTIONS)[number];
export type DecisionHistoryEntry = {
  action: DecisionHistoryAction;
  /** git user.name from local config, else "unknown". */
  by: string;
  /** ISO 8601 timestamp of the change. */
  at: string;
  group: string;
  /** The decision recorded by this change (action "record" only). */
  decision?: GroupDecision;
  /** The earlier decision this change replaced or removed, kept verbatim. */
  previous?: GroupDecision;
};

export function validateHistoryEntry(value: unknown): DecisionHistoryEntry {
  const h = value as Partial<DecisionHistoryEntry> | null;
  if (!h || typeof h !== 'object' || !(DECISION_HISTORY_ACTIONS as readonly string[]).includes(h.action as string) ||
      typeof h.by !== 'string' || !h.by.trim() || typeof h.at !== 'string' || Number.isNaN(Date.parse(h.at)) || typeof h.group !== 'string' || !h.group) {
    throw new Error('Invalid group decision history entry.');
  }
  if (h.decision !== undefined) validateGroupDecision(h.decision);
  if (h.previous !== undefined) validateGroupDecision(h.previous);
  if (h.action === 'record' && !h.decision) throw new Error('A record history entry needs its decision.');
  if (h.action !== 'record' && !h.previous) throw new Error(`A ${h.action} history entry needs the removed decision.`);
  return h as DecisionHistoryEntry;
}

/** Replace any earlier decision for the same group; keeps a stable order. */
export function upsertGroupDecision(decisions: readonly GroupDecision[], decision: GroupDecision): GroupDecision[] {
  return [...decisions.filter((d) => d.groupKey !== decision.groupKey), decision].sort((a, b) => a.group.localeCompare(b.group));
}

/** Membership is recomputed from the current findings, so a new page matching the group inherits its decision. */
export function applyGroupDecisions<F extends ScanFinding>(findings: readonly F[], decisions: readonly GroupDecision[], now: Date): (F & { reviewDecision?: AppliedReviewDecision })[] {
  const byKey = new Map(decisions.map((d) => [d.groupKey, d]));
  return findings.map((f) => {
    const d = byKey.get(componentGroupKey(f));
    if (!d) return f;
    const expired = isExpired(d, now);
    return { ...f, reviewDecision: { ...d, expired, suppressesGate: !expired && d.decision !== 'to-fix' } };
  });
}

export type ReviewedGroup = { decision: AppliedReviewDecision; findings: ScanFinding[] };

/** Decided findings grouped by decision, for the report's own section. */
export function reviewedGroups(findings: readonly ScanFinding[]): ReviewedGroup[] {
  const groups = new Map<string, ReviewedGroup>();
  for (const f of findings) {
    if (!f.reviewDecision) continue;
    const g = groups.get(f.reviewDecision.group) ?? { decision: f.reviewDecision, findings: [] };
    g.findings.push(f);
    groups.set(f.reviewDecision.group, g);
  }
  return [...groups.values()].sort((a, b) => a.decision.group.localeCompare(b.decision.group));
}

export function decisionLabel(d: AppliedReviewDecision): string {
  return d.decision === 'accepted-risk' && d.expired ? 'accepted-risk (expired)' : d.decision;
}

export function decisionSummary(d: AppliedReviewDecision): string {
  return `${decisionLabel(d)} by ${d.by} on ${d.at}${d.expires ? `; expires ${d.expires}` : ''}${d.reason ? `; reason: ${d.reason}` : ''}`;
}

export function reviewableGroups(findings: readonly ScanFinding[]): SharedComponentGroup[] {
  return groupSharedComponents(findings);
}
