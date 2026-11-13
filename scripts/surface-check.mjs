// Actual WebGL checks for shared surface layers, diagnostic channels and geometry
// reconstruction. A changed picture is evidence of a working switch, not taste.
import {chromium} from 'playwright-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=process.env.LAB_BASE||'http://127.0.0.1:4173/',out='artifacts/v14';
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const report={errors:[],channels:{},materials:[],geometry:{}};
try{
  const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1});
  page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  await page.goto(`${base}?lab=mats&shot=1&t=2&seed=4207&cam=close`);await page.waitForFunction(()=>window.__lab?.ready,null,{timeout:90000});
  report.materials=await page.evaluate(()=>__lab.snapshot().details.materials);
  const layered=report.materials.filter(m=>m.source?.schema===2);
  assert.ok(layered.length>=12,'Scene surfaces must use explicit shared layers');
  assert.ok(layered.every(m=>m.hasRoughness&&m.hasMetalness&&Object.values(m.layers).every(n=>Number.isFinite(n)&&n>=0&&n<=1)));
  for(const channel of ['color','normal','roughness','metalness','occlusion','oxide','shaded']){
    await page.evaluate(c=>__lab.control('channel',c),channel);
    report.channels[channel]=await page.evaluate(()=>{const s=__lab.snapshot();return{channel:s.details.channel,post:s.renderer.post,memory:{...__lab.debug.r.renderer.info.memory}};});
    assert.equal(report.channels[channel].channel,channel);assert.equal(report.channels[channel].post,channel==='shaded');
    await page.locator('#c').screenshot({path:`${out}/material-channel-${channel}.png`});
  }
  report.resources=await page.evaluate(()=>{
    const r=__lab.debug.r,channels=['color','normal','roughness','metalness','occlusion','oxide','shaded'];
    const before={...r.renderer.info.memory},programs=r.renderer.info.programs.length;
    for(let n=0;n<4;n++)for(const c of channels)__lab.control('channel',c);
    __lab.control('roughness',.65);__lab.control('channel','roughness');
    const scalars=[];r.scene.traverse(m=>{if(m.material?.uniforms?.scalar)scalars.push(m.material.uniforms.scalar.value);});
    __lab.control('roughness',1);for(const c of channels)__lab.control('channel',c);
    return{before,after:{...r.renderer.info.memory},programsBefore:programs,programsAfter:r.renderer.info.programs.length,scalars};
  });
  assert.deepEqual(report.resources.after,report.resources.before);assert.equal(report.resources.programsAfter,report.resources.programsBefore);
  assert.ok(report.resources.scalars.length===36&&report.resources.scalars.every(n=>n>0&&n<=.65));
  await page.goto(`${base}?lab=props&shot=1&t=2&seed=4207&cam=cargo`);await page.waitForFunction(()=>window.__lab?.ready,null,{timeout:90000});
  const read=()=>page.evaluate(()=>({state:__lab.snapshot(),colliders:__lab.debug.world.colliders.map(c=>({x:c.x,y:c.y,z:c.z,hx:c.hx,hy:c.hy,hz:c.hz,yaw:c.yaw,mat:c.mat,tag:c.tag,solid:c.solid,sight:c.sight}))}));
  report.geometry.detailed=await read();await page.locator('#c').screenshot({path:`${out}/cargo-geometry-on.png`});
  const oldURL=page.url();await page.evaluate(()=>__lab.control('geometryDetail',false));await page.waitForURL(u=>u.href!==oldURL);await page.waitForFunction(()=>window.__lab?.ready,null,{timeout:90000});
  report.geometry.flat=await read();await page.locator('#c').screenshot({path:`${out}/cargo-geometry-off.png`});
  assert.equal(report.geometry.flat.state.controls.geometryDetail,false);assert.equal(report.geometry.flat.state.details.geometryDetail,false);
  assert.deepEqual(report.geometry.flat.colliders,report.geometry.detailed.colliders);
  assert.ok(report.geometry.detailed.state.details.modelTriangles>report.geometry.flat.state.details.modelTriangles);
  assert.ok(report.geometry.detailed.state.metrics['材质批次']<40);
  const ca=report.geometry.flat.state.camera,cb=report.geometry.detailed.state.camera;
  assert.equal(ca.preset,cb.preset);assert.equal(ca.fov,cb.fov);
  for(const key of ['position','target'])assert.ok(ca[key].every((n,i)=>Math.abs(n-cb[key][i])<1e-9),'Orbit reconstruction must preserve the camera within floating-point precision');
  await page.goto(report.geometry.detailed.state.url);await page.waitForFunction(()=>window.__lab?.ready,null,{timeout:90000});
  assert.equal(await page.evaluate(()=>__lab.snapshot().details.geometryDetail),true);
  assert.equal(report.errors.length,0,report.errors.join('\n'));console.log(JSON.stringify({layered:layered.length,channels:Object.keys(report.channels),resources:report.resources,geometry:{triangles:[report.geometry.flat.state.details.modelTriangles,report.geometry.detailed.state.details.modelTriangles],collisionUnchanged:true},errors:report.errors},null,2));
}catch(error){report.failure=error.stack;throw error;}finally{await fs.writeFile(`${out}/surface-report.json`,JSON.stringify(report,null,2));await browser.close();}
