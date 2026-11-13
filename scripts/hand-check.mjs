import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const outIndex = process.argv.indexOf('--out');
const out = outIndex < 0 ? 'artifacts/v144' : process.argv[outIndex + 1];
assert.ok(out, '--out requires a directory');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const report = { tiers: [], errors: [], warnings: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); if (m.type() === 'warning') report.warnings.push(m.text()); });
  for (const quality of ['high', 'low']) {
    const url = new URL('http://127.0.0.1:4173/');
    url.search = new URLSearchParams({ lab: 'weapon', shot: '1', t: '2', q: quality, seed: '4207', c: JSON.stringify({ reloadPhase: .45 }) });
    await page.goto(url.href); await page.waitForFunction(() => window.__lab?.ready, null, { timeout: 90000 });
    const result = await page.evaluate(() => {
      const lab = __lab, vm = lab.debug.vm, states = [];
      const directScrub = { drawProgress: vm.drawT, reload: vm.anim?.t / vm.anim?.dur };
      const inspect = label => {
        vm.rig.updateMatrixWorld(true);
        const snapshot=lab.snapshot();
        states.push({ label, checks: snapshot.checks.every(c => c.pass),
          joints:Object.fromEntries(Object.entries(vm.arms).filter(([,a])=>a.g.visible).map(([side])=>[side,snapshot.details.hands[side].joint])),
          handPose: Object.values(vm.arms).filter(a => a.g.visible).every(a => [...a.hand.position.toArray(), ...a.hand.quaternion.toArray()].every(Number.isFinite)) });
      };
      for (const weapon of ['m4a1', 'ak47', 'mp5', 'awm', 'deagle', 'knife', 'he']) {
        lab.control('reloadPhase', -1); lab.control('ads', 0); lab.control('weapon', weapon); lab.step(45); inspect(`${weapon}/hip`);
        lab.control('ads', 1); lab.step(20); inspect(`${weapon}/ads`);
        lab.control('ads', 0); lab.action('fire'); lab.step(15); inspect(`${weapon}/fire`);
        lab.action('cancel'); lab.action('inspect'); lab.step(45); inspect(`${weapon}/inspect`); lab.action('cancel');
        if (!['knife', 'he'].includes(weapon)) for (const phase of [.12, .3, .6, .8, .9]) {
          lab.control('reloadPhase', phase); lab.step(1); inspect(`${weapon}/reload-${phase}`);
        }
      }
      lab.control('reloadPhase', -1); lab.control('weapon', 'm4a1'); lab.step(45);
      const memory = () => ({ ...lab.debug.r.renderer.info.memory });
      const before = memory();
      for (let i = 0; i < 21; i++) { lab.control('weapon', ['m4a1', 'ak47', 'mp5', 'awm', 'deagle', 'knife', 'he'][i % 7]); lab.step(25); }
      const after = memory();
      return { quality: lab.snapshot().quality, directScrub, states, memory: { before, after }, hands: lab.snapshot().details.hands };
    });
    assert.equal(result.directScrub.drawProgress, 1, 'direct reload links must complete the draw first');
    assert.ok(Math.abs(result.directScrub.reload - .45) < 1e-9);
    assert.ok(result.states.every(s => s.checks && s.handPose));
    assert.equal(result.memory.after.geometries, result.memory.before.geometries);
    assert.equal(result.memory.after.textures, result.memory.before.textures);
    report.tiers.push(result); console.log(`${quality}: ${result.states.length} poses, stable resources`);
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.warnings, []);
  await writeFile(`${out}/hand-check.json`, JSON.stringify(report, null, 2));
} finally { await browser.close(); }
