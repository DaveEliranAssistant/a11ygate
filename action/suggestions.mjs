import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  buildSuggestionBody,
  findSuggestionComment,
  patchLines,
  planSuggestions,
  sourceKind,
} from './dist/fix.mjs';
import { planWithModelFixes } from './dist/modelfix.mjs';

export const MAX_SUGGESTIONS = 25;
const MAX_FILE_BYTES = 1_000_000;

/** New findings from the CLI JSON result. */
export function newFindingsFromReport(report) {
  const list = report && report.findings && Array.isArray(report.findings.new) ? report.findings.new : [];
  return list.filter(
    (item) =>
      item &&
      typeof item.fingerprint === 'string' &&
      typeof item.ruleId === 'string' &&
      typeof item.html === 'string' &&
      (item.status === undefined || item.status === 'new'),
  );
}

/** Reads a changed file from the checkout, refusing paths that leave the workspace. */
export function readWorkspaceFile(workspace, relative) {
  if (!workspace || typeof relative !== 'string' || relative.length === 0) return null;
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) return null;
  const root = realpathSync(workspace);
  const full = path.join(root, relative);
  if (!existsSync(full)) return null;
  const real = realpathSync(full);
  if (real !== root && !real.startsWith(root + path.sep)) return null;
  const stat = statSync(real);
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
  return readFileSync(real, 'utf8');
}

/** Source files for the mapper: changed HTML/JSX/TSX files with their head-side hunk lines. */
export function sourceFilesFromPullFiles(pullFiles, readFile) {
  const files = [];
  for (const entry of Array.isArray(pullFiles) ? pullFiles : []) {
    if (!entry || typeof entry.filename !== 'string' || typeof entry.patch !== 'string') continue;
    if (entry.status === 'removed' || !sourceKind(entry.filename)) continue;
    const content = readFile(entry.filename);
    if (typeof content !== 'string') continue;
    files.push({ path: entry.filename, content, diffLines: patchLines(entry.patch) });
  }
  return files;
}

/** The review-comment payload for POST /repos/{owner}/{repo}/pulls/{pull}/comments. */
export function reviewCommentPayload(suggestion, commitId) {
  const payload = {
    body: buildSuggestionBody(suggestion),
    commit_id: commitId,
    path: suggestion.path,
    line: suggestion.endLine,
    side: 'RIGHT',
  };
  if (suggestion.startLine < suggestion.endLine) {
    payload.start_line = suggestion.startLine;
    payload.start_side = 'RIGHT';
  }
  return payload;
}

async function paginate(github, pathname, maxPages) {
  const items = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const sep = pathname.includes('?') ? '&' : '?';
    const batch = await github(`${pathname}${sep}per_page=100&page=${page}`);
    if (!Array.isArray(batch) || batch.length === 0) break;
    items.push(...batch);
    if (batch.length < 100) break;
  }
  return items;
}

/**
 * Posts rule-based suggested changes as pull request review comments.
 * Never throws: every failure is reported through `warn`, so a suggestion
 * API error cannot fail an otherwise passing gate.
 *
 * `github(pathname, { method, body })` returns parsed JSON or throws.
 */
export async function postSuggestions({ report, github, repo, pr, headSha, workspace, lang, warn, info, readFile, modelFixes, modelAdapters, env }) {
  const summary = { planned: 0, created: 0, updated: 0, unchanged: 0, failed: 0, skipped: [] };
  const log = info ?? (() => {});
  try {
    const findings = newFindingsFromReport(report);
    if (findings.length === 0) return summary;

    let commitId = typeof headSha === 'string' && /^[0-9a-f]{40}$/i.test(headSha) ? headSha : '';
    if (!commitId) {
      const pull = await github(`/repos/${repo}/pulls/${pr}`);
      commitId = pull && pull.head && typeof pull.head.sha === 'string' ? pull.head.sha : '';
    }
    if (!commitId) throw new Error('could not find the pull request head commit');

    const pullFiles = await paginate(github, `/repos/${repo}/pulls/${pr}/files`, 30);
    const reader = readFile ?? ((relative) => readWorkspaceFile(workspace, relative));
    const files = sourceFilesFromPullFiles(pullFiles, reader);
    const plan = planSuggestions(findings, files, { lang });
    summary.skipped = plan.skipped;
    if (modelFixes) {
      // Optional model path (off by default). It only records routing; the F1 plan is posted unchanged.
      const routed = await planWithModelFixes({ findings, files, options: { lang }, config: modelFixes, f1Plan: plan, adapters: modelAdapters, env, sourceCommit: commitId });
      summary.model = routed.model;
      if (modelFixes.enabled) log(routed.model.message);
    }
    const suggestions = plan.suggestions.slice(0, MAX_SUGGESTIONS);
    summary.planned = suggestions.length;
    if (suggestions.length === 0) {
      log('A11yGate found no new findings with a safe rule-based fix on lines in this diff.');
      return summary;
    }

    const existing = await paginate(github, `/repos/${repo}/pulls/${pr}/comments`, 30);
    for (const suggestion of suggestions) {
      const payload = reviewCommentPayload(suggestion, commitId);
      try {
        const previous = findSuggestionComment(existing, suggestion.fingerprint);
        const samePlace = previous && previous.path === payload.path && previous.line === payload.line;
        if (previous && samePlace && previous.body === payload.body) {
          summary.unchanged += 1;
        } else if (previous && samePlace) {
          await github(`/repos/${repo}/pulls/comments/${previous.id}`, { method: 'PATCH', body: { body: payload.body } });
          summary.updated += 1;
        } else {
          await github(`/repos/${repo}/pulls/${pr}/comments`, { method: 'POST', body: payload });
          summary.created += 1;
        }
      } catch (error) {
        summary.failed += 1;
        warn(`A11yGate could not post a suggested change for ${suggestion.path}:${suggestion.endLine}. ${error instanceof Error ? error.message : ''}`.trim());
      }
    }
    log(`A11yGate suggested changes: ${summary.created} new, ${summary.updated} updated, ${summary.unchanged} unchanged.`);
  } catch (error) {
    summary.failed += 1;
    warn(`A11yGate skipped suggested changes. ${error instanceof Error ? error.message : ''}`.trim());
  }
  return summary;
}
