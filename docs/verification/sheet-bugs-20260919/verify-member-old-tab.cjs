const {chromium}=require('/tmp/club-gap-audit/node_modules/playwright-core');
const fs=require('fs'),assert=require('assert/strict');
const out='/opt/bossclinician/docs/verification/sheet-bugs-20260919';
const signal='/tmp/boss-navigation-deployment-ready';
(async()=>{
 const b=await chromium.launch({executablePath:'/home/ubuntu/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',args:['--no-sandbox']});
 try {
 const c=await b.newContext({viewport:{width:1440,height:1000}});
 const p=await c.newPage();const errors=[],responses=[];p.on('pageerror',e=>errors.push(e.message));p.on('response',r=>{if(r.url().includes('/assets/'))responses.push({url:r.url(),status:r.status()});});
 const f=JSON.parse(fs.readFileSync('/tmp/boss-sheet-fixture.json'));await p.goto('https://bossclinician.callsphere.site/login',{waitUntil:'domcontentloaded'});await p.locator('input[type=email]').fill(f.memberEmail);await p.locator('input[type=password]').fill(f.password);await p.getByRole('button',{name:'Sign in',exact:true}).click();await p.waitForURL(u=>!u.pathname.includes('login'));
 await p.getByRole('heading',{name:'Your library',exact:true}).waitFor();
 const scripts=await p.locator('script[src]').evaluateAll(s=>s.map(x=>x.src));
 assert.equal(responses.some(r=>/\/Events-[^/]+\.js/.test(r.url)),false);
 fs.writeFileSync(out+'/member-old-tab-open.json',JSON.stringify({openedAt:new Date().toISOString(),scripts,eventsChunkAlreadyLoaded:false},null,2));
 console.log('Old member library tab is open before deployment; waiting for '+signal);
 await new Promise(resolve=>{const timer=setInterval(()=>{if(fs.existsSync(signal)){clearInterval(timer);resolve();}},1000);});
 const initialScripts=scripts;
 await p.locator('a[href="/my-events"]').filter({visible:true}).first().click();
 await p.getByRole('heading',{name:'Your events',exact:true}).waitFor({timeout:30000});
 await p.screenshot({path:out+'/member-old-tab-after-release.png',fullPage:true});
 const eventResponses=responses.filter(r=>/\/Events-[^/]+\.js/.test(r.url));
 assert(eventResponses.length>0);assert(eventResponses.every(r=>r.status===200));assert.deepEqual(errors,[]);
 const result={initialScripts,completedAt:new Date().toISOString(),eventResponses,errors,heading:await p.locator('h1').innerText(),sameDocument:JSON.stringify(initialScripts)===JSON.stringify(await p.locator('script[src]').evaluateAll(s=>s.map(x=>x.src)))};
 fs.writeFileSync(out+'/member-old-tab-after-release.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exit(1)});
