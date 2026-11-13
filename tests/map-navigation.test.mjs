import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildMap } from '../src/map.js';
import { World, NavGrid } from '../src/physics.js';
import { Actor } from '../src/actor.js';
import { Bot, DIFF } from '../src/bots.js';
import { WeaponState } from '../src/weapons.js';
import { RelayObjective } from '../src/objective.js';
import { RelayState } from '../src/relay-state.js';

// The real map builder runs headlessly. Textures do not affect geometry/collision.
const tex = { map: null, normalMap: null, roughnessMap: null, emissiveMap: null };
const T = Object.fromEntries(['deck', 'bulkhead', 'darkSteel', 'yellowSteel', 'redSteel', 'greenSteel', 'superWall', 'hull'].map(k => [k, { ...tex }]));
T.containers = Array.from({ length: 8 }, () => ({ color: { rgb: [90, 110, 120] }, side20: null, side40: null, n20: null, n40: null, door: null, doorN: null, roof: null, roofN: null }));
T.crates = Array.from({ length: 6 }, (_, i) => ({ ...tex, kind: i % 2 ? 'wood' : 'metal' }));
Object.assign(T, { fence: null, grating: null, signs: null });
const world = new World(), map = buildMap(new THREE.Scene(), T, world, { skipAO: true });
const b = map.navBounds, nav = new NavGrid(world, b.x0, b.z0, b.x1, b.z1, 0.5, 0.42);

function walkPath(from, to, seconds = 40) {
  const p = Object.create(Actor.prototype), game = { world, actors: [p], onLand() {}, onFootstep() {}, onJump() {} };
  Object.assign(p, { game, pos: new THREE.Vector3(...from), vel: new THREE.Vector3(), radius: .36, height: 1.8, stepHeight: .42,
    onGround: true, eyeH: 1.62, crouch: false, ads: 0, scoped: 0, inv: [{ def: { speed: 1 } }], slot: 0, jumpCD: 0, stepDist: 0 });
  const path = nav.findPath(from[0], from[2], to[0], to[2]);
  assert.ok(path?.length, `no route ${from} -> ${to}`);
  let index = 1, peak = p.pos.y;
  for (let i = 0; i < seconds * 60 && index < path.length; i++) {
    const goal = path[index], dx = goal[0] - p.pos.x, dz = goal[1] - p.pos.z, distance = Math.hypot(dx, dz);
    if (distance < .25 && Math.abs(p.pos.y - (nav.heightAt(...goal) ?? 0)) < .45) { index++; continue; }
    p.move(1 / 60, dx / Math.max(distance, .001), dz / Math.max(distance, .001), false, false, false);
    peak = Math.max(peak, p.pos.y);
  }
  return { p, complete: index >= path.length, path, peak };
}

test('expanded ship has 1.49 times the playable deck and all spawns have head clearance', () => {
  const deck = world.colliders.find(c => c.tag === 'deck');
  assert.ok(deck.hz * 2 / 24.3 > 1.45 && deck.hz * 2 / 24.3 < 1.55);
  for (const spawn of [...map.spawns.BL, ...map.spawns.GR]) {
    assert.equal(world.blocked(spawn.x, .025, spawn.z, .36, 1.8), false, JSON.stringify(spawn));
    assert.ok(nav.walkable(nav.idx(spawn.x, spawn.z)), `spawn has no nav cell ${JSON.stringify(spawn)}`);
  }
});

test('both teams can navigate every maintenance room, cross hatch and observation deck', () => {
  for (const team of ['BL', 'GR']) {
    const spawn = map.spawns[team][0];
    for (const target of map.navigationChecks) {
      const k = nav.idx(target.x, target.z);
      assert.ok(nav.walkable(k), `blocked key area ${target.name}`);
      assert.ok(Math.abs(nav.heightAt(target.x, target.z) - target.y) < .3, `wrong floor ${target.name}`);
      const path = nav.findPath(spawn.x, spawn.z, target.x, target.z);
      assert.ok(path?.length, `${team} cannot reach ${target.name}`);
    }
  }
});

test('real actor movement climbs and descends both observation decks without jumping or teleporting', () => {
  for (const side of [-1, 1]) {
    const z = side * 16.05;
    const up = walkPath([-13.2, 0, z], [0, 2.6, z]);
    assert.ok(up.complete, `stuck climbing ${side}: ${up.p.pos.toArray()}, path=${JSON.stringify(up.path)}`);
    assert.ok(up.peak >= 2.59 && up.p.pos.y > 2.5);
    const down = walkPath([0, 2.6, z], [13.2, 0, z]);
    assert.ok(down.complete, `stuck descending ${side}: ${down.p.pos.toArray()}`);
    assert.ok(down.p.pos.y < .1);
    assert.equal(nav.lineFree(0, side * 12.8, 0, z), false, 'cannot route directly up a 2.6m platform side');
  }
});

test('actual actor movement crosses all four interior rooms and the full new side routes', () => {
  for (const route of map.routeChecks.filter(r => !r.via)) {
    const moved = walkPath(route.from, route.to, 55);
    assert.ok(moved.complete, `${route.name} blocked at ${moved.p.pos.toArray()} path=${JSON.stringify(moved.path)}`);
  }
});

test('a bot follows its real planner to a raised relay from either spawn without emergency jumps', () => {
  for (const [team, side] of [['BL', 1], ['GR', -1]]) {
    const bot = Object.create(Bot.prototype), objective = { active: true, position: new THREE.Vector3(0, 2.6, side * 16.05), radius: 4.25 };
    let jumps = 0;
    const game = { time: 0, world, nav, map, actors: [bot], objective,
      onLand() {}, onFootstep() {}, onJump() { jumps++; }, onReloadStart() {}, onReloadDone() {}, onScope() {}, onSwitch() {} };
    Object.assign(bot, { game, id: side > 0 ? 0 : 1, team, side: team === 'BL' ? 1 : -1, primary: 'm4a1', diff: DIFF.normal,
      alive: true, isPlayer: false, pos: new THREE.Vector3(team === 'BL' ? -32 : 32, 0, side * 15.7), vel: new THREE.Vector3(),
      radius: .36, height: 1.8, eyeH: 1.62, stepHeight: .42, onGround: true, crouch: false, hp: 100,
      inv: [new WeaponState('m4a1'), new WeaponState('deagle'), new WeaponState('knife'), new WeaponState('he')], slot: 0,
      readyAt: 0, ads: 0, scoped: 0, pitch: 0, yaw: 0, punchP: 0, punchY: 0, aimPunch: 0,
      jumpCD: 0, stepDist: 0, pendingThrow: 0, lastCheck: new THREE.Vector3(), stats: { shots: 0 } });
    bot.onSpawn();
    let arrived = false;
    for (let i = 0; i < 45 * 60; i++) {
      game.time += 1 / 60; bot.update(1 / 60);
      if (bot.pos.y > 2.5 && bot.pos.distanceTo(objective.position) < 3.45) { arrived = true; break; }
    }
    assert.ok(arrived, `${team} bot failed to climb: ${bot.pos.toArray()}, ${bot.tactic}`);
    assert.equal(jumps, 0, `${team} needed an emergency jump on a supposed walking route`);
  }
});

test('raised relay counts occupants on the platform and excludes the lower bypass', () => {
  const objective = Object.create(RelayObjective.prototype);
  const position = new THREE.Vector3(0, 2.6, 16.05), rules = new RelayState();
  const game = { world, actors: [
    { alive: true, protectT: 0, team: 'BL', pos: position.clone() },
    { alive: true, protectT: 0, team: 'GR', pos: new THREE.Vector3(0, 0, 12.8) },
  ], player: { team: 'BL' }, score: {}, goal: 100, hud: { toast() {} }, endMatch() {} };
  Object.assign(objective, { game, active: true, radius: 4.25, position, rules });
  objective.update(7);
  assert.equal(rules.owner, 'BL');
  assert.equal(rules.contested, false);
  game.actors[1].pos.copy(position).add(new THREE.Vector3(.7, 0, 0));
  objective.update(.1);
  assert.equal(rules.contested, true);
});
