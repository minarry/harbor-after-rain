// Actual 60 Hz laboratory playback, sampled to a small original PNG sequence.
// Never changes hand, arm or weapon transforms to create a diagnostic pose.
import {chromium} from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {Quaternion} from 'three';
import assert from 'node:assert/strict';

const arg=(key,fallback)=>{const i=process.argv.indexOf(key);return i<0?fallback:process.argv[i+1];};
const phase=arg('--phase','after'),out=path.resolve(arg('--out','artifacts/v144'));
const weapon=arg('--weapon','m4a1'),sampleCount=Number(arg('--samples','33'));
assert.ok(['before','after'].includes(phase));
assert.ok(['m4a1','ak47','mp5','deagle','awm'].includes(weapon));
assert.ok(Number.isInteger(sampleCount)&&sampleCount>=24&&sampleCount<=36,'Use 24–36 samples');
const source=path.resolve(arg('--source',phase==='before'?path.join(out,'before.html'):'dist/index.html'));
const stem=`reload-motion-${weapon}-${phase}`,framesDir=path.join(out,`${stem}-frames`);
await fs.mkdir(framesDir,{recursive:true});
const bytes=await fs.readFile(source);
const report={schemaVersion:1,complete:false,phase,weapon,source,sourceSha256:createHash('sha256').update(bytes).digest('hex'),
  viewport:{width:1440,height:900},seed:4207,quality:'high',step:1/60,sampleCount,
  motionSource:'Public __lab.action(reload) followed by __lab.step at 60 Hz. First sample is settled rest before the reload; last sample includes the native return to rest. No pose scrubbing, hand repositioning or rig/camera changes.',
  coordinateSpaces:{handQuaternion:'local to hand.parent',handWorldQuaternion:'actual Object3D world quaternion',forearmQuaternion:'runtime arm forearm frame, in the view-model rig coordinates',wristQuaternion:'runtime forearm^-1 * hand; independent wrist rotation',contact:'runtime grasp anchor, in view-model scene world coordinates'},
  frames:[],trace:[],errors:[]};
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
  const page=await browser.newPage({viewport:report.viewport,deviceScaleFactor:1});
  page.on('pageerror',e=>report.errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  const url=new URL(pathToFileURL(source));
  url.search=new URLSearchParams({lab:'weapon',seed:'4207',shot:'1',t:'2',q:'high',c:JSON.stringify({weapon,ads:0,reloadPhase:-1})});
  await page.goto(url.href);
  await page.waitForFunction(()=>window.__lab?.ready,null,{timeout:90000});
  const initial=await page.evaluate(()=>{__lab.pause(true);if(__lab.debug.vm.drawT!==1)throw Error('Draw animation has not settled');return __lab.snapshot();});
  report.initialSimulationFrame=initial.frame;report.initialTime=initial.time;
  await page.evaluate(()=>{
    const vm=__lab.debug.vm,original=vm.update;
    window.__reloadMotionTrace=[];
    const sample=(restProgress=1)=>{
      vm.rig.updateMatrixWorld(true);
      const snapshot=__lab.snapshot(),array=v=>v?.toArray?.()||null;
      const arms=Object.fromEntries(Object.entries(vm.arms).map(([side,a])=>{
        const world=a.hand.getWorldQuaternion(a.hand.quaternion.clone());
        const actual=a.localContact?a.hand.localToWorld(a.localContact.clone()):null;
        const runtime=snapshot.details.hands?.[side]?.joint;
        const fields={handQuaternion:a.hand.quaternion.toArray(),handWorldQuaternion:world.toArray(),
          forearmQuaternion:runtime?.forearm||array(a.forearmQuaternion),wristQuaternion:runtime?.wristRelative||array(a.wristQuaternion),
          wristBendDegrees:runtime?.bendDegrees??(Number.isFinite(a.wristBend)?a.wristBend*180/Math.PI:null),
          handPosition:a.hand.position.toArray(),wrist:array(a.wrist),elbow:array(a.elbow),forearmDirection:array(a.forearmDirection),
          contact:array(a.contact),actualContact:array(actual),contactError:actual&&a.contact?actual.distanceTo(a.contact):null,
          palmNormalWorld:a.hand.position.clone().set(0,-1,0).applyQuaternion(world).toArray(),kind:a.poseKind,blend:a.poseBlend};
        fields.finite=Object.values(fields).filter(Array.isArray).flat().every(Number.isFinite);
        return [side,fields];
      }));
      window.__reloadMotionTrace.push({simulationFrame:snapshot.frame,simulationTime:snapshot.time,
        progress:vm.anim?.type==='reload'?Math.min(1,vm.anim.t/vm.anim.dur):restProgress,arms});
    };
    sample(0);
    // Observe the result of every actual fixed update, including the two ticks
    // made by the public reload action. Do not change any pose input or output.
    vm.update=function(...args){const value=original.apply(this,args);if(args[0]>0)sample();return value;};
    window.__stopReloadMotionTrace=()=>{vm.update=original;};
  });
  async function capture(index,targetFrame,progress){
    const state=await page.evaluate(({index,targetFrame,progress})=>{
      const api=__lab,vm=api.debug.vm;
      vm.rig.updateMatrixWorld(true);
      const values=v=>v?.toArray?.()||null;
      const arms=Object.fromEntries(Object.entries(vm.arms).map(([side,a])=>{
        const handWorldQ=a.hand.getWorldQuaternion(a.hand.quaternion.clone());
        const handWorldP=a.hand.getWorldPosition(a.hand.position.clone());
        const palmNormal=a.hand.position.clone().set(0,-1,0).applyQuaternion(handWorldQ);
        const actualContact=a.localContact?a.hand.localToWorld(a.localContact.clone()):null;
        const contactError=actualContact&&a.contact?actualContact.distanceTo(a.contact):null;
        return [side,{kind:a.poseKind,blend:a.poseBlend,contact:values(a.contact),actualContact:values(actualContact),contactError,
          handPosition:values(a.hand.position),handWorldPosition:values(handWorldP),handQuaternion:values(a.hand.quaternion),handWorldQuaternion:values(handWorldQ),
          forearmQuaternion:values(a.forearmQuaternion),wristQuaternion:values(a.wristQuaternion),forearmDirection:values(a.forearmDirection),
          wrist:values(a.wrist),elbow:values(a.elbow),shoulder:values(a.shoulder),palmNormalWorld:values(palmNormal),
          wristBendRadians:Number.isFinite(a.wristBend)?a.wristBend:null,
          wristBendDegrees:Number.isFinite(a.wristBendDegrees)?a.wristBendDegrees:Number.isFinite(a.wristBend)?a.wristBend*180/Math.PI:null,
          finite:[...a.hand.position.toArray(),...handWorldQ.toArray(),...a.mesh.skeleton.bones.flatMap(b=>[...b.position.toArray(),...b.quaternion.toArray()])].every(Number.isFinite)}];
      }));
      const snapshot=api.snapshot();
      return {index,targetFrame,simulationFrame:snapshot.frame,simulationTime:snapshot.time,
        progress:vm.anim?.type==='reload'?Math.min(1,vm.anim.t/vm.anim.dur):progress,
        animation:vm.anim?{type:vm.anim.type,time:vm.anim.t,duration:vm.anim.dur}:null,arms,
        view:{rigPosition:vm.rig.position.toArray(),rigScale:vm.rig.scale.toArray(),cameraPosition:api.debug.r.vmCamera.position.toArray(),cameraQuaternion:api.debug.r.vmCamera.quaternion.toArray(),fov:api.debug.r.vmCamera.fov},
        errors:snapshot.errors};
    },{index,targetFrame,progress});
    const name=`${String(index).padStart(3,'0')}.png`;
    state.image=`${path.basename(framesDir)}/${name}`;
    await page.locator('#c').screenshot({path:path.join(framesDir,name)});
    report.frames.push(state);
    assert.equal(state.simulationFrame-initial.frame,targetFrame,'Unexpected simulation step');
    assert.deepEqual(state.view.rigPosition,[0,0,0]);assert.deepEqual(state.view.rigScale,[1,1,1]);
    assert.ok(Object.values(state.arms).every(a=>a.finite),'Non-finite hand/bone transform');
    assert.deepEqual(state.errors,[]);
    if(index%8===0||index===sampleCount-1)console.log(`Captured motion ${index+1}/${sampleCount}, phase ${state.progress.toFixed(3)}`);
  }
  await capture(0,0,0);
  const started=await page.evaluate(()=>{__lab.action('reload');const vm=__lab.debug.vm;if(vm.anim?.type!=='reload')throw Error('Reload did not start');return {duration:vm.anim.dur,frame:__lab.snapshot().frame};});
  report.duration=started.duration;
  // One extra simulation tick handles floating-point accumulation at the exact
  // endpoint; the final frame must show the real animation returning to rest.
  const totalFrames=Math.ceil(started.duration/report.step)+1;
  let currentFrame=started.frame-initial.frame;
  for(let i=1;i<sampleCount;i++){
    const targetFrame=Math.round(i*totalFrames/(sampleCount-1));
    assert.ok(targetFrame>=currentFrame,'Sample rate exceeds simulation rate');
    if(targetFrame>currentFrame)await page.evaluate(n=>__lab.step(n),targetFrame-currentFrame);
    currentFrame=targetFrame;await capture(i,targetFrame,i/(sampleCount-1));
  }
  assert.equal(report.frames.at(-1).animation,null,'Reload must return to native rest');
  report.trace=await page.evaluate(()=>{window.__stopReloadMotionTrace();return window.__reloadMotionTrace;});
  assert.equal(report.trace.length,totalFrames+1,'Every 60 Hz update must be recorded');
  report.trace.forEach((frame,i)=>{
    assert.equal(frame.simulationFrame,initial.frame+i,'Missing or duplicate fixed-step trace');
    assert.ok(Object.values(frame.arms).every(a=>a.finite),'Non-finite intermediate arm transform');
  });
  const qAngle=(a,b)=>new Quaternion().fromArray(a).angleTo(new Quaternion().fromArray(b))*180/Math.PI;
  report.summary={};
  for(const side of ['L','R']){
    const arms=report.trace.map(f=>f.arms[side]);
    const haveJoints=arms.every(a=>a.forearmQuaternion&&a.wristQuaternion&&Number.isFinite(a.wristBendDegrees));
    if(phase==='after')assert.ok(haveJoints,`${side}: runtime forearm/wrist joint fields are missing`);
    const maxChange=key=>haveJoints?Math.max(...arms.slice(1).map((a,i)=>qAngle(a[key],arms[i][key]))):null;
    const relativeErrors=haveJoints?arms.map(a=>new Quaternion().fromArray(a.forearmQuaternion).multiply(new Quaternion().fromArray(a.wristQuaternion)).angleTo(new Quaternion().fromArray(a.handQuaternion))*180/Math.PI):[];
    if(haveJoints)assert.ok(Math.max(...relativeErrors)<.05,`${side}: recorded wrist relation does not reproduce the real hand orientation`);
    const largestPositionStep=key=>arms.slice(1).reduce((largest,a,i)=>{
      const previous=arms[i][key],value=a[key];if(!previous||!value)return largest;
      const mm=Math.hypot(...value.map((v,j)=>v-previous[j]))*1000;
      return mm>largest.mm?{mm,simulationFrame:report.trace[i+1].simulationFrame,progress:report.trace[i+1].progress}:largest;
    },{mm:0,simulationFrame:initial.frame,progress:0});
    report.summary[side]={haveRuntimeJoints:haveJoints,continuityStepSeconds:report.step,
      largestElbowStep:largestPositionStep('elbow'),largestWristStep:largestPositionStep('wrist'),
      maxHandStepDegrees:Math.max(...arms.slice(1).map((a,i)=>qAngle(a.handWorldQuaternion,arms[i].handWorldQuaternion))),
      maxForearmStepDegrees:maxChange('forearmQuaternion'),maxWristStepDegrees:maxChange('wristQuaternion'),
      maxWristBendDegrees:haveJoints?Math.max(...arms.map(a=>a.wristBendDegrees)):null,
      maxJointRelationErrorDegrees:relativeErrors.length?Math.max(...relativeErrors):null,
      maxStableContactErrorMm:Math.max(0,...arms.filter(a=>a.contactError!==null).map(a=>a.contactError*1000))};
  }
  assert.deepEqual(report.errors,[]);report.complete=true;
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const playback=JSON.stringify({duration:report.duration,frames:report.frames}).replaceAll('<','\\u003c');
  const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>运输船 · 真实换弹与旋腕复核</title><style>
  *{box-sizing:border-box}body{margin:0;background:#101b20;color:#eee9dd;font:15px/1.65 system-ui,sans-serif}main{max-width:1140px;margin:auto;padding:28px 20px}small,a{color:#e1b77c}h1{font-size:clamp(23px,3.5vw,36px);margin:8px 0 14px}p{color:#acb9b9}img{display:block;width:100%;max-height:74vh;object-fit:contain;background:#081216;border:1px solid #354b52}.controls{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:16px 0}button,select{font:inherit;color:#eee9dd;background:#203139;border:1px solid #53666d;min-height:44px;padding:8px 13px}button{cursor:pointer}input[type=range]{width:100%;accent-color:#e1b77c}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:18px}.metrics div{border-top:1px solid #53666d;padding-top:9px;color:#acb9b9;font-size:13px}.metrics strong{display:block;color:#eee9dd;font-size:20px}summary{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}a:focus-visible,button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid #e1b77c;outline-offset:3px}@media(max-width:600px){main{padding:20px 12px}.metrics{grid-template-columns:1fr 1fr}}
  </style><main><small>HARBOR / AFTER RAIN · ${esc(phase)} · ${esc(weapon.toUpperCase())}</small><h1>真实换弹与旋腕复核</h1><p>使用游戏的固定时间步连续推进空仓换弹，记录 ${sampleCount} 张原始画面。可播放、慢放或拖动逐帧观察；采样频率不代表游戏帧率。手部位置与关节均由实际动作代码产生。</p>
  <img id="frame" src="${esc(report.frames[0].image)}" alt="实际换弹动作的固定时间采样画面"><div class="controls"><button id="play" aria-pressed="false">播放换弹</button><label for="speed">速度</label><select id="speed"><option value="1">正常</option><option value="0.5">半速</option><option value="0.25">四分之一速</option></select><output id="position"></output></div><label for="timeline">逐帧查看</label><input id="timeline" type="range" min="0" max="${sampleCount-1}" step="1" value="0">
  <div class="metrics"><div>左手动作<strong id="kind"></strong></div><div>左掌朝上分量<strong id="palm"></strong></div><div>左腕弯折<strong id="bend"></strong></div><div>左手接触误差<strong id="contact"></strong></div></div>
  <p>首帧为换弹前持枪，最后一帧为实际归位。掌心朝上分量取相机空间 Y 分量，+1 为朝上、0 为侧向。接触误差只在存在明确握点时显示。</p><details><summary>查看当前帧真实关节数据</summary><pre id="data"></pre></details><p><a href="${esc(stem)}.json">下载完整记录</a> · 来源 SHA-256：<code style="overflow-wrap:anywhere">${esc(report.sourceSha256)}</code></p></main>
  <script>const capture=${playback},frames=capture.frames;let index=0,playing=false,timer;const image=document.querySelector('#frame'),play=document.querySelector('#play'),slider=document.querySelector('#timeline'),speed=document.querySelector('#speed');const fmt=(v,suffix)=>Number.isFinite(v)?v.toFixed(2)+suffix:'未提供';function show(){const f=frames[index],a=f.arms.L;image.src=f.image;slider.value=index;document.querySelector('#position').textContent=(index+1)+' / '+frames.length+' · '+Math.round(f.progress*100)+'%';document.querySelector('#kind').textContent=({support:'托枪',grip:'握把',magazine:'抓弹匣',rack:'拉机柄'})[a.kind]||a.kind;document.querySelector('#palm').textContent=fmt(a.palmNormalWorld[1],'');document.querySelector('#bend').textContent=fmt(a.wristBendDegrees,'°');document.querySelector('#contact').textContent=fmt(a.contactError===null?null:a.contactError*1000,' mm');document.querySelector('#data').textContent=JSON.stringify({progress:f.progress,simulationFrame:f.simulationFrame,arms:f.arms},null,2)}function pause(){playing=false;clearTimeout(timer);play.textContent='播放换弹';play.setAttribute('aria-pressed','false')}function next(){if(!playing)return;if(index===frames.length-1){pause();return}const delta=frames[index+1].simulationTime-frames[index].simulationTime;timer=setTimeout(()=>{index++;show();next()},Math.max(1,delta*1000/Number(speed.value)))}play.onclick=()=>{if(playing){pause();return}if(index===frames.length-1)index=0;playing=true;play.textContent='暂停';play.setAttribute('aria-pressed','true');show();next()};slider.oninput=()=>{pause();index=Number(slider.value);show()};speed.onchange=()=>{if(playing){clearTimeout(timer);next()}};for(const f of frames){const preload=new Image();preload.src=f.image}show();</script></html>`;
  await fs.writeFile(path.join(out,`${stem}.html`),html);
  console.log(JSON.stringify({file:`${stem}.html`,frames:report.frames.length,sourceSha256:report.sourceSha256,summary:report.summary},null,2));
}finally{
  await fs.writeFile(path.join(out,`${stem}.json`),JSON.stringify(report,null,2));
  await browser.close();
}
