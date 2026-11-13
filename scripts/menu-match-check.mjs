import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

// Exercise the actual menu, actors, clock and result screen in the built game.
const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'artifacts/v149';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const report = { rounds: [], outcomes: [], errors: [], desktop: {}, mobile: {}, offline: {} };
const watch = page => {
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
};
const ready = async page => {
  await page.waitForFunction(() => window.__game?.nav && !document.querySelector('#menu').classList.contains('hidden'), { timeout: 60000 });
  // Stop only rendering after loading, so fixed-step fast-forward owns the clock.
  await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
  await page.waitForTimeout(120);
};
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }); watch(page);
  await page.goto('http://127.0.0.1:4173/?nolock=1&q=high'); await ready(page);
  for (const id of ['btnStartTdm', 'btnStartRelay']) assert.equal(await page.locator('#' + id).isVisible(), true);
  const a = await page.locator('#btnStartTdm').boundingBox(), b = await page.locator('#btnStartRelay').boundingBox();
  report.desktop = { sideBySide: a.x + a.width <= b.x && Math.abs(a.y - b.y) < 3,
    inView: [a, b].every(r => r.x >= 0 && r.y >= 0 && r.x + r.width <= 1440 && r.y + r.height <= 900),
    diagrams: await page.locator('#menu svg').count(),
    noDropdown: await page.locator('#sel-mode').count() === 0,
    noOverflow: await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    labLink: await page.locator('#menu a[href="?lab=render"]').isVisible() };
  assert.ok(report.desktop.sideBySide && report.desktop.inView && report.desktop.noDropdown && report.desktop.noOverflow && report.desktop.labLink);
  assert.ok(report.desktop.diagrams >= 2);
  await page.screenshot({ path: `${out}/menu-desktop.png` });

  for (const [mode, id] of [['tdm', 'btnStartTdm'], ['relay', 'btnStartRelay']]) {
    await page.locator('#' + id).click();
    const initial = await page.evaluate(() => { const g = __game; g.updateHUD(0); return { mode: g.mode, time: g.time, remaining: g.timeLeft, text: g.hud.el.sTime.textContent, active: g.objective.active, persisted: JSON.parse(localStorage.getItem('harbor_after_rain_opts_v1')).mode }; });
    assert.equal(initial.mode, mode); assert.equal(initial.persisted, mode); assert.equal(initial.remaining, 180); assert.equal(initial.text, '3:00'); assert.equal(initial.active, mode === 'relay');
    await page.keyboard.press('Escape');
    const pause = await page.evaluate(() => { const g = __game, time = g.time; g.fastForward(2); g.simulate(1); return { paused: g.paused, unchanged: g.time === time && g.timeLeft === 180 }; });
    assert.ok(pause.paused && pause.unchanged);
    await page.locator('#btnResume').click();
    const round = await page.evaluate(() => {
      const g = __game; g.goal = 10000; // Suppress target-score wins to exercise the actual time limit.
      g.fastForward(179, 1 / 30); g.updateHUD(0);
      const before = { ended: g.ended, time: g.time, text: g.hud.el.sTime.textContent, remaining: g.timeLeft };
      g.fastForward(2, 1 / 30);
      const end = { ended: g.ended, playing: g.playing, time: g.time, remaining: g.timeLeft, score: { ...g.score }, result: g.hud.el.endRes.textContent, relayRotations: g.objective.rules.index };
      g.fastForward(10); g.simulate(10);
      return { before, end, frozenAfterEnd: g.time === end.time && JSON.stringify(g.score) === JSON.stringify(end.score) };
    });
    assert.equal(round.before.ended, false); assert.ok(round.before.remaining > 0 && round.before.remaining < 1.1);
    assert.equal(round.before.text, '0:01'); assert.equal(round.end.ended, true); assert.equal(round.end.playing, false);
    assert.equal(round.end.time, 180); assert.equal(round.end.remaining, 0); assert.equal(round.frozenAfterEnd, true);
    if (mode === 'relay') assert.equal(round.end.relayRotations, 2);
    report.rounds.push({ mode, initial, pause, ...round });
    await page.locator('#btnMenu').click();
  }

  // Check both team perspectives, victory/defeat/draw, and the final partial step.
  for (const mode of ['tdm', 'relay']) for (const outcome of ['win', 'lose', 'draw']) {
    const result = await page.evaluate(({ mode, outcome }) => {
      const g = __game; g.opts.mode = mode; g.opts.team = mode === 'tdm' ? 'BL' : 'GR'; g.startMatch();
      const my = g.player.team, other = my === 'BL' ? 'GR' : 'BL';
      g.time = 179.99; g.timeLeft = .01; g.goal = 10000;
      g.score[my] = outcome === 'lose' ? 5 : 8; g.score[other] = outcome === 'win' ? 5 : 8;
      Object.assign(g.objective.rules.score, g.score);
      for (const actor of g.actors) actor.protectT = 99;
      g.simulate(1 / 30);
      return { mode, outcome, time: g.time, remaining: g.timeLeft, label: g.hud.el.endRes.textContent };
    }, { mode, outcome });
    assert.equal(result.label, { win: '胜利', lose: '失败', draw: '平局' }[outcome]);
    assert.equal(result.time, 180); assert.equal(result.remaining, 0); report.outcomes.push(result);
    await page.locator('#btnMenu').click();
  }
  report.early = await page.evaluate(() => {
    const g = __game; g.opts.mode = 'tdm'; g.opts.team = 'BL'; g.startMatch(); g.goal = 30; g.score.BL = 29;
    const victim = g.actors.find(a => a.team === 'GR'); victim.protectT = 0;
    g.damage(victim, g.player, 1000, 'chest', 'm4a1', g.player.forward(g.player.pos.clone())); g.fastForward(2);
    const tdm = { ended: g.ended, time: g.time, score: g.score.BL };
    g.opts.mode = 'relay'; g.startMatch(); g.goal = 30;
    const r = g.objective.rules; r.score.BL = 29; r.owner = 'BL'; r.progress = -1; r.tick = .99;
    for (const actor of g.actors) actor.protectT = 99;
    g.simulate(1 / 30);
    return { tdm, relay: { ended: g.ended, time: g.time, score: g.score.BL } };
  });
  for (const early of Object.values(report.early)) { assert.equal(early.ended, true); assert.equal(early.score, 30); assert.ok(early.time < 180); }
  await page.locator('#btnMenu').click();
  await page.locator('#btnStartRelay').focus(); await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => __game.playing && __game.mode === 'relay'), true, 'keyboard starts relay');
  await page.evaluate(() => __game.quitToMenu());
  await page.reload(); await ready(page);
  report.persistedMode = await page.evaluate(() => __game.opts.mode);
  assert.equal(report.persistedMode, 'relay');
  await page.close();

  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const mobile = await context.newPage(); watch(mobile);
  await mobile.goto('http://127.0.0.1:4173/?touch=1&q=low'); await ready(mobile);
  report.mobile.noOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  assert.equal(report.mobile.noOverflow, true);
  await mobile.screenshot({ path: `${out}/menu-mobile.png`, fullPage: true });
  for (const [id, mode] of [['btnStartTdm', 'tdm'], ['btnStartRelay', 'relay']]) {
    await mobile.locator('#' + id).scrollIntoViewIfNeeded();
    await mobile.screenshot({ path: `${out}/menu-mobile-${mode}.png` });
    await mobile.locator('#' + id).tap();
    assert.equal(await mobile.evaluate(() => __game.mode), mode);
    assert.equal(await mobile.evaluate(() => __game.touchMode && __game.playing && __game.timeLeft === 180), true);
    report.mobile[mode] = true;
    await mobile.evaluate(() => __game.quitToMenu());
  }
  await context.close();

  const offline = await browser.newPage({ viewport: { width: 1280, height: 800 } }); watch(offline);
  await offline.context().setOffline(true);
  const url = pathToFileURL(resolve('dist/index.html')); url.search = '?nolock=1&q=low';
  await offline.goto(url.href); await ready(offline); await offline.locator('#btnStartTdm').click();
  report.offline = await offline.evaluate(() => ({ playing: __game.playing, seconds: __game.timeLeft }));
  assert.equal(report.offline.playing, true); assert.equal(report.offline.seconds, 180);
  await offline.close();
  assert.deepEqual(report.errors, []);
  await writeFile(`${out}/menu-match-check.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
