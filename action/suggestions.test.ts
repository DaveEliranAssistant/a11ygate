import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  newFindingsFromReport,
  postSuggestions,
  readWorkspaceFile,
  reviewCommentPayload,
  type GithubRequest,
} from './suggestions.mjs';

const SHA = 'a'.repeat(40);

const PAGE = [
  '<!doctype html>',
  '<html>',
  '<body>',
  '  <img src="hero.jpg">',
  '  <div class="close" onclick="hide()" aria-label="Close">',
  '  </div>',
  '  <img src="old.png">',
  '</body>',
  '</html>',
  '',
].join('\n');

// Lines 1–6 changed; line 7 (old.png) is outside the diff.
const PATCH = '@@ -0,0 +1,6 @@\n+<!doctype html>\n+<html>\n+<body>\n+  <img src="hero.jpg">\n+  <div class="close" onclick="hide()" aria-label="Close">\n+  </div>';

function finding(fingerprint: string, ruleId: string, html: string, status = 'new') {
  return { status, fingerprint, ruleId, html, impact: 'critical', path: '/', selector: 'x' };
}

const REPORT = {
  findings: {
    new: [
      finding('fp-img', 'image-alt', '<img src="hero.jpg">'),
      finding('fp-div', 'aria-prohibited-attr', '<div class="close" onclick="hide()" aria-label="Close">'),
      finding('fp-lang', 'html-has-lang', '<html>'),
      finding('fp-old', 'image-alt', '<img src="old.png">'),
      finding('fp-contrast', 'color-contrast', '<p>'),
    ],
    stillOpen: [finding('fp-open', 'image-alt', '<img src="hero.jpg">', 'still-open')],
  },
};

type Call = { pathname: string; method: string; body?: Record<string, unknown> };

function fakeGithub(options: { existing?: unknown[]; failPost?: boolean } = {}) {
  const calls: Call[] = [];
  const github: GithubRequest = async (pathname, init = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ pathname, method, body: init.body as Record<string, unknown> | undefined });
    if (method === 'GET' && pathname.startsWith('/repos/o/r/pulls/7/files')) {
      return pathname.includes('page=1') ? [{ filename: 'site/index.html', status: 'modified', patch: PATCH }] : [];
    }
    if (method === 'GET' && pathname.startsWith('/repos/o/r/pulls/7/comments')) {
      return pathname.includes('page=1') ? (options.existing ?? []) : [];
    }
    if (method === 'POST' && options.failPost) throw new Error('GitHub request failed (403).');
    return {};
  };
  return { github, calls };
}

async function run(github: GithubRequest, warnings: string[] = []) {
  return postSuggestions({
    report: REPORT,
    github,
    repo: 'o/r',
    pr: '7',
    headSha: SHA,
    lang: 'en',
    warn: (message) => warnings.push(message),
    readFile: (relative) => (relative === 'site/index.html' ? PAGE : null),
  });
}

describe('suggested-change review comments', () => {
  it('posts one review comment per new, in-diff finding with a suggestion block', async () => {
    const { github, calls } = fakeGithub();
    const summary = await run(github);
    const posts = calls.filter((call) => call.method === 'POST');
    expect(summary.created).toBe(3);
    expect(posts).toHaveLength(3);
    for (const post of posts) {
      expect(post.pathname).toBe('/repos/o/r/pulls/7/comments');
      expect(post.body).toMatchObject({ commit_id: SHA, path: 'site/index.html', side: 'RIGHT' });
      const body = String(post.body?.body);
      expect(body).toMatch(/<!-- a11ygate-suggestion:fp-(img|div|lang) -->/);
      expect(body).toContain('```suggestion\n');
      expect(body).toContain('Apply suggestion');
    }
    // Out-of-diff and not-new findings get no review comment.
    expect(posts.some((post) => String(post.body?.body).includes('fp-old'))).toBe(false);
    expect(posts.some((post) => String(post.body?.body).includes('fp-open'))).toBe(false);
    expect(summary.skipped).toEqual(expect.arrayContaining([expect.objectContaining({ fingerprint: 'fp-old', reason: 'outside-diff' })]));
  });

  it('uses start_line for a multi-line replacement and the exact replacement text', async () => {
    const { github, calls } = fakeGithub();
    await run(github);
    const div = calls.find((call) => String(call.body?.body).includes('fp-div'));
    expect(div?.body).toMatchObject({ start_line: 5, line: 6, start_side: 'RIGHT' });
    expect(String(div?.body?.body)).toContain(
      '```suggestion\n  <button type="button" class="close" onclick="hide()" aria-label="Close">\n  </button>\n```',
    );
  });

  it('marks placeholders with TODO(a11ygate) and invents no alt, label or aria text', async () => {
    const { github, calls } = fakeGithub();
    await run(github);
    const img = String(calls.find((call) => String(call.body?.body).includes('fp-img'))?.body?.body);
    expect(img).toContain('<!-- TODO(a11ygate):');
    expect(img).toContain('<img alt="" src="hero.jpg">');
    const lang = String(calls.find((call) => String(call.body?.body).includes('fp-lang'))?.body?.body);
    expect(lang).toContain('<html lang="en"><!-- TODO(a11ygate): confirm "en"');
    for (const call of calls.filter((c) => c.method === 'POST')) {
      const code = String(call.body?.body).split('```suggestion\n')[1].split('\n```')[0];
      for (const match of code.matchAll(/(?:alt|aria-label)="([^"]*)"/g)) {
        // The only aria-label is the one already in the source.
        expect(['', 'Close'].includes(match[1]) || match[1].includes('TODO(a11ygate)')).toBe(true);
      }
    }
  });

  it('skips unchanged comments and patches changed ones on a re-run', async () => {
    const first = fakeGithub();
    await run(first.github);
    const posted = first.calls.filter((call) => call.method === 'POST');
    const existing = posted.map((call, index) => ({ id: 100 + index, path: call.body?.path, line: call.body?.line, body: call.body?.body }));
    existing[0] = { ...existing[0], body: String(existing[0].body).replace('Review before', 'Old text. Review before') };

    const second = fakeGithub({ existing });
    const summary = await run(second.github);
    expect(summary).toMatchObject({ created: 0, updated: 1, unchanged: 2 });
    const patch = second.calls.find((call) => call.method === 'PATCH');
    expect(patch?.pathname).toBe('/repos/o/r/pulls/comments/100');
  });

  it('warns instead of throwing when the API rejects a suggestion', async () => {
    const warnings: string[] = [];
    const { github } = fakeGithub({ failPost: true });
    const summary = await run(github, warnings);
    expect(summary.failed).toBe(3);
    expect(warnings[0]).toContain('could not post a suggested change');
  });

  it('warns instead of throwing when listing files fails', async () => {
    const warnings: string[] = [];
    const summary = await postSuggestions({
      report: REPORT,
      github: async () => {
        throw new Error('GitHub request failed (500).');
      },
      repo: 'o/r',
      pr: '7',
      headSha: SHA,
      warn: (message) => warnings.push(message),
    });
    expect(summary.failed).toBe(1);
    expect(warnings[0]).toContain('skipped suggested changes');
  });

  it('builds a single-line payload without start_line', () => {
    const payload = reviewCommentPayload(
      { fingerprint: 'f', ruleId: 'image-alt', rule: 'image-alt', path: 'a.html', startLine: 3, endLine: 3, original: ['x'], replacement: ['y'], placeholder: false, note: 'n' },
      SHA,
    );
    expect(payload).toEqual(expect.objectContaining({ line: 3, side: 'RIGHT', commit_id: SHA, path: 'a.html' }));
    expect(payload.start_line).toBeUndefined();
  });

  it('reads only new findings from the CLI JSON result', () => {
    expect(newFindingsFromReport(REPORT).map((f) => f.fingerprint)).toEqual(['fp-img', 'fp-div', 'fp-lang', 'fp-old', 'fp-contrast']);
    expect(newFindingsFromReport({})).toEqual([]);
  });
});

describe('workspace file reads', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'a11ygate-ws-'));
  mkdirSync(path.join(root, 'src'));
  writeFileSync(path.join(root, 'src', 'a.html'), '<img>');
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('reads a file in the checkout and refuses paths that leave it', () => {
    expect(readWorkspaceFile(root, 'src/a.html')).toBe('<img>');
    expect(readWorkspaceFile(root, '../etc/passwd')).toBeNull();
    expect(readWorkspaceFile(root, '/etc/passwd')).toBeNull();
    expect(readWorkspaceFile(root, 'src/missing.html')).toBeNull();
  });
});

describe('action contract', () => {
  it('declares suggest-fixes defaulting to true and passes it to run.mjs', () => {
    const source = readFileSync(new URL('./action.yml', import.meta.url), 'utf8');
    expect(source).toMatch(/suggest-fixes:\n[\s\S]*?default: 'true'/);
    expect(source).toContain('A11Y_SUGGEST_FIXES: ${{ inputs.suggest-fixes }}');
    expect(source).toContain('A11Y_HEAD_SHA: ${{ github.event.pull_request.head.sha }}');
    const runner = readFileSync(new URL('./run.mjs', import.meta.url), 'utf8');
    expect(runner).toContain('postSuggestions');
    // Suggestions are only attempted inside the comment branch.
    expect(runner.indexOf('A11Y_SUGGEST_FIXES')).toBeGreaterThan(runner.indexOf("isYes(process.env.A11Y_COMMENT)"));
  });
});
