import { describe,it,expect } from 'vitest';
import { parseManualEvidence,manualEvidenceDocument } from '@/lib/manual-evidence';
const entry={id:'keyboard-checkout',scope:'/checkout, desktop, signed out',check:'Keyboard checkout journey',reviewer:'Synthetic Reviewer',date:'2026-11-03',status:'not-assessed',notes:'SYNTHETIC record: not a completed review.'};
describe('structured manual evidence, not automated assessment',()=>{
 it('round trips explicit reviewer/date/status/notes without upgrading not-assessed',()=>{const r=parseManualEvidence(JSON.stringify({schemaVersion:1,checks:[entry]}));expect(r.ok).toBe(true);if(!r.ok)return;expect(r.checks[0]).toEqual(entry);expect(JSON.parse(manualEvidenceDocument(r.checks)).checks[0].status).toBe('not-assessed');});
 it('rejects invented pass statuses, empty identity/date/notes and impossible calendar dates',()=>{for(const change of [{status:'PASS'},{status:'success'},{reviewer:''},{date:'2026-02-30'},{date:'yesterday'},{notes:''},{scope:''}])expect(parseManualEvidence(JSON.stringify({schemaVersion:1,checks:[{...entry,...change}]})).ok).toBe(false);});
 it('rejects malformed, oversized and duplicate-ID documents',()=>{for(const raw of ['{','[]',JSON.stringify({schemaVersion:2,checks:[]}),JSON.stringify({schemaVersion:1,checks:[entry,entry]}),' '.repeat(8*1024*1024+1)])expect(parseManualEvidence(raw).ok).toBe(false);});
 it('preserves failed and passed human assertions distinctly, never converts them into axe findings',()=>{for(const status of ['failed','passed']){const r=parseManualEvidence(JSON.stringify({schemaVersion:1,checks:[{...entry,status}]}));expect(r.ok).toBe(true);if(r.ok){expect(r.checks[0].status).toBe(status);expect(r.checks[0]).not.toHaveProperty('violations');}}});
});
