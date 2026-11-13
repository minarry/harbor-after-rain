import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { World, NavGrid } from '../src/physics.js';
import { Bot, DIFF } from '../src/bots.js';
import { WeaponState } from '../src/weapons.js';
import { allyInFireLane, chooseLane, chooseRelayGoal, findCover } from '../src/tactics.js';

test('fire lane respects friend, finite range and vertical clearance', () => {
  const shooter = { team: 'BL' }, origin = { x: 0, y: 1.6, z: 0 }, target = { x: 20, y: 1.6, z: 0 };
  const ally = { team: 'BL', alive: true, pos: { x: 10, y: 0, z: 0 }, height: 1.8 };
  assert.equal(allyInFireLane(origin, target, [ally], shooter), true);
  for (const pos of [{ x: -1, y: 0, z: 0 }, { x: 22, y: 0, z: 0 }, { x: 10, y: 4, z: 0 }, { x: 10, y: 0, z: 2 }]) {
    ally.pos = pos;
    assert.equal(allyInFireLane(origin, target, [ally], shooter), false);
  }
  ally.pos = { x: 10, y: 0, z: 0 }; ally.team = 'GR';
  assert.equal(allyInFireLane(origin, target, [ally], shooter), false);
});

test('spawning bots fill the least populated approach', () => {
  const actors = [{ team: 'BL', alive: true, lane: -6.8 }, { team: 'BL', alive: true, lane: -0.4 }, { team: 'GR', alive: true, lane: 6.8 }];
  assert.equal(chooseLane(actors, 'BL', null, undefined, () => 0.5), 6.8);
});

test('cover selection finds a navigable position occluded by real collision geometry', () => {
  const world = new World();
  world.add({ x: 0, y: 1.5, z: 2.5, sx: 2, sy: 3, sz: 2 });
  world.build();
  const nav = new NavGrid(world, -12, -12, 12, 12, 0.5, 0.36);
  const bot = { pos: new Vector3(0, 0, 0), team: 'BL', game: { world, nav, actors: [] } };
  const threat = new Vector3(10, 0, 2.5), cover = findCover(bot, threat);
  assert.ok(cover && cover.path.length);
  assert.equal(nav.walkable(nav.idx(...cover.point)), true);
  const eye = new Vector3(cover.point[0], 1.05, cover.point[1]);
  const direction = threat.clone().setY(1.25).sub(eye), distance = direction.length(); direction.normalize();
  assert.ok(world.raycast(eye.x, eye.y, eye.z, direction.x, direction.y, direction.z, distance - 0.5, 'sight'));
});

test('damage from an unseen attacker creates sound memory, not a target lock', () => {
  const bot = Object.create(Bot.prototype);
  Object.assign(bot, { alive: true, team: 'BL', pos: new Vector3(), visible: false, target: null, lastSeen: null, heardT: -99, suppression: 0, burstPauseUntil: 0,
    game: { time: 3, world: { raycast: () => ({ t: 2 }) } } });
  bot.onDamaged({ alive: true, team: 'GR', pos: new Vector3(12, 0, 3) });
  assert.equal(bot.target, null);
  assert.equal(bot.lastSeen, null);
  assert.ok(bot.heard && bot.suppression > 0.5);
});

function firingSimulation(fps, blocked = false) {
  const bot = Object.create(Bot.prototype), target = { alive: true, team: 'GR', pos: new Vector3(0, 0, -20), vel: new Vector3(), speed: 0 };
  target.soldier = { headWorld: out => out.copy(target.pos).setY(1.62), chestWorld: out => out.copy(target.pos).setY(1.62) };
  const game = { time: 0, world: { raycast: () => blocked ? { t: 5 } : null }, nav: { lineFree: () => true }, actors: [bot, target], fireWeapon() {}, onReloadStart() {}, onReloadDone() {} };
  Object.assign(bot, {
    game, id: 0, team: 'BL', alive: true, pos: new Vector3(), eyeH: 1.62, yaw: 0, pitch: 0, punchP: 0, punchY: 0, aimPunch: 0,
    diff: { ...DIFF.normal, strafe: 0, bunny: 0 }, suppression: 0, thinkT: Infinity, target, visible: true,
    lastSeen: target.pos.clone(), lastSeenT: 0, heardT: -99, crouchUntil: 0, cover: null, slot: 0,
    inv: [new WeaponState('ak47')], readyAt: 0, reactUntil: 0, aimHead: false, errY: 0, errP: 0,
    stats: { shots: 0 }, recoilControl: 0, scoped: 0, burst: 0, burstGoal: 4, burstPauseUntil: 0,
    strafeT: 1, strafeDir: 0, fireBlockedUntil: 0, onGround: true, role: 'rush', move() {}, speed: 0,
  });
  for (let n = 0; n < fps * 2; n++) { game.time = n / fps; bot.update(1 / fps); }
  return bot.stats.shots;
}

test('bot burst cadence is based on bullets across render frame rates', () => {
  const random = Math.random; Math.random = () => 0.5;
  try {
    const low = firingSimulation(30), high = firingSimulation(120);
    assert.ok(low >= 10 && high >= 10, `${low}/${high} rounds`);
    assert.ok(Math.abs(low - high) <= 1, `${low}/${high} rounds`);
  } finally { Math.random = random; }
});

test('a newly occluded target stops firing before the next think tick', () => {
  assert.equal(firingSimulation(60, true), 0);
});

test('relay capture goal stays on the visible side of a separating cargo wall', () => {
  const world = new World();
  world.add({ x: 0, y: 1.5, z: 0, sx: 0.6, sy: 3, sz: 12 });
  world.build();
  const nav = new NavGrid(world, -10, -10, 10, 10, 0.5, 0.36);
  const objective = { radius: 4.25, position: new Vector3(-1.5, 0, 0) };
  const bot = { pos: new Vector3(-6, 0, 0), team: 'BL', game: { world, nav, actors: [] } };
  // Its preferred offset is across the wall, but that point cannot capture.
  const selected = chooseRelayGoal(bot, objective, 0, 2.9);
  assert.ok(selected?.path?.length);
  assert.ok(selected.point[0] < -0.5);
  const dx = objective.position.x - selected.point[0], dz = objective.position.z - selected.point[1], length = Math.hypot(dx, dz);
  assert.ok(length <= objective.radius - 0.8);
  assert.equal(world.raycast(selected.point[0], 0.8, selected.point[1], dx / length, 0, dz / length, length - 0.15, 'sight'), null);
});

test('relay planner falls back to center when all offset candidates are occluded', () => {
  const world = new World(); world.build();
  const nav = new NavGrid(world, -10, -10, 10, 10, 0.5, 0.36);
  const bot = { pos: new Vector3(-6, 0, 0), team: 'BL', game: { nav, world: { raycast: () => ({ t: 0.1 }) }, actors: [] } };
  const selected = chooseRelayGoal(bot, { radius: 4.25, position: new Vector3(1, 0, 2) }, 0, 2.9);
  assert.deepEqual(selected.point, [1, 2]);
  assert.ok(selected.path.length);
});

test('respawn clears tactical timestamps from an earlier match clock', () => {
  const bot = Object.create(Bot.prototype);
  Object.assign(bot, { pos: new Vector3(), lastCheck: new Vector3(), game: { time: 0, actors: [] }, primary: 'ak47', team: 'BL',
    contactReportAt: 500, reactUntil: 500, fireBlockedUntil: 500, huntFor: 499, objectiveKey: 'old', thinkT: 3,
    lastSeen: new Vector3(), heard: new Vector3(), pickGoal() {} });
  bot.onSpawn();
  assert.equal(bot.contactReportAt, 0.5);
  assert.equal(bot.reactUntil, 0);
  assert.equal(bot.fireBlockedUntil, 0);
  assert.equal(bot.huntFor, -99);
  assert.equal(bot.objectiveKey, null);
  assert.equal(bot.lastSeen, null);
  assert.equal(bot.heard, null);
  assert.ok(bot.thinkT <= 0.15);
});
