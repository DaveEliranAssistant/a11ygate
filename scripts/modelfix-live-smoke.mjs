#!/usr/bin/env node
/**
 * MANUAL, OPT-IN live smoke test for the free-tier model adapters (A11Y-R5).
 *
 * Not part of `npm test`, `pretest`, `test:e2e` or any CI workflow. It makes
 * real provider requests, so it refuses to run unless you set
 * `A11YGATE_LIVE_SMOKE=1` yourself, in your own shell, with your own
 * free-plan credentials. This file contains no keys; never add any.
 *
 *   A11YGATE_LIVE_SMOKE=1 \
 *   GROQ_API_KEY=... A11YGATE_MODEL_GROQ_MODEL=... \
 *   node scripts/modelfix-live-smoke.mjs [groq|gemini|cloudflare ...]
 *
 * Gemini needs GEMINI_API_KEY + A11YGATE_MODEL_GEMINI_MODEL. Cloudflare needs
 * CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID + A11YGATE_MODEL_CLOUDFLARE_MODEL.
 *
 * It sends ONE synthetic fixture snippet (no repository content) per selected
 * provider, at most one request each (budget = number of providers), and
 * prints only sanitized status: provider state, outcome and rejection codes.
 * It never prints prompts, replies or credentials. Check your provider plan
 * first: a key alone does not prove that requests are free.
 */
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (process.env.A11YGATE_LIVE_SMOKE !== '1') {
  console.error('Refusing to run: this script calls live model providers. Set A11YGATE_LIVE_SMOKE=1 to opt in.');
  process.exit(2);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const known = ['groq', 'gemini', 'cloudflare'];
const selected = process.argv.slice(2).length ? process.argv.slice(2) : known;
if (selected.some((id) => !known.includes(id))) {
  console.error(`Unknown provider. Choose from: ${known.join(', ')}`);
  process.exit(2);
}

const dir = await mkdtemp(path.join(os.tmpdir(), 'a11ygate-live-smoke-'));
try {
  const outfile = path.join(dir, 'modelfix.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'lib', 'modelfix', 'index.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'silent',
    plugins: [
      {
        name: 'at-alias',
        setup(context) {
          context.onResolve({ filter: /^@\// }, (args) => {
            const base = path.join(repoRoot, args.path.slice(2));
            return { path: existsSync(`${base}.ts`) ? `${base}.ts` : path.join(base, 'index.ts') };
          });
        },
      },
    ],
  });
  const modelfix = await import(pathToFileURL(outfile).href);

  // Synthetic fixture only.
  const page = ['<!doctype html>', '<html lang="en">', '<body>', '  <p class="muted" style="color:#aaa">Sample text</p>', '</body>', '</html>', ''].join('\n');
  const files = [{ path: 'fixture/index.html', content: page, diffLines: new Set(page.split('\n').map((_, i) => i + 1)) }];
  const findings = [{ fingerprint: 'smoke-contrast', ruleId: 'color-contrast', html: '<p class="muted" style="color:#aaa">', status: 'new' }];

  for (const id of selected) {
    const env = {
      ...process.env,
      A11YGATE_MODEL_PROVIDERS: id,
      A11YGATE_MODEL_MAX_REQUESTS: '1',
      A11YGATE_MODEL_TIMEOUT_MS: process.env.A11YGATE_MODEL_TIMEOUT_MS || '20000',
    };
    const config = modelfix.resolveModelFixConfig({ repoConfig: 'modelFixes: true\n', flag: 'on', env });
    const adapters = modelfix.freeTierAdapters({ env });
    const result = await modelfix.planWithModelFixes({ findings, files, config, env, adapters });
    const route = result.model.routes[0]?.model ?? null;
    console.log(
      JSON.stringify({
        provider: id,
        status: result.model.status,
        requests: result.model.modelRequests,
        outcome: route?.outcome ?? null,
        rejections: route?.rejections ?? [],
        providerState: result.model.providers?.find((p) => p.id === id)?.state ?? 'not-configured',
      }),
    );
  }
  console.log('Automated testing only. Not a WCAG audit, certification or legal advice.');
} finally {
  await rm(dir, { recursive: true, force: true });
}
