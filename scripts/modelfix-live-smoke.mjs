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
 *
 * A provider whose credentials/model are missing is reported as `skipped`
 * (not configured) and does not fail the run; with nothing configured the
 * script exits 0. Optional flags (used by .github/workflows/provider-smoke.yml):
 *   --json-out <file>   write the sanitized JSON artifact
 *   --summary <file>    append a sanitized Markdown table (e.g. $GITHUB_STEP_SUMMARY)
 */
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { KNOWN_PROVIDERS, missingSecrets, runProviderSmoke, smokeArtifact, smokeSummary } from './provider-smoke-lib.mjs';

if (process.env.A11YGATE_LIVE_SMOKE !== '1') {
  console.error('Refusing to run: this script calls live model providers. Set A11YGATE_LIVE_SMOKE=1 to opt in.');
  process.exit(2);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const options = { jsonOut: null, summary: null };
const selected = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--json-out' || args[i] === '--summary') {
    const value = args[i + 1];
    if (!value) {
      console.error(`${args[i]} needs a file path.`);
      process.exit(2);
    }
    options[args[i] === '--json-out' ? 'jsonOut' : 'summary'] = value;
    i += 1;
  } else {
    selected.push(args[i]);
  }
}
if (selected.some((id) => !KNOWN_PROVIDERS.includes(id))) {
  console.error(`Unknown provider. Choose from: ${KNOWN_PROVIDERS.join(', ')}`);
  process.exit(2);
}
const providers = selected.length ? selected : [...KNOWN_PROVIDERS];

/** Bundles lib/modelfix only when at least one provider is configured. */
async function loadModelfix(dir) {
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
  return import(pathToFileURL(outfile).href);
}

const dir = await mkdtemp(path.join(os.tmpdir(), 'a11ygate-live-smoke-'));
let exitCode = 0;
try {
  const anyConfigured = providers.some((id) => missingSecrets(id, process.env).length === 0);
  const modelfix = anyConfigured ? await loadModelfix(dir) : null;
  const run = await runProviderSmoke({ env: process.env, providers, modelfix });
  exitCode = run.exitCode;
  if (options.jsonOut) await writeFile(options.jsonOut, `${JSON.stringify(smokeArtifact(run.results), null, 2)}\n`);
  if (options.summary) await appendFile(options.summary, `${smokeSummary(run.results)}\n`);
  console.log('Automated testing only. Not a WCAG audit, certification or legal advice.');
} finally {
  await rm(dir, { recursive: true, force: true });
}
process.exit(exitCode);
