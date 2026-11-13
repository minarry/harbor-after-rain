// Focused recovery test: compare each history against idle at the SAME fixed
// simulation time. Geometry is read after real skin/arm updates, never posed here.
import {chromium} from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {Quaternion} from 'three';
import assert from 'node:assert/strict';

const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const phase=arg('--phase','before'),out=path.resolve(arg('--out','artifacts/v145'));
assert.ok(['before','after'].includes(phase));
const source=path.resolve(arg('--source',phase==='before'?path.join(out,'before.html'):'dist/index.html'));
const weapons=['m4a1','ak47','mp5','deagle','awm'];
const scenarios=[{id:'full',label:'完整换弹',repeat:1},{id:'cancel45',label:'45% 取消',cancel:.45},{id:'cancel80',label:'80% 取消',cancel:.80},{id:'repeat3',label:'连续三次换弹',repeat:3}];
const checkpoints=[{id:'end',seconds:0},{id:'plus020',seconds:.2},{id:'plus060',seconds:.6}];
await fs.mkdir(out,{recursive:true});
const sourceBytes=await fs.readFile(source);
const report={schemaVersion:1,phase,source,sourceSha256:createHash('sha256').update(sourceBytes).digest('hex'),complete:false,
  viewport:{width:1440,height:900},seed:4207,quality:'high',fixedStep:1/60,initialTime:2,
  tolerance:{positionMm:1,rotationDegrees:.5,geometryMaxMm:1},
  notes:'Each history and the idle control starts from a fresh identical seeded laboratory. All commands use public __lab.action/step. No hand, arm, rig or camera is repositioned. Each comparison uses the same elapsed 60 Hz tick, including the two ticks advanced by public actions. Forearm and upper-arm geometry residuals use actual world-space deformed vertices. Immediate and +0.2s samples describe the return; +0.6s determines recovery.',
  cases:[],errors:[]};
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const mm=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]))*1000;
const angle=(a,b)=>a&&b?new Quaternion().fromArray(a).angleTo(new Quaternion().fromArray(b))*180/Math.PI:null;
function geometryDelta(a,b){
  assert.equal(a.positions.length,b.positions.length,'Geometry changed within the same source');
  let maxMm=0,sumSquaredMm=0,maxNormalDegrees=0;
  for(let i=0;i<a.positions.length;i+=3){
    const distance=Math.hypot(a.positions[i]-b.positions[i],a.positions[i+1]-b.positions[i+1],a.positions[i+2]-b.positions[i+2])*1000;
    maxMm=Math.max(maxMm,distance);sumSquaredMm+=distance*distance;
    const dot=a.normals[i]*b.normals[i]+a.normals[i+1]*b.normals[i+1]+a.normals[i+2]*b.normals[i+2];
    maxNormalDegrees=Math.max(maxNormalDegrees,Math.acos(Math.max(-1,Math.min(1,dot)))*180/Math.PI);
  }
  return {vertices:a.positions.length/3,maxMm,rmsMm:Math.sqrt(sumSquaredMm/(a.positions.length/3)),maxNormalDegrees};
}
function compare(actual,control){
  assert.equal(actual.frame,control.frame,'Must compare the same simulation frame');
  assert.ok(Math.abs(actual.time-control.time)<1e-9,'Must compare the same simulation time');
  const arms=Object.fromEntries(['L','R'].map(side=>{
    const a=actual.arms[side],b=control.arms[side];
    return [side,{elbowMm:mm(a.elbow,b.elbow),wristMm:mm(a.wrist,b.wrist),handMm:mm(a.handWorldPosition,b.handWorldPosition),
      handDegrees:angle(a.handWorldQuaternion,b.handWorldQuaternion),forearmDegrees:angle(a.forearmQuaternion,b.forearmQuaternion),wristRelativeDegrees:angle(a.wristQuaternion,b.wristQuaternion),
      geometry:Object.fromEntries(['fore','upper'].map(key=>[key,geometryDelta(a.geometry[key],b.geometry[key])]))}];
  }));
  const positions=Object.values(arms).flatMap(a=>[a.elbowMm,a.wristMm,a.handMm]),rotations=Object.values(arms).flatMap(a=>[a.handDegrees,a.forearmDegrees,a.wristRelativeDegrees]);
  const maxPositionMm=Math.max(...positions),maxRotationDegrees=Math.max(...rotations.filter(v=>v!==null));
  const maxGeometryMm=Math.max(...Object.values(arms).flatMap(a=>Object.values(a.geometry).map(g=>g.maxMm)));
  return {arms,maxPositionMm,maxRotationDegrees,maxGeometryMm,pass:rotations.every(v=>v!==null)&&maxPositionMm<report.tolerance.positionMm&&maxRotationDegrees<report.tolerance.rotationDegrees&&maxGeometryMm<report.tolerance.geometryMaxMm};
}
function compact(state){
  return {...state,arms:Object.fromEntries(Object.entries(state.arms).map(([side,a])=>{
    const {geometry,...rest}=a;return [side,{...rest,geometry:Object.fromEntries(Object.entries(geometry).map(([key,g])=>[key,{vertexCount:g.positions.length/3,triangleCount:g.triangleCount}]))}];
  }))};
}
try{
  const page=await browser.newPage({viewport:report.viewport,deviceScaleFactor:1});
  let active='';page.on('pageerror',e=>report.errors.push({case:active,message:e.message}));
  page.on('console',m=>{if(m.type()==='error')report.errors.push({case:active,message:m.text()});});
  async function load(weapon){
    const url=new URL(pathToFileURL(source));url.search=new URLSearchParams({lab:'weapon',seed:'4207',shot:'1',t:'2',q:'high',c:JSON.stringify({weapon,ads:0,reloadPhase:-1})});
    await page.goto(url.href);await page.waitForFunction(()=>window.__lab?.ready,null,{timeout:90000});
    return page.evaluate(()=>{__lab.pause(true);if(__lab.debug.vm.drawT!==1)throw Error('Unsettled draw');return {frame:__lab.snapshot().frame,time:__lab.snapshot().time};});
  }
  async function readState(){return page.evaluate(()=>{
    const vm=__lab.debug.vm,snapshot=__lab.snapshot();vm.rig.updateMatrixWorld(true);
    const arms=Object.fromEntries(Object.entries(vm.arms).map(([side,a])=>{
      const geometry=Object.fromEntries(['fore','upper'].map(key=>{
        const mesh=a[key],geo=mesh.geometry,p=geo.attributes.position,n=geo.attributes.normal,positions=[],normals=[];
        const v=a.hand.position.clone(),normalMatrix=mesh.normalMatrix.clone().getNormalMatrix(mesh.matrixWorld);
        for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);positions.push(...v.toArray());v.fromBufferAttribute(n,i).applyNormalMatrix(normalMatrix);normals.push(...v.toArray());}
        return [key,{positions,normals,triangleCount:(geo.index?.count||p.count)/3}];
      }));
      const worldQ=a.hand.getWorldQuaternion(a.hand.quaternion.clone());
      const values=v=>v?.toArray?.()||null;
      return [side,{kind:a.poseKind,blend:a.poseBlend,handWorldPosition:a.hand.getWorldPosition(a.hand.position.clone()).toArray(),handQuaternion:a.hand.quaternion.toArray(),handWorldQuaternion:worldQ.toArray(),
        forearmQuaternion:values(a.forearmQuaternion),wristQuaternion:values(a.wristQuaternion),wristBendDegrees:Number.isFinite(a.wristBend)?a.wristBend*180/Math.PI:null,
        elbow:values(a.elbow),wrist:values(a.wrist),shoulder:values(a.shoulder),contact:values(a.contact),palmNormal:a.hand.position.clone().set(0,-1,0).applyQuaternion(worldQ).toArray(),geometry}];
    }));
    return {frame:snapshot.frame,time:snapshot.time,animation:vm.anim?{type:vm.anim.type,time:vm.anim.t,duration:vm.anim.dur}:null,drawT:vm.drawT,arms,
      view:{rigPosition:vm.rig.position.toArray(),rigScale:vm.rig.scale.toArray(),camera:__lab.debug.r.vmCamera.position.toArray(),cameraQuaternion:__lab.debug.r.vmCamera.quaternion.toArray(),fov:__lab.debug.r.vmCamera.fov},errors:snapshot.errors};
  });}
  async function image(name){await page.locator('#c').screenshot({path:path.join(out,name)});return name;}
  for(const weapon of weapons){
    const histories=[];
    for(const scenario of scenarios){
      active=weapon+'/'+scenario.id;const base=await load(weapon);
      const sequence=await page.evaluate(({scenario})=>{
        const actions=[];
        for(let repeat=0;repeat<(scenario.repeat||1);repeat++){
          const startFrame=__lab.snapshot().frame;__lab.action('reload');
          const duration=__lab.debug.vm.anim?.dur;if(!duration)throw Error('Reload failed');
          const reloadFrames=Math.ceil(duration*60)+1;
          const target=scenario.cancel!==undefined?Math.round(duration*60*scenario.cancel):reloadFrames;
          const already=__lab.snapshot().frame-startFrame;if(target>already)__lab.step(target-already);
          if(scenario.cancel!==undefined)__lab.action('cancel');
          if(__lab.debug.vm.anim)throw Error('Expected native rest after reload/cancel');
          actions.push({startFrame,endFrame:__lab.snapshot().frame,duration,cancel:scenario.cancel??null});
        }
        return {actions,endFrame:__lab.snapshot().frame};
      },{scenario});
      const history={weapon,scenario:scenario.id,label:scenario.label,base,sequence,samples:[]};
      let advanced=0;
      for(const checkpoint of checkpoints){
        const target=Math.round(checkpoint.seconds*60);if(target>advanced)await page.evaluate(n=>__lab.step(n),target-advanced);advanced=target;
        const state=await readState();assert.equal(state.animation,null);assert.equal(state.drawT,1);assert.deepEqual(state.errors,[]);
        const needsImage=checkpoint.seconds===.6||(weapon==='m4a1'&&scenario.id==='full');
        const screenshot=needsImage?await image(`${weapon}-${scenario.id}-${checkpoint.id}-${phase}.png`):null;
        history.samples.push({...checkpoint,elapsedFrames:state.frame-base.frame,state,screenshot,needsImage});
      }
      histories.push(history);console.log(`Captured ${weapon} ${scenario.id} ${phase}`);
    }
    // One monotonically stepped idle branch supplies all exact-time controls.
    active=weapon+'/idle-control';const base=await load(weapon),controls=new Map();
    const ticks=[...new Set(histories.flatMap(h=>h.samples.map(s=>s.elapsedFrames)))].sort((a,b)=>a-b);
    let advanced=0;
    for(const target of ticks){
      if(target>advanced)await page.evaluate(n=>__lab.step(n),target-advanced);advanced=target;
      const state=await readState();assert.equal(state.frame-base.frame,target);
      const needsImage=histories.some(h=>h.samples.some(s=>s.elapsedFrames===target&&s.needsImage));
      const screenshot=needsImage?await image(`${weapon}-control-${target}-${phase}.png`):null;
      controls.set(target,{state,screenshot});
    }
    for(const history of histories){
      const samples=history.samples.map(sample=>{
        const control=controls.get(sample.elapsedFrames);assert.deepEqual(sample.state.view,control.state.view);
        return {id:sample.id,seconds:sample.seconds,elapsedFrames:sample.elapsedFrames,screenshot:sample.screenshot,controlScreenshot:control.screenshot,
          actual:compact(sample.state),control:compact(control.state),delta:compare(sample.state,control.state)};
      });
      const final=samples.at(-1);
      report.cases.push({weapon,scenario:history.scenario,label:history.label,sequence:history.sequence,samples,recovered:final.delta.pass});
      console.log(JSON.stringify({weapon,scenario:history.scenario,atPlus06:{positionMm:+final.delta.maxPositionMm.toFixed(4),rotationDegrees:+final.delta.maxRotationDegrees.toFixed(4),geometryMm:+final.delta.maxGeometryMm.toFixed(4)},recovered:final.delta.pass}));
    }
  }
  assert.equal(report.cases.length,20);assert.deepEqual(report.errors,[]);
  report.complete=true;report.summary={sequences:report.cases.length,checkpoints:report.cases.length*3,recovered:report.cases.filter(c=>c.recovered).length,
    maxFinalPositionMm:Math.max(...report.cases.map(c=>c.samples.at(-1).delta.maxPositionMm)),maxFinalRotationDegrees:Math.max(...report.cases.map(c=>c.samples.at(-1).delta.maxRotationDegrees)),maxFinalGeometryMm:Math.max(...report.cases.map(c=>c.samples.at(-1).delta.maxGeometryMm))};
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rows=report.cases.flatMap(c=>c.samples.map(s=>`<tr><td>${esc(c.weapon.toUpperCase())}</td><td>${esc(c.label)}</td><td>${s.seconds?`+${s.seconds}s`:'结束时'}</td><td>${s.delta.maxPositionMm.toFixed(3)}</td><td>${s.delta.maxRotationDegrees.toFixed(3)}</td><td>${s.delta.maxGeometryMm.toFixed(3)}</td><td class="${s.delta.pass?'pass':'fail'}">${s.delta.pass?'已归位':'仍有残差'}</td></tr>`)).join('');
  const pairs=report.cases.flatMap(c=>c.samples.filter(s=>s.screenshot).map(s=>({title:`${c.weapon.toUpperCase()} · ${c.label} · ${s.seconds?`+${s.seconds}s`:'结束时'}`,control:s.controlScreenshot,actual:s.screenshot,delta:s.delta})));
  const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>运输船 · 换弹归位复核</title><style>*{box-sizing:border-box}body{margin:0;background:#101b20;color:#eee9dd;font:14px/1.65 system-ui,sans-serif}main{max-width:1500px;margin:auto;padding:28px 20px}h1{font-size:30px}p{color:#b4c0c1}a{color:#e1b77c}select{padding:10px;background:#203139;color:#eee9dd;border:1px solid #53666d;max-width:100%;font:inherit}figure{margin:0}img{width:100%;display:block}figcaption{padding:8px 0;color:#e1b77c}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:15px}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;white-space:nowrap}th,td{padding:7px 12px;text-align:left;border-bottom:1px solid #354b52}.pass{color:#9fd2b1}.fail{color:#efbe82}code{overflow-wrap:anywhere}details{margin-top:24px}@media(max-width:700px){main{padding:18px 12px}.pair{grid-template-columns:1fr}}</style><main><h1>换弹归位复核 · ${phase==='before'?'修复前':'修复后'}</h1><p>5 种武器，完整换弹、两种取消时机及连续三次换弹。每个动作历史都与相同模拟时刻的静止持枪比较；没有重新定位模型。结束后 0.6 秒，位置和模型顶点残差须小于 1 mm，朝向残差小于 0.5°。</p><p>${report.summary.recovered} / 20 组达到归位要求。<a href="reload-recovery-${phase}.json">完整数值记录</a></p><label for="view">选择原始截图对照</label><br><select id="view">${pairs.map((p,i)=>`<option value="${i}">${esc(p.title)}</option>`).join('')}</select><div class="pair"><figure><figcaption>同一时刻 · 一直静止持枪</figcaption><a id="control-link" target="_blank"><img id="control" alt="相同模拟时刻的静止持枪对照"></a></figure><figure><figcaption>同一时刻 · 经历换弹或取消后</figcaption><a id="actual-link" target="_blank"><img id="actual" alt="换弹或取消后的实际手臂状态"></a></figure></div><details><summary>全部 60 个时间点的残差</summary><div class="scroll"><table><thead><tr><th>武器</th><th>历史</th><th>时间点</th><th>关节位置 mm</th><th>朝向 °</th><th>模型顶点 mm</th><th>结果</th></tr></thead><tbody>${rows}</tbody></table></div></details><p>来源 SHA-256：<code>${esc(report.sourceSha256)}</code></p></main><script>const pairs=${JSON.stringify(pairs.map(({title,control,actual})=>({title,control,actual}))).replaceAll('<','\\u003c')};function show(){const p=pairs[Number(document.querySelector('#view').value)];for(const key of ['control','actual'])document.querySelector('#'+key).src=document.querySelector('#'+key+'-link').href=p[key]}document.querySelector('#view').onchange=show;show();</script></html>`;
  await fs.writeFile(path.join(out,`reload-recovery-${phase}.html`),html);
  console.log(JSON.stringify(report.summary,null,2));
  if(phase==='after')assert.equal(report.summary.recovered,20,'Some weapons retain arm pose after +0.6s; see report');
}finally{
  await fs.writeFile(path.join(out,`reload-recovery-${phase}.json`),JSON.stringify(report,null,2));
  await browser.close();
}
