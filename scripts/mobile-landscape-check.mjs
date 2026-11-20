// Trusted touch contacts exercise the default landscape presentation. Native
// screen APIs are explicit fixtures; physical iOS fullscreen/locking is not QA'd.
import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const args=process.argv.slice(2),arg=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const out=resolve(arg('--out','artifacts/v152')),base=arg('--url','http://127.0.0.1:4173/'),only=arg('--only','');
await mkdir(out,{recursive:true});
const report={version:2,physicalIOSVerified:false,nativeAPIs:'Simulated success, rejection and absence; trusted CDP touchscreen contacts.',cases:[],errors:[],failures:[]};
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const wait=(page,ms=100)=>page.waitForTimeout(ms),centre=r=>({x:r.x+r.width/2,y:r.y+r.height/2});
const angle=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const read=page=>page.evaluate(()=>{const g=__game,p=g.player,v=__mobileViewport;return{playing:g.playing,paused:g.paused,time:g.time,mode:g.mode,alive:p?.alive,pos:p?.pos.toArray(),yaw:p?.yaw,pitch:p?.pitch,mag:p?.weapon?.mag,touch:p?{...p.touch}:null,debug:g.touch?.debugState?.(),viewport:{width:v.width,height:v.height,rotated:v.rotated,enabled:v.enabled},physical:{width:innerWidth,height:innerHeight},nativeCalls:[...__landscapeNativeCalls],sensorCalls:[...__landscapeSensorCalls],unhandled:[...__landscapeUnhandled]};});
const quiet=s=>!s.touch||(!s.touch.fire&&!s.touch.firePressed&&Math.abs(s.touch.mx)<1e-6&&Math.abs(s.touch.mz)<1e-6);

// Independent geometry oracle: do not call the runtime's coordinate helpers.
function logicalViewport(page){const {width,height}=page.viewportSize();return{width:Math.max(width,height),height:Math.min(width,height),rotated:height>width,physicalWidth:width};}
function toClient(page,p){const v=logicalViewport(page);return v.rotated?{x:v.physicalWidth-p.y,y:p.x}:p;}
function toLogical(page,p){const v=logicalViewport(page);return v.rotated?{x:p.y,y:v.physicalWidth-p.x}:p;}
function logicalRect(page,r){const v=logicalViewport(page);return v.rotated?{x:r.y,y:v.physicalWidth-r.x-r.width,width:r.height,height:r.width}:r;}
class Fingers{
  constructor(page,cdp){this.page=page;this.cdp=cdp;this.points=new Map();this.commands=0;}
  async send(type,points){this.commands++;await this.cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(p=>({...p,radiusX:5,radiusY:5,force:1}))});}
  async down(id,p){assert.ok(!this.points.has(id));this.points.set(id,{id,...p});await this.send('touchStart',[...this.points.values()]);await wait(this.page,30);}
  async move(id,p,steps=4){const old=this.points.get(id);assert.ok(old);for(let i=1;i<=steps;i++){this.points.set(id,{id,x:old.x+(p.x-old.x)*i/steps,y:old.y+(p.y-old.y)*i/steps});await this.send('touchMove',[...this.points.values()]);await wait(this.page,24);}}
  async up(id){const ended=this.points.get(id);assert.ok(ended);this.points.delete(id);await this.send('touchEnd',this.points.size?[ended]:[]);await wait(this.page,50);}
  async cancel(){await this.send('touchCancel',[]);this.points.clear();await wait(this.page,80);}
  async logicalDown(id,p){return this.down(id,toClient(this.page,p));}
  async logicalMove(id,p,steps){return this.move(id,toClient(this.page,p),steps);}
  async tap(selector,id=90){const element=this.page.locator(selector);await element.scrollIntoViewIfNeeded();const r=await element.boundingBox();assert.ok(r,`${selector} visible`);await this.down(id,centre(r));await this.up(id);await wait(this.page,80);}
}
async function zonePoint(page,selector){
  const r=logicalRect(page,await page.locator(selector).boundingBox()),v=logicalViewport(page);
  for(const fy of[.58,.42,.72,.3])for(const fx of[.45,.6,.3,.75]){
    const p={x:r.x+r.width*fx,y:r.y+r.height*fy};if(p.x<65||p.y<70||p.x>v.width-80||p.y>v.height-70)continue;
    const client=toClient(page,p),hit=await page.evaluate(({selector,client})=>document.elementFromPoint(client.x,client.y)===document.querySelector(selector),{selector,client});if(hit)return p;
  }
  throw new Error(`No logical unobstructed point in ${selector}`);
}
async function anchor(page){
  await page.evaluate(()=>{const p=__game.player;p.pos.copy(window.__landscapeOrigin);p.yaw=0;p.pitch=0;p.vel.set(0,0,0);p.protectT=999;p.updateCamera(0);});await wait(page,80);
}
async function ready(page,f,mode='tdm'){
  await f.tap(mode==='relay'?'#btnStartRelay':'#btnStartTdm');await page.waitForFunction(()=>__game.playing&&__game.player?.alive);
  await page.evaluate(()=>{
    const g=__game,p=g.player;g.goal=10000;for(const a of g.actors)if(!a.isPlayer)a.update=()=>{};
    outer:for(let x=-32;x<=-24;x+=2)for(let z=-13;z<=13;z+=2)if([-1,0,1].every(dx=>[-1,0,1].every(dz=>!g.world.blocked(x+dx,.05,z+dz,.4,1.7)))){p.pos.set(x,0,z);break outer;}
    window.__landscapeOrigin=p.pos.clone();p.yaw=0;p.pitch=0;p.vel.set(0,0,0);p.protectT=999;p.updateCamera(0);
  });await page.waitForFunction(()=>__game.time>=__game.player.readyAt);await wait(page,120);assert.equal((await read(page)).mode,mode);
}
async function assertClean(page){
  const s=await read(page);assert.deepEqual(s.sensorCalls,[],'landscape presentation never touches a sensor');assert.deepEqual(s.unhandled,[],'native screen failures are handled silently');
  assert.equal(await page.locator('#landscapeGate,[data-gyro-toggle],[data-gyro-status]').count(),0,'no rotation prompt or sensor UI is mounted');return s;
}
async function layout(page){
  const data=await page.evaluate(()=>{
    const g=__game,v=__mobileViewport,canvas=g.renderer.renderer.domElement,r=canvas.getBoundingClientRect();
    const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};
    return{viewport:{width:v.width,height:v.height,rotated:v.rotated},physical:{width:innerWidth,height:innerHeight},canvas:rect(canvas),cameraAspect:g.renderer.camera.aspect,scroll:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},buttons:[...document.querySelectorAll('#touch [data-touch-action]')].filter(e=>e.getClientRects().length&&getComputedStyle(e).display!=='none').map(e=>({action:e.dataset.touchAction,rect:rect(e),hit:document.elementFromPoint(e.getBoundingClientRect().x+e.getBoundingClientRect().width/2,e.getBoundingClientRect().y+e.getBoundingClientRect().height/2)?.closest('[data-touch-action]')===e}))};
  });
  const expected=logicalViewport(page);assert.equal(data.viewport.width,expected.width);assert.equal(data.viewport.height,expected.height);assert.equal(data.viewport.rotated,expected.rotated);
  assert.ok(Math.abs(data.cameraAspect-expected.width/expected.height)<.015,'camera uses the logical landscape aspect');
  assert.ok(Math.abs(data.canvas.x)<1&&Math.abs(data.canvas.y)<1&&Math.abs(data.canvas.width-data.physical.width)<1&&Math.abs(data.canvas.height-data.physical.height)<1,'canvas fills the physical viewport without stretch or empty borders');
  for(const b of data.buttons){const r=b.rect;assert.ok(r.width>=44&&r.height>=44,`${b.action} target remains at least 44px after rotation`);assert.ok(r.x>=-.5&&r.y>=-.5&&r.x+r.width<=data.physical.width+.5&&r.y+r.height<=data.physical.height+.5,`${b.action} is inside physical viewport`);assert.ok(b.hit,`${b.action} is directly reachable`);}
  for(const action of['fire','fire-left','jump','crouch','reload','switch','aim','pause'])assert.ok(data.buttons.some(b=>b.action===action),`${action} uses the landscape control set`);
  return data;
}
async function assertReset(page,label){await wait(page,100);const s=await read(page);assert.ok(quiet(s),`${label} clears active movement/fire`);assert.equal(s.debug.pointerIds.length,0,`${label} clears every touch owner`);return s;}

async function cardinalFlow(page,f,result){
  result.cardinals=[];const move=await zonePoint(page,'#touch-move-zone');
  for(const[name,dx,dy,key,sign,axis,worldSign]of[['right',42,0,'mx',1,0,1],['left',-42,0,'mx',-1,0,-1],['forward',0,-42,'mz',1,2,-1],['back',0,42,'mz',-1,2,1]]){
    await anchor(page);const before=await read(page);await f.logicalDown(1,move);await f.logicalMove(1,{x:move.x+dx,y:move.y+dy},3);await wait(page,180);const after=await read(page);
    assert.ok(after.touch[key]*sign>.3,`${name} joystick axis is mapped correctly`);assert.ok((after.pos[axis]-before.pos[axis])*worldSign>.08,`${name} moves the actual actor in the correct world direction`);assert.ok(Math.abs(after.touch[key==='mx'?'mz':'mx'])<.01,`${name} does not leak into the other movement axis`);await f.up(1);await assertReset(page,`${name} release`);result.cardinals.push({name,before,after});
  }
  result.lookAxes=[];const look=await zonePoint(page,'#touch-look-zone');
  for(const[name,dx,dy,key,sign]of[['look-right',40,0,'yaw',-1],['look-left',-40,0,'yaw',1],['look-up',0,-30,'pitch',1],['look-down',0,30,'pitch',-1]]){
    await anchor(page);const before=await read(page);await f.logicalDown(2,look);await f.logicalMove(2,{x:look.x+dx,y:look.y+dy},3);await f.up(2);await wait(page,100);const after=await read(page);
    assert.ok((after[key]-before[key])*sign>.06,`${name} rotates the real camera in the correct direction`);assert.ok(Math.abs(after[key==='yaw'?'pitch':'yaw']-before[key==='yaw'?'pitch':'yaw'])<.015,`${name} does not swap camera axes`);assert.equal(after.mag,before.mag,'aim drags do not become tap fire');result.lookAxes.push({name,before,after});
  }
}
async function twoThumbFlow(page,f,result){
  await anchor(page);await page.evaluate(()=>__game.player.weapon.refill());await wait(page,150);
  const move=await zonePoint(page,'#touch-move-zone'),fire=toLogical(page,centre(await page.locator('[data-touch-action="fire"]').boundingBox())),look=await zonePoint(page,'#touch-look-zone');
  const before=await read(page);await f.logicalDown(3,move);await f.logicalMove(3,{x:move.x-42,y:move.y},3);await f.logicalDown(4,fire);await f.logicalMove(4,{x:fire.x-60,y:fire.y-8},4);await wait(page,160);const during=await read(page);
  assert.ok(during.touch.mx<-.3&&during.touch.fire,'two thumbs move and fire together after rotation');assert.ok(Math.hypot(during.pos[0]-before.pos[0],during.pos[2]-before.pos[2])>.1,'combined gesture moves the actor');assert.ok(during.mag<before.mag,'combined gesture fires real rounds');assert.ok(angle(during.yaw,before.yaw)>.08,'held fire drag correctly aims left');
  await page.screenshot({path:resolve(out,`${result.name}-two-thumb.png`)});await f.up(4);assert.ok((await read(page)).touch.mx<-.3,'releasing fire preserves the moving thumb');await f.up(3);await assertReset(page,'two-thumb release');result.twoThumb={before,during};
  await wait(page,160);const tapBefore=await read(page);await f.logicalDown(5,look);await f.up(5);await wait(page,160);const tapped=await read(page);assert.equal(tapBefore.mag-tapped.mag,1,'logical right blank tap fires exactly one round');
  await f.logicalDown(6,look);await f.logicalMove(6,{x:look.x+36,y:look.y},3);await f.up(6);await wait(page,160);const dragged=await read(page);assert.equal(dragged.mag,tapped.mag,'subsequent right blank drag aims without firing');result.tapAndDrag={tapBefore,tapped,dragged};
}
async function actionable(page,selector){const e=page.locator(selector),r=await e.boundingBox();assert.ok(r,`${selector} has a box`);const p=centre(r),v=page.viewportSize();assert.ok(r.x>=-.5&&r.y>=-.5&&r.x+r.width<=v.width+.5&&r.y+r.height<=v.height+.5,`${selector} fits the rotated physical viewport`);assert.ok(await page.evaluate(({selector,p})=>{const e=document.querySelector(selector),top=document.elementFromPoint(p.x,p.y);return top===e||e.contains(top);},{selector,p}),`${selector} is not obscured`);return{rect:r,point:p};}
async function menuFlow(page,f,result){
  await f.tap('[data-touch-action="pause"]');await page.waitForFunction(()=>__game.paused);await assertReset(page,'pause');
  const resumeInitial=await actionable(page,'#btnResume'),quitInitial=await actionable(page,'#btnQuit');
  const content=logicalRect(page,await page.locator('#pause .pause-content').boundingBox());
  const beforeScroll=await page.locator('#pause .pause-content').evaluate(e=>({top:e.scrollTop,visible:e.clientHeight,total:e.scrollHeight}));
  let scrollPoint=null;
  for(const fraction of[.08,.16,.3,.65,.8]){
    const logical={x:content.x+content.width*fraction,y:content.y+content.height*.78},client=toClient(page,logical);
    if(await page.evaluate(p=>{const e=document.elementFromPoint(p.x,p.y);return !!e?.closest('.pause-content')&&!e.closest('button,input');},client)){scrollPoint=logical;break;}
  }
  assert.ok(scrollPoint,'rotated settings have an unobstructed swipe surface');
  await f.logicalDown(77,scrollPoint);await f.logicalMove(77,{x:scrollPoint.x,y:content.y+content.height*.22},8);await f.up(77);await wait(page,160);
  const afterScroll=await page.locator('#pause .pause-content').evaluate(e=>e.scrollTop);
  if(beforeScroll.total>beforeScroll.visible+2)assert.ok(afterScroll>beforeScroll.top+10,'a real logical upward swipe scrolls rotated settings');
  const last='#pause .seg[data-k="tod"] button[data-v="day"]';await page.locator(last).evaluate(e=>e.scrollIntoView({block:'center'}));
  const setting=await actionable(page,last),resumeScrolled=await actionable(page,'#btnResume');
  assert.ok(Math.abs(resumeScrolled.point.x-resumeInitial.point.x)<1&&Math.abs(resumeScrolled.point.y-resumeInitial.point.y)<1,'Continue stays fixed while rotated settings scroll');
  await f.down(7,setting.point);await f.up(7);assert.equal(await page.evaluate(()=>__game.opts.tod),'day','last scrolled setting receives rotated touch');
  await page.screenshot({path:resolve(out,`${result.name}-pause.png`)});await f.down(8,resumeScrolled.point);await f.up(8);await page.waitForFunction(()=>!__game.paused);result.pause={resumeInitial,quitInitial,setting,resumeScrolled,swipe:{before:beforeScroll,after:afterScroll,point:scrollPoint}};
}
async function resizeFlow(page,f,result){
  result.resizes=[];for(const target of[{width:844,height:390},{width:390,height:844}]){
    const move=await zonePoint(page,'#touch-move-zone'),fire=toLogical(page,centre(await page.locator('[data-touch-action="fire"]').boundingBox()));
    await f.logicalDown(9,move);await f.logicalMove(9,{x:move.x-40,y:move.y},2);await f.logicalDown(10,fire);await page.setViewportSize(target);await wait(page,200);const reset=await assertReset(page,'presentation resize');assert.equal(reset.paused,false,'presentation resize does not gate or pause the match');
    const before=await read(page);await f.move(9,{x:Math.min(target.width-10,140),y:120},2);await f.move(10,{x:Math.min(target.width-10,260),y:200},2);const stale=await read(page);assert.ok(quiet(stale)&&Math.abs(angle(stale.yaw,before.yaw))<.01,'old contacts remain inert after presentation resize');await f.cancel();result.resizes.push({target,reset,stale,layout:await layout(page)});
  }
  const before=await read(page);await f.tap('[data-touch-action="fire"]');await wait(page,150);const fresh=await read(page);assert.ok(fresh.mag<before.mag,'new contacts work after both resize directions');result.freshAfterResize={before,fresh};
}
async function fallbackFlow(page,f,result,mode){await ready(page,f,mode);result.layout=await layout(page);await cardinalFlow(page,f,result);await twoThumbFlow(page,f,result);await menuFlow(page,f,result);await resizeFlow(page,f,result);}
async function nativeFlow(page,f,result,fixture){
  assert.equal((await read(page)).nativeCalls.length,0,'loading the page does not request native fullscreen or locking');await ready(page,f);
  await page.waitForFunction(name=>__landscapeNativeCalls.some(c=>c.name===name),fixture==='fullscreen-reject'?'fullscreen':'lock');
  if(fixture==='success'){
    // A real native rotation changes physical dimensions. CDP supplies that
    // platform response; the implementation must release its CSS fallback.
    await page.setViewportSize({width:844,height:390});await wait(page,200);
    assert.equal((await read(page)).viewport.rotated,false,'native landscape dimensions remove CSS rotation');
  }else assert.equal((await read(page)).viewport.rotated,true,'rejected native locking keeps the already usable CSS fallback');
  result.layout=await layout(page);await twoThumbFlow(page,f,result);await menuFlow(page,f,result);result.native=await assertClean(page);
  assert.ok(result.native.nativeCalls.filter(c=>c.name==='lock').every(c=>c.value==='landscape'),'native requests always choose landscape');
}
async function fixture(page,kind){
  await page.addInitScript(kind=>{
    window.__landscapeNativeCalls=[];window.__landscapeSensorCalls=[];window.__landscapeUnhandled=[];window.__landscapeContacts=[];
    const fail=name=>{__landscapeSensorCalls.push(name);throw new Error(`Unexpected sensor access ${name}`);};
    for(const key of['DeviceOrientationEvent','DeviceMotionEvent','Gyroscope','AbsoluteOrientationSensor','RelativeOrientationSensor','ondeviceorientation','ondevicemotion'])Object.defineProperty(window,key,{configurable:true,get(){return fail(key);}});
    const add=EventTarget.prototype.addEventListener;EventTarget.prototype.addEventListener=function(type,...args){if(['deviceorientation','deviceorientationabsolute','devicemotion'].includes(type))return fail(`listen:${type}`);return add.call(this,type,...args);};
    window.addEventListener('unhandledrejection',e=>__landscapeUnhandled.push(String(e.reason)));
    for(const type of['pointerdown','pointerup','pointercancel'])window.addEventListener(type,e=>__landscapeContacts.push({type,id:e.pointerId,trusted:e.isTrusted,pointerType:e.pointerType}),true);
    let fullscreen=null;Object.defineProperty(document,'fullscreenElement',{configurable:true,get:()=>fullscreen});
    if(kind==='missing'){
      Object.defineProperty(screen,'orientation',{configurable:true,value:undefined});for(const key of['requestFullscreen','webkitRequestFullscreen','webkitRequestFullScreen'])Object.defineProperty(Element.prototype,key,{configurable:true,value:undefined});
    }else{
      const orientation=new EventTarget();orientation.type='portrait-primary';orientation.angle=0;
      orientation.lock=value=>{__landscapeNativeCalls.push({name:'lock',value});return kind==='success'?Promise.resolve():Promise.reject(new DOMException('QA fixture rejected screen locking','NotAllowedError'));};
      Object.defineProperty(screen,'orientation',{configurable:true,value:orientation});
      Object.defineProperty(Element.prototype,'requestFullscreen',{configurable:true,value:function(){__landscapeNativeCalls.push({name:'fullscreen'});if(kind==='fullscreen-reject')return Promise.reject(new DOMException('QA fixture rejected fullscreen','NotAllowedError'));fullscreen=this;document.dispatchEvent(new Event('fullscreenchange'));return Promise.resolve();}});
    }
  },kind);
}
async function runCase(name,kind,task,{offline=false,viewport={width:390,height:844}}={}){
  if(only&&!name.includes(only))return;const result={name,nativeFixture:kind,offline};report.cases.push(result);
  const context=await browser.newContext({viewport,isMobile:true,hasTouch:true,deviceScaleFactor:1});const page=await context.newPage(),cdp=await context.newCDPSession(page),f=new Fingers(page,cdp);
  page.on('pageerror',e=>report.errors.push({case:name,error:e.stack||e.message}));page.on('console',m=>{if(m.type()==='error')report.errors.push({case:name,error:m.text()});});await fixture(page,kind);
  try{
    await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});await cdp.send('Emulation.setFocusEmulationEnabled',{enabled:true});
    const url=new URL(offline?pathToFileURL(resolve('dist/index.html')).href:base);url.searchParams.set('touch','1');url.searchParams.set('q','low');const response=await page.goto(url.href);assert.ok(response);
    result.htmlSHA256=createHash('sha256').update(await response.body()).digest('hex');report.htmlSHA256??=result.htmlSHA256;assert.equal(result.htmlSHA256,report.htmlSHA256,'all landscape cases use the same candidate HTML');
    await page.waitForFunction(()=>window.__game?.nav&&window.__mobileViewport,{timeout:90000});await page.evaluate(()=>{__game.opts.primary='m4a1';__game.opts.team='BL';});
    result.initial=await assertClean(page);assert.equal(result.initial.viewport.rotated,viewport.height>viewport.width,'the menu starts in landscape presentation before any tap');
    await task(page,f,result);result.final=await assertClean(page);result.contacts=await page.evaluate(()=>__landscapeContacts);assert.ok(result.contacts.length&&result.contacts.every(e=>e.trusted),'all gameplay gestures were trusted browser contacts');
    result.commands=f.commands;result.passed=true;console.log(`${name}: PASS (${f.commands} CDP touch commands)`);
  }catch(error){result.passed=false;result.failure=error.stack||error.message;report.failures.push({case:name,error:error.message});result.final=await read(page).catch(()=>null);await page.screenshot({path:resolve(out,`${name}-failure.png`)}).catch(()=>{});console.error(`${name}: FAIL ${error.message}`);}
  finally{await context.close();await writeFile(resolve(out,'mobile-landscape-report.json'),JSON.stringify(report,null,2));}
}
try{
  for(const mode of['tdm','relay'])await runCase(`portrait-fallback-${mode}`,'missing',(page,f,result)=>fallbackFlow(page,f,result,mode));
  await runCase('native-rejected','reject',(page,f,result)=>nativeFlow(page,f,result,'reject'));
  await runCase('native-fullscreen-rejected','fullscreen-reject',(page,f,result)=>nativeFlow(page,f,result,'fullscreen-reject'));
  await runCase('native-success','success',(page,f,result)=>nativeFlow(page,f,result,'success'));
  await runCase('offline-portrait','missing',(page,f,result)=>fallbackFlow(page,f,result,'tdm'),{offline:true});
}finally{await browser.close();await writeFile(resolve(out,'mobile-landscape-report.json'),JSON.stringify(report,null,2));}
assert.ok(report.cases.length);assert.equal(report.failures.length,0,JSON.stringify(report.failures));assert.equal(report.errors.length,0,JSON.stringify(report.errors));console.log(JSON.stringify({passed:report.cases.length,errors:report.errors.length,htmlSHA256:report.htmlSHA256,out},null,2));
