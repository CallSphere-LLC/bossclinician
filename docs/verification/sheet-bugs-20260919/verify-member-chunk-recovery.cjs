const {chromium}=require('/tmp/club-gap-audit/node_modules/playwright-core');const fs=require('fs'),assert=require('assert/strict');
const out='/opt/bossclinician/docs/verification/sheet-bugs-20260919';
(async()=>{const b=await chromium.launch({executablePath:'/home/ubuntu/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',args:['--no-sandbox']});const results=[];
try{for(const persistent of [false,true]){
const c=await b.newContext({viewport:{width:390,height:844}});const p=await c.newPage();p.setDefaultTimeout(20000);
let blocked=0,documents=0;const errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.isNavigationRequest()&&r.frame()===p.mainFrame())documents++;});
await p.route(/\/assets\/Events-[^/]+\.js(?:\?.*)?$/,async route=>{if(persistent||blocked===0){blocked++;await route.fulfill({status:404,contentType:'text/plain',body:'Intentional missing lazy module for recovery verification'});}else await route.continue();});
const f=JSON.parse(fs.readFileSync('/tmp/boss-sheet-fixture.json'));await p.goto('https://bossclinician.callsphere.site/login',{waitUntil:'domcontentloaded'});await p.locator('input[type=email]').fill(f.memberEmail);await p.locator('input[type=password]').fill(f.password);await p.getByRole('button',{name:'Sign in',exact:true}).click();await p.waitForURL(u=>!u.pathname.includes('login'));await p.getByRole('heading',{name:'Your library',exact:true}).waitFor();
await p.locator('a[href="/my-events"]').filter({visible:true}).first().click();
if(!persistent){await p.getByRole('heading',{name:'Your events',exact:true}).waitFor().catch(async e=>{const failure={persistent,blocked,documents,errors,url:p.url(),body:await p.locator('body').innerText()};fs.writeFileSync(out+'/member-chunk-before-failure.json',JSON.stringify(failure,null,2));await p.screenshot({path:out+'/member-chunk-before-failure.png',fullPage:true});throw e;});assert.equal(documents,2);assert.equal(blocked,1);}else{
await p.getByRole('heading',{name:'This page couldn’t load',exact:true}).waitFor();await p.waitForTimeout(2500);assert.equal(documents,2);assert.equal(blocked,2);await p.getByRole('button',{name:'Try again',exact:true}).waitFor();
await p.screenshot({path:out+'/member-persistent-chunk-error.png',fullPage:true});
await p.unroute(/\/assets\/Events-[^/]+\.js(?:\?.*)?$/);await p.getByRole('button',{name:'Try again',exact:true}).click();await p.getByRole('heading',{name:'Your events',exact:true}).waitFor();assert.equal(documents,3);
}
const result={persistent,blocked,documents,heading:await p.locator('h1').innerText(),errors,automaticReloads:1,manualRetryWorks:persistent?true:null};results.push(result);await p.screenshot({path:out+`/member-chunk-${persistent?'persistent-recovered':'transient-recovered'}.png`,fullPage:true});console.log(result);await c.close();
}}finally{await b.close();fs.writeFileSync(out+'/member-chunk-recovery.json',JSON.stringify(results,null,2));}})().catch(e=>{console.error(e);process.exit(1)});
