import { describe,it,expect } from 'vitest';
import { mkdtemp,writeFile,readFile,rm,symlink,lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';import path from 'node:path';
import { run } from '../packages/cli/src/run';import { minimalResult } from './helpers';
async function scenario(current:unknown,baseline:unknown,args:string[]=[]){
 const dir=await mkdtemp(path.join(tmpdir(),'a11ygate-coverage-'));const c=path.join(dir,'current.json'),b=path.join(dir,'baseline.json'),j=path.join(dir,'report.json');
 await writeFile(c,JSON.stringify(current));await writeFile(b,JSON.stringify(baseline));let out='';let err='';
 const invoke=(extra:string[]=[])=>run(['--current',c,'--baseline',b,'--json',j,...args,...extra],{stdout:s=>out+=s,stderr:s=>err+=s});
 return {dir,c,b,j,invoke,out:()=>out,err:()=>err};
}
describe('actual CLI coverage and baseline proposal',()=>{
 it('rejects dangling output symlink aliases before writing a baseline or acceptance sidecar',async()=>{
  const s=await scenario(minimalResult(),minimalResult());const target=path.join(s.dir,'proposed.json');await symlink(target,target+'.review.json');
  try{expect(await s.invoke(['--update-baseline',target])).toBe(2);expect((await lstat(target+'.review.json')).isSymbolicLink()).toBe(true);await expect(readFile(target,'utf8')).rejects.toMatchObject({code:'ENOENT'});}finally{await rm(s.dir,{recursive:true,force:true});}
 });
 it('records manual assertions separately without clearing automated failures; malformed manual input is an error',async()=>{
  const s=await scenario(minimalResult(),minimalResult({violations:[]}));const f=path.join(s.dir,'manual.json');
  const entry={id:'synthetic',scope:'/products',check:'Keyboard',reviewer:'Synthetic Reviewer',date:'2026-11-03',status:'passed',notes:'Synthetic evidence, not a real review.'};
  try{await writeFile(f,JSON.stringify({schemaVersion:1,checks:[entry]}));expect(await s.invoke(['--manual-evidence',f])).toBe(1);const r=JSON.parse(await readFile(s.j,'utf8'));expect(r.manualChecks).toEqual([entry]);expect(r.verdict).toBe('FAIL');const saved=await readFile(f,'utf8');expect(await s.invoke(['--manual-evidence',f,'--update-baseline',f])).toBe(2);expect(await readFile(f,'utf8')).toBe(saved);await writeFile(f,'{}');expect(await s.invoke(['--manual-evidence',f])).toBe(2);}finally{await rm(s.dir,{recursive:true,force:true});}
 });
 it('returns INCOMPLETE/2 and no false fixes for omitted pages',async()=>{
  const s=await scenario(minimalResult({url:'https://sample.test/other',violations:[]}),minimalResult());
  try{expect(await s.invoke()).toBe(2);const r=JSON.parse(await readFile(s.j,'utf8'));expect(r.verdict).toBe('INCOMPLETE');expect(r.counts.fixed).toBe(0);expect(r.findings.unassessed).toHaveLength(1);expect(s.out()).toContain('Missing');}finally{await rm(s.dir,{recursive:true,force:true});}
 });
 it('keeps debt, configuration uncertainty and user guidance visible under PASS',async()=>{
  const s=await scenario(minimalResult(),minimalResult());
  try{expect(await s.invoke()).toBe(0);const r=JSON.parse(await readFile(s.j,'utf8'));expect(r.counts.stillOpen).toBe(1);expect(r.coverage.status).toBe('unverified');expect(r.findings.stillOpen[0].guidance.userImpact).toMatch(/vision/i);expect(s.out()).toContain('Unassessed scope');}finally{await rm(s.dir,{recursive:true,force:true});}
 });
 it('writes the exact acceptance proposal alongside a requested baseline without clearing this gate',async()=>{
  const s=await scenario(minimalResult(),minimalResult({violations:[]}));const target=path.join(s.dir,'proposed.json');
  try{expect(await s.invoke(['--update-baseline',target])).toBe(1);const review=JSON.parse(await readFile(target+'.review.json','utf8'));expect(review.newlyAccepted).toHaveLength(1);expect(review.newlyAccepted[0].selector).toBe('.price-tag');expect(review.approval).toBe('review-required');}finally{await rm(s.dir,{recursive:true,force:true});}
 });
 it('refuses a baseline proposal on lost coverage and leaves any existing baseline untouched',async()=>{
  const s=await scenario(minimalResult({url:'https://sample.test/other',violations:[]}),minimalResult());const target=path.join(s.dir,'approved.json');await writeFile(target,'DO NOT CHANGE');
  try{expect(await s.invoke(['--update-baseline',target])).toBe(2);expect(await readFile(target,'utf8')).toBe('DO NOT CHANGE');}finally{await rm(s.dir,{recursive:true,force:true});}
 });
 it('rejects output paths that alias input data before overwriting anything',async()=>{
  const s=await scenario(minimalResult(),minimalResult());const original=await readFile(s.c,'utf8');
  try{expect(await s.invoke(['--markdown',s.c])).toBe(2);expect(await readFile(s.c,'utf8')).toBe(original);}finally{await rm(s.dir,{recursive:true,force:true});}
 });
});
