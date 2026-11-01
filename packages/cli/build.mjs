import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageRoot, '../..');
const outfile = path.join(packageRoot, 'dist', 'cli.mjs');
const actionOut = path.join(repoRoot, 'action', 'dist', 'cli.mjs');

await mkdir(path.dirname(outfile), { recursive: true });
await mkdir(path.dirname(actionOut), { recursive: true });

await build({
  entryPoints: [path.join(packageRoot, 'src', 'bin.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile,
  banner: { js: '#!/usr/bin/env node' },
  legalComments: 'none',
  logLevel: 'warning',
  plugins: [
    {
      name: 'at-alias',
      setup(buildContext) {
        buildContext.onResolve({ filter: /^@\// }, (args) => {
          const base = path.join(repoRoot, args.path.slice(2));
          return { path: existsSync(`${base}.ts`) ? `${base}.ts` : base };
        });
      },
    },
  ],
});

await chmod(outfile, 0o755);
await copyFile(outfile, actionOut);
await chmod(actionOut, 0o755);
