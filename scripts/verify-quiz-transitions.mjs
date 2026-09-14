// Browser regression: run against a built app with Playwright installed.
// Uses browser-local API fixtures; no real contacts, quiz settings or sends.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}), args:['--no-sandbox'] });
const base = process.env.QUIZ_BASE || 'https://bossclinician.callsphere.site';
const evidence = [];
try {
for (const reducedMotion of ['no-preference', 'reduce']) {
 for (const questionCount of [1, 3]) {
  const context = await browser.newContext({reducedMotion, viewport:{width:390,height:844}});
  const page = await context.newPage();
  const errors=[]; page.on('pageerror', error=>errors.push(error.message));
  const questions=Array.from({length:questionCount},(_,index)=>({id:index+1,prompt:`Question prompt ${index+1}`,helpText:'',kind:'single',required:true,answers:[{id:100+index,label:`Answer ${index+1}`}]}));
  let submissions=0;
  await page.route('**/api/assessments/zz-transition-regression',route=>route.fulfill({json:{id:90001,slug:'zz-transition-regression',title:'Transition regression',introMd:'',kind:'quiz',requireEmail:true,questions}}));
  await page.route('**/api/assessments/zz-transition-regression/submit', async route=>{
   submissions++;
   assert.deepEqual(route.request().postDataJSON().responses, questions.map(q=>({questionId:q.id,answerIds:[q.answers[0].id]})));
   await route.fulfill({json:{attemptId:90001,score:0,maxScore:0,percent:0,passed:null,feedback:[],result:{slug:'done',title:'Completed regression',bodyMd:'',imageUrl:'',ctaLabel:'',ctaUrl:''}}});
  });
  await page.goto(base+'/quiz/zz-transition-regression');
  await page.evaluate(()=>{localStorage.clear();sessionStorage.clear()});await page.reload();
  await page.getByRole('button',{name:'Start',exact:true}).waitFor();
  await page.evaluate(()=>{
   window.stepMismatches=[];
   new MutationObserver(()=>{
    const main=document.querySelector('main');if(!main)return;
    const text=main.innerText;
    const header=text.match(/QUESTION (\d+) OF \d+/i);
    const heading=main.querySelector('h1')?.textContent;
    if(header&&heading!==`Question prompt ${header[1]}`)window.stepMismatches.push({header:header[0],heading});
    if(/ONE LAST STEP/i.test(text)&&heading!=='Where should I send your result?')window.stepMismatches.push({header:'ONE LAST STEP',heading});
   }).observe(document.querySelector('main'),{childList:true,subtree:true,characterData:true});
  });
  await page.getByRole('button',{name:'Start',exact:true}).click();
  for(let i=1;i<=questionCount;i++){
   await page.getByRole('heading',{name:`Question prompt ${i}`,exact:true}).waitFor();
   await page.getByRole('button',{name:`Answer ${i}`,exact:true}).click();
  }
  await page.getByLabel('Your first name').waitFor();
  // Return to the last answer, then go forward with the explicit button.
  await page.getByRole('button',{name:'Back',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:`Answer ${questionCount}`,exact:true}).getAttribute('aria-pressed'),'true');
  await page.getByRole('button',{name:'See my result',exact:true}).click();
  await page.getByLabel('Your first name').fill('Browser regression');
  await page.locator('main input[name="email"]').fill('quiz@example.invalid');
  await page.getByRole('button',{name:'Show me my result',exact:true}).click();
  await page.getByRole('heading',{name:'Completed regression',exact:true}).waitFor();
  const mismatches=await page.evaluate(()=>window.stepMismatches);
  evidence.push({reducedMotion,questionCount,submissions,mismatches,errors});
  await context.close();
 }
}
console.log(JSON.stringify(evidence,null,2));
if(process.env.QUIZ_EVIDENCE)fs.writeFileSync(process.env.QUIZ_EVIDENCE,JSON.stringify(evidence,null,2));
for(const run of evidence){assert.deepEqual(run.mismatches,[], 'Header and visible panel must change in the same commit');assert.deepEqual(run.errors,[]);assert.equal(run.submissions,1);}
} finally {await browser.close();}
