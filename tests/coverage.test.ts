import { describe, expect, it } from 'vitest';
import { compareScans } from '@/lib/compare';
import { parseAxeJson } from '@/lib/parse';
import { gateVerdict } from '@/lib/gate';
import { baselineReview } from '@/lib/export-baseline';
import { findingGuidance } from '@/lib/guidance';
import { minimalResult } from './helpers';
const page = (url = 'https://example.test/cart', extra = {}) => minimalResult({url, toolOptions:{runOnly:['wcag2a','wcag2aa']}, ...extra});
describe('coverage-aware regression evidence', () => {
 it('does not label omitted pages as fixes and blocks a green gate', () => {
  const d=compareScans([page('https://example.test/',{violations:[]})],[page()]);
  expect(d.fixedFindings).toHaveLength(0);expect(d.unassessed).toHaveLength(1);
  expect(d.coverage?.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'missing-page'})]));
  expect(gateVerdict(d.newFindings,'serious',d.coverage)).toBe('INCOMPLETE');
 });
 it('shows failed scans separately, never as fixes',()=>{
  const d=compareScans([page(undefined,{violations:[],scanStatus:'failed',scanError:'navigation timed out'})],[page()]);
  expect(d.fixedFindings).toHaveLength(0);expect(d.unassessed).toHaveLength(1);
  expect(d.coverage?.issues.some(x=>x.code==='failed-scan')).toBe(true);
 });
 it('retains material runOnly, scope and engine differences',()=>{
  for(const extra of [{toolOptions:{runOnly:['best-practice']}},{scanConfig:{viewport:'mobile'}},{testEngine:{version:'99.0.0'}}]){
   const raw=parseAxeJson(JSON.stringify(page(undefined,{...extra,violations:[]})));expect(raw.ok).toBe(true);if(!raw.ok)continue;
   const d=compareScans(raw.results,[page()]);expect(d.fixedFindings).toHaveLength(0);expect(d.coverage?.status).toBe('incomplete');
  }
 });
 it('matches page URL query/state rather than dropping query strings',()=>{
  const d=compareScans([page('https://example.test/cart?state=empty',{violations:[]})],[page('https://example.test/cart?state=full')]);
  expect(d.fixedFindings).toHaveLength(0);expect(d.unassessed).toHaveLength(1);
 });
 it('rejects duplicate page evidence as ambiguous instead of choosing the favorable scan',()=>{
  const d=compareScans([page(),page(undefined,{violations:[]})],[page()]);
  expect(d.coverage?.issues.some(x=>x.code==='duplicate-page')).toBe(true);
 });
 it('does not call selector relocation a confirmed fix',()=>{
  const next=page();next.violations[0].nodes[0].target=['.new-price'];
  const d=compareScans([next],[page()]);expect(d.newFindings).toHaveLength(1);expect(d.fixedFindings).toHaveLength(0);
  expect(d.unassessed?.[0].assessmentReason).toMatch(/selector/i);
 });
 it('keeps normalized selector matches still open and preserves their current element',()=>{
  const old=page();old.violations[0].nodes[0].target=['.price:nth-child(1)'];
  const next=page();next.violations[0].nodes[0].target=['.price:nth-child(2)'];
  const d=compareScans([next],[old]);expect(d.stillOpen).toHaveLength(1);expect(d.stillOpen[0].selector).toContain('(2)');
 });
 it('only reports absence as fixed on comparable scanned pages',()=>{
  const d=compareScans([page(undefined,{violations:[]})],[page()]);expect(d.fixedFindings).toHaveLength(1);expect(d.coverage?.status).toBe('complete');
 });
 it('retains known new regression FAIL even when another page is missing',()=>{
  const d=compareScans([page('https://example.test/new')],[page()]);expect(gateVerdict(d.newFindings,'serious',d.coverage)).toBe('FAIL');
 });
 it('makes acceptance review enumerate every newly accepted and retained fingerprint',()=>{
  const current=page();const d=compareScans([current],null);const r=baselineReview([current],d);
  expect(r.newlyAccepted.map(x=>x.fingerprint)).toEqual(d.newFindings.map(x=>x.fingerprint));
  expect(r.acceptedFindings).toHaveLength(1);expect(r.approval).toBe('review-required');
 });
 it('exposes unrecorded configuration and unassessed manual scope even when the gate passes',()=>{
  const d=compareScans([minimalResult()],[minimalResult()]);expect(d.coverage?.status).toBe('unverified');
  expect(d.coverage?.unassessedScope.join(' ')).toMatch(/manual/i);expect(d.stillOpen).toHaveLength(1);
 });
 it('includes rule-specific user impact, remediation and concrete verification',()=>{
  const d=compareScans([page()],null);const g=findingGuidance(d.newFindings[0]);
  expect(g.userImpact).toMatch(/vision|contrast/i);expect(g.remediation).toMatch(/contrast|color/i);expect(g.verification.length).toBeGreaterThan(1);
 });
 it('rejects malformed coverage metadata and invalid calendar timestamps',()=>{
  for(const extra of [{scanStatus:'success-ish'},{toolOptions:[]},{scanConfig:'mobile'},{timestamp:'2026-13-99T22:00:00Z'},{timestamp:'2026-02-30T22:00:00Z'},{scanStatus:'failed',scanError:''},{scanError:'navigation timed out'},{scanStatus:'complete',scanError:'navigation timed out'}]){
   expect(parseAxeJson(JSON.stringify(page(undefined,extra))).ok).toBe(false);
  }
 });
});
