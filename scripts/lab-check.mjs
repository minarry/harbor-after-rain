import {chromium} from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {LAB_IDS} from '../src/lab/config.js';

const base=process.env.LAB_BASE||'http://127.0.0.1:4173/',out='artifacts/lab';
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const report={schemaVersion:1,modules:[],errors:[],network:[]};
try{
  const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1});
  page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  page.on('request',r=>{if(!r.url().startsWith(base)&&/^https?:/.test(r.url()))report.network.push(r.url());});
  for(const id of LAB_IDS){
    const start=report.errors.length;
    await page.goto(`${base}?lab=${id}&shot=1&t=2&seed=4207`);await page.waitForFunction(()=>window.__lab?.ready,{timeout:60000});
    const initial=await page.evaluate(()=>__lab.snapshot());
    assert.equal(initial.module,id);assert.equal(initial.frame,120);assert.equal(initial.checks.every(c=>c.pass!==false),true,`${id} initial checks`);
    const time=initial.time;await page.waitForTimeout(160);assert.equal(await page.evaluate(()=>__lab.snapshot().time),time,'paused clock stable');
    await page.screenshot({path:`${out}/${id}.png`});
    const probes=await page.evaluate(id=>{
      const lab=__lab,r=lab.debug.r,results={};
      if(id==='render'){
        lab.control('post',false);results.postOff=!r.bloom.enabled&&!r.haze.enabled;
        lab.control('post',true);lab.control('ao',false);results.aoOff=!r.features?.state?.ao||r.getFeatures().ao===false;lab.control('ao',true);
        const mem={...r.renderer.info.memory};for(let i=0;i<20;i++){lab.control('ao',i%2===0);lab.control('post',i%2===0);}lab.control('post',true);lab.control('ao',true);results.stableResources=r.renderer.info.memory.geometries===mem.geometries&&r.renderer.info.memory.textures===mem.textures;
      }
      if(id==='mats'){lab.control('channel','normal');lab.control('channel','roughness');lab.control('channel','shaded');lab.control('wetness',0);results.dry=lab.snapshot().weather.wetness===0;lab.control('wetness',1);}
      if(id==='props'){lab.control('wireframe',true);results.wire=lab.debug.map.meshes.every(m=>m.material.wireframe);lab.control('wireframe',false);}
      if(id==='level'){lab.control('colliders',true);lab.control('team','BL');results.routes=lab.snapshot().details.routeResults.every(r=>r.reachable);lab.control('colliders',false);}
      if(id==='backdrop'){lab.control('shipSpeed',0);const d=lab.debug.env.shipDist;lab.step(30);results.stopped=lab.debug.env.shipDist===d;lab.control('lighting','day');lab.control('lighting','dusk');}
      if(id==='ground'){lab.control('rain',0);lab.control('wetness',1);results.afterRain=lab.snapshot().weather.rain===0&&lab.snapshot().weather.wetness===1;lab.control('reflections',false);results.reflectionOff=lab.snapshot().weather.reflections===false;lab.control('rain',1);lab.control('reflections',true);}
      if(id==='fx'){
        results.materials={};for(const surface of ['metal','wood','deck','armor','flesh','water']){lab.action('clear');lab.control('surface',surface);lab.action('impact');const s=lab.debug.fx.stats();results.materials[surface]=s.particleCount+s.activeSparks+s.activeDroplets+s.activeDebris+s.activeRipples+s.decalCount>0&&lab.snapshot().details.collisionSurface===surface;}
        lab.action('clear');lab.control('surface','metal');for(let i=0;i<50;i++)lab.action('burst');const s=lab.debug.fx.stats();results.bounded=s.activeSparks<=s.effectCapacity.sparks&&s.activeDebris<=s.effectCapacity.debris;
        lab.action('clear');results.cleared=Object.entries(lab.debug.fx.stats()).filter(([k,v])=>typeof v==='number').every(([k,v])=>v===0);
      }
      if(id==='weapon'){
        results.weapons={};for(const gun of ['m4a1','ak47','mp5','awm','deagle','knife','he']){lab.control('weapon',gun);lab.step(45);lab.control('ads',1);lab.step(10);lab.action('reload');lab.control('reloadPhase',.45);lab.step(1);results.weapons[gun]=lab.snapshot().checks.every(c=>c.pass);}
        lab.control('weapon','m4a1');lab.control('ads',0);lab.control('reloadPhase',.5);lab.step(1);
      }
      if(id==='enemies'){lab.control('highDetail',false);lab.control('highDetail',true);lab.action('hurt');lab.action('hurt');results.lowHP=lab.snapshot().details.hp===30&&r.fx.uniforms.uLowHP.value>0;lab.action('kill');lab.step(50);results.dead=lab.snapshot().details.actors.every(a=>a.dead);lab.action('resetActors');results.reset=lab.snapshot().details.hp===100;lab.action('route');lab.step(600);results.botArrived=lab.snapshot().details.tactics.route?.reached===true;lab.action('sight');lab.step(180);results.sight=lab.snapshot().details.tactics.sight?.blockedObserved===false&&lab.snapshot().details.tactics.sight?.clearObserved===true;}
      return results;
    },id);
    const walk=v=>{for(const [k,x] of Object.entries(v)){if(x&&typeof x==='object')walk(x);else assert.equal(x,true,`${id}: ${k}`);}};walk(probes);
    const final=await page.evaluate(()=>__lab.snapshot());assert.equal(report.errors.length,start,`${id}: ${report.errors.slice(start).join('\n')}`);
    await page.screenshot({path:`${out}/${id}-tested.png`});report.modules.push({id,initial,probes,final});console.log(`PASS ${id} ${initial.metrics['三角形']} triangles`);
  }
  // Exported configuration must reconstruct controls, seed, fixed time and camera.
  await page.goto(`${base}?lab=render&shot=1&seed=9042&t=1`);await page.waitForFunction(()=>window.__lab?.ready);
  const saved=await page.evaluate(()=>{__lab.control('exposure',1.15);__lab.camera('front');__lab.step(60);return __lab.snapshot();});
  await page.goto(saved.url);await page.waitForFunction(()=>window.__lab?.ready);const replay=await page.evaluate(()=>__lab.snapshot());
  assert.deepEqual(replay.controls,saved.controls);assert.deepEqual(replay.camera,saved.camera);assert.equal(replay.seed,saved.seed);assert.equal(replay.time,saved.time);report.replay=true;
  // No external requests are needed by the bundled file, including lab UI.
  const offline=pathToFileURL(path.resolve('dist/index.html')).href;
  await page.goto(`${offline}?lab=props&shot=1`);await page.waitForFunction(()=>window.__lab?.ready,{timeout:60000});report.offline=await page.evaluate(()=>__lab.snapshot().checks.every(c=>c.pass));assert.equal(report.offline,true);assert.equal(report.network.length,0);
  await page.setViewportSize({width:390,height:844});await page.goto(`${base}?lab=ground&shot=1&q=medium`);await page.waitForFunction(()=>window.__lab?.ready);await page.screenshot({path:`${out}/mobile.png`});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);report.mobile=true;
}catch(e){report.failure=e.stack;throw e;}finally{await fs.writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
