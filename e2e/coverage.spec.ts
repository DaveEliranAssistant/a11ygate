import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const scan = (url:string,violations:unknown[]=[]) => ({url,timestamp:'2026-11-03T12:00:00Z',testEngine:{version:'4.11.1'},toolOptions:{runOnly:['wcag2aa']},violations});
const issue={id:'image-alt',impact:'serious',tags:['wcag111'],help:'SYNTHETIC_A11Y_LOCAL_ONLY image needs alternative text',helpUrl:'https://dequeuniversity.com/rules/axe/4.11/image-alt',nodes:[{target:['#hero'],html:'<img id="hero" src="synthetic-only.png">'}]};
async function load(page: import('@playwright/test').Page,kind:'current'|'baseline',data:unknown){await page.locator('#'+kind+'-paste').fill(JSON.stringify(data));await page.getByRole('button',{name:'Parse pasted '+kind+' JSON'}).click();}
test('missing page cannot become a fix or a passing regression gate; processing stays local',async({page})=>{
 const sent:string[]=[];page.on('request',r=>sent.push(r.url()+' '+(r.postData()??'')));
 await page.goto('/');await load(page,'current',scan('https://synthetic.test/'));
 await load(page,'baseline',[scan('https://synthetic.test/'),scan('https://synthetic.test/cart',[issue])]);
 await expect(page.getByTestId('verdict')).toHaveText('INCOMPLETE');await expect(page.getByTestId('count-fixed')).toHaveText('0');
 await expect(page.getByRole('heading',{name:'Scan coverage'})).toBeVisible();await expect(page.getByText('missing-page',{exact:false}).first()).toBeVisible();
 await expect(page.getByRole('button',{name:'Download new baseline JSON'})).toBeDisabled();
 expect(sent.filter(x=>x.includes('SYNTHETIC_A11Y_LOCAL_ONLY'))).toEqual([]);
 const a=await new AxeBuilder({page}).analyze();expect(a.violations).toEqual([]);
});
test('PASS retains debt, actionable guidance and exact baseline acceptance review',async({page})=>{
 await page.goto('/');const data=scan('https://synthetic.test/',[issue]);await load(page,'current',data);await load(page,'baseline',data);
 await expect(page.getByTestId('verdict')).toHaveText('PASS');await expect(page.getByTestId('count-still-open')).toHaveText('1');
 await expect(page.getByRole('heading',{name:'Review baseline acceptance'})).toBeVisible();await expect(page.getByText('image-alt|#hero|/',{exact:true}).first()).toBeVisible();
 const details=page.locator('details').filter({hasText:'image-alt'}).first();if(await details.getAttribute('open')!==null)await details.locator('summary').click();await details.locator('summary').focus();await page.keyboard.press('Enter');
 await expect(page.getByText('User impact:',{exact:false}).first()).toBeVisible();await expect(page.getByText('Verification:',{exact:false}).first()).toBeVisible();
 await expect(page.getByText('Unassessed scope',{exact:false}).first()).toBeVisible();
 const a=await new AxeBuilder({page}).analyze();expect(a.violations).toEqual([]);
 await page.setViewportSize({width:390,height:844});await expect(page.getByTestId('verdict')).toHaveText('PASS');
});
test('manual evidence defaults to not-assessed, survives navigation and never changes the automated gate',async({page})=>{
 await page.goto('/');await load(page,'current',scan('https://synthetic.test/'));
 await expect(page.getByTestId('verdict')).toHaveText('PASS');await expect(page.locator('#manual-status')).toHaveValue('not-assessed');
 for(const [id,value] of Object.entries({id:'keyboard-synthetic',scope:'/ synthetic desktop',check:'Keyboard traversal',reviewer:'Synthetic Reviewer',date:'2026-11-03',notes:'Synthetic record, not a completed human assessment.'}))await page.locator('#manual-'+id).fill(value);
 await page.getByRole('button',{name:'Add manual evidence'}).click();await expect(page.getByText('Keyboard traversal: not-assessed',{exact:true})).toBeVisible();
 await expect(page.getByTestId('verdict')).toHaveText('PASS');await page.getByRole('link',{name:'Report',exact:true}).click();
 await expect(page.getByText('Keyboard traversal: not-assessed',{exact:true})).toBeVisible();await page.reload();await expect(page.getByText('Keyboard traversal: not-assessed',{exact:true})).toBeVisible();
 const a=await new AxeBuilder({page}).analyze();expect(a.violations).toEqual([]);
});
test('invalid import never leaves an old PASS visible as the attempted result' ,async({page})=>{
 await page.goto('/');await load(page,'current',scan('https://synthetic.test/'));await expect(page.getByTestId('verdict')).toHaveText('PASS');
 await page.locator('#current-paste').fill('{');await page.getByRole('button',{name:'Parse pasted current JSON'}).click();
 await expect(page.locator('#import-error')).toContainText('Not valid JSON');await expect(page.getByTestId('verdict')).toHaveCount(0);
});
