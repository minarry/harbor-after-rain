import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const errors = [], warnings = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
    if (msg.type() === 'warning') warnings.push(msg.text());
  });
  await page.goto('http://127.0.0.1:4173/?nolock=1&q=high', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.nav && window.__game?.hud?.el?.btnStartTdm, { timeout: 60000 });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: 'artifacts/menu.png' });
  await page.locator('#btnStartTdm').click();
  await page.waitForFunction(() => window.__game?.playing && window.__game.actors.length === 10);
  const start = await page.evaluate(() => ({ x: __game.player.pos.x, z: __game.player.pos.z }));
  await page.keyboard.down('KeyW'); await page.waitForTimeout(500); await page.keyboard.up('KeyW');
  const moved = await page.evaluate(() => ({ x: __game.player.pos.x, z: __game.player.pos.z }));
  assert.ok(Math.hypot(moved.x - start.x, moved.z - start.z) > .1, 'WASD must move player');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => __game.paused), true, 'Escape pauses');
  await page.locator('#btnResume').click();
  assert.equal(await page.evaluate(() => __game.paused), false, 'resume restores play');
  await page.evaluate(() => {
    const g = __game, p = g.player;
    p.pos.set(-17, 0, -6.5); p.yaw = -Math.PI / 2; p.pitch = -.025;
    p.protectT = 6; p.updateCamera(1 / 60);
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'artifacts/gameplay.png' });
  const simulated = await page.evaluate(() => {
    const g = __game;
    const before = g.renderer.renderer.info.memory;
    const tdm = g.fastForward(45, 1 / 30);
    const actors = g.actors.map(a => ({ team: a.team, alive: a.alive, x: a.pos.x, z: a.pos.z, tactic: a.tactic, shots: a.stats.shots, kills: a.stats.k }));
    return { tdm, actors, memory: before };
  });
  assert.ok(simulated.actors.every(a => Number.isFinite(a.x) && Number.isFinite(a.z)), 'bot positions remain finite');
  assert.ok(simulated.actors.some(a => a.shots > 0), 'bots fire during simulated match');
  await page.evaluate(() => __game.quitToMenu());
  await page.locator('.seg[data-k="goal"] button[data-v="100"]').click();
  await page.locator('#btnStartRelay').click();
  const relay = await page.evaluate(() => {
    const g = __game;
    g.fastForward(90, 1 / 30);
    return { index: g.objective.rules.index, score: { ...g.score }, active: g.objective.active,
      positions: g.actors.map(a => [a.pos.x, a.pos.z]), owner: g.objective.owner };
  });
  assert.equal(relay.active, true); assert.ok(relay.index >= 1, 'relay rotates after 75 seconds');
  assert.ok(relay.positions.every(p => p.every(Number.isFinite)));
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'artifacts/relay.png' });
  const diagnostics = await page.evaluate(() => ({ ready: true, quality: __game.opts.quality, fps: __game.fps,
    calls: __game.renderer.renderer.info.render.calls, triangles: __game.renderer.renderer.info.render.triangles,
    memory: __game.renderer.renderer.info.memory, mode: __game.mode, score: __game.score }));
  const result = { diagnostics, simulated, relay, errors, warnings: [...new Set(warnings)] };
  await writeFile('artifacts/browser-check.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  assert.equal(errors.length, 0, 'no runtime or shader errors');
} finally { await browser.close(); }
