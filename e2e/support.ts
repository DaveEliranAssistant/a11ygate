import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export async function expectNoSeriousViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
  expect(blocking, `${label}\n${JSON.stringify(blocking, null, 2)}`).toEqual([]);
}
