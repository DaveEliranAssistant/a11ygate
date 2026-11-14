import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      '.next/**',
      'out/**',
      'build/**',
      'next-env.d.ts',
      'playwright-report/**',
      'test-results/**',
      'blob-report/**',
      'packages/cli/dist/**',
      'action/dist/**',
      'examples/recipes/*/.next/**',
      'examples/recipes/*/dist/**',
      'examples/recipes/*/storybook-static/**',
      'examples/recipes/*/.angular/**',
    ],
  },
];

export default eslintConfig;
