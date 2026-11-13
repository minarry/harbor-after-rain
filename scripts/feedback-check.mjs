// Real-render regression for sight alignment, reload state, surface response and weather.
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const errors = [], result = {};
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push(e.stack || e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.goto('http://127.0.0.1:4173/?nolock=1&q=high');
  await page.waitForFunction(() => window.__game?.nav, { timeout: 90000 });
  await page.locator('#btnStartTdm').click();
  await page.evaluate(() => {
    const g = __game, p = g.player;
    for (const a of g.actors) if (!a.isPlayer) a.update = () => {};
    p.pos.set(-33, 0, -5); g.chooseLoadout('m4a1');
    p.pos.set(-17, 0, -6.5); p.yaw = -Math.PI / 2; p.pitch = -.025; p.protectT = 0;
    p.updateCamera(1/60); g.goal = 50;g.hud.toastT=0;g.hud.el.toast.style.opacity=0;
  });
  await page.waitForTimeout(1300);
  const originalMag = await page.evaluate(() => ({p:__game.vm.parts.mag.position.toArray(),r:__game.vm.parts.mag.rotation.toArray()}));
  await page.screenshot({ path: 'artifacts/v2-hip.png' });
  await page.mouse.move(720,450);
  await page.mouse.down({ button: 'right' });
  await page.waitForTimeout(700);
  result.ads = await page.evaluate(() => ({ ads: __game.player.ads, fov: __game.renderer.camera.fov, cross: getComputedStyle(document.getElementById('cross')).display }));
  assert.ok(result.ads.ads > .95 && result.ads.fov < 65, 'held right mouse raises sights and narrows FOV');
  assert.equal(result.ads.cross, 'none', 'HUD crosshair yields to the weapon sights');
  await page.screenshot({ path: 'artifacts/v2-ads.png' });
  await page.mouse.down(); await page.waitForTimeout(220); await page.mouse.up();
  assert.ok(await page.evaluate(() => __game.player.weapon.mag < 30), 'aimed fire consumes ammunition');
  await page.mouse.up({ button: 'right' });
  await page.evaluate(() => { __game.player.weapon.mag = 0; });
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'artifacts/v2-reload.png' });
  await page.keyboard.press('Escape');
  const pause = await page.evaluate(() => ({ time: __game.time, pose: __game.vm.holder.matrixWorld.toArray() }));
  await page.waitForTimeout(350);
  const frozen = await page.evaluate(() => ({ time: __game.time, pose: __game.vm.holder.matrixWorld.toArray() }));
  assert.equal(frozen.time,pause.time, 'pause freezes reload simulation');
  assert.deepEqual(frozen.pose,pause.pose, 'pause freezes the first person reload pose');
  await page.locator('#btnResume').click();
  await page.waitForFunction(()=>__game.player.weapon.mag===30&&!__game.player.weapon.reloading,{},{timeout:10000});
  result.reload = await page.evaluate(() => ({ mag: __game.player.weapon.mag, reserve: __game.player.weapon.reserve, reloading: __game.player.weapon.reloading }));
  assert.equal(result.reload.mag,30); assert.equal(result.reload.reloading,false);
  // Reload interruption must restore the new weapon rather than a hidden magazine pose.
  await page.evaluate(() => { __game.player.weapon.mag=4; });
  await page.keyboard.press('KeyR'); await page.waitForTimeout(350);
  await page.keyboard.press('Digit2'); await page.waitForTimeout(800);
  await page.mouse.down({button:'right'}); await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => __game.player.weapon.id),'deagle');
  await page.screenshot({path:'artifacts/v2-pistol-ads.png'});
  await page.mouse.up({button:'right'});
  await page.keyboard.press('Digit1'); await page.waitForTimeout(1100);
  const returnedMag = await page.evaluate(() => ({p:__game.vm.parts.mag.position.toArray(),r:__game.vm.parts.mag.rotation.toArray()}));
  assert.deepEqual(returnedMag,originalMag,'returning to a cancelled reload restores its original magazine transform');
  // Observe the actual traceBullet dispatch, not direct calls to the effect factory.
  result.surfaces = await page.evaluate(() => {
    const g=__game, V=g.player.pos.constructor, logs=[], original=g.fx.impact;
    g.fx.impact=function(p,n,mat,dir){ logs.push(mat); return original.call(this,p,n,mat,dir); };
    try {
      const shooter=g.player, gun=g.player.inv[0].def;
      g.traceBullet(shooter,new V(0,2,25),new V(0,-1,0),gun);
      // Locate exposed faces using the real collision map, avoiding guesses about map layout.
      for(const type of ['metal','wood','deck']) {
        let found=false;
        for(const c of g.world.colliders) {
          if(c.mat!==type) continue;
          const origin=new V(c.x,c.top+1.1,c.z), dir=new V(0,-1,0);
          const nearest=g.world.raycast(origin.x,origin.y,origin.z,0,-1,0,2,'bullet');
          if(nearest?.collider!==c) continue;
          g.traceBullet(shooter,origin,dir,gun); found=true; break;
        }
        if(!found) throw new Error('No exposed '+type+' collision surface');
      }
      const enemy=g.actors.find(a=>a.team!==shooter.team);
      enemy.pos.set(0,0,30); enemy.yaw=0; enemy.protectT=0; enemy.hp=100; enemy.armor=100;
      enemy.soldier.root.position.copy(enemy.pos);enemy.soldier.root.rotation.y=0;
      enemy.soldier.update(1/60,{speed:0,fwd:1,crouch:false,pitch:0,onGround:true});
      enemy.soldier.root.updateMatrixWorld(true);
      g.traceBullet(shooter,new V(0,1.4,34),new V(0,0,-1),gun);
      enemy.armor=0;
      g.traceBullet(shooter,new V(0,1.4,34),new V(0,0,-1),gun);
      if(enemy.hp>=100) throw new Error('Controlled enemy did not receive real bullet damage');
      return logs;
    } finally { g.fx.impact=original; }
  });
  for(const material of ['water','metal','wood','deck','armor','flesh']) assert.ok(result.surfaces.includes(material), 'real bullet reaches '+material);
  result.weather = await page.evaluate(() => {
    const g=__game, A=g.env.atmosphere, V=g.player.pos.constructor;
    let indoor=null,outdoor=null;
    for(let x=-33;x<34;x+=1.5) for(let z=-10;z<11;z+=1.5) {
      if(g.world.blocked(x,.1,z,.35,1.7)) continue;
      const p=new V(x,1.65,z), e=A.exposureAt(p);
      if(e<.25) indoor??={x,z,e}; if(e>.8) outdoor??={x,z,e};
    }
    return {indoor,outdoor,rainLevel:A.rainLevel};
  });
  assert.ok(result.weather.indoor && result.weather.outdoor,'rain exposure distinguishes enclosed lanes and open deck');
  result.pools = await page.evaluate(() => {
    const g=__game,V=g.player.pos.constructor,p=new V(-17,1,-6.5),n=new V(0,1,0),dir=new V(0,-1,0);
    for(let i=0;i<320;i++) { g.fx.impact(p,n,i%2?'water':'metal',dir); g.fx.ejectShell(p,dir); }
    g.fx.update(1/60,g.realTime,g.renderer.camera,g.env.shipSpeed);
    const saturated=g.fx.stats(); g.fx.resetTransient(); const cleared=g.fx.stats();
    return {saturated,cleared};
  });
  const capacities=result.pools.saturated.effectCapacity;
  for(const [key,cap] of Object.entries({activeShells:'shells',activeDebris:'debris',activeRipples:'ripples',activeSparks:'sparks',activeDroplets:'droplets',particleCount:'particles',tracerCount:'tracers'})) {
    assert.ok(result.pools.saturated[key]<=capacities[cap],key+' remains within its fixed pool');
    assert.equal(result.pools.cleared[key],0,key+' is cleared for the next match');
  }
  assert.equal(result.pools.cleared.decalCount,0,'bullet marks are cleared between matches');
  await page.evaluate(() => {
    const g=__game,p=g.player;
    p.pos.set(-33,0,-5);g.chooseLoadout('awm');p.pos.set(-17,0,-6.5);p.yaw=-Math.PI/2;p.pitch=-.025;
    g._caseActions=[];const action=g.vm.onAction;
    g.vm.onAction=e=>{if(e.type==='shell')g._caseActions.push(e.weapon);action?.(e);};
  });
  await page.waitForFunction(()=>__game.player.weapon.id==='awm'&&__game.time>=__game.player.readyAt,{},{timeout:10000});
  await page.mouse.move(720,450);await page.mouse.down();
  await page.waitForFunction(()=>__game.player.weapon.mag===4,{},{timeout:10000});
  await page.mouse.up();await page.keyboard.press('KeyR');
  await page.waitForFunction(()=>__game.player.weapon.reloading,{},{timeout:10000});
  await page.waitForFunction(()=>__game.player.weapon.mag===5&&!__game.player.weapon.reloading,{},{timeout:10000});
  result.sniperCase=await page.evaluate(()=>({actions:__game._caseActions,ammo:__game.player.weapon.mag,warnings:[...__game.audio._warned]}));
  assert.deepEqual(result.sniperCase.actions,['awm'],'AWM immediately reloaded after firing ejects exactly one spent case');
  assert.equal(result.sniperCase.ammo,5);
  assert.deepEqual(result.sniperCase.warnings,[],'surface and reload audio paths do not report errors');
  result.errors=errors;
  await writeFile('artifacts/feedback-check.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
  assert.equal(errors.length,0,'new PBR, rain and impact shaders compile without browser errors');
} finally { await browser.close(); }
