import { checkEngineLicenses } from '../../scripts/check-engine-licenses.mjs';
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageRoot, '../..');
const outfile = path.join(packageRoot, 'dist', 'cli.mjs');
const actionOut = path.join(repoRoot, 'action', 'dist', 'cli.mjs');

const atAlias = {
  name: 'at-alias',
  setup(buildContext) {
    buildContext.onResolve({ filter: /^@\// }, (args) => {
      const base = path.join(repoRoot, args.path.slice(2));
      return { path: existsSync(`${base}.ts`) ? `${base}.ts` : base };
    });
  },
};

checkEngineLicenses();

await mkdir(path.dirname(outfile), { recursive: true });
await mkdir(path.dirname(actionOut), { recursive: true });

const cliBuild = await build({
  metafile: true,
  entryPoints: [path.join(packageRoot, 'src', 'bin.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile,
  banner: { js: '#!/usr/bin/env node' },
  legalComments: 'none',
  // Optional peer dependencies for `a11ygate scan`; loaded with dynamic import at runtime.
  external: ['playwright', 'playwright-core', '@axe-core/playwright', 'html_codesniffer', 'accessibility-checker-engine', 'lighthouse', 'puppeteer-core'],
  logLevel: 'warning',
  plugins: [atAlias],
});

// All engine packages remain runtime peers, including their transitive code.
// Failing here prevents a future import change from silently bundling engine code.
for (const input of Object.keys(cliBuild.metafile.inputs)) {
  if (input.includes('node_modules/')) throw new Error(`Unexpected bundled dependency: ${input}`);
}

// Pure, network-free fix rules for the Action's suggested changes (action/suggestions.mjs).
await build({
  entryPoints: [path.join(repoRoot, 'lib', 'fix', 'index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: path.join(repoRoot, 'action', 'dist', 'fix.mjs'),
  legalComments: 'none',
  logLevel: 'warning',
  plugins: [atAlias],
});

// Optional model-fix orchestrator (routing only, no provider code or network) for the Action.
await build({
  entryPoints: [path.join(repoRoot, 'lib', 'modelfix', 'index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: path.join(repoRoot, 'action', 'dist', 'modelfix.mjs'),
  legalComments: 'none',
  logLevel: 'warning',
  plugins: [atAlias],
});

// Isolated verifier for the Action (git worktree + local 127.0.0.1 re-scan). Loaded only when model
// fixes are on and the repository opted in. Browser packages stay optional runtime peers.
const verifyBuild = await build({
  metafile: true,
  entryPoints: [path.join(repoRoot, 'lib', 'modelfix-verify', 'index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: path.join(repoRoot, 'action', 'dist', 'modelfix-verify.mjs'),
  legalComments: 'none',
  external: ['playwright', 'playwright-core', '@axe-core/playwright'],
  logLevel: 'warning',
  plugins: [atAlias],
});
for (const input of Object.keys(verifyBuild.metafile.inputs)) {
  if (input.includes('node_modules/')) throw new Error(`Unexpected bundled dependency in modelfix-verify: ${input}`);
}

await chmod(outfile, 0o755);
await copyFile(outfile, actionOut);
await chmod(actionOut, 0o755);
