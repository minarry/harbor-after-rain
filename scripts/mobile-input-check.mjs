// Trusted CDP contacts exercise the real touch handlers and player simulation.
// Removed APIs are trapped: gameplay must never inspect sensors or screen locks.
// This is Chromium feature-removal regression, not physical iOS device QA.
import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const args=process.argv.slice(2),arg=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const out=resolve(arg('--out','artifacts/v151')),base=arg('--url','http://127.0.0.1:4173/'),only=arg('--only','');
await mkdir(out,{recursive:true});
const report={version:2,physicalIOSVerified:false,touchTransport:'Chrome CDP Input.dispatchTouchEvent',cases:[],errors:[],failures:[]};
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const wait=(page,ms=100)=>page.waitForTimeout(ms),centre=r=>({x:r.x+r.width/2,y:r.y+r.height/2});
const angle=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const read=page=>page.evaluate(()=>{
  const g=__game,p=g.player;
  return{playing:g.playing,paused:g.paused,alive:p?.alive,time:g.time,mode:g.mode,mag:p?.weapon?.mag,
    yaw:p?.yaw,pitch:p?.pitch,pos:p?.pos.toArray(),touch:p?{...p.touch}:null,look:p?.touchLook?{...p.touchLook}:null,
    debug:g.touch?.debugState?.(),opts:{sens:g.opts.sens,touchSens:g.opts.touchSens},
    removedAPICalls:[...__inputRemovedCalls],unhandled:[...__inputUnhandled]};
});
const quiet=s=>!s.touch||(!s.touch.fire&&!s.touch.firePressed&&Math.abs(s.touch.mx)<1e-6&&Math.abs(s.touch.mz)<1e-6);

class Fingers{
  constructor(page,cdp){this.page=page;this.cdp=cdp;this.points=new Map();this.commands=0;}
  async send(type,points){this.commands++;await this.cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(p=>({...p,radiusX:5,radiusY:5,force:1}))});}
  async down(id,p){assert.ok(!this.points.has(id));this.points.set(id,{id,...p});await this.send('touchStart',[...this.points.values()]);await wait(this.page,24);}
  async move(id,p,steps=3){const old=this.points.get(id);assert.ok(old);for(let i=1;i<=steps;i++){this.points.set(id,{id,x:old.x+(p.x-old.x)*i/steps,y:old.y+(p.y-old.y)*i/steps});await this.send('touchMove',[...this.points.values()]);await wait(this.page,20);}}
  async up(id){const ended=this.points.get(id);assert.ok(ended);this.points.delete(id);await this.send('touchEnd',this.points.size?[ended]:[]);await wait(this.page,45);}
  async cancel(){await this.send('touchCancel',[]);this.points.clear();await wait(this.page,70);}
  async tap(selector,id=90){const el=this.page.locator(selector);await el.scrollIntoViewIfNeeded();const r=await el.boundingBox();assert.ok(r,`${selector} visible`);await this.down(id,centre(r));await this.up(id);await wait(this.page,70);}
}

async function zonePoint(page,selector){
  return page.evaluate(selector=>{
    const zone=document.querySelector(selector),r=zone.getBoundingClientRect();
    for(const fy of[.4,.55,.3,.7])for(const fx of[.45,.6,.3,.75]){
      const x=r.x+r.width*fx,y=r.y+r.height*fy,e=document.elementFromPoint(x,y);
      if(x>50&&x<innerWidth-70&&y>45&&y<innerHeight-45&&e&&!e.closest('[data-touch-action]')&&(e===zone||zone.contains(e)))return{x,y};
    }
    throw new Error(`No unobstructed point in ${selector}`);
  },selector);
}
async function ready(page,f,mode='tdm'){
  await f.tap(mode==='relay'?'#btnStartRelay':'#btnStartTdm');await page.waitForFunction(()=>__game.playing&&__game.player?.alive);
  await page.evaluate(()=>{
    const g=__game,p=g.player;g.goal=10000;for(const a of g.actors)if(!a.isPlayer)a.update=()=>{};
    outer:for(let x=-32;x<=-24;x+=2)for(let z=-13;z<=13;z+=2){if([-1,0,1].every(dx=>[-1,0,1].every(dz=>!g.world.blocked(x+dx,.05,z+dz,.4,1.7)))){p.pos.set(x,0,z);break outer;}}
    p.yaw=0;p.pitch=0;p.vel.set(0,0,0);p.protectT=999;p.updateCamera(0);
  });
  await page.waitForFunction(()=>__game.time>=__game.player.readyAt);await wait(page,140);assert.equal((await read(page)).mode,mode);
}
async function refill(page){await page.evaluate(()=>__game.player.weapon.refill());await wait(page,150);}
async function pause(page,f){await f.tap('[data-touch-action="pause"]',91);await page.waitForFunction(()=>__game.paused);}
async function resume(page,f){await f.tap('#btnResume',92);await page.waitForFunction(()=>!__game.paused);await wait(page,100);}
async function assertNoShot(page,before,label){await wait(page,180);const after=await read(page);assert.equal(after.mag,before.mag,label);assert.ok(!after.touch.fire&&!after.touch.firePressed,`${label}: no latched fire`);return after;}

async function tapFlow(page,f,result,mode){
  await ready(page,f,mode);const look=await zonePoint(page,'#touch-look-zone'),move=await zonePoint(page,'#touch-move-zone');
  result.gestures=[];
  await refill(page);let before=await read(page);await f.down(1,look);
  const held=await read(page);assert.equal(held.mag,before.mag,'blank-area tap does not shoot on pointerdown');assert.equal(held.touch.fire,false);
  await f.up(1);await wait(page,180);let after=await read(page);assert.equal(before.mag-after.mag,1,'one short blank-area tap consumes exactly one round');
  await wait(page,250);assert.equal((await read(page)).mag,after.mag,'tap never becomes automatic fire');result.gestures.push({name:'short-tap',before,held,after});
  before=await read(page);await f.down(11,look);await f.move(11,{x:look.x+6,y:look.y},1);await f.up(11);await wait(page,150);after=await read(page);
  assert.equal(before.mag-after.mag,1,'small six-pixel finger jitter remains a single tap');result.gestures.push({name:'tap-with-small-jitter',before,after});

  for(const [name,gesture]of[
    ['drag',async()=>{await f.down(2,look);await f.move(2,{x:look.x+45,y:look.y-12});await f.up(2);}],
    ['out-and-back',async()=>{await f.down(3,look);await f.move(3,{x:look.x+28,y:look.y},1);await f.move(3,look,1);await f.up(3);}],
    ['long-hold',async()=>{await f.down(4,look);await wait(page,360);await f.up(4);}],
    ['cancel',async()=>{await f.down(5,look);await f.cancel();}],
  ]){
    before=await read(page);await gesture();after=await assertNoShot(page,before,`${name} does not fire`);
    if(name==='drag')assert.ok(Math.abs(angle(after.yaw,before.yaw))>.08,'drag still changes actual yaw');
    result.gestures.push({name,before,after});
  }
  before=await read(page);await f.down(6,move);await f.move(6,{x:move.x-40,y:move.y});await f.down(7,look);await f.up(7);await wait(page,150);after=await read(page);
  assert.equal(before.mag-after.mag,1,'right tap fires exactly once while the left thumb moves');assert.ok(after.touch.mx<-.2,'right tap preserves the left movement owner');
  assert.ok(Math.hypot(after.pos[0]-before.pos[0],after.pos[2]-before.pos[2])>.1,'left thumb produces real world movement');
  await page.screenshot({path:resolve(out,`${result.name}-move-tap.png`)});await f.up(6);result.gestures.push({name:'move-and-tap',before,after});

  before=await read(page);await f.tap('[data-touch-action="crouch"]');await f.tap('[data-touch-action="aim"]');await f.tap('[data-touch-action="aim"]');await f.tap('[data-touch-action="crouch"]');
  after=await assertNoShot(page,before,'non-fire action buttons do not bubble into blank-area tap fire');result.gestures.push({name:'button-isolation',before,after});
  await refill(page);before=await read(page);await f.tap('[data-touch-action="fire"]');await wait(page,200);after=await read(page);
  assert.equal(before.mag-after.mag,1,'a short dedicated fire tap has no duplicate blank-area shot');result.gestures.push({name:'fire-button-isolation',before,after});

  // Keep the original look contact down across real secondary menu touches.
  before=await read(page);await f.down(8,look);await pause(page,f);await resume(page,f);assert.equal((await read(page)).debug.pointerIds.length,0,'Continue does not restore the old look owner');await f.up(8);
  after=await assertNoShot(page,before,'a pre-pause contact cannot fire when released after Continue');assert.ok(quiet(after));result.gestures.push({name:'pause-stale-release',before,after});
  await f.down(9,look);await page.setViewportSize({width:390,height:844});await wait(page,180);
  assert.equal((await read(page)).paused,false,'portrait resize does not gate or pause play');
  assert.equal(await page.locator('#touch').isVisible(),true,'touch remains available after resize');
  await page.setViewportSize({width:844,height:390});await wait(page,180);
  before=await read(page);await f.up(9);after=await assertNoShot(page,before,'a pre-resize contact cannot fire after returning to landscape');result.gestures.push({name:'resize-stale-release',before,after});
  await f.down(10,look);await page.evaluate(()=>{const g=__game,p=g.player;g.kill(p,null,'m4a1',false,false,p.pos.clone().set(0,0,-1));});
  await page.waitForFunction(()=>!__game.player.alive);await page.evaluate(()=>__game.spawnActor(__game.player));await page.waitForFunction(()=>__game.time>=__game.player.readyAt);before=await read(page);assert.equal(before.debug.pointerIds.length,0,'respawn does not restore the old look owner');await f.up(10);
  after=await assertNoShot(page,before,'a contact held through death and respawn does not fire');result.gestures.push({name:'respawn-stale-release',before,after});
}


async function actionable(page,selector,fraction=.5){
  const data=await page.evaluate(({selector,fraction})=>{
    const e=document.querySelector(selector),r=e?.getBoundingClientRect();if(!r)return null;
    const point={x:r.left+r.width*fraction,y:r.top+r.height/2},top=document.elementFromPoint(point.x,point.y);
    return{point,x:r.x,y:r.y,width:r.width,height:r.height,viewport:{width:innerWidth,height:innerHeight},
      visible:!!e.getClientRects().length&&!e.hidden&&getComputedStyle(e).visibility!=='hidden',enabled:!e.disabled,hit:top===e||e.contains(top)};
  },{selector,fraction});
  assert.ok(data&&data.visible&&data.enabled,`${selector} is visible and enabled`);
  assert.ok(data.x>=-.5&&data.y>=-.5&&data.x+data.width<=data.viewport.width+.5&&data.y+data.height<=data.viewport.height+.5,`${selector} is fully inside the compact viewport`);
  assert.ok(data.hit,`${selector} is not covered by the fixed action row or another control`);return data;
}
async function settingsReload(page,result){
  result.reloads??=[];const contacts=await page.evaluate(()=>__inputTouches);
  assert.ok(contacts.every(e=>e.trusted),'pre-reload settings gestures remain trusted browser contacts');
  const response=await page.reload();assert.ok(response);const hash=createHash('sha256').update(await response.body()).digest('hex');
  assert.equal(hash,result.htmlSHA256,'settings persistence reload uses the same candidate HTML');
  await page.waitForFunction(()=>window.__game?.nav,{timeout:90000});
  result.reloads.push({htmlSHA256:hash,contacts,opts:(await read(page)).opts});
}
async function compactSettings(page,f,result){
  result.migrated=(await read(page)).opts;
  assert.equal(result.migrated.sens,1.65,'legacy mouse sensitivity is preserved');
  assert.equal(result.migrated.touchSens,1.65,'missing touch sensitivity inherits the valid legacy setting');
  assert.equal(await page.evaluate(()=>Object.prototype.hasOwnProperty.call(__game.opts,'gyroSens')),false,'obsolete saved sensor options are dropped');
  await settingsReload(page,result);assert.deepEqual((await read(page)).opts,result.migrated,'legacy migration remains stable after reload');
  result.sliderChanges=[];
  for(const [key,fraction]of[['touchSens',.75]]){
    const selector=`#menu .slider[data-k="${key}"] input`;
    await page.locator(selector).evaluate(e=>e.scrollIntoView({block:'center'}));const target=await actionable(page,selector,fraction),before=(await read(page)).opts;
    await f.down(81,target.point);await f.up(81);const after=(await read(page)).opts;
    assert.ok(Math.abs(after[key]-before[key])>.1,`${key} changes via a real range-control touch`);
    for(const other of['sens','touchSens'].filter(k=>k!==key))assert.equal(after[other],before[other],`${key} leaves ${other} unchanged`);
    result.sliderChanges.push({key,before,after,target});
  }
  const saved=(await read(page)).opts;await settingsReload(page,result);assert.deepEqual((await read(page)).opts,saved,'touch and mouse sensitivities remain independently saved after reload');
  result.saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('harbor_after_rain_opts_v1')));
  assert.equal(Object.prototype.hasOwnProperty.call(result.saved,'gyroSens'),false,'obsolete sensor setting is not persisted after editing');
  await ready(page,f);await pause(page,f);
  result.pauseInitial={resume:await actionable(page,'#btnResume'),quit:await actionable(page,'#btnQuit'),scroll:await page.locator('#pause .pause-content').evaluate(e=>({top:e.scrollTop,height:e.clientHeight,total:e.scrollHeight}))};
  assert.ok(result.pauseInitial.resume.height>=44&&result.pauseInitial.quit.height>=44,'compact pause actions retain usable touch targets');
  await page.screenshot({path:resolve(out,'compact-settings-pause-initial.png')});
  // Do not call Fingers.tap here: its scroll helper could hide an offscreen
  // Continue regression. Press its already-verified initial viewport position.
  await f.down(82,result.pauseInitial.resume.point);await f.up(82);await page.waitForFunction(()=>!__game.paused);
  await pause(page,f);
  const touchSelector='#pause .slider[data-k="touchSens"] input';
  await page.locator(touchSelector).evaluate(e=>e.scrollIntoView({block:'center'}));
  result.pauseTouch={control:await actionable(page,touchSelector,.35),resume:await actionable(page,'#btnResume'),quit:await actionable(page,'#btnQuit'),scroll:await page.locator('#pause .pause-content').evaluate(e=>e.scrollTop)};
  const before=(await read(page)).opts;await f.down(83,result.pauseTouch.control.point);await f.up(83);const after=(await read(page)).opts;
  assert.ok(Math.abs(after.touchSens-before.touchSens)>.1,'the scrolled touch slider can still receive touch input');assert.equal(after.sens,before.sens);
  const lastSelector='#pause .seg[data-k="tod"] button[data-v="day"]';
  await page.locator(lastSelector).evaluate(e=>e.scrollIntoView({block:'center'}));
  result.pauseLast={control:await actionable(page,lastSelector),resume:await actionable(page,'#btnResume'),quit:await actionable(page,'#btnQuit'),scroll:await page.locator('#pause .pause-content').evaluate(e=>e.scrollTop)};
  assert.ok(result.pauseLast.scroll>0,'the last setting is tested after scrolling the actual settings region');
  assert.ok(Math.abs(result.pauseInitial.resume.y-result.pauseLast.resume.y)<1,'Continue stays in the same viewport row while the settings scroll');
  await f.down(84,result.pauseLast.control.point);await f.up(84);assert.equal(await page.evaluate(()=>__game.opts.tod),'day','the last setting is reachable above the action row');
  await page.screenshot({path:resolve(out,'compact-settings-pause-scrolled.png')});
  await f.down(85,result.pauseLast.resume.point);await f.up(85);await page.waitForFunction(()=>!__game.paused);
}

async function assertRemoved(page){
  assert.equal(await page.locator('#landscapeGate,[data-gyro-toggle],[data-gyro-recenter],[data-gyro-status],.slider[data-k="gyroSens"]').count(),0,'removed sensor controls and rotation prompts are absent');
  const state=await page.evaluate(()=>({calls:[...__inputRemovedCalls],unhandled:[...__inputUnhandled],hasOwnAbsent:typeof Object.hasOwn==='undefined',controller:'gyro' in (window.__game||{}),screenController:'landscape' in (window.__game||{})}));
  assert.deepEqual(state.calls,[],'no removed API is inspected, requested or subscribed');
  assert.deepEqual(state.unhandled,[],'no rejected feature-detection promise escapes');
  assert.ok(state.hasOwnAbsent,'the regression runs without Object.hasOwn');
  assert.equal(state.controller,false,'no sensor controller is constructed');
  assert.equal(state.screenController,false,'no screen-orientation controller is constructed');
  return state;
}
async function portraitFlow(page,f,result,mode){
  result.initial=await assertRemoved(page);await ready(page,f,mode);
  assert.equal((await read(page)).paused,false,'portrait viewport does not obstruct starting');
  assert.equal(await page.locator('#touch').isVisible(),true,'portrait viewport does not hide touch controls');
  await pause(page,f);result.paused=await read(page);await resume(page,f);
  result.resumed=await read(page);assert.equal(result.resumed.paused,false,'portrait viewport does not obstruct Continue');
  const before=await read(page);await f.tap('[data-touch-action="fire"]');await wait(page,150);
  result.fired=await read(page);assert.equal(before.mag-result.fired.mag,1,'normal fire remains active without an orientation gate');
  await page.screenshot({path:resolve(out,`${result.name}.png`)});
}
async function touchSensitivity(page,f,result){
  await ready(page,f);result.samples=[];
  for(const settings of[{sens:.3,touchSens:.5},{sens:2.8,touchSens:.5},{sens:2.8,touchSens:1.5}]){
    await page.evaluate(settings=>Object.assign(__game.opts,settings),settings);
    const point=await zonePoint(page,'#touch-look-zone'),before=await read(page);
    await f.down(31,point);await f.move(31,{x:point.x+40,y:point.y});await f.up(31);await wait(page,100);
    const after=await read(page),yaw=angle(after.yaw,before.yaw);
    assert.equal(before.mag,after.mag,'sensitivity drag never fires');result.samples.push({settings,yaw,before,after});
  }
  const [low,mouseChanged,high]=result.samples;
  assert.ok(Math.abs(low.yaw-mouseChanged.yaw)<.002,'mouse sensitivity does not affect touch dragging');
  assert.ok(Math.abs(high.yaw/low.yaw-3)<.08,'touch sensitivity scales real camera motion independently');
}
async function labFlow(page,f,result){
  await page.waitForFunction(()=>window.__lab?.ready,{timeout:90000});
  result.snapshot=await page.evaluate(()=>__lab.snapshot());
  assert.equal(result.snapshot.module,'fx');
  assert.ok(result.snapshot.checks.every(c=>c.pass!==false),'effects laboratory initializes with Object.hasOwn absent');
  const rows=await page.locator('.lab-metrics dt').count();assert.ok(rows>0,'nested metrics are rendered through the lab panel');
  await f.tap('[data-drawer-toggle="inspector"]');
  await page.screenshot({path:resolve(out,'legacy-api-lab-metrics.png')});
  result.metricRows=rows;
}

async function runCase(name,task,options={}){
  if(only&&!name.includes(only))return;
  const result={name,removedAPIsTrapped:true,objectHasOwnRemoved:true};report.cases.push(result);
  const context=await browser.newContext({viewport:options.viewport||{width:844,height:390},isMobile:true,hasTouch:true,deviceScaleFactor:1});
  const page=await context.newPage(),cdp=await context.newCDPSession(page),f=new Fingers(page,cdp);
  page.on('pageerror',e=>report.errors.push({case:name,error:e.stack||e.message}));
  page.on('console',m=>{if(m.type()==='error')report.errors.push({case:name,error:m.text()});});
  await page.addInitScript(({legacySettings})=>{
    // An old saved shape must migrate while discarding retired settings.
    if(legacySettings&&!sessionStorage.getItem('__inputLegacySeeded')){
      localStorage.setItem('harbor_after_rain_opts_v1',JSON.stringify({sens:1.65,gyroSens:2.4}));
      sessionStorage.setItem('__inputLegacySeeded','1');
    }
    delete Object.hasOwn;
    window.__inputRemovedCalls=[];window.__inputUnhandled=[];window.__inputTouches=[];
    const fail=name=>{__inputRemovedCalls.push(name);throw new Error(`Removed mobile API accessed: ${name}`);};
    const trap=(object,key,label)=>Object.defineProperty(object,key,{configurable:true,get(){return fail(label||key);}});
    for(const key of['DeviceOrientationEvent','DeviceMotionEvent','Gyroscope','AbsoluteOrientationSensor','RelativeOrientationSensor','orientation','ondeviceorientation','ondevicemotion','onorientationchange'])trap(window,key);
    trap(screen,'orientation','screen.orientation');
    for(const key of['requestFullscreen','webkitRequestFullscreen','webkitRequestFullScreen'])trap(Element.prototype,key);
    const add=EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener=function(type,...args){
      if(['deviceorientation','deviceorientationabsolute','devicemotion','orientationchange'].includes(type))return fail(`listen:${type}`);
      return add.call(this,type,...args);
    };
    if(navigator.permissions){const query=navigator.permissions.query.bind(navigator.permissions);navigator.permissions.query=function(descriptor){if(['gyroscope','accelerometer','magnetometer'].includes(descriptor?.name))return fail(`permission:${descriptor.name}`);return query(descriptor);};}
    window.addEventListener('unhandledrejection',e=>__inputUnhandled.push(String(e.reason)));
    for(const type of['pointerdown','pointerup','pointercancel'])window.addEventListener(type,e=>__inputTouches.push({type,id:e.pointerId,pointerType:e.pointerType,trusted:e.isTrusted,action:e.target?.closest?.('[data-touch-action]')?.dataset.touchAction||null}),true);
  },{legacySettings:!!options.legacySettings});
  try{
    await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
    await cdp.send('Emulation.setFocusEmulationEnabled',{enabled:true});
    const url=new URL(base);url.searchParams.set('q','low');url.searchParams.set('touch','1');
    if(options.lab){url.searchParams.set('lab',options.lab);url.searchParams.set('shot','1');}
    const response=await page.goto(url.href);assert.ok(response);
    const body=await response.body();result.htmlSHA256=createHash('sha256').update(body).digest('hex');
    report.htmlSHA256??=result.htmlSHA256;assert.equal(result.htmlSHA256,report.htmlSHA256,'every case uses the same candidate HTML');
    assert.equal(/Object\.hasOwn\s*\(/.test(body.toString()),false,'built HTML contains no Object.hasOwn calls');
    if(!options.lab){
      await page.waitForFunction(()=>window.__game?.nav,{timeout:90000});
      await page.evaluate(()=>{__game.opts.primary='m4a1';__game.opts.team='BL';});
      result.initial=await assertRemoved(page);
    }
    await task(page,f,result,cdp);result.removal=await assertRemoved(page);
    result.final=options.lab?await page.evaluate(()=>__lab.snapshot()):await read(page);
    result.contacts=await page.evaluate(()=>__inputTouches);
    assert.ok(result.contacts.some(e=>e.pointerType==='touch')&&result.contacts.every(e=>e.trusted),'all touch gestures use trusted browser events');
    result.commands=f.commands;result.passed=true;console.log(`${name}: PASS (${f.commands} CDP touch commands)`);
  }catch(error){
    result.passed=false;result.failure=error.stack||error.message;report.failures.push({case:name,error:error.message});
    result.final=await read(page).catch(()=>null);result.removedCalls=await page.evaluate(()=>window.__inputRemovedCalls||[]).catch(()=>[]);
    await page.screenshot({path:resolve(out,`${name}-failure.png`)}).catch(()=>{});console.error(`${name}: FAIL ${error.message}`);
  }finally{await context.close();await writeFile(resolve(out,'mobile-input-report.json'),JSON.stringify(report,null,2));}
}
try{
  for(const mode of['tdm','relay'])await runCase(`tap-${mode}`,(page,f,result)=>tapFlow(page,f,result,mode));
  await runCase('touch-sensitivity',touchSensitivity);
  await runCase('compact-settings',compactSettings,{viewport:{width:667,height:375},legacySettings:true});
  for(const mode of['tdm','relay'])await runCase(`portrait-no-gate-${mode}`,(page,f,result)=>portraitFlow(page,f,result,mode),{viewport:{width:390,height:844}});
  await runCase('legacy-api-lab',labFlow,{lab:'fx'});
}finally{await browser.close();await writeFile(resolve(out,'mobile-input-report.json'),JSON.stringify(report,null,2));}
assert.ok(report.cases.length,'at least one selected case ran');
assert.equal(report.failures.length,0,JSON.stringify(report.failures));assert.equal(report.errors.length,0,JSON.stringify(report.errors));
console.log(JSON.stringify({passed:report.cases.length,errors:report.errors.length,physicalIOSVerified:false,htmlSHA256:report.htmlSHA256,out},null,2));
