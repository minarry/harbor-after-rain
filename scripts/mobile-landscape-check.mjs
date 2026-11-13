// Orientation gates use real viewport changes and trusted CDP contacts. The
// separate fullscreen/lock stubs prove call routing and failure handling only;
// they do not claim that a physical browser successfully locked its screen.
import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const args=process.argv.slice(2),arg=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const out=resolve(arg('--out','artifacts/v149')),base=arg('--url','http://127.0.0.1:4173/');
await mkdir(out,{recursive:true});
const report={version:1,nativeOrientationLockVerified:false,apiTests:'explicitly mocked call routing and failure handling',cases:[],errors:[],failures:[]};
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const sleep=(page,ms=100)=>page.waitForTimeout(ms);
const centre=r=>({x:r.x+r.width/2,y:r.y+r.height/2});
const state=page=>page.evaluate(()=>{
  const g=__game,p=g.player,visible=id=>{const e=document.getElementById(id);return!!e&&!e.hidden&&!e.classList.contains('hidden')&&getComputedStyle(e).display!=='none'&&e.getClientRects().length>0;};
  return{width:innerWidth,height:innerHeight,gate:visible('landscapeGate'),touchVisible:visible('touch'),blocked:!!g.landscape?.blocked,
    playing:g.playing,paused:g.paused,time:g.time,mode:g.mode,alive:p?.alive,mag:p?.weapon?.mag,yaw:p?.yaw,pos:p?.pos.toArray(),
    touch:p?{...p.touch}:null,debug:g.touch.debugState?.()||null,calls:structuredClone(__screenCalls),unhandled:[...__orientationUnhandled],
    hint:document.getElementById('landscapeHint')?.textContent};
});
const quiet=s=>!s.touch||(!s.touch.fire&&!s.touch.firePressed&&Math.abs(s.touch.mx)<1e-6&&Math.abs(s.touch.mz)<1e-6);
const yawDelta=(a,b)=>Math.abs(Math.atan2(Math.sin(a.yaw-b.yaw),Math.cos(a.yaw-b.yaw)));

class Contacts{
  constructor(page,cdp){this.page=page;this.cdp=cdp;this.points=new Map();this.commands=0;}
  async send(type,points){this.commands++;await this.cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(p=>({...p,radiusX:5,radiusY:5,force:1}))});}
  async down(id,point){assert.ok(!this.points.has(id));this.points.set(id,{id,...point});await this.send('touchStart',[...this.points.values()]);await sleep(this.page,35);}
  async move(id,point){
    const old=this.points.get(id);assert.ok(old);
    for(let i=1;i<=3;i++){this.points.set(id,{id,x:old.x+(point.x-old.x)*i/3,y:old.y+(point.y-old.y)*i/3});await this.send('touchMove',[...this.points.values()]);await sleep(this.page,25);}
  }
  async up(id){const ended=this.points.get(id);assert.ok(ended);this.points.delete(id);await this.send('touchEnd',this.points.size?[ended]:[]);await sleep(this.page,50);}
  async cancel(){await this.send('touchCancel',[]);this.points.clear();await sleep(this.page,80);}
  async tap(selector,id=80){const e=this.page.locator(selector);await e.scrollIntoViewIfNeeded();const r=await e.boundingBox();assert.ok(r,`${selector} is visible`);await this.down(id,centre(r));await this.up(id);await sleep(this.page,90);}
}

async function freeMovePoint(page){
  return page.evaluate(()=>{
    const zone=document.getElementById('touch-move-zone'),r=zone.getBoundingClientRect();
    for(const fy of[.6,.75,.45])for(const fx of[.45,.6,.3]){
      const x=r.x+r.width*fx,y=r.y+r.height*fy,e=document.elementFromPoint(x,y);
      if(e&&(e===zone||zone.contains(e))&&!e.closest('[data-touch-action]'))return{x,y};
    }
    throw new Error('No usable movement point');
  });
}
async function waitGate(page,blocked){
  await page.waitForFunction(blocked=>{
    const e=document.getElementById('landscapeGate');return !!__game.landscape&&!!__game.landscape.blocked===blocked&&!!e&&!e.hidden===blocked;
  },blocked,{timeout:5000});
  const s=await state(page);assert.equal(s.gate,blocked,'rendered gate follows the actual viewport');
  if(blocked){assert.equal(s.touchVisible,false,'portrait hides playable touch controls');assert.ok(quiet(s),'portrait clears held input');}
  return s;
}
async function readyMatch(page,f,mode){
  await f.tap(mode==='relay'?'#btnStartRelay':'#btnStartTdm');
  await page.waitForFunction(()=>__game.playing&&__game.player?.alive);
  await page.evaluate(()=>{
    const g=__game,p=g.player;for(const a of g.actors)if(!a.isPlayer)a.update=()=>{};
    outer:for(let x=-32;x<=-24;x+=2)for(let z=-13;z<=13;z+=2){
      if([-1,0,1].every(dx=>[-1,0,1].every(dz=>!g.world.blocked(x+dx,.05,z+dz,.4,1.7)))){p.pos.set(x,0,z);break outer;}
    }
    p.yaw=0;p.pitch=0;p.vel.set(0,0,0);p.protectT=99;p.updateCamera(0);
  });
  await page.waitForFunction(()=>__game.time>=__game.player.readyAt);await sleep(page,120);
  assert.equal((await state(page)).mode,mode);
}
async function initialPortrait(page,f,result){
  result.initial=await waitGate(page,true);assert.equal(result.initial.playing,false,'portrait starts at the gate, not in a match');
  assert.deepEqual(result.initial.calls,[],'loading the page does not request fullscreen or lock without a gesture');
  const gateBox=await page.locator('#landscapeGate').boundingBox();
  assert.ok(gateBox.x<=0&&gateBox.y<=0&&gateBox.width>=389&&gateBox.height>=843,'gate covers the portrait viewport');
  // The real underlying menu tap is intercepted by the gate. The public entry
  // guard is also exercised defensively, as it is used by restart/autostart.
  await f.tap('#btnStartTdm');assert.equal((await state(page)).playing,false,'portrait gate intercepts a menu start tap');
  result.entryGuard=await page.evaluate(()=>{__game.startMatch();return{playing:__game.playing,player:!!__game.player};});
  assert.equal(result.entryGuard.playing,false,'startMatch cannot bypass portrait orientation');
  await f.tap('#btnLandscape');await sleep(page,200);
  result.request=await waitGate(page,true);assert.equal(result.request.playing,false,'a lock request does not pretend the viewport has rotated');
  await page.screenshot({path:resolve(out,`${result.name}-gate.png`)});
}

async function orientationFlow(page,f,result,mode){
  await initialPortrait(page,f,result);
  await page.setViewportSize({width:844,height:390});result.manualLandscape=await waitGate(page,false);
  assert.equal(result.manualLandscape.playing,false,'manual rotation only reveals the menu');
  await readyMatch(page,f,mode);
  const move=await freeMovePoint(page),fire=centre(await page.locator('[data-touch-action="fire"]').boundingBox());
  const before=await state(page);await f.down(1,move);await f.move(1,{x:move.x-44,y:move.y});await f.down(2,fire);await sleep(page,160);
  const held=await state(page);assert.ok(held.touch.fire&&held.touch.mx<-.2&&held.mag<before.mag,'two trusted contacts are actively moving and firing');
  await page.screenshot({path:resolve(out,`${mode}-landscape-held.png`)});
  await page.setViewportSize({width:390,height:844});await waitGate(page,true);await page.waitForFunction(()=>__game.paused);
  const frozen=await state(page);await sleep(page,250);const later=await state(page);
  assert.equal(later.time,frozen.time,'portrait freezes the real match clock');assert.equal(later.mag,frozen.mag,'portrait stops firing');
  assert.ok(quiet(later)&&later.debug?.pointerIds.length===0,'portrait clears every input owner');
  await f.move(1,{x:move.x-24,y:move.y});await f.move(2,{x:365,y:fire.y});
  const blockedMove=await state(page);assert.ok(quiet(blockedMove)&&blockedMove.time===frozen.time,'old contacts cannot control the portrait gate');
  await page.screenshot({path:resolve(out,`${mode}-portrait-paused.png`)});
  await page.setViewportSize({width:844,height:390});const returned=await waitGate(page,false);
  assert.ok(returned.paused,'landscape does not resume a paused match automatically');
  await sleep(page,120);assert.equal((await state(page)).time,returned.time,'clock stays frozen until Continue is pressed');
  await f.tap('#btnResume',3);await page.waitForFunction(()=>!__game.paused);
  const resumed=await state(page);await f.move(1,{x:move.x-58,y:move.y});await f.move(2,{x:fire.x-50,y:fire.y});
  const stale=await state(page);assert.ok(quiet(stale)&&yawDelta(resumed,stale)<.01&&stale.mag===resumed.mag,'old fingers remain disarmed after the real Continue tap');
  await f.cancel();
  const freshBefore=await state(page);await f.down(4,fire);await f.move(4,{x:fire.x-48,y:fire.y});await sleep(page,100);
  const fresh=await state(page);assert.ok(fresh.mag<freshBefore.mag&&yawDelta(freshBefore,fresh)>.04,'a fresh contact can aim and fire after rotation recovery');
  await f.up(4);await page.screenshot({path:resolve(out,`${mode}-landscape-resumed.png`)});
  result.flow={before,held,frozen,later,blockedMove,returned,resumed,stale,freshBefore,fresh};
}

async function runCase(name,api,mobile,task){
  const result={name,apiSimulation:api,mobile};report.cases.push(result);
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1});
  const page=await context.newPage(),cdp=await context.newCDPSession(page),f=new Contacts(page,cdp);
  page.on('pageerror',e=>report.errors.push({case:name,error:e.stack||e.message}));
  page.on('console',m=>{if(m.type()==='error')report.errors.push({case:name,error:m.text()});});
  await page.addInitScript(api=>{
    window.__screenCalls=[];window.__orientationUnhandled=[];window.__orientationTouches=[];
    window.addEventListener('unhandledrejection',e=>__orientationUnhandled.push(String(e.reason)));
    for(const type of['pointerdown','pointerup','pointercancel'])window.addEventListener(type,e=>__orientationTouches.push({type,id:e.pointerId,pointerType:e.pointerType,trusted:e.isTrusted}),true);
    // Init scripts run before the parser creates <html>. The DOM prototypes
    // already exist and each browser context has its own isolated instances.
    const fullscreenPrototype=Element.prototype;
    window.__nativeScreenCapabilities={fullscreen:typeof fullscreenPrototype.requestFullscreen==='function',orientationLock:typeof screen.orientation?.lock==='function'};
    if(api==='missing'){
      Object.defineProperty(fullscreenPrototype,'requestFullscreen',{configurable:true,value:undefined});
      Object.defineProperty(screen,'orientation',{configurable:true,value:undefined});
    }else{
      let fullscreen=false;
      Object.defineProperty(document,'fullscreenElement',{configurable:true,get:()=>fullscreen?document.documentElement:null});
      Object.defineProperty(fullscreenPrototype,'requestFullscreen',{configurable:true,value:()=>{
        __screenCalls.push({api:'fullscreen'});
        if(api==='reject')return Promise.reject(new DOMException('Test denial','NotAllowedError'));
        fullscreen=true;return Promise.resolve();
      }});
      Object.defineProperty(screen.orientation,'lock',{configurable:true,value:orientation=>{
        __screenCalls.push({api:'orientation.lock',orientation});
        return api==='reject'?Promise.reject(new DOMException('Test unsupported lock','NotSupportedError')):Promise.resolve();
      }});
    }
  },api);
  try{
    if(mobile)await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
    await cdp.send('Emulation.setFocusEmulationEnabled',{enabled:true});
    const url=new URL(base);url.searchParams.set('q','low');url.searchParams.set(mobile?'touch':'nolock','1');
    const response=await page.goto(url.href);assert.ok(response);
    result.htmlSHA256=createHash('sha256').update(await response.body()).digest('hex');
    report.htmlSHA256??=result.htmlSHA256;assert.equal(result.htmlSHA256,report.htmlSHA256,'every orientation scenario uses the same built HTML');
    await page.waitForFunction(()=>window.__game?.nav&&__game.landscape,{timeout:90000});
    await page.evaluate(()=>{__game.opts.primary='m4a1';__game.opts.team='BL';});
    result.browserCapabilities=await page.evaluate(()=>__nativeScreenCapabilities);
    await task(page,f,result);
    result.final=await state(page);assert.deepEqual(result.final.unhandled,[],'API absence/rejection does not leak an unhandled promise');
    result.contacts=await page.evaluate(()=>__orientationTouches);
    if(mobile)assert.ok(result.contacts.some(e=>e.pointerType==='touch')&&result.contacts.every(e=>e.trusted),'orientation interactions use trusted browser contacts');
    result.commands=f.commands;result.passed=true;console.log(`${name}: PASS`);
  }catch(error){
    result.passed=false;result.failure=error.stack||error.message;report.failures.push({case:name,error:error.message});
    result.final=await state(page).catch(()=>null);await page.screenshot({path:resolve(out,`${name}-failure.png`)}).catch(()=>{});
    console.error(`${name}: FAIL ${error.message}`);
  }finally{await context.close();await writeFile(resolve(out,'mobile-landscape-report.json'),JSON.stringify(report,null,2));}
}

try{
  for(const mode of['tdm','relay'])await runCase(`manual-${mode}`,'missing',true,(page,f,result)=>orientationFlow(page,f,result,mode));
  for(const api of['reject','resolve'])await runCase(`api-${api}`,api,true,async(page,f,result)=>{
    await initialPortrait(page,f,result);
    const calls=result.request.calls;
    assert.ok(calls.some(c=>c.api==='fullscreen'),'the explicit gesture attempts preferred fullscreen');
    assert.ok(calls.filter(c=>c.api==='orientation.lock').every(c=>c.orientation==='landscape'),'lock calls request landscape only');
    if(api==='resolve')assert.ok(calls.some(c=>c.api==='orientation.lock'),'successful simulated fullscreen proceeds to the landscape-lock request');
    await page.setViewportSize({width:844,height:390});await waitGate(page,false);await readyMatch(page,f,'tdm');
    result.fallbackStarted=await state(page);assert.ok(result.fallbackStarted.playing,'manual rotation remains usable after the simulated API outcome');
  });
  await runCase('desktop-portrait','resolve',false,async(page,f,result)=>{
    result.initial=await state(page);assert.equal(result.initial.gate,false,'a narrow desktop window is not forced through the mobile gate');
    assert.equal(result.initial.blocked,false);assert.deepEqual(result.initial.calls,[]);
    await page.locator('#btnStartTdm').click();await page.waitForFunction(()=>__game.playing);
    const playing=await state(page);assert.deepEqual(playing.calls,[],'desktop start never requests fullscreen or orientation lock');
    assert.equal(playing.gate,false);result.playing=playing;
    await page.screenshot({path:resolve(out,'desktop-portrait.png')});
  });
}finally{await browser.close();await writeFile(resolve(out,'mobile-landscape-report.json'),JSON.stringify(report,null,2));}
assert.equal(report.failures.length,0,JSON.stringify(report.failures));assert.equal(report.errors.length,0,JSON.stringify(report.errors));
assert.equal(report.cases.length,5);console.log(JSON.stringify({passed:report.cases.length,errors:report.errors.length,htmlSHA256:report.htmlSHA256,out},null,2));
