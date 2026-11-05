'use client';
import { useState, type FormEvent } from 'react';
import { parseManualEvidence,manualEvidenceDocument,type ManualCheck } from '@/lib/manual-evidence';
import { downloadText } from '@/lib/download';
import { MAX_AXE_JSON_BYTES } from '@/lib/limits';
export function ManualEvidence({checks,onChange}:{checks:ManualCheck[];onChange:(checks:ManualCheck[])=>void}){
 const [error,setError]=useState('');
 function add(e:FormEvent<HTMLFormElement>){
  e.preventDefault();const form=e.currentTarget;const data=new FormData(form);const next=Object.fromEntries(['id','scope','check','reviewer','date','status','notes'].map(k=>[k,data.get(k)]));
  const parsed=parseManualEvidence(JSON.stringify({schemaVersion:1,checks:[...checks,next]}));
  if(!parsed.ok){setError(parsed.error);return;}setError('');onChange(parsed.checks);form.reset();
 }
 return <section aria-labelledby="manual-evidence-heading">
  <h2 id="manual-evidence-heading">Structured manual evidence</h2>
  <p>Separate human assertions, not automated checks. Reviewer identity and review quality are not verified; dates do not establish freshness. These editable records never improve the automated regression gate or certify accessibility. Stored in this tab only, unless you export them.</p>
  <p>{checks.length} records. Missing records and any scope outside the notes remain unassessed.</p>
  <form onSubmit={add}>
   {(['id','scope','check','reviewer','date'] as const).map(key=><div key={key}><label htmlFor={'manual-'+key}>{({id:'Check ID',scope:'Manual scope',check:'Manual check',reviewer:'Reviewer',date:'Review date'})[key]}</label><input id={'manual-'+key} name={key} type={key==='date'?'date':'text'} required maxLength={key==='scope'?1024:256}/></div>)}
   <label htmlFor="manual-status">Manual status</label><select id="manual-status" name="status" defaultValue="not-assessed"><option value="not-assessed">Not assessed</option><option value="passed">Passed — reviewer assertion</option><option value="failed">Failed — reviewer assertion</option></select>
   <label htmlFor="manual-notes">Manual notes</label><textarea id="manual-notes" name="notes" required maxLength={4000}/>
   <button type="submit">Add manual evidence</button>
  </form>
  {error?<p role="alert">{error}</p>:null}
  <label htmlFor="manual-import">Import manual evidence JSON</label><input id="manual-import" type="file" accept=".json,application/json" onChange={async e=>{const f=e.target.files?.[0];e.target.value='';if(!f)return;if(f.size>MAX_AXE_JSON_BYTES){setError('Manual evidence exceeds 8 MB.');return;}try{const r=parseManualEvidence(await f.text());if(!r.ok){setError(r.error);return;}onChange(r.checks);setError('');}catch{setError('Could not read manual evidence.');}}}/>
  <button type="button" onClick={()=>downloadText('a11ygate-manual-evidence.json',manualEvidenceDocument(checks),'application/json')}>Download manual evidence JSON</button>
  <ul>{checks.map(c=><li key={c.id}><strong>{c.check}: {c.status}</strong><p>Scope: {c.scope}; reviewer: {c.reviewer}; date: {c.date}; ID: {c.id}</p><p>{c.notes}</p><button type="button" onClick={()=>onChange(checks.filter(x=>x.id!==c.id))}>Remove evidence {c.id}</button></li>)}</ul>
 </section>;
}
