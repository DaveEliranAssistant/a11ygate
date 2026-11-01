import baselineFixture from '@/fixtures/demo-shop-baseline.json';
import currentFixture from '@/fixtures/demo-shop-current.json';
import { parseAxeJson } from '@/lib/parse';
import type { AxeResults } from '@/lib/types';

export const DEMO_PROJECT_NAME = 'Demo Shop';

export type DemoData = {
  projectName: string;
  synthetic: true;
  current: AxeResults[];
  baseline: AxeResults[];
};

export function loadDemo(): DemoData {
  const current = parseAxeJson(JSON.stringify(currentFixture));
  const baseline = parseAxeJson(JSON.stringify(baselineFixture));
  if (!current.ok) throw new Error(`Demo current fixture is invalid: ${current.error}`);
  if (!baseline.ok) throw new Error(`Demo baseline fixture is invalid: ${baseline.error}`);
  return {
    projectName: DEMO_PROJECT_NAME,
    synthetic: true,
    current: current.results,
    baseline: baseline.results,
  };
}
