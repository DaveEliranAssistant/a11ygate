import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
// Narrow allowlist: do not silently accept a newly missing or changed license.
export const ENGINE_LICENSES = {
  html_codesniffer: 'BSD-3-Clause',
  'accessibility-checker-engine': 'Apache-2.0',
  'accessibility-checker': 'Apache-2.0',
  lighthouse: 'Apache-2.0',
  'puppeteer-core': 'Apache-2.0',
};

export function verifyEngineLicense(manifest, expected) {
  if (!manifest.license || manifest.license !== expected) {
    throw new Error(`Engine license rejected: ${manifest.name}@${manifest.version}: ${manifest.license ?? 'missing'} (expected ${expected}). Review distribution compatibility before updating the allowlist.`);
  }
}

export function checkEngineLicenses() {
  const checked = [];
  for (const [name, expected] of Object.entries(ENGINE_LICENSES)) {
    let entry;
    try { entry = require.resolve(name); } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND') continue; // Optional engines may be absent.
      throw error;
    }
    let directory = path.dirname(entry);
    let manifest;
    while (directory !== path.dirname(directory)) {
      const candidate = path.join(directory, 'package.json');
      if (existsSync(candidate)) {
        const parsed = JSON.parse(readFileSync(candidate, 'utf8'));
        if (parsed.name === name) { manifest = parsed; break; }
      }
      directory = path.dirname(directory);
    }
    if (!manifest) throw new Error(`Missing license manifest for installed engine ${name}.`);
    verifyEngineLicense(manifest, expected);
    checked.push(`${name}@${manifest.version}: ${manifest.license}`);
  }
  return checked;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(checkEngineLicenses().join('\n') || 'No optional engine packages installed.');
}
