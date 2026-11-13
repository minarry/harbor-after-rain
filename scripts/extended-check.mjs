import { chromium } from 'playwright-core';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const errors = [], results = {};
const watch = page => {
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
};
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); watch(page);
  await page.goto('http://127.0.0.1:4173/?nolock=1&q=medium');
  await page.waitForFunction(() => window.__game, { timeout: 60000 });
  results.menuWeaponHidden = await page.evaluate(() => !__game.vm.rig.visible);
  assert.equal(results.menuWeaponHidden, true);
  await page.locator('#btnStartTdm').click();
  await page.keyboard.press('KeyB'); await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => __game.inLoadout && __game.paused), true);
  await page.locator('#btnLoadClose').click();
  assert.equal(await page.evaluate(() => !__game.inLoadout && !__game.paused), true);
  results.memory = await page.evaluate(() => {
    const g = __game, samples = [];
    for (let i=0;i<6;i++) {
      g.startMatch(); g.simulate(1/60);
      // Use identical visibility and camera so lazy GPU allocation is comparable.
      for (const a of g.actors) { a.protectT = 0; a.soldier.mesh.visible = true; }
      g.player.pos.set(-17,0,-6.5); g.player.yaw=-Math.PI/2; g.player.updateCamera(1/60);
      g.renderFrame(1/60); g.renderFrame(1/60);
      samples.push({ ...g.renderer.renderer.info.memory });
    }
    return samples;
  });
  const tail = results.memory.slice(2);
  console.log('Restart memory:', JSON.stringify(results.memory));
  assert.ok(Math.max(...tail.map(x=>x.textures))-Math.min(...tail.map(x=>x.textures)) <= 2, 'restart textures stay stable');
  assert.ok(Math.max(...tail.map(x=>x.geometries))-Math.min(...tail.map(x=>x.geometries)) <= 1, 'restart geometry stays stable');
  results.complete = await page.evaluate(() => {
    const g = __game; g.goal = 30;
    g.fastForward(360, 1/30);
    return { ended:g.ended, score:{...g.score}, time:g.time, mode:g.mode };
  });
  assert.equal(results.complete.ended, true, 'bots can complete a full round');
  await page.screenshot({ path:'artifacts/results.png' });
  await page.close();

  const context = await browser.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:1 });
  const mobile = await context.newPage(); watch(mobile);
  await mobile.goto('http://127.0.0.1:4173/?q=low&touch=1');
  await mobile.waitForFunction(()=>window.__game,{timeout:60000});
  await mobile.locator('#btnStartTdm').scrollIntoViewIfNeeded();
  await mobile.screenshot({ path:'artifacts/mobile-menu.png' });
  const box=await mobile.locator('#btnStartTdm').boundingBox();
  assert.ok(box && box.y>=0 && box.y+box.height<=844,'mobile start reachable');
  await mobile.locator('#btnStartTdm').tap();
  await mobile.setViewportSize({width:844,height:390});
  await mobile.waitForTimeout(700);
  await mobile.screenshot({ path:'artifacts/mobile-gameplay.png' });
  results.mobile = await mobile.evaluate(()=>({touch:__game.touchMode,playing:__game.playing,quality:__game.opts.quality,viewport:[innerWidth,innerHeight]}));
  assert.equal(results.mobile.touch,true); assert.equal(results.mobile.playing,true);
  await mobile.locator('#touch .btn').filter({hasText:'瞄准'}).tap();
  await mobile.waitForTimeout(450);
  assert.ok(await mobile.evaluate(()=>__game.player.ads>.9),'touch aim toggles on');
  await mobile.locator('#touch .btn').filter({hasText:'瞄准'}).tap();
  await mobile.waitForTimeout(350);
  assert.ok(await mobile.evaluate(()=>__game.player.ads<.05),'touch aim toggles off');
  await mobile.locator('#touch .btn').filter({hasText:'暂停'}).tap();
  assert.equal(await mobile.evaluate(()=>__game.paused),true,'touch pause works');
  await mobile.evaluate(()=>{const g=__game;g.resume();g.player.touch.fire=true;g.player.touch.mx=1;g.pause();});
  assert.equal(await mobile.evaluate(()=>!__game.player.touch.fire&&__game.player.touch.mx===0),true,'pause clears held touch input');
  await context.close();

  const offline = await browser.newPage({viewport:{width:1280,height:720}}); watch(offline);
  await offline.context().setOffline(true);
  const local = pathToFileURL(resolve('dist/index.html')); local.search='?q=low&nolock=1';
  await offline.goto(local.href);
  await offline.waitForFunction(()=>window.__game,{timeout:60000});
  await offline.locator('#btnStartTdm').click();
  results.offline=await offline.evaluate(()=>({playing:__game.playing,actors:__game.actors.length}));
  assert.equal(results.offline.playing,true); assert.equal(results.offline.actors,10);
  await offline.close();
  await writeFile('artifacts/extended-check.json',JSON.stringify({results,errors},null,2));
  console.log(JSON.stringify({results,errors},null,2));
  assert.equal(errors.length,0,'no runtime / shader errors in alternate paths');
} finally { await browser.close(); }
