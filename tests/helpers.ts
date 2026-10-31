import type { AxeResults, Finding } from '@/lib/types';

export function makeFinding(overrides: Partial<Finding> & Pick<Finding, 'fingerprint' | 'ruleId'>): Finding {
  return {
    impact: 'serious',
    tags: ['wcag143'],
    help: 'Elements must have sufficient color contrast',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast',
    selector: '.price-tag',
    html: '<span class="price-tag">€12</span>',
    url: 'https://demo.shop/products',
    path: '/products',
    engineVersion: '4.10.2',
    timestamp: '2026-10-15T09:00:00.000Z',
    ...overrides,
  };
}

export function minimalResult(overrides: Record<string, unknown> = {}): AxeResults {
  return {
    url: 'https://demo.shop/products',
    timestamp: '2026-10-15T09:00:00.000Z',
    testEngine: { version: '4.10.2' },
    violations: [
      {
        id: 'color-contrast',
        impact: 'serious',
        tags: ['wcag143'],
        help: 'Elements must have sufficient color contrast',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast',
        nodes: [{ target: ['.price-tag'], html: '<span class="price-tag">€12</span>' }],
      },
    ],
    ...overrides,
  } as AxeResults;
}
