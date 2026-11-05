import { diffScans } from '@/lib/diff';
import { findingsFromResults } from '@/lib/parse';
import { pagePath } from '@/lib/fingerprint';
import type { AxeResults, CoverageComparison, DiffedFinding, DiffResult, Finding } from '@/lib/types';

/** Origins may differ between local CI servers. Query/hash state is NOT discarded. */
export function scanPageKey(url: string): string {
  try { const u = new URL(url); return pagePath(url) + u.search + u.hash; }
  catch { return url.trim(); }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
}
function config(result: AxeResults): string {
  return canonical({engine:result.testEngine.version,options:result.toolOptions??null,context:result.scanConfig??null,environment:result.testEnvironment??null});
}
function group(results: readonly AxeResults[]): Map<string,AxeResults[]> {
  const out = new Map<string,AxeResults[]>();
  for (const r of results) { const key=scanPageKey(r.url);out.set(key,[...(out.get(key)??[]),r]); }
  return out;
}
function scopedFindings(results: readonly AxeResults[]): Finding[] {
  return results.flatMap(r=>findingsFromResults([r]).map(f=>({...f,fingerprint: scanPageKey(r.url) === f.path ? f.fingerprint : f.fingerprint+'|scope:'+scanPageKey(r.url)})));
}
/** Compose the existing finding diff with observed page/configuration evidence. */
export function compareScans(current: readonly AxeResults[], baseline: readonly AxeResults[] | null): DiffResult {
  const next=group(current), base=group(baseline??[]);
  const coverage: CoverageComparison={status:'complete',issues:[],pages:[],unassessedScope:[
    'Only supplied page/query/hash states are assessed; undiscovered pages and interactions are unassessed.',
    'Manual keyboard, screen-reader and usability checks are not performed by the automated gate.',
    'Origins are intentionally ignored for local CI hosts; equivalent environments must be established by the caller.',
    'Normalized selectors are heuristic identities, not proof that every affected element is unchanged.'
  ],unassessedFindings:0};
  const blocked=new Set<string>();
  const issue=(page:string,code:string,detail:string,blocking=true)=>{
    coverage.issues.push({page,code,detail});
    if(blocking){blocked.add(page);coverage.status='incomplete';}
    else if(coverage.status==='complete')coverage.status='unverified';
  };
  for(const key of new Set([...base.keys(),...next.keys()])){
    const a=next.get(key)??[], b=base.get(key)??[];
    if(!a.length)issue(key,'missing-page','Page was in the baseline but is absent from the current input; previous findings are unassessed, not fixed.');
    if(a.length>1 || b.length>1)issue(key,'duplicate-page','Multiple scans for this page/state are ambiguous; provide distinct query/hash states or separate comparisons.');
    if([...a,...b].some(r=>r.scanStatus==='failed' || !!r.scanError))issue(key,'failed-scan',[...a,...b].filter(r=>r.scanStatus==='failed').map(r=>r.scanError).join('; '));
    if(a.length===1 && b.length===1 && config(a[0])!==config(b[0]))issue(key,'configuration-changed','Engine, toolOptions, scanConfig or testEnvironment differs or is missing on one side; absence is not a fix.');
    if([...a,...b].some(r=>!r.toolOptions && !r.scanConfig))issue(key,'configuration-unrecorded','Rule selection, exclusions, viewport and authentication context were not fully recorded; equivalence is unverified.',false);
    if([...a].some(r=>(r.incomplete?.length??0)>0))issue(key,'axe-needs-review','axe incomplete results require human review; they are not passes or accepted fixes.',false);
    coverage.pages.push({page:key,current:a.length,baseline:b.length,comparable:!blocked.has(key)});
  }
  const d=diffScans(scopedFindings(current),baseline===null?null:scopedFindings(baseline));
  const unassessed:DiffedFinding[]=[];
  d.fixedFindings=d.fixedFindings.filter(f=>{
    const key=scanPageKey(f.url);
    const relocated=d.newFindings.some(n=>scanPageKey(n.url)===key && n.ruleId===f.ruleId);
    const incomplete=next.get(key)?.some(r=>r.incomplete?.some(v=>v.id===f.ruleId));
    const reason=blocked.has(key)?'Scan coverage is missing, failed or materially incomparable.':relocated?'A selector changed or another occurrence was found; resolution is unverified.':incomplete?'axe reported this rule as incomplete; manual review is needed.':null;
    if(reason){unassessed.push({...f,status:'unassessed',assessmentReason:reason});return false;}
    return true;
  });
  coverage.unassessedFindings=unassessed.length;
  return {...d,unassessed,coverage,all:[...d.newFindings,...d.fixedFindings,...d.stillOpen,...unassessed]};
}
