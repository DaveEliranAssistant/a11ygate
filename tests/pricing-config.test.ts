import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import { build } from 'esbuild';
import { expect, it } from 'vitest';
import pricing from '@/config/pricing.json';
import schema from '@/schema/pricing.schema.json';

const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);

it('validates the shared pricing config against its JSON schema', () => {
  expect(validate(pricing), JSON.stringify(validate.errors)).toBe(true);
});

it.each([0, -1, 1.5, '990', null])('rejects a yearly price of %s', (priceUsdPerYear) => {
  expect(validate({ ...pricing, priceUsdPerYear })).toBe(false);
});

it('bundles the pricing JSON with esbuild for the CLI target', async () => {
  const result = await build({
    stdin: {
      contents: 'export { default } from "./config/pricing.json";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    write: false,
  });
  const bundled = result.outputFiles[0]!.text;
  expect(bundled).toContain(`priceUsdPerYear: ${pricing.priceUsdPerYear}`);
  expect(bundled).not.toMatch(/from\s+['"].*\.json/);
});

it('keeps billing free of payment SDKs, provider domains and embedded credentials', () => {
  const providers = /stripe|lemonsqueezy|paddle|gumroad|braintree|adyen|paypal/i;
  for (const file of ['package.json', 'packages/cli/package.json']) {
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      expect(Object.keys(manifest[section] ?? {}).filter((name) => providers.test(name)), file).toEqual([]);
    }
  }

  for (const file of [
    'app/pricing/page.tsx', 'app/sitemap.ts', 'components/CheckoutButton.tsx', 'lib/billing.ts', 'config/pricing.json',
  ]) {
    const source = readFileSync(file, 'utf8');
    expect(source, file).not.toMatch(providers);
    expect(source, file).not.toMatch(/https?:\/\/[^\s"'\x60]+|-----BEGIN .*PRIVATE KEY-----|(?:api.?key|secret|token)\s*[:=]\s*['"]/i);
  }
});
