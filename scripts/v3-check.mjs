// End-to-end checks for the expanded arena and the actual combat-feedback path.
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

await mkdir('artifacts', {recursive:true});
const browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const result={},errors=[];
try {
  const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
  page.on('pageerror',e=>errors.push(e.stack||e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('http://127.0.0.1:4173/?nolock=1&q=high');
  await page.waitForFunction(()=>window.__game?.nav,{},{timeout:90000});
  await page.locator('#btnStartTdm').click();
  result.map=await page.evaluate(()=>{
    const g=__game,p=g.player;
    for(const a of g.actors) if(!a.isPlayer)a.update=()=>{};
    p.pos.set(-33,0,-5);g.chooseLoadout('m4a1');p.pos.set(-17,0,-6.5);p.yaw=-Math.PI/2;p.pitch=-.025;p.protectT=0;
    p.updateCamera(1/60);g.goal=100;g.hud.toastT=0;g.hud.el.toast.style.opacity=0;
    const names=['playHurt','playDeath','playHitmarker','playKillConfirm'];g._heard=[];
    for(const name of names){const old=g.audio[name].bind(g.audio);g.audio[name]=(...args)=>{g._heard.push({name,args});return old(...args);};}
    return {bounds:g.map.bounds,navBounds:g.map.navBounds,spawns:g.map.spawns,roofRect:g.env.atmosphere.roof.rect.toArray()};
  });
  assert.ok((result.map.bounds.maxZ-result.map.bounds.minZ)>35,'expanded combat width is playable');
  await page.waitForFunction(()=>__game.time>=__game.player.readyAt);
  await page.screenshot({path:'artifacts/v3-hands.png'});
  await page.mouse.move(720,450);await page.mouse.down({button:'right'});await page.waitForTimeout(700);
  assert.ok(await page.evaluate(()=>__game.player.ads>.95));
  await page.screenshot({path:'artifacts/v3-ads.png'});await page.mouse.up({button:'right'});
  await page.evaluate(()=>{__game.player.weapon.mag=4;});await page.keyboard.press('KeyR');
  await page.waitForFunction(()=>__game.player.weapon.reloading);
  await page.waitForTimeout(850);await page.screenshot({path:'artifacts/v3-reload.png'});
  await page.waitForFunction(()=>!__game.player.weapon.reloading,{},{timeout:10000});
  result.hit=await page.evaluate(()=>{
    const g=__game,p=g.player,V=p.pos.constructor,a=g.actors.find(a=>a.team!==p.team);
    p.armor=0;p.hp=100;p.protectT=0;
    g.damage(p,a,26,'chest','m4a1',new V(1,0,0),false,false);
    for(let i=0;i<4;i++)p.updateCamera(1/60);
    return {hp:p.hp,kick:{...p.damageResponse.offset},audio:g._heard.slice(),basePitch:p.pitch,cameraPitch:g.renderer.camera.rotation.x};
  });
  assert.equal(result.hit.hp,74);assert.ok(result.hit.cameraPitch-result.hit.basePitch>.025,'damage visibly kicks camera');
  assert.ok(result.hit.audio.some(x=>x.name==='playHurt'));
  await page.evaluate(()=>{
    const g=__game,p=g.player,V=p.pos.constructor,a=g.actors.find(a=>a.team!==p.team);
    p.hp=44;g.damage(p,a,24,'chest','m4a1',new V(1,0,0),false,false);
  });
  await page.waitForFunction(()=>__game.renderer.fx.uniforms.uLowHP.value>.75);
  await page.waitForTimeout(500);await page.screenshot({path:'artifacts/v3-low-health.png'});
  result.low=await page.evaluate(()=>({hp:__game.player.hp,glow:__game.renderer.fx.uniforms.uLowHP.value,heartbeat:__game.audio._hbOn}));
  assert.equal(result.low.hp,20);assert.equal(result.low.heartbeat,true);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>__game.audio._hbOn),false,'pause stops scheduling heartbeats');
  const frozen=await page.evaluate(()=>({camera:__game.renderer.camera.matrixWorld.toArray(),time:__game.renderer.fx.uniforms.uTime.value}));
  await page.waitForTimeout(200);
  assert.deepEqual(await page.evaluate(()=>({camera:__game.renderer.camera.matrixWorld.toArray(),time:__game.renderer.fx.uniforms.uTime.value})),frozen,'pause freezes hit and low-health animation');
  await page.locator('#btnResume').click();
  assert.equal(await page.evaluate(()=>__game.audio._hbOn),true,'resume restores low-health heartbeat');
  result.kills=await page.evaluate(()=>{
    const g=__game,p=g.player,V=p.pos.constructor,targets=g.actors.filter(a=>a.team!==p.team).slice(0,2);
    g._heard=[];
    for(let i=0;i<targets.length;i++){const a=targets[i];a.protectT=0;a.hp=10;a.armor=0;g.damage(a,p,100,i?'head':'chest','m4a1',new V(1,0,0),false,false);}
    return g._heard.slice();
  });
  const confirms=result.kills.filter(x=>x.name==='playKillConfirm');
  assert.deepEqual(confirms.map(x=>x.args),[[false,1],[true,2]],'ordinary kill and headshot multikill carry distinct sound layers');
  assert.ok(!result.kills.some(x=>x.name==='playHitmarker'),'lethal hit does not duplicate the ordinary hit cue');
  result.death=await page.evaluate(()=>{
    const g=__game,p=g.player,V=p.pos.constructor,a=g.actors.find(a=>a.team!==p.team&&a.alive);g._heard=[];
    g.damage(p,a,200,'chest','m4a1',new V(1,0,0),false,false);
    return {alive:p.alive,heartbeat:g.audio._hbOn,audio:g._heard.slice()};
  });
  assert.equal(result.death.alive,false);assert.equal(result.death.heartbeat,false);
  assert.equal(result.death.audio.find(x=>x.name==='playDeath').args[0],null,'own death uses direct local sound');
  await page.waitForTimeout(350);await page.screenshot({path:'artifacts/v3-death.png'});
  result.respawn=await page.evaluate(()=>{
    const g=__game,p=g.player;g.spawnActor(p);g.renderFrame(1/60);
    return {hp:p.hp,glow:g.renderer.fx.uniforms.uLowHP.value,trauma:p.damageResponse.trauma,kick:{...p.damageResponse.offset}};
  });
  assert.equal(result.respawn.hp,100);assert.equal(result.respawn.glow,0);assert.equal(result.respawn.trauma,0);
  result.traversal=await page.evaluate(()=>{
    const g=__game,p=g.player,report=[];
    // Test the level's collision without frozen actors occupying its spawn exits.
    for(const a of g.actors)if(a!==p){a.alive=false;a.respawnT=1000;a.soldier.root.visible=false;}
    for(const route of g.map.routeChecks){
      p.pos.set(...route.from);p.vel.set(0,0,0);p.onGround=true;p.crouch=false;p.ads=0;p.land=0;
      let maxY=p.pos.y,steps=0;
      for(const end of [route.via,route.to].filter(Boolean)){
        const path=g.nav.findPath(p.pos.x,p.pos.z,end[0],end[2]);
        if(!path?.length)throw Error('Unreachable route '+route.name);
        for(const point of path){
          for(let frame=0;frame<3600;frame++){
            const dx=point[0]-p.pos.x,dz=point[1]-p.pos.z,d=Math.hypot(dx,dz);
            if(d<.19)break;
            p.move(1/60,dx/d,dz/d,false,false,true);maxY=Math.max(maxY,p.pos.y);steps++;
          }
          if(Math.hypot(point[0]-p.pos.x,point[1]-p.pos.z)>.5)throw Error('Movement blocked on '+route.name+' near '+point+' at '+p.pos.toArray());
        }
      }
      report.push({name:route.name,steps,maxY,end:p.pos.toArray(),goal:route.to});
    }
    return report;
  });
  assert.ok(result.traversal.length>=8);
  for(const r of result.traversal){assert.ok(Math.hypot(r.end[0]-r.goal[0],r.end[2]-r.goal[2])<.6);if(r.name.includes('平台'))assert.ok(r.maxY>2.5);}
  await page.evaluate(()=>{
    const g=__game,p=g.player;p.pos.set(-31,0,15.7);p.vel.set(0,0,0);p.yaw=-Math.PI/2;p.pitch=-.035;p.protectT=99;p.updateCamera(1/60);
    g.hud.toastT=0;g.hud.el.toast.style.opacity=0;
  });
  await page.waitForTimeout(400);await page.screenshot({path:'artifacts/v3-side-lane.png'});
  await page.evaluate(()=>{const p=__game.player;p.pos.set(-3,2.6,16.05);p.yaw=0;p.pitch=-.14;p.updateCamera(1/60);});
  await page.waitForTimeout(400);await page.screenshot({path:'artifacts/v3-platform.png'});
  // Render the actual Web Audio graph offline: ensure cues are finite, audible,
  // distinguishable, and bounded by the output limiter without external assets.
  result.audio=await page.evaluate(async()=>{
    const C=__game.audio.constructor, output={};
    for(const kind of ['hit','kill','headshot','death']){
      const ctx=new OfflineAudioContext(2,48000*2,48000),a=new C();a.init(ctx);
      if(kind==='hit')a.playHitmarker(false);
      if(kind==='kill')a.playKillConfirm(false,1);
      if(kind==='headshot')a.playKillConfirm(true,2);
      if(kind==='death')a.playDeath(null);
      const b=await ctx.startRendering();let sum=0,peak=0,tail=0;
      for(let c=0;c<2;c++){const data=b.getChannelData(c);for(let i=0;i<data.length;i++){const x=data[i];if(!Number.isFinite(x))throw Error('Non-finite sound');sum+=x*x;peak=Math.max(peak,Math.abs(x));if(i>12000)tail+=x*x;}}
      output[kind]={rms:Math.sqrt(sum/(b.length*2)),peak,tail,warnings:[...a._warned]};
    }
    return output;
  });
  for(const a of Object.values(result.audio)){assert.ok(a.rms>.001&&a.peak<1);assert.deepEqual(a.warnings,[]);}
  assert.ok(result.audio.kill.rms>result.audio.hit.rms*1.35,'kill confirmation is more substantial than a hit');
  assert.ok(result.audio.death.tail>1,'death feedback includes a lasting fall and equipment impact');
  result.errors=errors;
  await writeFile('artifacts/v3-check.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
  assert.deepEqual(errors,[]);
} finally {
  result.errors=errors;await writeFile('artifacts/v3-check.json',JSON.stringify(result,null,2));
  await browser.close();
}
