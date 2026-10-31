import { describe, expect, it } from 'vitest';
import { gateVerdict, meetsThreshold, verdictReason } from '@/lib/gate';
import { makeFinding } from './helpers';

describe('gate threshold', () => {
  const serious = makeFinding({ fingerprint: 'a|b|/p', ruleId: 'color-contrast', impact: 'serious' });
  const critical = makeFinding({ fingerprint: 'c|d|/p', ruleId: 'button-name', impact: 'critical' });
  const moderate = makeFinding({ fingerprint: 'e|f|/p', ruleId: 'region', impact: 'moderate' });
  const unspecified = makeFinding({ fingerprint: 'g|h|/p', ruleId: 'custom', impact: null });

  it('fails when a new finding is at the threshold', () => {
    expect(gateVerdict([serious], 'serious')).toBe('FAIL');
    expect(meetsThreshold('serious', 'serious')).toBe(true);
  });

  it('fails when a new finding is above the threshold', () => {
    expect(gateVerdict([critical], 'serious')).toBe('FAIL');
    expect(meetsThreshold('critical', 'moderate')).toBe(true);
  });

  it('passes when every new finding is below the threshold', () => {
    expect(gateVerdict([moderate], 'serious')).toBe('PASS');
    expect(meetsThreshold('moderate', 'serious')).toBe(false);
    expect(meetsThreshold('minor', 'moderate')).toBe(false);
  });

  it('passes when there are no new findings', () => {
    expect(gateVerdict([], 'minor')).toBe('PASS');
    expect(verdictReason([], 'serious')).toBe('No new finding is at or above serious.');
  });

  it('does not let a null impact meet a named threshold', () => {
    expect(meetsThreshold(null, 'minor')).toBe(false);
    expect(gateVerdict([unspecified], 'minor')).toBe('PASS');
  });

  it('names the rules that trip the gate', () => {
    expect(verdictReason([serious, moderate], 'serious')).toBe(
      '1 new finding at or above serious: color-contrast.',
    );
    expect(verdictReason([serious, critical], 'serious')).toBe(
      '2 new findings at or above serious: color-contrast, button-name.',
    );
  });
});
