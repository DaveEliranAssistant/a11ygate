import { MAX_AXE_JSON_BYTES, axeJsonByteLength } from '@/lib/limits';
export type ManualCheck = {id:string;scope:string;check:string;reviewer:string;date:string;status:'passed'|'failed'|'not-assessed';notes:string};
export type ManualParse = {ok:true;checks:ManualCheck[]}|{ok:false;error:string};
export function parseManualEvidence(text:string):ManualParse {
 try {
  if(text.length>MAX_AXE_JSON_BYTES || axeJsonByteLength(text)>MAX_AXE_JSON_BYTES)throw Error('Manual evidence exceeds 8 MB.');
  const v=JSON.parse(text);if(!v || v.schemaVersion!==1 || !Array.isArray(v.checks) || v.checks.length>200)throw Error('Expected schemaVersion 1 and at most 200 checks.');
  const ids=new Set<string>();const checks:ManualCheck[]=[];
  for(const x of v.checks){
   if(!x || typeof x!=='object' || Array.isArray(x))throw Error('Every manual check must be an object.');
   for(const [key,max] of Object.entries({id:120,scope:1024,check:256,reviewer:120,date:10,notes:4000})){
    if(typeof x[key]!=='string'||!x[key].trim()||x[key].length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(x[key]))throw Error('Manual check '+key+' is missing, too long or invalid.');
   }
   if(!/^\d{4}-\d{2}-\d{2}$/.test(x.date) || !Number.isFinite(Date.parse(x.date)) || new Date(x.date).toISOString().slice(0,10)!==x.date)throw Error('Manual date must be a real ISO YYYY-MM-DD date.');
   if(!['passed','failed','not-assessed'].includes(x.status))throw Error('Manual status must be passed, failed or not-assessed.');
   if(ids.has(x.id))throw Error('Manual check IDs must be unique.');ids.add(x.id);
   checks.push({id:x.id,scope:x.scope,check:x.check,reviewer:x.reviewer,date:x.date,status:x.status,notes:x.notes});
  }
  return {ok:true,checks};
 }catch(e){return{ok:false,error:e instanceof Error?e.message:'Invalid manual evidence.'};}
}
export function manualEvidenceDocument(checks:readonly ManualCheck[]):string {
 const text=JSON.stringify({schemaVersion:1,checks},null,2)+'\n';const parsed=parseManualEvidence(text);if(!parsed.ok)throw Error(parsed.error);return text;
}
