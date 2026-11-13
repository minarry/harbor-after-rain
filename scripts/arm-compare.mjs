// Native full-width game capture, complementing hand-compare's laboratory views.
// No hand, arm, gun, light or camera-rig geometry is changed for this capture.
import {chromium} from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const arg=(key,fallback)=>{const i=process.argv.indexOf(key);return i<0?fallback:process.argv[i+1];};
const phase=arg('--phase','before'),out=path.resolve(arg('--out','artifacts/v144'));
assert.ok(['before','after'].includes(phase),'--phase must be before or after');
const source=path.resolve(arg('--source',phase==='before'?`${out}/before.html`:'dist/index.html'));
const setupFile=path.join(out,'game-arm-setup.json');
await fs.mkdir(out,{recursive:true});
const defaultSetup={schemaVersion:1,viewport:{width:1440,height:900},deviceScaleFactor:1,seed:4207,quality:'high',
  options:{mode:'tdm',team:'BL',primary:'m4a1',size:5,diff:'normal',goal:50,tod:'dusk',fov:78,vol:0},
  player:{position:[-17,0,-6.5],yaw:-Math.PI/2,pitch:-.025},frames:120,step:1/60,
  weather:{rain:.85,wetness:.85,immediate:true},
  notes:'Actual game renderer and player camera, normal full-width viewport and default FOV. NPCs are hidden and removed from the screenshot simulation to prevent interference. The normal player simulation and renderFrame are advanced by 120 fixed frames. No arm/gun rig repositioning or material/light overrides. Quality scaling is fixed; normal post-processing remains enabled. Intro toast and variable FPS text are suppressed only in the capture.'};
let setup;
try{setup=JSON.parse(await fs.readFile(setupFile,'utf8'));}catch(e){if(e.code!=='ENOENT'||phase==='after')throw e;setup=defaultSetup;await fs.writeFile(setupFile,JSON.stringify(setup,null,2));}
const bytes=await fs.readFile(source);
const report={phase,source,sourceBytes:bytes.length,sourceSha256:createHash('sha256').update(bytes).digest('hex'),setupFile,setup,errors:[]};
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
  const page=await browser.newPage({viewport:setup.viewport,deviceScaleFactor:setup.deviceScaleFactor});
  page.on('pageerror',e=>report.errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  await page.addInitScript(({seed,options,quality})=>{
    let a=seed>>>0;
    Math.random=()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};
    try{localStorage.setItem('harbor_after_rain_opts_v1',JSON.stringify({...options,quality}));}catch{}
  },setup);
  const url=new URL(pathToFileURL(source));url.search=new URLSearchParams({nolock:'1',q:setup.quality});
  await page.goto(url.href);
  await page.waitForFunction(()=>window.__game?.nav&&!document.querySelector('#menu').classList.contains('hidden'),null,{timeout:90000});
  await page.evaluate(()=>{window.requestAnimationFrame=()=>0;});
  await page.waitForTimeout(150); // Drain the single frame already scheduled.
  await page.locator('#btnStartTdm').click();
  report.state=await page.evaluate(cfg=>{
    const g=__game,p=g.player;
    const excludedNPCs=g.actors.filter(a=>a!==p);
    for(const a of excludedNPCs){a.soldier.root.visible=false;a.alive=false;a.update=()=>{};}
    for(const t of g.tags)t.sprite.visible=false;
    g.actors=[p];g.tags=[];
    g.time=0;g.timeLeft=180;g.realTime=0;g.frame=0;g.simAccumulator=0;
    g.env.shipDist=0;g.fx.resetTransient();
    g.env.apply(cfg.options.tod);g.env.atmosphere.setWeather(cfg.weather);
    g.renderer.adaptive=false;g.renderer.resize(cfg.viewport.width,cfg.viewport.height);
    p.pos.fromArray(cfg.player.position);p.vel.set(0,0,0);p.yaw=cfg.player.yaw;p.pitch=cfg.player.pitch;
    p.speed=0;p.onGround=true;p.crouch=false;p.ads=0;p.scoped=0;p.land=0;p.bobT=0;p.protectT=0;
    p.punchP=p.punchY=p.aimPunch=0;p.damageResponse.reset();
    g.renderer.camera.fov=cfg.options.fov;g.renderer.camera.updateProjectionMatrix();
    g.hud.toastT=0;g.hud.el.toast.style.opacity=0;
    for(let i=0;i<cfg.frames;i++){
      g.realTime=(i+1)*cfg.step;g.simulate(cfg.step);g.renderFrame(cfg.step);
    }
    // Only this native camera update is used; no camera or view-model offsets.
    p.updateCamera(0);g.renderFrame(0);
    const fps=document.querySelector('#radarWrap .lbl');if(fps)fps.textContent='运输船';
    const vm=g.vm,cam=g.renderer.camera;
    return {playing:g.playing,paused:g.paused,time:g.time,timeLeft:g.timeLeft,weapon:p.weapon.id,drawT:vm.drawT,
      excludedNPCs:excludedNPCs.length,position:p.pos.toArray(),yaw:p.yaw,pitch:p.pitch,
      camera:{position:cam.position.toArray(),quaternion:cam.quaternion.toArray(),fov:cam.fov,aspect:cam.aspect},
      viewCamera:{position:g.renderer.vmCamera.position.toArray(),fov:g.renderer.vmCamera.fov,aspect:g.renderer.vmCamera.aspect},
      rig:{position:vm.rig.position.toArray(),scale:vm.rig.scale.toArray()},
      light:{preset:g.env.name,sunDirection:g.env.sunDir.toArray(),sunColor:g.env.sun.color.getHex(),sunIntensity:g.env.sun.intensity,vmSun:vm.sun.intensity,vmFill:vm.fill.intensity,lightK:g.lightK,indoorK:g.indoorK},
      weather:g.env.atmosphere.getWeather(),renderer:g.renderer.getFeatures(),
      arms:Object.fromEntries(Object.entries(vm.arms).map(([side,a])=>[side,{hand:a.hand.position.toArray(),quaternion:a.hand.quaternion.toArray(),wrist:a.wrist.toArray(),elbow:a.elbow.toArray()}]))};
  },setup);
  assert.equal(report.state.weapon,setup.options.primary);
  assert.equal(report.state.drawT,1,'native game draw must settle');
  assert.deepEqual(report.state.rig.position,[0,0,0]);assert.deepEqual(report.state.rig.scale,[1,1,1]);
  assert.ok(Math.abs(report.state.camera.fov-setup.options.fov)<1e-6,'normal game FOV');
  report.screenshot=path.join(out,`game-m4-hip-${phase}.png`);
  await page.screenshot({path:report.screenshot});
  // A direct viewport crop for reviewing the arm at readable size. It uses the
  // same frozen render; no rig, camera, lighting or image pixels are changed.
  report.detailScreenshot=path.join(out,`game-arm-detail-${phase}.png`);
  await page.screenshot({path:report.detailScreenshot,clip:{
    x:Math.floor(setup.viewport.width*.29),y:Math.floor(setup.viewport.height*.55),
    width:Math.floor(setup.viewport.width*.59),height:Math.floor(setup.viewport.height*.45)}});
  assert.equal(report.errors.length,0,report.errors.join('\n'));
  console.log(JSON.stringify({screenshot:report.screenshot,state:report.state,errors:report.errors},null,2));
}finally{
  await fs.writeFile(path.join(out,`game-arm-${phase}.json`),JSON.stringify(report,null,2));
  await browser.close();
}
