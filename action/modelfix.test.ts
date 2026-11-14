import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { failingAdapter, resolveModelFixConfig, type ModelAdapter } from '@/lib/modelfix';
import { blockNetwork } from '../tests/network-guard';
import { postSuggestions, type GithubRequest } from './suggestions.mjs';

const SHA = 'c'.repeat(40);
const PAGE = '<html>\n<body>\n  <img src="hero.jpg">\n  <p class="muted">Low contrast</p>\n</body>\n</html>\n';
const PATCH = '@@ -0,0 +1,6 @@\n+<html>\n+<body>\n+  <img src="hero.jpg">\n+  <p class="muted">Low contrast</p>\n+</body>\n+</html>';
const REPORT = {
  findings: {
    new: [
      { status: 'new', fingerprint: 'fp-img', ruleId: 'image-alt', html: '<img src="hero.jpg">' },
      { status: 'new', fingerprint: 'fp-contrast', ruleId: 'color-contrast', html: '<p class="muted">' },
    ],
  },
};

function fakeGithub() {
  const calls: { pathname: string; method: string; body?: unknown }[] = [];
  const github: GithubRequest = async (pathname, init = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ pathname, method, body: init.body });
    if (method === 'GET' && pathname.startsWith('/repos/o/r/pulls/7/files')) {
      return pathname.includes('page=1') ? [{ filename: 'index.html', status: 'modified', patch: PATCH }] : [];
    }
    return method === 'GET' ? [] : {};
  };
  return { github, calls };
}

async function run(extra: Partial<Parameters<typeof postSuggestions>[0]> = {}) {
  const { github, calls } = fakeGithub();
  const info: string[] = [];
  const summary = await postSuggestions({
    report: REPORT,
    github,
    repo: 'o/r',
    pr: '7',
    headSha: SHA,
    lang: 'en',
    warn: () => {},
    info: (message) => info.push(message),
    readFile: (relative) => (relative === 'index.html' ? PAGE : null),
    ...extra,
  });
  return { summary, calls, info };
}

let net: ReturnType<typeof blockNetwork>;
beforeEach(() => {
  net = blockNetwork();
});
afterEach(() => {
  net.restore();
});

describe('action suggestions with the model path', () => {
  it('posts exactly the F1 review comments when models are off, unconfigured, or failing', async () => {
    const baseline = await run();
    expect(baseline.summary.created).toBe(1);
    expect(baseline.summary.model).toBeUndefined();

    const env = { A11YGATE_MODEL_PROVIDERS: 'groq', A11YGATE_MODEL_MAX_REQUESTS: '5', A11YGATE_MODEL_TIMEOUT_MS: '1000' };
    let draftCalls = 0;
    const failing: ModelAdapter = { ...failingAdapter('groq'), draft: async () => { draftCalls += 1; throw new Error('down'); } };
    const variants = [
      { modelFixes: resolveModelFixConfig({}) },
      { modelFixes: resolveModelFixConfig({ repoConfig: 'modelFixes: true', flag: 'off', env }), modelAdapters: [failing], env },
      { modelFixes: resolveModelFixConfig({ repoConfig: null, flag: 'on', env }), modelAdapters: [failing], env },
      { modelFixes: resolveModelFixConfig({ repoConfig: 'modelFixes: true', flag: 'on', env }), env },
      { modelFixes: resolveModelFixConfig({ repoConfig: 'modelFixes: true', flag: 'on', env }), modelAdapters: [failing], env },
    ];
    const statuses: string[] = [];
    for (const variant of variants) {
      const result = await run(variant);
      expect(result.calls).toEqual(baseline.calls);
      const { model, ...rest } = result.summary;
      expect(rest).toEqual(baseline.summary);
      statuses.push(String(model?.status));
    }
    expect(statuses).toEqual(['disabled', 'disabled', 'disabled', 'no-provider', 'adapters-failed']);
    expect(draftCalls).toBe(1);
    expect(net.attempts).toEqual([]);
  });
});
