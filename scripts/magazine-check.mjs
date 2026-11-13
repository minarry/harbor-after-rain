// Actual reload steps, plus explicitly labelled camera-only magazine diagnostics.
import {chromium} from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const arg=(k,d)=>{const i=process.argv.indexOf(k);return i<0?d:process.argv[i+1];};
const phase=arg('--phase','before'),out=path.resolve(arg('--out','artifacts/v147'));
assert.ok(['before','after'].includes(phase));
const source=path.resolve(arg('--source',phase==='before'?path.join(out,'before.html'):'dist/index.html'));
await fs.mkdir(out,{recursive:true});
const report={phase,source,sourceSha256:createHash('sha256').update(await fs.readFile(source)).digest('hex'),complete:false,viewport:{width:1440,height:900},seed:4207,records:[],errors:[],notes:'Native views use the unchanged weapon-laboratory camera. Geometry diagnostics move only that camera relative to the gun and hide both arms; no gun or magazine transforms are edited. All animation samples follow the public reload action at 60 Hz.'};
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
  const page=await browser.newPage({viewport:report.viewport,deviceScaleFactor:1});
  page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  for(const weapon of ['m4a1','ak47','mp5','awm','deagle']){
    const url=new URL(pathToFileURL(source));url.search=new URLSearchParams({lab:'weapon',seed:'4207',shot:'1',t:'2',q:'high',c:JSON.stringify({weapon,reloadPhase:-1})});
    await page.goto(url.href);await page.waitForFunction(()=>__lab?.ready,null,{timeout:90000});
    const base=await page.evaluate(()=>{__lab.pause(true);const vm=__lab.debug.vm;return {frame:__lab.snapshot().frame,drawT:vm.drawT,position:vm.parts.mag.position.toArray(),quaternion:vm.parts.mag.quaternion.toArray()};});
    assert.equal(base.drawT,1);
    const record={weapon,base,samples:[]};
    async function sample(id,{native=false,diagnostic=false}={}){
      const state=await page.evaluate(()=>{
        const vm=__lab.debug.vm,mag=vm.parts.mag,a=vm.arms.L;vm.rig.updateMatrixWorld(true);
        const realContact=a.localContact?a.hand.localToWorld(a.localContact.clone()):null;
        return {frame:__lab.snapshot().frame,animation:vm.anim?{type:vm.anim.type,progress:vm.anim.t/vm.anim.dur}:null,magazine:{position:mag.position.toArray(),quaternion:mag.quaternion.toArray(),visible:mag.visible},left:{kind:a.poseKind,hand:a.hand.position.toArray(),quaternion:a.hand.quaternion.toArray(),gripsMagazine:a.graspSocket===mag,contactError:realContact?realContact.distanceTo(a.contact):null},errors:__lab.snapshot().errors};
      });
      assert.deepEqual(state.errors,[]);assert.ok([...state.magazine.position,...state.magazine.quaternion,...state.left.hand].every(Number.isFinite));
      if(state.left.gripsMagazine)assert.ok(state.left.contactError<1e-7,'Hand must follow the actual moving magazine');
      const item={id,...state};
      if(native){item.native=`${weapon}-${id}-native-${phase}.png`;await page.locator('#c').screenshot({path:path.join(out,item.native)});}
      if(diagnostic){
        item.diagnosticSetup=await page.evaluate(()=>{
          const {vm,r}=__lab.debug,cam=r.vmCamera;
          window.__magCamera={position:cam.position.toArray(),quaternion:cam.quaternion.toArray(),visible:Object.fromEntries(Object.entries(vm.arms).map(([s,a])=>[s,a.g.visible]))};
          vm.rig.updateMatrixWorld(true);
          const eye=[.38,-.015,.20],target=[0,-.055,-.07];
          cam.position.copy(vm.cur.localToWorld(vm.holder.position.clone().fromArray(eye)));
          cam.lookAt(vm.cur.localToWorld(vm.holder.position.clone().fromArray(target)));cam.updateMatrixWorld(true);
          for(const a of Object.values(vm.arms))a.g.visible=false;
          __lab.control('wetness',__lab.snapshot().controls.wetness);
          return {eyeGunLocal:eye,targetGunLocal:target,hidden:'both arms; geometry diagnostic only',rigPosition:vm.rig.position.toArray()};
        });
        item.diagnostic=`${weapon}-${id}-geometry-${phase}.png`;await page.locator('#c').screenshot({path:path.join(out,item.diagnostic)});
        await page.evaluate(()=>{const {vm,r}=__lab.debug,s=__magCamera;r.vmCamera.position.fromArray(s.position);r.vmCamera.quaternion.fromArray(s.quaternion);r.vmCamera.updateMatrixWorld(true);for(const [side,a]of Object.entries(vm.arms))a.g.visible=s.visible[side];__lab.control('wetness',__lab.snapshot().controls.wetness);});
      }
      record.samples.push(item);
    }
    await sample('seated',{native:weapon==='m4a1',diagnostic:true});
    const start=await page.evaluate(()=>{const frame=__lab.snapshot().frame;__lab.action('reload');return {frame,duration:__lab.debug.vm.anim.dur};});
    let elapsed=2;
    for(const [id,f]of [['release',.12],['clear',.30],['transfer',.43],['align',.52],['insert',.60],['lock',.68],['end',1]]){
      const target=f===1?Math.ceil(start.duration*60)+1:Math.round(start.duration*60*f);
      if(target>elapsed)await page.evaluate(n=>__lab.step(n),target-elapsed);elapsed=target;
      await sample(id,{native:weapon==='m4a1'&&['clear','align','insert'].includes(id),diagnostic:id==='clear'});
    }
    await page.evaluate(()=>__lab.step(36));await sample('recovered',{native:weapon==='m4a1'});
    const end=record.samples.at(-1);assert.equal(end.animation,null);assert.deepEqual(end.magazine.position,base.position);assert.deepEqual(end.magazine.quaternion,base.quaternion);
    report.records.push(record);console.log(`Verified ${weapon} ${phase}: seated, clear, insert, recover`);
  }
  assert.deepEqual(report.errors,[]);report.complete=true;
}finally{await fs.writeFile(path.join(out,`magazine-${phase}.json`),JSON.stringify(report,null,2));await browser.close();}
if(phase==='after'){
  const before=JSON.parse(await fs.readFile(path.join(out,'magazine-before.json'),'utf8'));
  const pairs=[];for(const r of report.records)for(const s of r.samples)for(const key of ['native','diagnostic'])if(s[key]){
    const old=before.records.find(b=>b.weapon===r.weapon)?.samples.find(b=>b.id===s.id)?.[key];if(old)pairs.push({title:`${r.weapon.toUpperCase()} · ${s.id} · ${key==='native'?'实际第一人称':'模型诊断：隐藏手臂、移动相机'}`,before:old,after:s[key]});
  }
  const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>弹匣连接与换弹对照</title><style>*{box-sizing:border-box}body{margin:0;background:#101b20;color:#eee9dd;font:15px/1.6 system-ui}main{max-width:1500px;margin:auto;padding:24px}select{max-width:100%;padding:10px;background:#203139;color:inherit;font:inherit}section{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:18px}figure{margin:0}img{width:100%;display:block}p{color:#b9c8c8}a{color:#e6c38d}@media(max-width:700px){section{grid-template-columns:1fr}main{padding:14px}}</style><main><h1>弹匣连接与换弹对照</h1><p>五种枪械，同一构图与光照。动作通过实际换弹按 60 Hz 推进；模型诊断明确隐藏手臂并移动相机，便于查看插口连接。</p><select id="view">${pairs.map((p,i)=>`<option value="${i}">${esc(p.title)}</option>`).join('')}</select><section><figure><figcaption>修改前</figcaption><img id="before" alt="修改前"></figure><figure><figcaption>修改后</figcaption><img id="after" alt="修改后"></figure></section><p><a href="magazine-after.json">动作与归位数据</a></p></main><script>const pairs=${JSON.stringify(pairs).replaceAll('<','\\u003c')};function show(){const p=pairs[+document.querySelector('#view').value];for(const k of ['before','after'])document.querySelector('#'+k).src=p[k]}document.querySelector('#view').onchange=show;show();</script></html>`;
  await fs.writeFile(path.join(out,'magazine-review.html'),html);
}
