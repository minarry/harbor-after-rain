import * as THREE from 'three';
import { World, NavGrid } from '../physics.js';
import { Bot, DIFF } from '../bots.js';
import { WeaponState } from '../weapons.js';
import { label } from './common.js';

const START = new THREE.Vector3(-8, 0, -6.5);
const GOAL = new THREE.Vector3(8, 0, -6.5);
const CLEAR_TARGET = new THREE.Vector3(-5.5, 0, -6.5);
const LIMIT = 22, TRAIL_CAPACITY = 512;
const OBSTACLES = [
  { x: -2.3, y: 1.15, z: -7.8, sx: 1.4, sy: 2.3, sz: 5.4 },
  { x: 2.3, y: 1.15, z: -5.2, sx: 1.4, sy: 2.3, sz: 5.4 },
];
const check = (name, pass, detail) => ({ name, pass, detail, status: pass === null ? 'pending' : pass ? 'pass' : 'fail' });

// Same headless fixture as the navigation regression: only rendering is replaced
// by a marker. Bot.update/think and inherited Actor.move/weaponUpdate are real.
function markerBot(game, root) {
  const bot = Object.create(Bot.prototype);
  Object.assign(bot, {
    game, id: 0, name: '路线验证', team: 'BL', side: 1, primary: 'm4a1', diff: DIFF.normal,
    recoilControl: DIFF.normal.ctrl, alive: true, isPlayer: false,
    pos: START.clone(), vel: new THREE.Vector3(), radius: .36, height: 1.8, eyeH: 1.62,
    stepHeight: .42, onGround: true, crouch: false, hp: 100, armor: 100,
    slot: 0, readyAt: 0, ads: 0, scoped: 0, pitch: 0, yaw: -Math.PI / 2,
    punchP: 0, punchY: 0, aimPunch: 0, jumpCD: 0, stepDist: 0, pendingThrow: 0,
    lastCheck: new THREE.Vector3(), stats: { shots: 0 },
    soldier: { root, setWeapon() {} },
  });
  return bot;
}

export function createTacticalProbe(ctx) {
  const root = new THREE.Group(); root.name = 'tactical-probe'; ctx.scene.add(root);
  const world = new World(), registeredColliders = [];
  world.add({ x: 0, y: -.15, z: -6.5, sx: 20, sy: .3, sz: 9, mat: 'deck', tag: 'deck', navSurface: true });
  const obstacleMaterial = new THREE.MeshStandardMaterial({ color: 0x37525a, roughness: .66, metalness: .45 });
  for (const obstacle of OBSTACLES) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(obstacle.sx, obstacle.sy, obstacle.sz), obstacleMaterial);
    body.position.set(obstacle.x, obstacle.y, obstacle.z); body.castShadow = body.receiveShadow = true;
    root.add(body); world.add({ ...obstacle, mat: 'metal', tag: 'probe-cover' });
    if (ctx.world) registeredColliders.push(ctx.world.add({ ...obstacle, mat: 'metal', tag: 'probe-cover' }));
  }
  world.build();
  const nav = new NavGrid(world, -9.5, -10.8, 9.5, -2.2, .35, .42);
  const markerMaterial = new THREE.MeshStandardMaterial({ color: 0x52ddbc, emissive: 0x16483e, roughness: .4 });
  const marker = new THREE.Group(), body = new THREE.Mesh(new THREE.CapsuleGeometry(.31, 1.12, 5, 10), markerMaterial);
  body.position.y = .9; body.castShadow = true; marker.add(body);
  const heading = new THREE.Mesh(new THREE.ConeGeometry(.16, .45, 4), markerMaterial);
  heading.rotation.x = -Math.PI / 2; heading.position.set(0, 1.45, -.43); marker.add(heading); root.add(marker);
  const target = new THREE.Mesh(new THREE.OctahedronGeometry(.34), new THREE.MeshStandardMaterial({ color: 0xffa36a, emissive: 0x5c2611 }));
  target.visible = false; root.add(target);
  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xe7b95e, side: THREE.DoubleSide, depthWrite: false });
  for (const p of [START, GOAL]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(.91, 1.04, 48), ringMaterial);
    ring.rotation.x = -Math.PI / 2; ring.position.set(p.x, .022, p.z); root.add(ring);
  }
  if (typeof document !== 'undefined') {
    for (const [text, p] of [['真实机器人 · 起点', START], ['绕过双掩体 · 终点', GOAL]]) {
      const sprite = label(ctx, text, [p.x, 2.05, p.z], 3.2); root.attach(sprite);
    }
  }
  const line = (color, opacity, capacity) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
    geometry.setDrawRange(0, 0);
    const object = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
    object.frustumCulled = false; root.add(object); return object;
  };
  const planned = line(0x7189a5, .65, TRAIL_CAPACITY), trail = line(0x76f2b3, 1, TRAIL_CAPACITY), sightLine = line(0xff8754, .85, 2);
  let state, bot, lastPath, routeResult = null, sightResult = null, trailCount = 0, trailClock = 0;
  const game = { time: 0, world, nav, map: { lanes: [-6.5], bounds: { minX: -9.5, maxX: 9.5, minZ: -10.8, maxZ: -2.2 } }, actors: [],
    objective: { active: true, position: GOAL.clone(), radius: 1.2 },
    onLand() {}, onFootstep() {}, onJump() { state.jumps++; }, onReloadStart() {}, onReloadDone() {}, onScope() {}, onSwitch() {},
  };
  const visibleTarget = { pos: GOAL.clone(), soldier: {
    headWorld(out) { out.copy(visibleTarget.pos); out.y += 1.65; return out; },
    chestWorld(out) { out.copy(visibleTarget.pos); out.y += 1.25; return out; },
  } };
  const previousPosition = new THREE.Vector3();
  const statusName = (record = state) => ({ idle: '未运行', route: '实际绕障中', arrived: '已抵达', failed: '验证失败', sight: record.elapsed < 1.2 ? '测试墙后遮挡' : '测试无遮挡', sightDone: '感知测试完成' })[record.status];
  const syncPlan = () => {
    if (bot.path === lastPath) return;
    lastPath = bot.path;
    const attribute = planned.geometry.attributes.position, path = bot.path || [];
    for (let i = 0; i < Math.min(path.length, TRAIL_CAPACITY); i++) attribute.setXYZ(i, path[i][0], .035, path[i][1]);
    attribute.needsUpdate = true; planned.geometry.setDrawRange(0, Math.min(path.length, TRAIL_CAPACITY));
  };
  const addTrail = () => {
    if (trailCount >= TRAIL_CAPACITY) return;
    trail.geometry.attributes.position.setXYZ(trailCount++, bot.pos.x, bot.pos.y + .055, bot.pos.z);
    trail.geometry.attributes.position.needsUpdate = true; trail.geometry.setDrawRange(0, trailCount);
  };
  function reset(clearEvidence = true) {
    if (clearEvidence) routeResult = sightResult = null;
    state = { status: 'idle', elapsed: 0, steps: 0, distance: 0, closest: START.distanceTo(GOAL), collisions: 0, jumps: 0,
      reached: false, blockedObserved: null, clearObserved: null };
    game.time = 0; bot = markerBot(game, marker); game.actors = [bot];
    bot.inv = ['m4a1', 'deagle', 'knife', 'he'].map(id => new WeaponState(id));
    bot.onSpawn(); bot.role = 'rush';
    lastPath = null; trailCount = 0; trailClock = 0;
    marker.position.copy(bot.pos); marker.rotation.y = bot.yaw;
    markerMaterial.color.setHex(0x52ddbc); target.visible = false;
    trail.geometry.setDrawRange(0, 0); sightLine.geometry.setDrawRange(0, 0);
    syncPlan();
  }
  function step(dt) {
    if (state.status !== 'route' && state.status !== 'sight') return;
    state.elapsed += dt; game.time += dt;
    if (state.status === 'sight') {
      visibleTarget.pos.copy(state.elapsed < 1.2 ? GOAL : CLEAR_TARGET);
      target.position.copy(visibleTarget.pos); target.position.y += 1.45;
      const canSee = bot.canSee(visibleTarget);
      if (state.elapsed < 1.2) state.blockedObserved = canSee;
      else state.clearObserved = canSee;
      sightLine.material.color.setHex(canSee ? 0x76f2b3 : 0xff8754);
      const a = sightLine.geometry.attributes.position;
      a.setXYZ(0, bot.pos.x, bot.pos.y + bot.eyeH, bot.pos.z); a.setXYZ(1, target.position.x, target.position.y, target.position.z);
      a.needsUpdate = true; sightLine.geometry.setDrawRange(0, 2);
      if (state.elapsed >= 2.4) { state.status = 'sightDone'; sightResult = { ...state }; }
      return;
    }
    previousPosition.copy(bot.pos); bot.update(dt); state.steps++;
    state.distance += bot.pos.distanceTo(previousPosition);
    const gap = bot.pos.distanceTo(GOAL); state.closest = Math.min(state.closest, gap);
    if (world.blocked(bot.pos.x, bot.pos.y + .03, bot.pos.z, bot.radius - .015, bot.height - .06)) state.collisions++;
    syncPlan(); trailClock += dt;
    if (trailClock >= .06) { trailClock = 0; addTrail(); }
    marker.position.copy(bot.pos); marker.rotation.y = bot.yaw;
    if (gap < 1.05 && Math.abs(bot.pos.y) < .1) {
      state.reached = true; state.status = state.collisions ? 'failed' : 'arrived'; addTrail();
      markerMaterial.color.setHex(state.collisions ? 0xff8754 : 0x9aff9b);
    } else if (state.elapsed >= LIMIT || !Number.isFinite(bot.pos.x + bot.pos.y + bot.pos.z)) {
      state.status = 'failed'; markerMaterial.color.setHex(0xff8754);
    }
    if (state.status === 'arrived' || state.status === 'failed') routeResult = { ...state };
  }
  reset();
  return {
    root, controls: [], actions: [{ id: 'route', label: '机器人真实绕障' }, { id: 'sight', label: '遮挡感知正反例' }, { id: 'reset', label: '重置战术测试' }],
    camera: { id: 'tactics', label: '战术测试场', pos: [0, 12, 7], target: [0, 0, -6.5] },
    update(dt) { if (!Number.isFinite(dt) || dt <= 0) return; for (let rest = Math.min(dt, .1); rest > 1e-8;) { const tick = Math.min(rest, 1 / 60); step(tick); rest -= tick; } },
    action(id) {
      if (id === 'reset') { reset(); return true; }
      if (id === 'route' || id === 'sight') {
        reset(false); state.status = id; target.visible = id === 'sight';
        if (id === 'route') { routeResult = null; addTrail(); } else sightResult = null;
        return true;
      }
      return false;
    },
    checks: () => {
      const route = routeResult || state, sight = sightResult || state;
      return [
      check('掩体实际阻断直线', !nav.lineFree(START.x, START.z, GOAL.x, GOAL.z), '两个真实碰撞体强制改变路线'),
      check('真实 Bot 已绕障抵达', routeResult ? route.reached && route.collisions === 0 && route.distance > START.distanceTo(GOAL) + 1 : null,
        `${statusName(route)}；实际移动 ${route.distance.toFixed(1)} m；终点最近 ${route.closest.toFixed(2)} m`),
      check('绕行未穿入障碍', routeResult ? route.reached && route.collisions === 0 : null, `${route.steps} 次实际物理更新；${route.collisions} 次障碍重叠`),
      check('遮挡不可见 / 移出后可见', sightResult ? sight.blockedObserved === false && sight.clearObserved === true : null,
        sight.blockedObserved === null ? '尚未运行感知正反例' : `墙后 ${sight.blockedObserved ? '可见' : '不可见'}；无遮挡 ${sight.clearObserved === null ? '待测试' : sight.clearObserved ? '可见' : '不可见'}`),
      ];
    },
    metrics: () => ({ 战术测试: statusName(), 实际步数: state.steps, 实走距离: `${state.distance.toFixed(1)} m`, 最近目标: `${state.closest.toFixed(2)} m`, 障碍重叠: state.collisions, 紧急跳跃: state.jumps }),
    report: () => ({ ...state, route: routeResult ? { ...routeResult } : null, sight: sightResult ? { ...sightResult } : null, position: bot.pos.toArray(), goal: GOAL.toArray(), plannedPath: (bot.path || []).map(p => [...p]), realBot: bot instanceof Bot, trailCount }),
    dispose() {
      const materials = new Set(), geometries = new Set();
      root.traverse(o => { if (o.geometry) geometries.add(o.geometry); if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m); });
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) { material.map?.dispose(); material.dispose(); }
      if (ctx.world) { ctx.world.colliders = ctx.world.colliders.filter(c => !registeredColliders.includes(c)); ctx.world.build(); }
      root.removeFromParent();
    },
  };
}
