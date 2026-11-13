// Two native game views + two explicitly relocated weapon-camera diagnostics.
import {chromium} from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const arg=(k,d)=>{const i=process.argv.indexOf(k);return i<0?d:process.argv[i+1];};
const phase=arg('--phase','before'),out=path.resolve(arg('--out','artifacts/v146'));
const source=path.resolve(arg('--source',phase==='before'?path.join(out,'before.html'):'dist/index.html'));
const sha=data=>createHash('sha256').update(data).digest('hex');
await fs.mkdir(out,{recursive:true});
const report={phase,source,sourceSha256:sha(await fs.readFile(source)),viewport:{width:1440,height:900},seed:4207,records:[],errors:[]};
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 const page=await browser.newPage({viewport:report.viewport,deviceScaleFactor:1});
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await page.addInitScript(()=>{let a=4207;Math.random=()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};localStorage.setItem('harbor_after_rain_opts_v1',JSON.stringify({mode:'tdm',team:'BL',primary:'m4a1',size:5,diff:'normal',goal:50,tod:'dusk',quality:'high',fov:78,vol:0}));});
 for(const weapon of ['m4a1','deagle']){
  const url=new URL(pathToFileURL(source));url.search='?nolock=1&q=high';await page.goto(url.href);await page.waitForFunction(()=>window.__game?.nav,null,{timeout:90000});
  await page.evaluate(()=>{requestAnimationFrame=()=>0;});await page.waitForTimeout(150);await page.locator('#btnStartTdm').click();
  await page.evaluate(weapon=>{
   const g=__game,p=g.player;for(const a of g.actors)if(a!==p){a.soldier.root.visible=false;a.alive=false;}for(const t of g.tags)t.sprite.visible=false;g.actors=[p];g.tags=[];
   g.time=g.realTime=g.frame=g.simAccumulator=0;g.timeLeft=180;g.env.shipDist=0;g.fx.resetTransient();g.env.apply('dusk');g.env.atmosphere.setWeather({rain:.85,wetness:.85,immediate:true});
   g.renderer.adaptive=false;g.renderer.resize(1440,900);p.pos.set(-17,0,-6.5);p.vel.set(0,0,0);p.yaw=-Math.PI/2;p.pitch=-.025;p.speed=0;p.onGround=true;p.ads=p.scoped=p.land=p.bobT=p.protectT=0;p.punchP=p.punchY=p.aimPunch=0;p.damageResponse.reset();
   p.weaponUpdate(0,{sw:weapon==='deagle'?1:0});g.renderer.camera.fov=78;g.renderer.camera.updateProjectionMatrix();g.hud.toastT=0;g.hud.el.toast.style.opacity=0;
   for(let i=0;i<120;i++){g.realTime=(i+1)/60;g.simulate(1/60);g.renderFrame(1/60);}p.updateCamera(0);g.renderFrame(0);const fps=document.querySelector('#radarWrap .lbl');if(fps)fps.textContent='运输船';
  },weapon);
  const state=await page.evaluate(()=>{
   const g=__game,vm=g.vm;vm.rig.updateMatrixWorld(true);const vector=vm.holder.position.clone(),gunInverse=vm.cur.getWorldQuaternion(vm.holder.quaternion.clone()).invert();
   const arms=Object.fromEntries(Object.entries(vm.arms).map(([side,a])=>[side,{hand:a.hand.position.toArray(),handWorld:a.hand.getWorldPosition(vector).toArray(),handQuaternion:a.hand.quaternion.toArray(),forearmQuaternion:a.forearmQuaternion.toArray(),wristQuaternion:a.wristQuaternion.toArray(),elbow:a.elbow.toArray(),wrist:a.wrist.toArray(),
    geometry:Object.fromEntries(['fore','upper'].map(key=>[key,{position:Array.from(a[key].geometry.attributes.position.array),normal:Array.from(a[key].geometry.attributes.normal.array)}]))}]));
   const r=vm.arms.R,bone=(b)=>b.getWorldPosition(vector).clone(),index=bone(r.fingers[0][0]),pinky=bone(r.fingers[3][0]),thumb=bone(r.thumb[0]);
   const palm=vector.set(0,-1,0).applyQuaternion(r.hand.getWorldQuaternion(r.hand.quaternion.clone())).applyQuaternion(gunInverse).toArray();
   return {time:g.time,weapon:g.player.weapon.id,drawT:vm.drawT,arms,camera:{position:g.renderer.camera.position.toArray(),quaternion:g.renderer.camera.quaternion.toArray(),fov:g.renderer.camera.fov},viewCamera:{position:g.renderer.vmCamera.position.toArray(),quaternion:g.renderer.vmCamera.quaternion.toArray(),fov:g.renderer.vmCamera.fov},rig:{position:vm.rig.position.toArray(),quaternion:vm.rig.quaternion.toArray()},
    rightDiagnostic:{elbowMinusWristY:r.elbow.y-r.wrist.y,indexBaseWorld:index.toArray(),pinkyBaseWorld:pinky.toArray(),thumbBaseWorld:thumb.toArray(),indexMinusPinkyY:index.y-pinky.y,thumbMinusPinkyY:thumb.y-pinky.y,indexDirectionGunLocal:index.clone().sub(pinky).normalize().applyQuaternion(gunInverse).toArray(),palmNormalGunLocal:palm}};
  });
  for(const arm of Object.values(state.arms))for(const geometry of Object.values(arm.geometry)){
   geometry.positionSha256=sha(Buffer.from(new Float32Array(geometry.position).buffer));geometry.normalSha256=sha(Buffer.from(new Float32Array(geometry.normal).buffer));geometry.vertices=geometry.position.length/3;delete geometry.position;delete geometry.normal;
  }
  assert.equal(state.weapon,weapon);assert.equal(state.drawT,1);
  const native=`${weapon}-native-${phase}.png`;await page.screenshot({path:path.join(out,native)});report.records.push({weapon,kind:'native game camera; no rig changes',screenshot:native,state});
  const diagnostic=await page.evaluate(()=>{
   const g=__game,vm=g.vm,cam=g.renderer.vmCamera;vm.rig.updateMatrixWorld(true);
   const positionGunLocal=[.32,-.025,.06],targetGunLocal=[0,-.065,.03],point=vm.holder.position.clone();
   cam.position.copy(vm.cur.localToWorld(point.fromArray(positionGunLocal)));const target=vm.cur.localToWorld(point.clone().fromArray(targetGunLocal));cam.up.set(0,1,0);cam.lookAt(target);cam.updateProjectionMatrix();g.renderer.render();
   const label=document.createElement('div');label.textContent='诊断视角：武器相机移至右侧 · 手、手臂及枪械姿态未改变';Object.assign(label.style,{position:'fixed',top:'95px',left:'24px',padding:'8px 12px',background:'rgba(5,14,18,.88)',color:'#f0cf97',font:'14px system-ui',zIndex:'999',pointerEvents:'none'});document.body.append(label);
   return {positionGunLocal,targetGunLocal,cameraPosition:cam.position.toArray(),cameraQuaternion:cam.quaternion.toArray(),target:target.toArray(),fov:cam.fov,rigPosition:vm.rig.position.toArray()};
  });
  const close=`${weapon}-right-side-${phase}.png`;await page.screenshot({path:path.join(out,close)});report.records.push({weapon,kind:'diagnostic only: weapon camera relocated, no hand/arm/rig transform changes',screenshot:close,diagnostic});
  console.log(JSON.stringify({weapon,native,diagnostic:close,right:state.rightDiagnostic}));
 }
 assert.deepEqual(report.errors,[]);
 if(phase==='after'){
  const before=JSON.parse(await fs.readFile(path.join(out,'right-hand-before.json'),'utf8'));
  report.leftUnchanged=report.records.filter(r=>r.state).map(r=>{const b=before.records.find(b=>b.weapon===r.weapon&&b.state);assert.deepEqual(r.state.arms.L,b.state.arms.L,`${r.weapon}: approved left arm changed`);return {weapon:r.weapon,exactTransformsAndGeometry:true};});
  assert.equal(sha(await fs.readFile(before.source)),before.sourceSha256,'Baseline source changed');
  assert.equal(sha(await fs.readFile(source)),report.sourceSha256,'Source changed during capture');
  assert.equal(before.records.length,4);assert.equal(report.records.length,4);
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const names={m4a1:'M4',deagle:'沙漠之鹰'},sections=[];
  // Show both normal viewpoints first, then the clearly labelled camera moves.
  const ordered=[...report.records.filter(r=>r.state),...report.records.filter(r=>r.diagnostic)];
  for(const after of ordered){
   const old=before.records.find(b=>b.weapon===after.weapon&&b.kind===after.kind);assert.ok(old,'Missing matched view');
   if(after.state){
    for(const key of ['time','camera','viewCamera','rig'])assert.deepEqual(after.state[key],old.state[key],`${after.weapon}: ${key} differs`);
   }else assert.deepEqual(after.diagnostic,old.diagnostic,'Diagnostic camera differs');
   await fs.access(path.join(out,old.screenshot));await fs.access(path.join(out,after.screenshot));
   const native=!!after.state,title=`${names[after.weapon]} · ${native?'正常游戏视角':'右侧诊断视角'}`;
   const note=native?'完整游戏画面，保持默认相机、黄昏光照和同一持枪时刻。':'仅将武器相机移动到右侧，便于检查食指、拇指、袖口和握把关系。手、手臂及枪械均保留真实动作姿态；此图不是正常游戏镜头。';
   const metric=native?`<p class="metric">右肘相对手腕高度：${(old.state.rightDiagnostic.elbowMinusWristY*1000).toFixed(1)} → ${(after.state.rightDiagnostic.elbowMinusWristY*1000).toFixed(1)} mm。正数表示肘部高于手腕。</p>`:'';
   sections.push(`<section><small>${native?'实际游戏':'相机移位诊断'}</small><h2>${esc(title)}</h2><p>${esc(note)}</p>${metric}<div class="pair"><figure><figcaption>改动前 · 1.4.5</figcaption><a href="${encodeURIComponent(old.screenshot)}" target="_blank"><img src="${encodeURIComponent(old.screenshot)}" alt="${esc(title)}，调整前" loading="lazy"></a></figure><figure><figcaption>改动后 · 1.4.6</figcaption><a href="${encodeURIComponent(after.screenshot)}" target="_blank"><img src="${encodeURIComponent(after.screenshot)}" alt="${esc(title)}，调整后" loading="lazy"></a></figure></div></section>`);
  }
  const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>运输船 · 右手握枪前后对照</title><style>*{box-sizing:border-box}body{margin:0;background:#101b20;color:#eee9dd;font:15px/1.7 system-ui,sans-serif}main{max-width:1600px;margin:auto;padding:30px 22px}small,a{color:#e1b77c}h1{font-size:clamp(25px,3vw,40px);margin:8px 0 14px}h2{margin:2px 0 9px;font-size:25px}p{color:#b1bfc0;max-width:1050px}.metric{font-size:13px}section{padding:27px 0;border-top:1px solid #354b52;margin-top:25px}.pair{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}figure{margin:0;min-width:0}figcaption{padding:8px 0;color:#e1b77c}img{width:100%;height:auto;display:block;border:1px solid #354b52}code{font-size:12px;overflow-wrap:anywhere}summary{cursor:pointer}a:focus-visible,summary:focus-visible{outline:2px solid #e1b77c;outline-offset:3px}@media(max-width:760px){main{padding:22px 13px}.pair{grid-template-columns:minmax(0,1fr)}}
  </style><main><small>HARBOR / AFTER RAIN · 1.4.5 → 1.4.6</small><h1>右手握枪：前后对照</h1><p>观察右前臂接入手腕的方向、食指与握把的关系。前后使用同一视角和时间；左手握姿与前臂形状保持一致。点击图片可查看完整原图。</p>${sections.join('')}<details><summary>固定设置与左手校验</summary><p>两种武器的左手位置、手掌和前臂朝向、肘腕位置，以及前臂和上臂的顶点、法线校验值逐项相同。截图来自真实渲染；诊断图仅改变武器相机，不重新摆放右手。</p><p><a href="right-hand-before.json">改动前记录</a> · <a href="right-hand-after.json">改动后记录</a></p><p>改动前 SHA-256<br><code>${esc(before.sourceSha256)}</code></p><p>改动后 SHA-256<br><code>${esc(report.sourceSha256)}</code></p></details></main></html>`;
  report.review='right-hand-review.html';await fs.writeFile(path.join(out,report.review),html);
 }
}finally{await fs.writeFile(path.join(out,`right-hand-${phase}.json`),JSON.stringify(report,null,2));await browser.close();}
