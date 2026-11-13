// Repeatable hand poses from a preserved standalone build. Diagnostic close-ups
// move the complete view-model rig; they are explicitly not the game viewpoint.
import {chromium} from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const arg=(key,fallback)=>{const i=process.argv.indexOf(key);return i<0?fallback:process.argv[i+1];};
const phase=arg('--phase','before');
assert.ok(['before','after'].includes(phase),'--phase must be before or after');
const out=path.resolve(arg('--out','artifacts/v142'));
const source=path.resolve(arg('--source',phase==='before'?`${out}/before.html`:'dist/index.html'));
const only=arg('--only','').split(',').filter(Boolean);
const cases=[
  {id:'m4-hip',weapon:'m4a1'},
  {id:'m4-ads',weapon:'m4a1',ads:1},
  {id:'m4-reload45',weapon:'m4a1',reloadPhase:.45},
  {id:'m4-reload80',weapon:'m4a1',reloadPhase:.80},
  {id:'m4-inspect',weapon:'m4a1',inspectSeconds:.8},
  {id:'m4-inspect-top',weapon:'m4a1',inspectSeconds:1.6},
  {id:'m4-grip-close',weapon:'m4a1',rigOffset:[-.08,.075,.10]},
  {id:'ak-grip-close',weapon:'ak47',rigOffset:[-.08,.075,.10]},
  {id:'deagle-grip-close',weapon:'deagle',rigOffset:[-.08,.075,.10]},
  {id:'hands-open-back',weapon:'m4a1',isolatedHands:'back'},
  {id:'hands-open-palm',weapon:'m4a1',isolatedHands:'palm'},
];
assert.ok(only.every(id=>cases.some(c=>c.id===id)),'Unknown --only case');
await fs.mkdir(out,{recursive:true});
const bytes=await fs.readFile(source),stat=await fs.stat(source);
const report={schemaVersion:2,phase,source,sourceBytes:bytes.length,sourceModified:stat.mtime.toISOString(),sourceSha256:createHash('sha256').update(bytes).digest('hex'),viewport:{width:1440,height:900},deviceScaleFactor:1,seed:4207,initialTime:2,quality:'high',notes:'Canvas-only screenshots. Ordinary non-close views use the native weapon laboratory first-person camera. The hands-open cases instead hide the weapon and sleeves and manually pose both hands; those are anatomy diagnostics, not gameplay poses. Close views translate the complete weapon + arms rig by the recorded fixed offset, without changing materials, lighting, FOV, or individual hand contacts. Each case reloads the same standalone build and fixed seed. Reload scrubbing is applied only after the two-second normal warmup has completed drawing the weapon; this avoids the old laboratory update(0) initialization bug. Arm transforms, wrist and elbow are in view-model rig-local coordinates; positions are metres. Geometry counts are source mesh counts, not renderer multi-pass totals.',cases:[],errors:[]};
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
  const page=await browser.newPage({viewport:report.viewport,deviceScaleFactor:1});
  let active='';
  page.on('pageerror',e=>report.errors.push({case:active,message:e.message}));
  page.on('console',m=>{if(m.type()==='error')report.errors.push({case:active,message:m.text()});});
  for(const item of cases.filter(c=>!only.length||only.includes(c.id))){
    active=item.id;
    // Old builds freeze drawT when reloadPhase is applied during URL startup.
    // Warm up a normal equip first, then apply the public scrub control.
    const controls={weapon:item.weapon,ads:item.ads||0,reloadPhase:-1};
    const url=new URL(pathToFileURL(source));
    url.search=new URLSearchParams({lab:'weapon',seed:'4207',shot:'1',t:'2',q:'high',c:JSON.stringify(controls)});
    await page.goto(url.href);
    await page.waitForFunction(()=>window.__lab?.ready,null,{timeout:90000});
    const setup=await page.evaluate(({inspectSeconds,rigOffset,reloadPhase,isolatedHands})=>{
      __lab.pause(true);
      const drawTBeforePose=__lab.debug.vm.drawT;
      if(drawTBeforePose<1)throw new Error('Weapon draw must settle before the pose');
      if(reloadPhase!==undefined){
        __lab.control('reloadPhase',reloadPhase);
        __lab.step(1);
      }
      if(inspectSeconds){
        __lab.action('inspect'); // A paused action advances two fixed frames.
        __lab.step(Math.round(inspectSeconds*60)-2);
      }
      if(rigOffset){
        __lab.debug.vm.rig.position.fromArray(rigOffset);
        __lab.debug.vm.rig.updateMatrixWorld(true);
        // The public control renders the unchanged pose with the rig offset.
        __lab.control('wetness',__lab.snapshot().controls.wetness);
      }
      let diagnosticPose=null;
      if(isolatedHands){
        const vm=__lab.debug.vm,fingerAngles=[-.12,-.18,-.10];
        vm.holder.visible=false;
        const hands={};
        for(const [side,arm] of Object.entries(vm.arms)){
          const sign=side==='R'?1:-1;
          arm.fore.visible=arm.upper.visible=false;
          arm.g.visible=arm.hand.visible=true;
          arm.hand.position.set(sign*.10,-.09,-.40);
          if(isolatedHands==='back')arm.hand.rotation.set(Math.PI/2,0,0,'XYZ');
          else arm.hand.rotation.set(-Math.PI/2,0,Math.PI,'ZYX');
          for(let i=0;i<arm.fingers.length;i++)for(let j=0;j<arm.fingers[i].length;j++){
            arm.fingers[i][j].rotation.set(fingerAngles[j],sign*(i-1.5)*.025*(j===0?1:0),0);
          }
          const thumbAngles=[[-.10,.30*sign,.12*sign],[-.12,-.12*sign,0],[-.10,-.06*sign,0]];
          for(let j=0;j<arm.thumb.length;j++)arm.thumb[j].rotation.set(...thumbAngles[j]);
          arm.poseKind='diagnostic-open';arm.poseBlend=0;
          arm.hand.updateMatrixWorld(true);
          hands[side]={position:arm.hand.position.toArray(),quaternion:arm.hand.quaternion.toArray(),thumbAngles};
        }
        diagnosticPose={notGameplay:true,surface:isolatedHands,hidden:['weapon holder','left forearm','left upper arm','right forearm','right upper arm'],fingerAngles,hands,notes:'Isolated manually posed hands, fingertips upward. No grip contact or sleeve IK is being evaluated. Materials, lights and camera remain unchanged.'};
        // Render without advancing simulation, which would restore the game pose.
        __lab.control('wetness',__lab.snapshot().controls.wetness);
      }
      return {drawTBeforePose,drawTAfterPose:__lab.debug.vm.drawT,reloadScrubAppliedAfterWarmup:reloadPhase!==undefined,diagnosticPose};
    },item);
    const state=await page.evaluate(()=>{
      const vm=__lab.debug.vm;
      function meshStats(mesh){
        const geo=mesh.geometry,indexCount=geo.index?.count??geo.attributes.position.count;
        const arrayMaterial=Array.isArray(mesh.material),materials=arrayMaterial?mesh.material:[mesh.material];
        const role=material=>/nail/i.test(material?.name||'')?'nail':/skin/i.test(material?.name||'')?'skin':'glove';
        const coverage=Object.fromEntries(['glove','skin','nail'].map(k=>[k,{indexCount:0,triangleCount:0,vertices:new Set()}]));
        // Three renders an ungrouped single material across the full geometry.
        const groups=arrayMaterial?geo.groups:[{start:0,count:indexCount,materialIndex:0}];
        const covered=new Uint8Array(indexCount);
        let overlapIndexCount=0;
        for(const group of groups){
          const material=materials[group.materialIndex];if(!material)continue;
          const c=coverage[role(material)],start=Math.max(0,group.start,geo.drawRange.start);
          const end=Math.min(indexCount,group.start+group.count,geo.drawRange.start+geo.drawRange.count);
          for(let i=start;i<end;i++){
            c.indexCount++;c.vertices.add(geo.index?geo.index.getX(i):i);
            if(covered[i])overlapIndexCount++;covered[i]=1;
          }
        }
        for(const c of Object.values(coverage)){c.triangleCount=c.indexCount/3;c.uniqueVertexCount=c.vertices.size;delete c.vertices;}
        return {triangleCount:indexCount/3,indexCount,vertexCount:geo.attributes.position.count,groupCount:geo.groups.length,renderedGroupCount:groups.length,materialCount:materials.length,materials:materials.map((m,i)=>({index:i,name:m?.name||'',role:role(m)})),materialCoverage:coverage,uncoveredIndexCount:covered.reduce((n,v)=>n+(v===0),0),overlapIndexCount,boneCount:mesh.skeleton?.bones.length||0};
      }
      return {snapshot:__lab.snapshot(),view:{rigPosition:vm.rig.position.toArray(),rigScale:vm.rig.scale.toArray(),cameraPosition:__lab.debug.r.vmCamera.position.toArray(),cameraFov:__lab.debug.r.vmCamera.fov},animation:vm.anim?{type:vm.anim.type,time:vm.anim.t,duration:vm.anim.dur}:null,drawT:vm.drawT,arms:Object.fromEntries(Object.entries(vm.arms).map(([key,a])=>{
        const isolated=a.poseKind==='diagnostic-open';
        const position=a.hand.position.toArray(),quaternion=a.hand.quaternion.toArray(),wrist=isolated?null:a.wrist?.toArray(),elbow=isolated?null:a.elbow?.toArray(),shoulder=isolated?null:a.shoulder?.toArray();
        const boneTransforms=a.mesh.skeleton.bones.map(b=>[...b.position.toArray(),...b.quaternion.toArray()]);
        return [key,{kind:a.poseKind,blend:a.poseBlend,contact:isolated?null:a.contact?.toArray(),position,quaternion,wrist,elbow,shoulder,handMesh:meshStats(a.mesh),finite:[...position,...quaternion,...(wrist||[]),...(elbow||[]),...boneTransforms.flat()].every(Number.isFinite)}];
      }))};
    });
    const canvas=page.locator('#c'),bounds=await canvas.boundingBox();
    const screenshot=path.join(out,`${item.id}-${phase}.png`);
    await canvas.screenshot({path:screenshot});
    report.cases.push({...item,kind:item.isolatedHands?'isolated open-hand anatomy diagnostic; not a game pose':item.rigOffset?'fixed diagnostic close-up':'native laboratory first-person viewpoint',screenshot,canvasBounds:bounds,setup,...state});
    assert.equal(state.snapshot.details.weapon,item.weapon);
    assert.ok(state.snapshot.checks.every(c=>c.pass),`${item.id}: lab check failed`);
    assert.ok(Object.values(state.arms).every(a=>a.finite),`${item.id}: hand transform invalid`);
    assert.ok(Object.values(state.arms).every(a=>a.handMesh.uncoveredIndexCount===0&&a.handMesh.overlapIndexCount===0),`${item.id}: hand material groups do not cover the mesh exactly once`);
    assert.equal(state.drawT,1,`${item.id}: draw animation contaminated the pose`);
    assert.equal(state.snapshot.errors.length,0,`${item.id}: runtime error`);
    console.log(`Captured ${item.id}-${phase}: ${Math.round(bounds.width)} × ${Math.round(bounds.height)}`);
  }
  assert.equal(report.errors.length,0,JSON.stringify(report.errors));
}finally{
  await fs.writeFile(path.join(out,`hand-comparison-${phase}${only.length?'-'+only.join('_'):''}.json`),JSON.stringify(report,null,2));
  await browser.close();
}
