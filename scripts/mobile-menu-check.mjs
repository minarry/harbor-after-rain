// Startup-menu regression using trusted touchscreen contacts only. Navigation
// never uses scrollIntoView, DOM clicks, synthetic events or scrollTop writes.
import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const args=process.argv.slice(2),arg=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const phase=arg('--phase','after'),out=resolve(arg('--out',`artifacts/v153/${phase}`)),base=arg('--url','http://127.0.0.1:4173/'),only=arg('--only','');
await mkdir(out,{recursive:true});
const report={schema:1,phase,transport:'Chrome CDP Input.dispatchTouchEvent',programmaticScroll:false,physicalIOSVerified:false,cases:[],errors:[],failures:[]};
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const wait=(page,ms=150)=>page.waitForTimeout(ms);
function viewport(page){const {width,height}=page.viewportSize();return{width:Math.max(width,height),height:Math.min(width,height),physicalWidth:width,rotated:height>width};}
function toClient(page,p){const v=viewport(page);return v.rotated?{x:v.physicalWidth-p.y,y:p.x}:p;}
function toLogical(page,p){const v=viewport(page);return v.rotated?{x:p.y,y:v.physicalWidth-p.x}:p;}
function logicalRect(page,r){const v=viewport(page);return v.rotated?{x:r.y,y:v.physicalWidth-r.x-r.width,width:r.height,height:r.width}:r;}
class Fingers{
  constructor(page,cdp){this.page=page;this.cdp=cdp;this.points=new Map();this.commands=0;}
  async send(type,points){this.commands++;await this.cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(p=>({...p,radiusX:5,radiusY:5,force:1}))});}
  async down(id,p){assert.ok(!this.points.has(id));this.points.set(id,{id,...toClient(this.page,p)});await this.send('touchStart',[...this.points.values()]);await wait(this.page,35);}
  async move(id,p,steps=9,onStep=null){const old=this.points.get(id),end=toClient(this.page,p);assert.ok(old);for(let i=1;i<=steps;i++){this.points.set(id,{id,x:old.x+(end.x-old.x)*i/steps,y:old.y+(end.y-old.y)*i/steps});await this.send('touchMove',[...this.points.values()]);await wait(this.page,25);if(onStep)await onStep(i);}}
  async up(id){const ended=this.points.get(id);assert.ok(ended);this.points.delete(id);await this.send('touchEnd',this.points.size?[ended]:[]);await wait(this.page,180);}
  async tap(selector){const target=await targetInfo(this.page,selector);assert.ok(target?.actionable,`${selector} must already be visible and hit-testable; test will not scroll it`);await this.down(80,target.point);await this.up(80);}
}
async function targetInfo(page,selector,fraction=.5){
  const rect=await page.locator(selector).boundingBox();if(!rect)return null;
  const local=logicalRect(page,rect),v=viewport(page),point={x:local.x+local.width*fraction,y:local.y+local.height/2},client=toClient(page,point);
  const hit=await page.evaluate(({selector,client})=>{const e=document.querySelector(selector),top=document.elementFromPoint(client.x,client.y);return!!e&&!e.disabled&&(e===top||e.contains(top));},{selector,client});
  const inside=local.x>=-.5&&local.y>=-.5&&local.x+local.width<=v.width+.5&&local.y+local.height<=v.height+.5;
  return{selector,rect,logical:local,point,client,inside,hit,actionable:inside&&hit};
}
async function state(page){return page.evaluate(()=>({playing:__game.playing,paused:__game.paused,mode:__game.mode,viewport:{width:__mobileViewport.width,height:__mobileViewport.height,rotated:__mobileViewport.rotated},scrolls:['#menu','#menu .menuBox','#menu .opts'].map(selector=>{const e=document.querySelector(selector);return{selector,top:e?.scrollTop,left:e?.scrollLeft,visible:e?.clientHeight,total:e?.scrollHeight};}),touchSens:__game.opts.touchSens,sensorCalls:[...__menuSensors],unhandled:[...__menuUnhandled]}));}
async function entries(page){return Promise.all(['#btnStartTdm','#btnStartRelay'].map(selector=>targetInfo(page,selector)));}
async function menuSwipe(page,f,direction,{distance,allowButton=false}={}){
  const v=viewport(page);
  let start=null;
  search:for(const yf of direction==='up'?[.8,.7,.9,.6,.5]:[.22,.3,.12,.4,.5])for(const xf of[.035,.95,.5,.28,.72]){
    const p={x:v.width*xf,y:v.height*yf},client=toClient(page,p);
    const valid=await page.evaluate(({client,allowButton})=>{const e=document.elementFromPoint(client.x,client.y);return!!e?.closest('#menu')&&(!e.closest('input,summary,a'))&&(allowButton||!e.closest('button'));},{client,allowButton});
    if(valid){start=p;break search;}
  }
  assert.ok(start,'visible startup menu has a real swipe surface');
  const amount=Math.min(distance||v.height*.55,v.height*.62),end={x:start.x,y:Math.max(12,Math.min(v.height-12,start.y+(direction==='up'?-amount:amount)))};
  const before=await state(page);await f.down(1,start);await f.move(1,end);await f.up(1);await wait(page,200);const after=await state(page);
  return{direction,start,end,before,after};
}
async function reach(page,f,selector,result){
  result.navigation??=[];
  for(let attempt=0;attempt<18;attempt++){
    const info=await targetInfo(page,selector);if(info?.actionable)return info;
    const v=viewport(page),direction=!info||info.logical.y+info.logical.height>v.height?'up':'down';
    result.navigation.push({target:selector,...await menuSwipe(page,f,direction)});
    assert.equal((await state(page)).playing,false,'scrolling settings must never start a match');
  }
  throw new Error(`Trusted menu swipes could not reach ${selector}`);
}
async function baseline(page,f,result){
  result.initial=await state(page);result.firstScreen=await entries(page);await page.screenshot({path:resolve(out,`${result.name}-initial.png`)});
  result.swipes=[];for(let i=0;i<3;i++)result.swipes.push(await menuSwipe(page,f,'up'));
  result.afterUp=await state(page);result.afterUpEntries=await entries(page);await page.screenshot({path:resolve(out,`${result.name}-after-up.png`)});
  for(let i=0;i<3;i++)result.swipes.push(await menuSwipe(page,f,'down'));
  result.afterDown=await state(page);result.returnEntries=await entries(page);
  result.observations={firstScreenEntriesReachable:result.firstScreen.every(t=>t?.actionable),scrollMoved:result.swipes.some(s=>s.after.scrolls.some((x,i)=>Math.abs(x.top-s.before.scrolls[i].top)>10)),noAccidentalStart:!(await state(page)).playing};
  assert.ok(result.observations.firstScreenEntriesReachable,'both game entries must be directly reachable on the first screen');
  assert.ok(result.observations.scrollMoved,'actual startup-menu swipes must scroll overflowing content');
}
async function verify(page,f,result){
  result.initial=await state(page);result.firstScreen=await entries(page);
  for(const target of result.firstScreen){assert.ok(target?.actionable,`${target?.selector} is fully visible and hit-testable on the first screen`);assert.ok(target.logical.height>=44,'mode entry retains a 44px touch height');}
  await page.screenshot({path:resolve(out,`${result.name}-initial.png`)});
  // A gesture beginning over the action is still a scroll if it moves far.
  const button=result.firstScreen[0],v=viewport(page);await f.down(2,button.point);await f.move(2,{x:button.point.x,y:Math.max(12,button.point.y-Math.min(110,v.height*.4))});await f.up(2);
  result.dragFromStart=await state(page);assert.equal(result.dragFromStart.playing,false,'dragging from a mode button must not accidentally start');
  const slider='#menu .slider[data-k="touchSens"] input';
  result.sliderBefore=await reach(page,f,slider,result);const before=(await state(page)).touchSens;
  const range=await page.locator(slider).evaluate(e=>({value:+e.value,min:+e.min,max:+e.max}));
  const thumbFraction=(range.value-range.min)/(range.max-range.min);
  const left=await targetInfo(page,slider,thumbFraction),right=await targetInfo(page,slider,.78);assert.ok(left.actionable&&right.actionable,'slider is reachable by actual menu scrolling');
  await f.down(3,left.point);const afterDown=await state(page),rangeSteps=[];await f.move(3,right.point,6,async()=>rangeSteps.push(await state(page)));const afterMove=await state(page);await f.up(3);const after=(await state(page)).touchSens;
  result.slider={before,after,range,thumbFraction,left,right,afterDown,afterMove,rangeSteps,contacts:await page.evaluate(()=>__menuContacts.slice(-30))};
  assert.ok(Math.abs(after-before)>.2,'touch sensitivity changes through a real slider drag');
  assert.ok(rangeSteps.some(s=>Math.abs(s.touchSens-afterDown.touchSens)>.2),'the value changes during the drag, beyond the initial contact');
  assert.ok(rangeSteps.every(s=>Math.abs(s.scrolls[0].top-afterDown.scrolls[0].top)<1),'dragging the slider never pans the menu');
  assert.equal((await state(page)).playing,false);
  await page.screenshot({path:resolve(out,`${result.name}-settings.png`)});
  await reach(page,f,'#btnStartTdm',result);await reach(page,f,'#btnStartRelay',result);result.returnEntries=await entries(page);
  assert.ok(result.returnEntries.every(t=>t?.actionable),'both entries are available after swiping back');
  const moved=(result.navigation||[]).some(s=>s.after.scrolls.some((x,i)=>Math.abs(x.top-s.before.scrolls[i].top)>10));assert.ok(moved,'the settings journey actually scrolled, without programmatic assistance');
  result.roundTrips=[];
  for(const [mode,selector]of[['tdm','#btnStartTdm'],['relay','#btnStartRelay']]){
    await reach(page,f,selector,result);await f.tap(selector);await page.waitForFunction(mode=>__game.playing&&__game.player?.alive&&__game.mode===mode,mode,{timeout:30000});
    await page.evaluate(()=>{__game.player.protectT=999;for(const a of __game.actors)if(!a.isPlayer)a.update=()=>{};});
    await f.tap('[data-touch-action="pause"]');await page.waitForFunction(()=>__game.paused);
    await f.tap('#btnResume');await page.waitForFunction(()=>!__game.paused);await f.tap('[data-touch-action="pause"]');await page.waitForFunction(()=>__game.paused);await f.tap('#btnQuit');await page.waitForFunction(()=>!__game.playing);
    result.roundTrips.push({mode,afterQuit:await state(page),entries:await entries(page)});assert.ok(result.roundTrips.at(-1).entries.every(t=>t?.actionable),'returning to menu exposes both entries without hidden scroll assistance');
  }
}
async function run(name,width,height,{offline=false}={}){
  if(only&&!name.includes(only))return;const result={name,width,height,offline};report.cases.push(result);
  const context=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true,deviceScaleFactor:1});const page=await context.newPage(),cdp=await context.newCDPSession(page),f=new Fingers(page,cdp);
  page.on('pageerror',e=>report.errors.push({case:name,error:e.stack||e.message}));page.on('console',m=>{if(m.type()==='error')report.errors.push({case:name,error:m.text()});});
  await page.addInitScript(()=>{
    window.__menuSensors=[];window.__menuUnhandled=[];window.__menuContacts=[];window.__menuForbiddenNavigation=[];
    Object.defineProperty(screen,'orientation',{configurable:true,value:undefined});for(const key of['requestFullscreen','webkitRequestFullscreen','webkitRequestFullScreen'])Object.defineProperty(Element.prototype,key,{configurable:true,value:undefined});
    for(const key of['DeviceOrientationEvent','DeviceMotionEvent','Gyroscope','AbsoluteOrientationSensor','RelativeOrientationSensor'])Object.defineProperty(window,key,{configurable:true,get(){__menuSensors.push(key);throw new Error('Unexpected sensor access '+key);}});
    window.addEventListener('unhandledrejection',e=>__menuUnhandled.push(String(e.reason)));
    for(const type of['pointerdown','pointermove','pointerup','pointercancel'])window.addEventListener(type,e=>__menuContacts.push({type,id:e.pointerId,pointerType:e.pointerType,trusted:e.isTrusted,x:e.clientX,y:e.clientY,target:e.target.id||e.target.tagName,setting:e.target.closest?.('[data-k]')?.dataset.k}),true);
    // This catches accidental use by future revisions of this regression script.
    for(const key of['scrollIntoView','scrollIntoViewIfNeeded','click']){const owner=key==='click'?HTMLElement.prototype:Element.prototype;Object.defineProperty(owner,key,{configurable:true,value(){__menuForbiddenNavigation.push(key);throw new Error('Programmatic menu navigation forbidden: '+key);}});}
  });
  try{
    await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});await cdp.send('Emulation.setFocusEmulationEnabled',{enabled:true});
    const url=new URL(offline?pathToFileURL(resolve('dist/index.html')).href:base);url.searchParams.set('touch','1');url.searchParams.set('q','low');const response=await page.goto(url.href);assert.ok(response);
    result.htmlSHA256=createHash('sha256').update(await response.body()).digest('hex');report.htmlSHA256??=result.htmlSHA256;assert.equal(result.htmlSHA256,report.htmlSHA256,'all tested menus use one immutable HTML');
    await page.waitForFunction(()=>window.__game?.nav&&window.__mobileViewport&&!document.querySelector('#menu').classList.contains('hidden'),undefined,{timeout:90000});
    await(phase==='before'?baseline:verify)(page,f,result);result.final=await state(page);assert.deepEqual(result.final.sensorCalls,[]);assert.deepEqual(result.final.unhandled,[]);
    result.contacts=await page.evaluate(()=>__menuContacts);assert.ok(result.contacts.length&&result.contacts.every(e=>e.trusted),'every interaction comes from a trusted touchscreen contact');assert.deepEqual(await page.evaluate(()=>__menuForbiddenNavigation),[]);
    result.passed=true;console.log(`${name}: PASS (${f.commands} touch commands)`);
  }catch(error){result.passed=false;result.failure=error.stack||error.message;report.failures.push({case:name,error:error.message});result.final=await state(page).catch(()=>null);await page.screenshot({path:resolve(out,`${name}-failure.png`)}).catch(()=>{});console.error(`${name}: FAIL ${error.message}`);}
  finally{result.commands=f.commands;await context.close();await writeFile(resolve(out,'mobile-menu-report.json'),JSON.stringify(report,null,2));}
}
try{
  for(const[name,w,h]of[['wide-native',844,390],['wide-rotated',390,844],['small-native',568,320],['small-rotated',320,568]])await run(name,w,h);
  if(phase!=='before'){await run('short-native',640,300);await run('short-rotated',300,640);await run('offline-rotated',320,568,{offline:true});}
}finally{await browser.close();await writeFile(resolve(out,'mobile-menu-report.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({phase,passed:report.cases.filter(c=>c.passed).length,failed:report.failures.length,errors:report.errors.length,htmlSHA256:report.htmlSHA256,out},null,2));
assert.ok(report.cases.length);if(phase!=='before'){assert.equal(report.failures.length,0,JSON.stringify(report.failures));assert.equal(report.errors.length,0,JSON.stringify(report.errors));}
