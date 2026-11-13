import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = process.env.LAB_BASE || 'http://127.0.0.1:4173/';
const out = 'artifacts/v14';
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const report = { schemaVersion: 1, passed: false, errors: [], warnings: [], checks: [], snapshots: {}, differences: {}, tiers: {} };
page.on('pageerror', e => report.errors.push(e.stack || e.message));
page.on('console', m => {
  if (m.type() === 'error') report.errors.push(m.text());
  if (m.type() === 'warning') report.warnings.push(m.text());
});

function check(name, passed, detail) {
  report.checks.push({ name, passed, detail });
  assert.equal(passed, true, name);
}
async function openLab(quality = 'high', camera = 'edges') {
  await page.goto(`${base}?lab=render&shot=1&q=${quality}&cam=${camera}`);
  await page.waitForFunction(() => window.__lab?.ready, null, { timeout: 90000 });
  // FPS text would otherwise contaminate a fixed-time image difference.
  await page.addStyleTag({ content: '.lab-stage-overlay{visibility:hidden!important}' });
}
async function change(patch) {
  return page.evaluate(p => {
    const r = window.__lab?.debug.r || __game.renderer;
    r.setFeatures(p); r.render();
    return {
      features: r.getFeatures(), finish: r.finish.enabled, aa: r.finish.uniforms.uAA.value,
      sharpness: r.finish.uniforms.uSharpness.value, grain: r.finish.uniforms.uGrain.value,
      legacyGrain: r.fx.uniforms.uGrain.value, stable: r.bloom.highPassUniforms.uStable.value,
      near: r.haze.uniforms.uNearSteps.value, ao: r.ao.enabled, haze: r.haze.enabled, bloom: r.bloom.enabled,
      shadowRadius: r.scene.userData.harborEnvironment.sun.shadow.radius,
    };
  }, patch);
}
async function snapshot(name) {
  const png = await page.locator('#c').screenshot({ path: `${out}/post-${name}.png` });
  report.snapshots[name] = await page.evaluate(() => {
    const r = window.__lab?.debug.r || __game.renderer;
    return { features: r.getFeatures(), memory: { ...r.renderer.info.memory }, passes: r.composer.passes.filter(p => p.enabled).length, shadowRadius: r.scene.userData.harborEnvironment.sun.shadow.radius };
  });
  return png.toString('base64');
}
async function compare(a, b) {
  return page.evaluate(async ({ a, b }) => {
    const load = async s => {
      const bytes = Uint8Array.from(atob(s), c => c.charCodeAt(0));
      const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const c = new OffscreenCanvas(image.width, image.height), ctx = c.getContext('2d');
      ctx.drawImage(image, 0, 0); image.close();
      return ctx.getImageData(0, 0, c.width, c.height).data;
    };
    const A = await load(a), B = await load(b);
    if (A.length !== B.length) throw new Error('A/B images have different dimensions');
    let sum = 0, changed = 0, max = 0;
    for (let i = 0; i < A.length; i += 4) {
      let delta = 0;
      for (let k = 0; k < 3; k++) delta += Math.abs(A[i + k] - B[i + k]);
      sum += delta; max = Math.max(max, delta); if (delta > 3) changed++;
    }
    return { mean: sum / (A.length / 4 * 3), changedPercent: changed / (A.length / 4) * 100, max };
  }, { a, b });
}

try {
  for (const quality of ['high', 'medium', 'low']) {
    await openLab(quality);
    const offState = await change({ grain: false, sharpen: false, lens: false, feedback: false, aa: false });
    check(`${quality}: AA disabled without leaving grain or sharpening`, !offState.finish && offState.aa === 0 && offState.sharpness === 0 && offState.grain === 0);
    const off = await snapshot(`${quality}-aa-off`);
    const onState = await change({ aa: true });
    check(`${quality}: AA reaches final-pass uniform`, onState.finish && onState.aa === 1 && onState.legacyGrain === 0);
    const on = await snapshot(`${quality}-aa-on`);
    const delta = report.differences[`${quality}-aa`] = await compare(off, on);
    check(`${quality}: AA changes actual image pixels`, delta.mean > 0 && delta.changedPercent > 0, delta);

    await change({ ao: true, haze: true, bloom: true, bloomStable: true });
    const tier = report.tiers[quality] = await page.evaluate(() => {
      const r = __lab.debug.r;
      const cycle = () => {
        for (let i = 0; i < 24; i++) {
          r.setFeatures({ aa: !!(i % 2), bloomStable: !!(i % 2), softShadows: !!(i % 2), hazeDistribution: i % 2 ? 'near' : 'uniform', post: !!(i % 3) });
          r.render();
        }
      };
      cycle(); // Warm every combination before asserting stable resources.
      const before = { ...r.renderer.info.memory }, programsBefore = r.renderer.info.programs.length;
      cycle();
      return {
        before, after: { ...r.renderer.info.memory }, programsBefore, programsAfter: r.renderer.info.programs.length,
        finishTexel: r.finish.uniforms.uTexel.value.toArray(), buffer: [r.composer.readBuffer.width, r.composer.readBuffer.height],
        aoTaps: r.ao.material.defines.AO_TAPS, samples: r.composer.readBuffer.samples,
        shadowSize: r.scene.userData.harborEnvironment.sun.shadow.mapSize.x,
        basePixelRatio: r.basePixelRatio, calls: r.renderer.info.render.calls,
      };
    });
    check(`${quality}: geometry count does not grow`, tier.after.geometries === tier.before.geometries, tier);
    check(`${quality}: texture count does not grow`, tier.after.textures === tier.before.textures, tier);
    check(`${quality}: shader program count does not grow`, tier.programsAfter === tier.programsBefore, tier);
    check(`${quality}: AA texel size follows actual render buffer`, tier.finishTexel.every((v, i) => Number.isFinite(v) && Math.abs(v - 1 / tier.buffer[i]) < 1e-9), tier);
    check(`${quality}: AO sample budget`, tier.aoTaps === (quality === 'high' ? 10 : 6), tier);
    const stopped = await change({ post: false });
    check(`${quality}: master post switch gates all optical passes`, !stopped.finish && !stopped.ao && !stopped.haze && !stopped.bloom && stopped.grain === 0);

    if (quality === 'low') {
      // The lab can force expensive features on; verify the real low-tier policy
      // independently, then apply it to confirm the actual pass budget.
      const low = report.lowBudget = await page.evaluate(() => {
        const r = __lab.debug.r, defaults = new r.features.constructor('low').get();
        r.setFeatures(defaults); r.render();
        return { defaults, passes: r.composer.passes.filter(p => p.enabled).length, aa: r.finish.uniforms.uAA.value, ao: r.ao.enabled, haze: r.haze.enabled, bloom: r.bloom.enabled, pixels: r.composer.readBuffer.width * r.composer.readBuffer.height };
      });
      check('low: MSAA disabled, shadow atlas capped and DPR bounded', tier.samples === 0 && tier.shadowSize === 1024 && tier.basePixelRatio <= 1, tier);
      check('low: expensive passes default off while AA remains on', !low.ao && !low.haze && !low.bloom && low.aa === 1 && low.defaults.sharpness === .08, low);
      check('low: optical pass and pixel budgets', low.passes <= 6 && low.pixels <= 950001, low);
    }
  }

  await openLab('high', 'detail');
  let state = await change({ grain: false, sharpen: false, lens: false, feedback: false, softShadows: false });
  check('hard-shadow switch sets zero PCF radius', state.shadowRadius === 0);
  const shadowOff = await snapshot('shadows-hard');
  state = await change({ softShadows: true });
  check('soft-shadow switch restores bounded PCF radius', state.shadowRadius > 0 && state.shadowRadius <= 8);
  const shadowOn = await snapshot('shadows-soft'); report.differences.shadows = await compare(shadowOff, shadowOn);
  state = await change({ hazeDistribution: 'uniform' }); check('uniform haze reaches shader', state.near === 0);
  const hazeUniform = await snapshot('haze-uniform');
  state = await change({ hazeDistribution: 'near' }); check('near-biased haze reaches shader', state.near === 1);
  const hazeNear = await snapshot('haze-near'); report.differences.haze = await compare(hazeUniform, hazeNear);

  // A real label caught a regression that an image-difference-only AA test
  // missed. Save identical typography crops for mandatory human inspection;
  // legibility and visual taste are intentionally not numeric assertions.
  await page.goto(`${base}?lab=props&shot=1&q=high&cam=cargo`);
  await page.waitForFunction(() => window.__lab?.ready, null, { timeout: 90000 });
  await page.addStyleTag({ content: '.lab-stage-overlay{visibility:hidden!important}' });
  const labelRegion = await page.evaluate(() => {
    const r=__lab.debug.r,label=r.scene.children.find(o=>o.isSprite&&Math.abs(o.position.z+1)<.01);
    const world=label.getWorldPosition(label.position.clone()),view=world.clone().applyMatrix4(r.camera.matrixWorldInverse),ndc=world.clone().project(r.camera);
    const b=document.querySelector('#c').getBoundingClientRect(),w=label.scale.x*r.camera.projectionMatrix.elements[0]/-view.z*b.width/2,h=label.scale.y*r.camera.projectionMatrix.elements[5]/-view.z*b.height/2;
    const x=Math.max(b.x,b.x+(ndc.x*.5+.5)*b.width-w/2-8),y=Math.max(b.y,b.y+(-ndc.y*.5+.5)*b.height-h/2-8);
    return {x,y,width:Math.min(w+16,b.right-x),height:Math.min(h+16,b.bottom-y)};
  });
  await change({grain:false,sharpen:false,lens:false,feedback:false,aa:false});
  const textOff=await snapshot('cargo-aa-off');await page.screenshot({path:`${out}/post-label-aa-off.png`,clip:labelRegion});
  await change({aa:true});const textOn=await snapshot('cargo-aa-on');await page.screenshot({path:`${out}/post-label-aa-on.png`,clip:labelRegion});
  report.differences.typography=await compare(textOff,textOn);
  report.typographyReview={off:'post-label-aa-off.png',on:'post-label-aa-on.png',region:labelRegion,automatedBeautyAssertion:false};

  await page.goto(`${base}?nolock=1&q=high`);
  await page.waitForFunction(() => window.__game?.nav, null, { timeout: 90000 });
  await page.locator('#btnStartTdm').click(); await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const g = __game, p = g.player;
    for (const a of g.actors) if (a !== p) a.update = () => {};
    p.pos.set(-17, 0, -6.5); p.yaw = -Math.PI / 2; p.pitch = -.025; p.protectT = 0; p.updateCamera(1 / 60);
    g.renderer.adaptive = false;
    g.renderer.setFeatures({ autoExposure: false, grain: false, sharpen: false, lens: false, feedback: false });
    g.paused = true; g.env.update = () => {}; g.fx.update = () => {};
  });
  await page.addStyleTag({ content: 'body > :not(canvas){visibility:hidden!important} canvas{visibility:visible!important}' });
  await change({ aa: false }); const gunOff = await snapshot('game-aa-off');
  await change({ aa: true }); const gunOn = await snapshot('game-aa-on');
  report.differences.gameAA = await compare(gunOff, gunOn);
  check('game AA changes actual image pixels', report.differences.gameAA.mean > 0 && report.differences.gameAA.changedPercent > 0, report.differences.gameAA);
  state = await change({ bloomStable: false }); check('legacy bloom branch reaches shader', state.stable === 0);
  const bloomOld = await snapshot('game-bloom-old');
  state = await change({ bloomStable: true }); check('stable bloom branch reaches shader', state.stable === 1);
  const bloomStable = await snapshot('game-bloom-stable'); report.differences.bloom = await compare(bloomOld, bloomStable);
  state = await change({ sharpen: true, sharpness: .12, grain: true, lens: true, feedback: true });
  check('final sharpening and grain uniforms restore independently', state.sharpness === .12 && state.grain === 1 && state.legacyGrain === 0);
  await snapshot('game-finish');
  check('no runtime or shader errors', report.errors.length === 0, report.errors);
  report.passed = true;
} catch (error) {
  report.failure = error.stack; throw error;
} finally {
  report.errors = [...new Set(report.errors)]; report.warnings = [...new Set(report.warnings)];
  await fs.writeFile(`${out}/post-report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, errors: report.errors, warnings: report.warnings, differences: report.differences }, null, 2));
  await browser.close();
}
