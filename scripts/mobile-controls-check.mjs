// Chromium sends trusted, independently identified touchscreen contacts through
// CDP. No test writes player.touch or invokes a touch-control event handler.
import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const args=process.argv.slice(2),arg=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const out=resolve(arg('--out','artifacts/v150'));
const base=arg('--url','http://127.0.0.1:4173/');
const only=arg('--only','');
await mkdir(out,{recursive:true});
const report={version:1,transport:'Chrome CDP Input.dispatchTouchEvent',cases:[],errors:[],failures:[]};
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
// Portrait is an orientation gate, exercised separately by landscape-check.
const sizes=[['wide',844,390],['compact',667,375],['tablet',1024,768]];
const modes=[['tdm','#btnStartTdm'],['relay','#btnStartRelay']];
const read=page=>page.evaluate(()=>{
  const g=__game,p=g.player;
  return {paused:g.paused,playing:g.playing,alive:p.alive,mode:g.mode,time:g.time,
    pos:p.pos.toArray(),yaw:p.yaw,pitch:p.pitch,mag:p.weapon.mag,
    touch:{...p.touch},look:p.touchLook?{...p.touchLook}:null,debug:g.touch.debugState?.()||null};
});
const movement=(a,b)=>Math.hypot(a.pos[0]-b.pos[0],a.pos[2]-b.pos[2]);
const angle=(a,b)=>Math.abs(Math.atan2(Math.sin(a.yaw-b.yaw),Math.cos(a.yaw-b.yaw)));
const quiet=s=>!s.touch.fire&&!s.touch.firePressed&&Math.abs(s.touch.mx)<1e-6&&Math.abs(s.touch.mz)<1e-6;
const wait=async(page,ms=120)=>page.waitForTimeout(ms);
const centre=r=>({x:r.x+r.width/2,y:r.y+r.height/2});

class Fingers{
  constructor(page,cdp){this.page=page;this.cdp=cdp;this.points=new Map();this.commands=0;}
  async send(type,points){
    this.commands++;
    await this.cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(p=>({...p,radiusX:5,radiusY:5,force:1}))});
  }
  async down(id,p){assert.ok(!this.points.has(id));this.points.set(id,{id,...p});await this.send('touchStart',[...this.points.values()]);await wait(this.page,35);}
  async move(id,p,steps=4){
    const old={...this.points.get(id)};assert.ok(old.id!==undefined,'moving contact must already be down');
    for(let i=1;i<=steps;i++){
      this.points.set(id,{id,x:old.x+(p.x-old.x)*i/steps,y:old.y+(p.y-old.y)*i/steps});
      await this.send('touchMove',[...this.points.values()]);await wait(this.page,24);
    }
  }
  async up(id){
    const ended=this.points.get(id);assert.ok(ended,'lifting contact must already be down');this.points.delete(id);
    // For a partial release Chrome expects the ENDED contact, not the remaining
    // list. Verified with trusted pointerup/pointermove and distinct pointer IDs.
    await this.send('touchEnd',this.points.size?[ended]:[]);await wait(this.page,35);
  }
  async cancel(){await this.send('touchCancel',[]);this.points.clear();await wait(this.page,80);}
  async tap(selector,id=90){
    const el=this.page.locator(selector);await el.scrollIntoViewIfNeeded();
    const r=await el.boundingBox();assert.ok(r,`${selector} is visible`);
    await this.down(id,centre(r));await this.up(id);await wait(this.page,80);
  }
}

async function zonePoint(page,selector){
  return page.evaluate(selector=>{
    const zone=document.querySelector(selector),r=zone.getBoundingClientRect();
    for(const fy of [.58,.45,.72,.3])for(const fx of [.45,.6,.3,.75]){
      const x=r.left+r.width*fx,y=r.top+r.height*fy;
      if(x<12||y<12||x>innerWidth-12||y>innerHeight-12)continue;
      const top=document.elementFromPoint(x,y);
      if(top&&!top.closest('[data-touch-action]')&&(top===zone||zone.contains(top)))return{x,y};
    }
    throw new Error(`No unobstructed point in ${selector}`);
  },selector);
}
async function layout(page){
  const data=await page.evaluate(()=>{
    const buttons=[...document.querySelectorAll('#touch [data-touch-action]')].filter(e=>e.getBoundingClientRect().width&&getComputedStyle(e).display!=='none').map(e=>{
      const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
      return{action:e.dataset.touchAction,x:r.x,y:r.y,width:r.width,height:r.height,
        reachable:document.elementFromPoint(x,y)?.closest('[data-touch-action]')===e};
    });
    return{width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,buttons};
  });
  for(const b of data.buttons){
    assert.ok(b.width>=44&&b.height>=44,`${b.action} touch target is at least 44px: ${b.width}×${b.height}`);
    assert.ok(b.x>=-.5&&b.y>=-.5&&b.x+b.width<=data.width+.5&&b.y+b.height<=data.height+.5,`${b.action} stays inside viewport`);
    assert.ok(b.reachable,`${b.action} is not covered by another control`);
  }
  for(let i=0;i<data.buttons.length;i++)for(let j=i+1;j<data.buttons.length;j++){
    const a=data.buttons[i],b=data.buttons[j],w=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x),h=Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y);
    assert.ok(w<=.5||h<=.5,`${a.action}/${b.action} targets overlap by ${w.toFixed(1)}×${h.toFixed(1)}px`);
  }
  assert.ok(data.scrollWidth<=data.width+1,'game does not horizontally overflow');
  for(const action of['fire','jump','crouch','reload','switch','aim','pause'])assert.ok(data.buttons.some(b=>b.action===action),`${action} is visible`);
  assert.equal(data.buttons.some(b=>b.action==='fire-left'),data.width>=data.height,'auxiliary fire appears in landscape and yields the left thumb area in portrait');
  return data;
}
async function refill(page){await page.evaluate(()=>{__game.player.weapon.refill();});await wait(page,120);}
async function prepareArena(page){
  await page.waitForFunction(()=>__game.playing&&__game.player?.alive);
  await page.evaluate(()=>{
    const g=__game,p=g.player;g.goal=10000;
    for(const a of g.actors)if(!a.isPlayer)a.update=()=>{};
    // Pick a real open floor patch; movement and collision remain active.
    outer:for(let x=-32;x<=-24;x+=2)for(let z=-13;z<=13;z+=2){
      if([-1,0,1].every(dx=>[-1,0,1].every(dz=>!g.world.blocked(x+dx,.05,z+dz,.4,1.7)))){p.pos.set(x,0,z);break outer;}
    }
    p.yaw=0;p.pitch=0;p.vel.set(0,0,0);p.protectT=999;p.updateCamera(0);
  });
  await page.waitForFunction(()=>__game.time>=__game.player.readyAt);await wait(page,140);
}
async function assertReset(page,label){
  await wait(page,100);const s=await read(page);assert.ok(quiet(s),`${label} clears movement and fire`);
  if(s.debug){assert.equal(s.debug.moveId,null,`${label} clears move owner`);assert.equal(s.debug.lookId,null,`${label} clears look owner`);assert.equal(s.debug.fireIds.length,0,`${label} clears all fire owners`);}
  return s;
}

async function core(page,f,result,name){
  const move=await zonePoint(page,'#touch-move-zone'),fire=centre(await page.locator('[data-touch-action="fire"]').boundingBox());
  const start=await read(page);
  await f.down(1,move);await wait(page,110);
  const initial=await read(page);assert.ok(movement(start,initial)<.025,'first touch anchors the stick without an immediate movement jump');
  await f.move(1,{x:move.x+2,y:move.y+2},1);await wait(page,80);
  const dead=await read(page);assert.ok(Math.abs(dead.touch.mx)<.001&&Math.abs(dead.touch.mz)<.001,'two-pixel motion remains inside the dead zone');
  await f.move(1,{x:move.x-48,y:move.y},3);
  await f.down(2,fire);const before=await read(page);
  // Continue beyond the fire button bounds while its pointer remains captured.
  await f.move(2,{x:fire.x-92,y:fire.y-12},5);await wait(page,180);
  const after=await read(page);
  assert.ok(movement(before,after)>.08,'left-thumb displacement moves the actual actor while firing');
  assert.ok(angle(before,after)>.04,'dragging the held fire contact turns actual player yaw');
  assert.ok(after.mag<before.mag,'simultaneous move/aim/fire consumes ammunition');
  assert.ok(after.touch.fire&&after.touch.mx<-.2,'both held actions remain active outside the button');
  const padClearance=await page.evaluate(()=>{
    const p=document.querySelector('#touch .touch-pad').getBoundingClientRect();
    return [...document.querySelectorAll('#touch [data-touch-action]')].filter(e=>e.getBoundingClientRect().width).map(e=>{
      const r=e.getBoundingClientRect();
      return{action:e.dataset.touchAction,gap:Math.hypot(p.x+p.width/2-r.x-r.width/2,p.y+p.height/2-r.y-r.height/2)-p.width/2-Math.max(r.width,r.height)/2};
    });
  });
  await page.screenshot({path:resolve(out,`${name}-two-thumb.png`)});
  for(const b of padClearance)assert.ok(b.gap>=-1,`expanded movement pad overlaps ${b.action} by ${(-b.gap).toFixed(1)}px`);
  await f.up(2);const one=await read(page);assert.ok(!one.touch.fire&&one.touch.mx<-.2,'releasing fire does not release the movement finger');
  await f.up(1);await assertReset(page,'release');
  result.core={start,initial,dead,before,after,remainingMove:one,padClearance};
}

async function deep(page,f,result){
  const fire=centre(await page.locator('[data-touch-action="fire"]').boundingBox());
  const alt=centre(await page.locator('[data-touch-action="fire-left"]').boundingBox());
  const move=await zonePoint(page,'#touch-move-zone'),look=await zonePoint(page,'#touch-look-zone');
  result.fireOrders=[];
  for(const first of[3,4]){
    await refill(page);await f.down(3,fire);await f.down(4,alt);await wait(page,140);
    await f.up(first);const remaining=await read(page);assert.ok(remaining.touch.fire,'one fire contact remains held after its peer lifts');
    if(remaining.debug)assert.equal(remaining.debug.fireIds.length,1,'only the lifted fire pointer is removed');
    await wait(page,180);const later=await read(page);assert.ok(later.mag<remaining.mag,'remaining fire pointer continues actual shots');
    await f.up(first===3?4:3);await assertReset(page,'last fire release');result.fireOrders.push({first,remaining,later});
  }
  await refill(page);await f.down(5,look);await f.move(5,{x:look.x+28,y:look.y},3);
  const owned=await read(page);await f.down(6,fire);await f.move(6,{x:fire.x-55,y:fire.y},4);
  const held=await read(page);
  if(owned.debug&&held.debug)assert.equal(held.debug.lookId,owned.debug.lookId,'existing look pointer retains ownership when fire starts');
  assert.ok(angle(owned,held)<.035,'second fire finger does not add a competing look delta');
  await f.move(5,{x:look.x+65,y:look.y},3);const looked=await read(page);assert.ok(angle(held,looked)>.035,'original look finger still rotates the camera while firing');
  await f.up(5);const takeover=await read(page);assert.ok(angle(looked,takeover)<.035,'handing look ownership to fire introduces no jump');
  await f.move(6,{x:fire.x-90,y:fire.y},3);const resumedLook=await read(page);assert.ok(angle(takeover,resumedLook)>.035,'remaining held fire pointer can continue aiming');
  await f.up(6);await assertReset(page,'look/fire release');result.lookPriority={owned,held,looked,takeover,resumedLook};

  await f.down(7,move);await f.move(7,{x:move.x-40,y:move.y},2);await f.down(8,fire);await f.cancel();
  const cancel=await assertReset(page,'browser touchCancel');await wait(page,160);assert.equal((await read(page)).mag,cancel.mag,'cancelled fire cannot consume later rounds');result.cancel=cancel;

  await f.down(9,move);await f.move(9,{x:move.x-40,y:move.y},2);await f.down(10,fire);
  await f.tap('[data-touch-action="pause"]',11);await page.waitForFunction(()=>__game.paused);
  result.pause=await assertReset(page,'pause');
  const resumeRect=await page.locator('#btnResume').boundingBox(),resumePoint=centre(resumeRect);
  await f.down(11,resumePoint);
  await f.move(11,{x:Math.min(page.viewportSize().width-8,resumeRect.x+resumeRect.width+24),y:resumePoint.y},3);
  await f.up(11);assert.ok((await read(page)).paused,'dragging a secondary menu contact outside its button cancels activation');
  result.resumeDragCancel=true;
  await f.tap('#btnResume',11);await page.waitForFunction(()=>!__game.paused);
  const resumed=await read(page);await f.move(9,{x:move.x-55,y:move.y},2);await f.move(10,{x:fire.x-40,y:fire.y},2);
  const stale=await read(page);assert.ok(quiet(stale)&&angle(resumed,stale)<.01,'old contacts cannot reactivate after resume');
  await f.cancel();result.resume={resumed,stale};

  await refill(page);await f.down(12,move);await f.move(12,{x:move.x-40,y:move.y},2);await f.down(13,fire);
  // Trigger the real death/respawn lifecycle; gestures remain browser contacts.
  await page.evaluate(()=>{const g=__game,p=g.player;g.kill(p,null,'m4a1',false,false,p.pos.clone().set(0,0,-1));});
  await assertReset(page,'death');await page.evaluate(()=>__game.spawnActor(__game.player));await wait(page,140);
  const born=await read(page);await f.move(12,{x:move.x-55,y:move.y},2);await f.move(13,{x:fire.x-40,y:fire.y},2);
  const oldAfterSpawn=await read(page);assert.ok(quiet(oldAfterSpawn)&&angle(born,oldAfterSpawn)<.01,'old contacts do not revive after respawn');await f.cancel();
  result.respawn={born,oldAfterSpawn};await page.waitForFunction(()=>__game.time>=__game.player.readyAt);

  await f.down(14,move);await f.move(14,{x:move.x-40,y:move.y},2);await f.down(15,fire);
  const original=page.viewportSize();await page.setViewportSize({width:original.height,height:original.width});await wait(page,160);
  result.rotation=await assertReset(page,'orientation resize');
  assert.ok(result.rotation.paused,'rotating to portrait pauses the match');
  assert.ok(await page.locator('#landscapeGate').isVisible(),'portrait shows the orientation gate');
  assert.equal(await page.locator('#touch').isVisible(),false,'portrait hides playable touch controls');
  await f.move(14,{x:Math.min(move.x,original.height-15),y:Math.min(move.y,original.width-15)},2);
  await f.move(15,{x:Math.min(fire.x,original.height-15),y:Math.min(fire.y,original.width-15)},2);
  assert.ok(quiet(await read(page)),'resized old contacts remain disarmed');await f.cancel();
  await page.setViewportSize(original);await wait(page,160);
  assert.ok((await read(page)).paused,'returning to landscape does not resume automatically');
  assert.equal(await page.locator('#landscapeGate').isVisible(),false,'landscape removes the orientation gate');
  await f.tap('#btnResume');await page.waitForFunction(()=>!__game.paused);

  await refill(page);await f.down(16,fire);
  await f.cdp.send('Emulation.setFocusEmulationEnabled',{enabled:false});
  const away=await page.context().newPage();await away.goto('about:blank');await away.bringToFront();
  await page.waitForFunction(()=>__game.paused);
  result.blur=await assertReset(page,'trusted browser blur');
  assert.ok(await page.evaluate(()=>__mobileTrace.some(e=>e.type==='blur'&&e.trusted)),'focus emulation emits a trusted browser blur');
  await f.cancel();await away.close();await page.bringToFront();
  await f.cdp.send('Emulation.setFocusEmulationEnabled',{enabled:true});await f.tap('#btnResume');await page.waitForFunction(()=>!__game.paused);
  await refill(page);const beforeFresh=await read(page);await f.down(17,fire);await wait(page,180);const fresh=await read(page);
  assert.ok(fresh.mag<beforeFresh.mag,'fresh fire works after all lifecycle resets');await f.up(17);await assertReset(page,'final release');result.freshAfterReset={beforeFresh,fresh};
}

try{
  for(const[label,width,height]of sizes)for(const[mode,start]of modes){
    const name=`${label}-${mode}`;if(only&&!name.includes(only))continue;
    const result={name,width,height,mode,checks:[]};report.cases.push(result);
    const context=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true,deviceScaleFactor:1});
    const page=await context.newPage();const cdp=await context.newCDPSession(page),f=new Fingers(page,cdp);
    page.on('pageerror',e=>report.errors.push({case:name,error:e.stack||e.message}));
    page.on('console',m=>{if(m.type()==='error')report.errors.push({case:name,error:m.text()});});
    await page.addInitScript(()=>{
      window.__mobileTrace=[];
      for(const type of['pointerdown','pointermove','pointerup','pointercancel','blur','focus'])window.addEventListener(type,e=>{
        if(__mobileTrace.length>=1600)__mobileTrace.shift();
        __mobileTrace.push({type,id:e.pointerId,pointerType:e.pointerType,x:e.clientX,y:e.clientY,trusted:e.isTrusted,action:e.target?.closest?.('[data-touch-action]')?.dataset.touchAction||null});
      },true);
    });
    try{
      await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
      await cdp.send('Emulation.setFocusEmulationEnabled',{enabled:true});
      const url=new URL(base);url.searchParams.set('touch','1');url.searchParams.set('q','low');
      const response=await page.goto(url.href);assert.ok(response,'built HTML response is available');
      result.htmlSHA256=createHash('sha256').update(await response.body()).digest('hex');
      report.htmlSHA256??=result.htmlSHA256;
      assert.equal(result.htmlSHA256,report.htmlSHA256,'every viewport checks the same built HTML');
      await page.waitForFunction(()=>window.__game?.nav,{timeout:90000});
      await page.evaluate(()=>{__game.opts.primary='m4a1';__game.opts.team='BL';});
      await f.tap(start);await prepareArena(page);
      assert.equal((await read(page)).mode,mode);result.layout=await layout(page);
      await page.screenshot({path:resolve(out,`${name}-layout.png`)});
      if(label==='wide'){
        await f.tap('[data-touch-action="switch"]');
        await page.waitForFunction(()=>__game.player.weapon.id==='deagle');
        await f.tap('[data-touch-action="switch"]');
        await page.waitForFunction(()=>__game.player.weapon.id==='knife');
        result.weaponCycle=['m4a1','deagle','knife'];
        await f.tap('[data-touch-action="pause"]');await f.tap('#btnQuit');
        await f.tap(start);await prepareArena(page);
      }
      await core(page,f,result,name);
      if(label==='wide')await deep(page,f,result);
      result.trace=await page.evaluate(()=>__mobileTrace);
      const downs=result.trace.filter(e=>e.type==='pointerdown'&&e.pointerType==='touch');
      assert.ok(downs.length>=3&&downs.every(e=>e.trusted),'browser dispatched trusted touch pointers for the menu and both thumbs');
      assert.ok(new Set(downs.map(e=>e.id)).size>=2,'multiple independent browser pointer IDs were exercised');
      result.commands=f.commands;result.passed=true;
      console.log(`${name}: PASS (${f.commands} CDP touch commands)`);
    }catch(error){
      result.passed=false;result.failure=error.stack||error.message;report.failures.push({case:name,error:error.message});
      result.trace=await page.evaluate(()=>window.__mobileTrace||[]).catch(()=>[]);
      result.state=await read(page).catch(()=>null);
      await page.screenshot({path:resolve(out,`${name}-failure.png`)}).catch(()=>{});
      console.error(`${name}: FAIL ${error.message}`);
    }finally{await context.close();await writeFile(resolve(out,'mobile-controls-report.json'),JSON.stringify(report,null,2));}
  }
}finally{
  await browser.close();await writeFile(resolve(out,'mobile-controls-report.json'),JSON.stringify(report,null,2));
}
assert.equal(report.failures.length,0,JSON.stringify(report.failures));
assert.equal(report.errors.length,0,JSON.stringify(report.errors));
assert.ok(report.cases.length,'at least one mobile viewport was checked');
console.log(JSON.stringify({passed:report.cases.length,errors:report.errors.length,out},null,2));
