// Trusted CDP contacts exercise the real touch handlers and player simulation.
// Device orientation is explicitly simulated, preferably through Chrome CDP;
// permission fixtures are isolated per context and are not physical-device QA.
import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const args=process.argv.slice(2),arg=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const out=resolve(arg('--out','artifacts/v150')),base=arg('--url','http://127.0.0.1:4173/'),only=arg('--only','');
await mkdir(out,{recursive:true});
const report={version:1,physicalSensorVerified:false,touchTransport:'Chrome CDP Input.dispatchTouchEvent',sensorNotice:'Simulated orientation samples; native phone permission, sensor calibration and mounting are not verified.',cases:[],errors:[],failures:[]};
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const wait=(page,ms=100)=>page.waitForTimeout(ms),centre=r=>({x:r.x+r.width/2,y:r.y+r.height/2});
const angle=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const read=page=>page.evaluate(()=>{
  const g=__game,p=g.player,gyro=g.gyro;
  return{playing:g.playing,paused:g.paused,alive:p?.alive,time:g.time,mode:g.mode,mag:p?.weapon?.mag,
    yaw:p?.yaw,pitch:p?.pitch,pos:p?.pos.toArray(),touch:p?{...p.touch}:null,look:p?.touchLook?{...p.touchLook}:null,
    debug:g.touch?.debugState?.(),gyro:{enabled:gyro?.enabled,pending:!!gyro?.pending,status:gyro?.status,text:gyro?.statusText,
      snapshot:gyro?.debugSnapshot?.()},opts:{sens:g.opts.sens,touchSens:g.opts.touchSens,gyroSens:g.opts.gyroSens},
    screenAngle:screen.orientation?.angle??window.orientation??0,permissions:__gyroPermissionCalls,
    samples:__gyroSamples.length,unhandled:[...__gyroUnhandled]};
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
  await f.down(9,look);await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>__game.landscape.blocked&&__game.paused);
  await page.setViewportSize({width:844,height:390});await page.waitForFunction(()=>!__game.landscape.blocked);assert.ok((await read(page)).paused);
  await resume(page,f);before=await read(page);await f.up(9);after=await assertNoShot(page,before,'a pre-rotation contact cannot fire after returning to landscape');result.gestures.push({name:'rotation-stale-release',before,after});
  await f.down(10,look);await page.evaluate(()=>{const g=__game,p=g.player;g.kill(p,null,'m4a1',false,false,p.pos.clone().set(0,0,-1));});
  await page.waitForFunction(()=>!__game.player.alive);await page.evaluate(()=>__game.spawnActor(__game.player));await page.waitForFunction(()=>__game.time>=__game.player.readyAt);before=await read(page);assert.equal(before.debug.pointerIds.length,0,'respawn does not restore the old look owner');await f.up(10);
  after=await assertNoShot(page,before,'a contact held through death and respawn does not fire');result.gestures.push({name:'respawn-stale-release',before,after});
}

// These paired orientations describe the same small left turn / upward tilt
// with opposite landscape mounting. They are physical angular fixtures, not
// calls into the application's quaternion or input helpers.
const POSES={
  90:{base:{alpha:90,beta:0,gamma:-51.56620156},left:{alpha:91.57109426,beta:1.24639078,gamma:-51.58329180},up:{alpha:90,beta:0,gamma:-53.57155384}},
  270:{base:{alpha:270,beta:0,gamma:51.56620156},left:{alpha:271.57109426,beta:-1.24639078,gamma:51.58329180},up:{alpha:270,beta:0,gamma:53.57155384}},
};
class Sensor{
  constructor(page,cdp,result){this.page=page;this.cdp=cdp;this.result=result;this.transport='cdp-deviceorientation';this.pose=null;this.sequence=0;result.sensor={simulated:true,transport:this.transport,samples:[]};}
  async sample(pose,settle=170){
    // A real sensor streams while still. Keep the override alive at about
    // 30 Hz, with sub-deadband alternating noise so Chrome emits each sample.
    // A single update followed by a long sleep would falsely test a stale feed.
    const steps=Math.max(2,Math.ceil(settle/32));
    for(let i=0;i<steps;i++){
      const before=await this.page.evaluate(()=>__gyroSamples.length),sample={...pose,alpha:pose.alpha+(++this.sequence%2?.00001:-.00001)};
      if(this.transport==='cdp-deviceorientation'){
        try{
          await this.cdp.send('DeviceOrientation.setDeviceOrientationOverride',sample);
          await this.page.waitForFunction(count=>__gyroSamples.length>count,before,{timeout:1500});
        }catch(error){
          this.transport='explicit-dom-deviceorientation-fallback';this.result.sensor.transport=this.transport;this.result.sensor.cdpUnavailable=error.message;
          await this.cdp.send('DeviceOrientation.clearDeviceOrientationOverride').catch(()=>{});
          await this.emit(sample);
        }
      }else await this.emit(sample);
      this.pose=sample;this.result.sensor.samples.push(sample);await wait(this.page,32);
    }
  }
  async emit(sample){await this.page.evaluate(sample=>window.dispatchEvent(new DeviceOrientationEvent('deviceorientation',{...sample,absolute:false})),sample);}
  async orientation(degrees){
    await this.cdp.send('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:1,mobile:true,screenOrientation:{type:degrees===90?'landscapePrimary':'landscapeSecondary',angle:degrees}});
    await this.page.waitForFunction(degrees=>screen.orientation?.angle===degrees,degrees);await wait(this.page,120);
  }
}
async function prime(page,sensor,pose){await page.evaluate(()=>__game.gyro.recenter());await sensor.sample(pose,220);await page.waitForFunction(()=>__game.gyro.status==='ready');}
async function delta(page,sensor,pose){const before=await read(page);await sensor.sample(pose,260);const after=await read(page);return{before,after,yaw:angle(after.yaw,before.yaw),pitch:after.pitch-before.pitch};}
async function setSettings(page,values){await page.evaluate(values=>Object.assign(__game.opts,values),values);}

async function sensorFlow(page,f,result,cdp){
  result.initial=await read(page);assert.equal(result.initial.gyro.enabled,false,'gyro is opt-in');assert.equal(result.initial.permissions,0,'loading does not request sensor permission');
  result.sliders=[];
  for(const key of['touchSens','gyroSens']){
    const element=page.locator(`#menu .slider[data-k="${key}"] input`);await element.scrollIntoViewIfNeeded();const box=await element.boundingBox();assert.ok(box);
    const before=await read(page);await f.down(89,{x:box.x+box.width*.72,y:box.y+box.height/2});await f.up(89);const after=await read(page);
    assert.ok(Math.abs(after.opts[key]-before.opts[key])>.2,`${key} slider responds to trusted touch`);
    for(const other of['sens','touchSens','gyroSens'].filter(k=>k!==key))assert.equal(after.opts[other],before.opts[other],`${key} slider does not change ${other}`);
    result.sliders.push({key,before:before.opts,after:after.opts});
  }
  await setSettings(page,{sens:1,touchSens:1,gyroSens:1});
  await f.tap('#menu [data-gyro-toggle]');await page.waitForFunction(()=>__game.gyro.enabled);await ready(page,f);
  const sensor=new Sensor(page,cdp,result);result.axes=[];
  for(const degrees of[90,270]){
    await sensor.orientation(degrees);await setSettings(page,{sens:1,touchSens:1,gyroSens:1});
    const fixture=POSES[degrees];await prime(page,sensor,fixture.base);const left=await delta(page,sensor,fixture.left);
    assert.ok(left.yaw>.025&&left.yaw<.045,`${degrees}° landscape: a left device turn rotates actual yaw left`);assert.ok(Math.abs(left.pitch)<.006,'left turn does not introduce cross-axis pitch');
    await prime(page,sensor,fixture.base);const up=await delta(page,sensor,fixture.up);
    assert.ok(up.pitch>.025&&up.pitch<.045,`${degrees}° landscape: upward tilt raises actual pitch`);assert.ok(Math.abs(up.yaw)<.006,'upward tilt does not introduce cross-axis yaw');
    result.axes.push({degrees,left,up});
  }
  await sensor.orientation(90);const fixture=POSES[90];result.sensitivity=[];
  for(const settings of[{sens:.3,touchSens:.5,gyroSens:.5},{sens:2.8,touchSens:1.5,gyroSens:1.5}]){
    await setSettings(page,settings);await prime(page,sensor,fixture.base);const gyro=await delta(page,sensor,fixture.left);
    const point=await zonePoint(page,'#touch-look-zone'),before=await read(page);await f.down(20,point);await f.move(20,{x:point.x+40,y:point.y});await f.up(20);await wait(page,100);const after=await read(page);
    const touch=angle(after.yaw,before.yaw);assert.equal(after.mag,before.mag,'sensitivity drag never fires');result.sensitivity.push({settings,gyro,touch});
  }
  const [low,high]=result.sensitivity;assert.ok(Math.abs(high.gyro.yaw/low.gyro.yaw-3)<.12,'gyro uses its own sensitivity');assert.ok(Math.abs(high.touch/low.touch-3)<.08,'touch uses its own sensitivity');
  await setSettings(page,{sens:2.8,touchSens:.5,gyroSens:.5});await prime(page,sensor,fixture.base);const mouseIndependent=await delta(page,sensor,fixture.left);
  assert.ok(Math.abs(mouseIndependent.yaw-low.gyro.yaw)<.001,'desktop mouse sensitivity does not alter gyro motion');
  const point=await zonePoint(page,'#touch-look-zone'),touchBefore=await read(page);await f.down(21,point);await f.move(21,{x:point.x+40,y:point.y});await f.up(21);const touchAfter=await read(page);
  assert.ok(Math.abs(angle(touchAfter.yaw,touchBefore.yaw)-low.touch)<.002,'desktop mouse sensitivity does not alter touch dragging');result.mouseIndependent={gyro:mouseIndependent,touch:angle(touchAfter.yaw,touchBefore.yaw)};

  await setSettings(page,{sens:1,touchSens:1,gyroSens:1});await prime(page,sensor,fixture.base);
  // Freeze only player consumption briefly, keeping trusted event delivery and
  // the gyro controller live. The next real update consumes both queued inputs.
  // This is deterministic same-frame batching, not fabricated input values.
  await page.evaluate(()=>{
    const p=__game.player,gyro=__game.gyro;window.__gyroFrame={hold:true,frames:[]};
    p.__qaOriginalUpdate=p.update;gyro.__qaOriginalTakeLook=gyro.takeLook;
    gyro.takeLook=function(){const value=this.__qaOriginalTakeLook();__gyroFrame.raw={...value};return value;};
    p.update=function(dt){if(__gyroFrame.hold)return;const before={yaw:this.yaw,pitch:this.pitch,tx:this.touchLook?.x||0,ty:this.touchLook?.y||0};__gyroFrame.raw=null;this.__qaOriginalUpdate(dt);if(__gyroFrame.frames.length<12)__gyroFrame.frames.push({...before,raw:__gyroFrame.raw,afterYaw:this.yaw,afterPitch:this.pitch});};
  });
  try{
    await f.down(22,point);await f.move(22,{x:point.x-40,y:point.y},1);await sensor.sample(fixture.left,100);
    await page.evaluate(()=>{__gyroFrame.hold=false;});await wait(page,180);await f.up(22);
    result.sameFrame=await page.evaluate(()=>__gyroFrame.frames);
    const combined=result.sameFrame.find(s=>Math.abs(s.tx)>1&&Math.abs(s.raw?.yaw||0)>.001);assert.ok(combined,'the real Player update consumes touch and gyro in the same frame');
    assert.ok(Math.abs(angle(combined.afterYaw,combined.yaw)-(-combined.tx*.0022+combined.raw.yaw))<.00001,'actual yaw equals the sum of both independently scaled inputs');
    assert.ok(Math.abs(angle(combined.afterYaw,combined.yaw))>Math.abs(combined.tx*.0022),'same-direction gyro adds to touch instead of replacing it');
  }finally{await page.evaluate(()=>{const p=__game.player,g=__game.gyro;p.update=p.__qaOriginalUpdate;g.takeLook=g.__qaOriginalTakeLook;delete p.__qaOriginalUpdate;delete g.__qaOriginalTakeLook;});}

  result.lifecycle=[];
  await pause(page,f);const paused=await read(page);await sensor.sample(fixture.up);const pausedAfter=await read(page);assert.equal(pausedAfter.yaw,paused.yaw);assert.equal(pausedAfter.pitch,paused.pitch);
  await resume(page,f);let before=await read(page);await sensor.sample(fixture.left);let after=await read(page);
  assert.ok(Math.abs(angle(after.yaw,before.yaw))<.002&&Math.abs(after.pitch-before.pitch)<.002,'first post-resume sample establishes a baseline without a camera jump');result.lifecycle.push({name:'resume-baseline',before,after});
  await pause(page,f);await f.tap('#pause [data-gyro-recenter]');await page.screenshot({path:resolve(out,'gyro-settings-paused.png')});await resume(page,f);
  before=await read(page);await sensor.sample(fixture.base);after=await read(page);assert.ok(Math.abs(angle(after.yaw,before.yaw))<.002&&Math.abs(after.pitch-before.pitch)<.002,'explicit recenter also discards the old orientation baseline');result.lifecycle.push({name:'recenter',before,after});
  await page.evaluate(()=>{const g=__game,p=g.player;g.kill(p,null,'m4a1',false,false,p.pos.clone().set(0,0,-1));});await sensor.sample(fixture.up);await page.evaluate(()=>__game.spawnActor(__game.player));await wait(page,100);
  before=await read(page);await sensor.sample(fixture.left);after=await read(page);assert.ok(Math.abs(angle(after.yaw,before.yaw))<.002&&Math.abs(after.pitch-before.pitch)<.002,'respawn establishes a fresh gyro baseline');result.lifecycle.push({name:'respawn',before,after});
  before=await read(page);await sensor.orientation(270);await sensor.sample(POSES[270].base);after=await read(page);assert.ok(Math.abs(angle(after.yaw,before.yaw))<.002&&Math.abs(after.pitch-before.pitch)<.002,'landscape reversal rebases without a camera jump');result.lifecycle.push({name:'landscape-reversal',before,after});
  await pause(page,f);await f.tap('#pause [data-gyro-toggle]');assert.equal((await read(page)).gyro.enabled,false);await resume(page,f);before=await read(page);await sensor.sample(POSES[270].left);after=await read(page);assert.ok(Math.abs(angle(after.yaw,before.yaw))<.00001&&Math.abs(after.pitch-before.pitch)<.00001,'disabled gyro cannot change the camera');result.lifecycle.push({name:'disable',before,after});
  await page.screenshot({path:resolve(out,'gyro-landscape-play.png')});
}

async function failureFlow(page,f,result,permission){
  result.initial=await read(page);assert.equal(result.initial.permissions,0,'no permission request during page load');
  const button=page.locator('#menu [data-gyro-toggle]');
  if(permission==='missing'){
    assert.equal(result.initial.gyro.status,'unsupported','absent sensor API is explicitly reported');assert.equal(result.initial.gyro.enabled,false);
    assert.equal(await button.isDisabled(),true,'unsupported sensor cannot be enabled');
  }else{
    await f.tap('#menu [data-gyro-toggle]');
    await page.waitForFunction(expected=>__game.gyro.status===expected,permission==='denied'?'denied':'no-data',{timeout:15000});
    result.after=await read(page);assert.equal(result.after.permissions,1,'one trusted enable gesture requests permission once');
    if(permission==='denied')assert.equal(result.after.gyro.enabled,false,'denied permission never enables sensor aiming');
    else assert.equal(result.after.gyro.enabled,true,'allowed permission remains enabled while honestly reporting no samples');
  }
  await button.scrollIntoViewIfNeeded();await page.screenshot({path:resolve(out,`gyro-${permission}-status.png`)});
  await ready(page,f);const point=await zonePoint(page,'#touch-look-zone'),before=await read(page);await f.down(30,point);await f.up(30);await wait(page,150);const after=await read(page);assert.equal(before.mag-after.mag,1,'touch tap fire stays usable without a working sensor');result.fallback={before,after};
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
  result.reloads??=[];const contacts=await page.evaluate(()=>__gyroTouches);
  assert.ok(contacts.every(e=>e.trusted),'pre-reload settings gestures remain trusted browser contacts');
  const response=await page.reload();assert.ok(response);const hash=createHash('sha256').update(await response.body()).digest('hex');
  assert.equal(hash,result.htmlSHA256,'settings persistence reload uses the same candidate HTML');
  await page.waitForFunction(()=>window.__game?.nav&&__game.gyro,{timeout:90000});
  result.reloads.push({htmlSHA256:hash,contacts,opts:(await read(page)).opts});
}
async function compactSettings(page,f,result){
  result.migrated=(await read(page)).opts;
  assert.equal(result.migrated.sens,1.65,'legacy mouse sensitivity is preserved');
  assert.equal(result.migrated.touchSens,1.65,'missing touch sensitivity inherits the valid legacy setting');
  assert.equal(result.migrated.gyroSens,1,'new gyro sensitivity defaults independently to one');
  await settingsReload(page,result);assert.deepEqual((await read(page)).opts,result.migrated,'legacy migration remains stable after reload');
  result.sliderChanges=[];
  for(const [key,fraction]of[['touchSens',.75],['gyroSens',.55]]){
    const selector=`#menu .slider[data-k="${key}"] input`;
    await page.locator(selector).evaluate(e=>e.scrollIntoView({block:'center'}));const target=await actionable(page,selector,fraction),before=(await read(page)).opts;
    await f.down(81,target.point);await f.up(81);const after=(await read(page)).opts;
    assert.ok(Math.abs(after[key]-before[key])>.1,`${key} changes via a real range-control touch`);
    for(const other of['sens','touchSens','gyroSens'].filter(k=>k!==key))assert.equal(after[other],before[other],`${key} leaves ${other} unchanged`);
    result.sliderChanges.push({key,before,after,target});
  }
  const saved=(await read(page)).opts;await settingsReload(page,result);assert.deepEqual((await read(page)).opts,saved,'both independent mobile sensitivities persist after reload');
  result.saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('harbor_after_rain_opts_v1')));
  await ready(page,f);await pause(page,f);
  result.pauseInitial={resume:await actionable(page,'#btnResume'),quit:await actionable(page,'#btnQuit'),scroll:await page.locator('#pause .pause-content').evaluate(e=>({top:e.scrollTop,height:e.clientHeight,total:e.scrollHeight}))};
  assert.ok(result.pauseInitial.resume.height>=44&&result.pauseInitial.quit.height>=44,'compact pause actions retain usable touch targets');
  await page.screenshot({path:resolve(out,'compact-settings-pause-initial.png')});
  // Do not call Fingers.tap here: its scroll helper could hide an offscreen
  // Continue regression. Press its already-verified initial viewport position.
  await f.down(82,result.pauseInitial.resume.point);await f.up(82);await page.waitForFunction(()=>!__game.paused);
  await pause(page,f);
  const gyroSelector='#pause .slider[data-k="gyroSens"] input';
  await page.locator(gyroSelector).evaluate(e=>e.scrollIntoView({block:'center'}));
  result.pauseGyro={control:await actionable(page,gyroSelector,.7),resume:await actionable(page,'#btnResume'),quit:await actionable(page,'#btnQuit'),scroll:await page.locator('#pause .pause-content').evaluate(e=>e.scrollTop)};
  const before=(await read(page)).opts;await f.down(83,result.pauseGyro.control.point);await f.up(83);const after=(await read(page)).opts;
  assert.ok(Math.abs(after.gyroSens-before.gyroSens)>.1,'the scrolled gyro slider can still receive touch input');assert.equal(after.touchSens,before.touchSens);assert.equal(after.sens,before.sens);
  const lastSelector='#pause .seg[data-k="tod"] button[data-v="day"]';
  await page.locator(lastSelector).evaluate(e=>e.scrollIntoView({block:'center'}));
  result.pauseLast={control:await actionable(page,lastSelector),resume:await actionable(page,'#btnResume'),quit:await actionable(page,'#btnQuit'),scroll:await page.locator('#pause .pause-content').evaluate(e=>e.scrollTop)};
  assert.ok(result.pauseLast.scroll>0,'the last setting is tested after scrolling the actual settings region');
  assert.ok(Math.abs(result.pauseInitial.resume.y-result.pauseLast.resume.y)<1,'Continue stays in the same viewport row while the settings scroll');
  await f.down(84,result.pauseLast.control.point);await f.up(84);assert.equal(await page.evaluate(()=>__game.opts.tod),'day','the last setting is reachable above the action row');
  await page.screenshot({path:resolve(out,'compact-settings-pause-scrolled.png')});
  await f.down(85,result.pauseLast.resume.point);await f.up(85);await page.waitForFunction(()=>!__game.paused);
}

async function runCase(name,permission,task,options={}){
  if(only&&!name.includes(only))return;
  const result={name,permissionFixture:permission};report.cases.push(result);
  const context=await browser.newContext({viewport:options.viewport||{width:844,height:390},isMobile:true,hasTouch:true,deviceScaleFactor:1});
  const page=await context.newPage(),cdp=await context.newCDPSession(page),f=new Fingers(page,cdp);
  page.on('pageerror',e=>report.errors.push({case:name,error:e.stack||e.message}));page.on('console',m=>{if(m.type()==='error')report.errors.push({case:name,error:m.text()});});
  await page.addInitScript(({permission,legacySettings})=>{
    // Seed an authentic older saved-options shape once, preserving subsequent
    // user edits across the reloads that verify the migration and persistence.
    if(legacySettings&&!sessionStorage.getItem('__gyroLegacySeeded')){
      localStorage.setItem('harbor_after_rain_opts_v1',JSON.stringify({sens:1.65}));sessionStorage.setItem('__gyroLegacySeeded','1');
    }
    window.__gyroPermissionCalls=0;window.__gyroUnhandled=[];window.__gyroTouches=[];window.__gyroSamples=[];
    window.addEventListener('unhandledrejection',e=>__gyroUnhandled.push(String(e.reason)));
    for(const type of['pointerdown','pointerup','pointercancel'])window.addEventListener(type,e=>__gyroTouches.push({type,id:e.pointerId,pointerType:e.pointerType,trusted:e.isTrusted,action:e.target?.closest?.('[data-touch-action]')?.dataset.touchAction||null}),true);
    window.addEventListener('deviceorientation',e=>{__gyroSamples.push({alpha:e.alpha,beta:e.beta,gamma:e.gamma,trusted:e.isTrusted});if(permission==='no-data')e.stopImmediatePropagation();},true);
    // Screen-request mocks keep the viewport under the orientation test's
    // control; they test neither fullscreen nor native orientation locking.
    Object.defineProperty(Element.prototype,'requestFullscreen',{configurable:true,value:undefined});
    if(screen.orientation)Object.defineProperty(screen.orientation,'lock',{configurable:true,value:undefined});
    window.__gyroNativeCapabilities={orientationEvent:typeof DeviceOrientationEvent!=='undefined',permission:typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission==='function',secure:isSecureContext};
    if(permission==='missing'){
      Object.defineProperty(window,'DeviceOrientationEvent',{configurable:true,value:undefined});
      // The controller also accepts legacy browsers exposing only the event
      // handler property. Remove that fallback in this explicitly absent-API
      // context, without altering any other scenario's native constructor.
      for(let owner=window;owner;owner=Object.getPrototypeOf(owner))if(Object.hasOwn(owner,'ondeviceorientation'))delete owner.ondeviceorientation;
    }
    else if(permission!=='native')Object.defineProperty(DeviceOrientationEvent,'requestPermission',{configurable:true,value:()=>{__gyroPermissionCalls++;return Promise.resolve(permission==='denied'?'denied':'granted');}});
  },{permission,legacySettings:!!options.legacySettings});
  try{
    await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});await cdp.send('Emulation.setFocusEmulationEnabled',{enabled:true});
    const url=new URL(base);url.searchParams.set('q','low');url.searchParams.set('touch','1');const response=await page.goto(url.href);assert.ok(response);
    result.htmlSHA256=createHash('sha256').update(await response.body()).digest('hex');report.htmlSHA256??=result.htmlSHA256;assert.equal(result.htmlSHA256,report.htmlSHA256,'every case uses the same candidate HTML');
    await page.waitForFunction(()=>window.__game?.nav&&__game.gyro,{timeout:90000});await page.evaluate(()=>{__game.opts.primary='m4a1';__game.opts.team='BL';});
    result.nativeCapabilities=await page.evaluate(()=>__gyroNativeCapabilities);await task(page,f,result,cdp);
    result.final=await read(page);assert.deepEqual(result.final.unhandled,[],'sensor failure handling does not leak promises');
    result.contacts=await page.evaluate(()=>__gyroTouches);assert.ok(result.contacts.some(e=>e.pointerType==='touch')&&result.contacts.every(e=>e.trusted),'all touch gestures use trusted browser events');
    result.sensorEvents=await page.evaluate(()=>__gyroSamples);result.commands=f.commands;result.passed=true;console.log(`${name}: PASS`);
  }catch(error){result.passed=false;result.failure=error.stack||error.message;report.failures.push({case:name,error:error.message});result.final=await read(page).catch(()=>null);await page.screenshot({path:resolve(out,`${name}-failure.png`)}).catch(()=>{});console.error(`${name}: FAIL ${error.message}`);}
  finally{await context.close();await writeFile(resolve(out,'mobile-gyro-report.json'),JSON.stringify(report,null,2));}
}

try{
  for(const mode of['tdm','relay'])await runCase(`tap-${mode}`,'native',(page,f,result)=>tapFlow(page,f,result,mode));
  await runCase('gyro-axes-mix-recovery','granted',sensorFlow);
  for(const permission of['denied','missing','no-data'])await runCase(`gyro-${permission}`,permission,(page,f,result)=>failureFlow(page,f,result,permission));
  await runCase('compact-settings','native',compactSettings,{viewport:{width:667,height:375},legacySettings:true});
}finally{await browser.close();await writeFile(resolve(out,'mobile-gyro-report.json'),JSON.stringify(report,null,2));}
assert.ok(report.cases.length,'at least one selected case ran');assert.equal(report.failures.length,0,JSON.stringify(report.failures));assert.equal(report.errors.length,0,JSON.stringify(report.errors));
console.log(JSON.stringify({passed:report.cases.length,errors:report.errors.length,physicalSensorVerified:false,htmlSHA256:report.htmlSHA256,out},null,2));
