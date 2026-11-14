import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const cli = JSON.parse(readFileSync('packages/cli/package.json', 'utf8'));
const root = JSON.parse(readFileSync('package.json', 'utf8'));
const heavy = ['html_codesniffer', 'accessibility-checker-engine', 'lighthouse', 'puppeteer-core'];

describe('optional engine distribution', () => {
  it('keeps every heavy engine out of production dependencies and npm auto-installed peers', () => {
    for (const name of heavy) {
      expect(root.dependencies?.[name]).toBeUndefined();
      expect(cli.dependencies?.[name]).toBeUndefined();
      expect(cli.optionalDependencies?.[name]).toBeUndefined();
      expect(cli.peerDependencies[name]).toBeTruthy();
      expect(cli.peerDependenciesMeta[name]).toEqual({ optional: true });
    }
    expect(cli.dependencies?.pa11y).toBeUndefined();
    const build = readFileSync('packages/cli/build.mjs', 'utf8');
    for (const name of heavy) expect(build).toContain(`'${name}'`);
  });

  it('verifies installed SPDX licenses and rejects missing or incompatible licenses', () => {
    const output = execFileSync(process.execPath, ['scripts/check-engine-licenses.mjs'], { encoding: 'utf8' });
    for (const name of heavy) {
      const manifest = require(`${name}/package.json`);
      expect(output).toContain(`${name}@${manifest.version}: ${manifest.license}`);
    }
    execFileSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { verifyEngineLicense } from './scripts/check-engine-licenses.mjs';
      for (const license of [undefined, 'LGPL-3.0-only', 'UNLICENSED', 'GPL-3.0-only']) {
        assert.throws(() => verifyEngineLicense({name: 'fixture', version: '1', license}, 'Apache-2.0'), /Engine license rejected/);
      }
    `]);
  });
});
