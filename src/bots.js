// 机器人 AI
import * as THREE from 'three';
import { Actor } from './actor.js';
import { chooseLane, allyInFireLane, reachableGoal, chooseRelayGoal, findCover } from './tactics.js';

export const DIFF = {
  easy: { react: [0.55, 0.9], aimErr: 0.075, turn: 3.2, track: 2.2, headP: 0.07, ctrl: 1.0, comp: 0.55, strafe: 0.35, see: 50, fov: 1.6, bunny: 0 },
  normal: { react: [0.42, 0.7], aimErr: 0.06, turn: 5.2, track: 2.8, headP: 0.09, ctrl: 0.88, comp: 0.76, strafe: 0.65, see: 62, fov: 1.85, bunny: 0 },
  hard: { react: [0.2, 0.34], aimErr: 0.032, turn: 8.5, track: 5.5, headP: 0.3, ctrl: 0.6, comp: 0.9, strafe: 0.85, see: 75, fov: 2.05, bunny: 0.12 },
  hell: { react: [0.12, 0.2], aimErr: 0.02, turn: 13, track: 8.5, headP: 0.5, ctrl: 0.42, comp: 0.95, strafe: 1, see: 95, fov: 2.3, bunny: 0.2 },
};

export const BOT_NAMES = [
  '丶夜猫子', 'CF灬战神', '狙神小白', '枪王之王', '火麒麟丶', '无敌小旋风', '天使の翼', '爆头专业户', '穿越者丨龙', '雷神M4',
  '灬冷血杀手', '沙鹰一哥', '老六本六', '我是菜鸟', '运输船之王', 'Sniper丶K', '二楼架枪', '管道守门员', '一枪一个', '闪电侠丶',
  '黑名单丶影', '保卫者老王', '夜袭者', '零度丶', '狂暴战神', '别打我头', '满血复活', '疾风步',
];

// 各阵营的架点（潜伏者坐标，保卫者取反）
const HOLDS = [[-20.5, -7.2, 0.2], [-24.6, 5.8, -0.15], [-16.4, 1.3, 0.1], [-9.8, -6.8, 0.25], [-26.2, -6.5, 0.05]];
const EXPANDED_HOLDS = [...HOLDS, [-1.8, 15.35, 0.12], [-1.8, -15.35, -0.12], [-19.8, 15.7, 0.2], [-19.8, -15.7, -0.2]];
const LANES = [-6.8, -0.4, 6.8];

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const wrapPi = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

export class Bot extends Actor {
  constructor(game, o) {
    super(game, o);
    this.diff = DIFF[o.diff] || DIFF.normal;
    this.recoilControl = this.diff.ctrl;
    this.path = null; this.pi = 0; this.goal = null;
    this.target = null; this.visible = false; this.lastSeen = null; this.lastSeenT = -99; this.reactUntil = 0;
    this.errY = 0; this.errP = 0; this.aimHead = false;
    this.strafeDir = 1; this.strafeT = 0; this.burst = 0; this.burstPauseUntil = 0;
    this.thinkT = Math.random() * 0.2; this.stuckT = 0; this.stuckN = 0; this.lastCheck = new THREE.Vector3();
    this.role = 'rush'; this.holdT = 0; this.crouchUntil = 0; this.nadeT = 20 + Math.random() * 20;
    this.heard = null; this.heardT = -99;
    this.fireHeld = false;
    this.wantJump = false;
    this.side = this.team === 'BL' ? 1 : -1; // 潜伏者坐标系转换
    this.tactic = 'advance'; this.suppression = 0; this.cover = null;
    this.coverSearchAt = 0; this.contactReportAt = 0; this.objectivePlanAt = 0;
    this.burstGoal = 4; this.searchAt = 0; this.fireBlockedUntil = 0;
  }
  onSpawn() {
    this.path = null; this.goal = null; this.target = null; this.visible = false; this.lastSeen = null;
    this.lastSeenT = this.heardT = -99; this.heard = null;
    this.cover = null; this.suppression = 0; this.tactic = 'advance';
    this.coverSearchAt = this.game.time + 1; this.objectivePlanAt = 0;
    this.contactReportAt = this.game.time + 0.5; this.objectiveKey = null;
    this.reactUntil = 0; this.fireBlockedUntil = 0; this.huntFor = -99;
    this.thinkT = Math.random() * 0.15; this.strafeT = 0;
    this.nadeT = 20 + Math.random() * 20; this.wantJump = false;
    this.lookYaw = this.lookPitch = undefined; this.nadePlan = null; this.throwAim = null;
    this.fireHeld = false; this.burst = 0; this.burstPauseUntil = 0;
    this.crouchUntil = 0; this.wantScope = false; this.holdT = 0;
    this.stuckN = 0; this.stuckT = 0; this.lastCheck.copy(this.pos);
    const r = Math.random();
    this.role = this.primary === 'awm' ? 'hold' : r < 0.25 ? 'flank' : 'rush';
    this.lane = chooseLane(this.game.actors, this.team, this, this.game.map?.lanes || LANES);
    this.stage = 0;
    this.pickGoal();
  }
  L(x, z) { return [x * this.side, z * this.side]; } // 己方坐标 -> 世界
  setPath(x, z) {
    const point = reachableGoal(this.game.nav, x, z);
    if (!point) { this.path = null; return false; }
    this.goal = point;
    this.path = this.game.nav.findPath(this.pos.x, this.pos.z, point[0], point[1]);
    this.pi = this.path?.length > 1 ? 1 : 0;
    return !!this.path;
  }
  pickGoal() {
    const g = this.game, nav = g.nav, rnd = Math.random;
    let gx, gz;
    if (g.objective?.active) {
      // Three teammates contest the relay; others cover different approaches.
      const station = this.primary === 'awm' ? 4 : this.id % 5, radius = station < 3 ? 1.5 + station * 0.7 : 6;
      const angle = this.id * 2.39996 + (this.side < 0 ? Math.PI : 0);
      this.objectivePlanAt = g.time + 4;
      this.objectiveKey = `${g.objective.position.x}:${g.objective.position.z}`;
      this.tactic = 'advance';
      if (station < 3) {
        const selected = chooseRelayGoal(this, g.objective, angle, radius);
        if (selected) {
          this.goal = selected.point; this.path = selected.path;
          this.pi = this.path?.length > 1 ? 1 : 0;
          return;
        }
      }
      gx = g.objective.position.x + Math.cos(angle) * radius;
      gz = g.objective.position.z + Math.sin(angle) * radius;
    } else if (this.role === 'hold') {
      const holds = g.map?.lanes?.length > 3 ? EXPANDED_HOLDS : HOLDS;
      const h = holds[(rnd() * holds.length) | 0];
      [gx, gz] = this.L(h[0], h[1]);
      this.holdYaw = this.side > 0 ? -Math.PI / 2 + h[2] : Math.PI / 2 + h[2];
    } else if (this.role === 'flank' && this.stage < (g.map?.lanes?.length > 3 ? 4 : 3)) {
      const side = this.id % 2 ? 1 : -1;
      const pts = g.map?.lanes?.length > 3
        ? [[-30.5, side * 15.7], [-14, side * 16.05], [0, side * 16.05], [19, side * 15.7]]
        : [[-31.5, 10.5], [-8, 10.6], [8.0, 7.8]];
      [gx, gz] = this.L(...pts[this.stage]);
    } else if (Math.abs(this.lane) > 12 && this.stage < 2) {
      // Deliberately use the raised route, rather than always taking its shorter ground bypass.
      [gx, gz] = this.L(this.stage === 0 ? 0 : 19, this.lane);
    } else if (this.stage < 1) {
      [gx, gz] = this.L(4 + rnd() * 18, this.lane + (rnd() - 0.5) * 2);
    } else {
      const sideLimit = g.map?.bounds ? Math.min(17.3, g.map.bounds.maxZ - 1) : 8.8;
      const p = nav.randomFree(rnd, -26, -sideLimit, 26, sideLimit);
      [gx, gz] = p || this.L(10, 0);
    }
    this.setPath(gx, gz);
  }
  hear(pos, loud) {
    if (!this.alive || this.visible) return;
    // Audio reveals an area, never an actor identity or exact hidden position.
    const dx = pos.x - this.pos.x, dz = pos.z - this.pos.z, L = Math.hypot(dx, dz);
    if (L < 0.1) return;
    const blocked = this.game.world.raycast(this.pos.x, this.pos.y + 1.4, this.pos.z, dx / L, 0, dz / L, L, 'sight');
    if (!loud && blocked && L > 7) return;
    if (this.game.time - this.heardT < 0.45 && this.heardLoud && !loud) return;
    const err = (loud ? 1.1 : 2.4) + (blocked ? 1.5 : 0);
    this.heard = pos.clone();
    this.heard.x += (Math.random() - 0.5) * err * 2;
    this.heard.z += (Math.random() - 0.5) * err * 2;
    this.heardT = this.game.time; this.heardLoud = loud;
  }
  suppress(source, amount = 0.25) {
    if (!this.alive) return;
    this.suppression = Math.min(1, this.suppression + amount);
    if (source && !this.visible) this.hear(source, true);
  }
  onDamaged(att) {
    if (!att || !this.alive || att.team === this.team) return;
    this.suppress(att.pos, 0.56);
    if (!this.visible && this.heard) {
      const dx = this.heard.x - this.pos.x, dz = this.heard.z - this.pos.z;
      this.lookYaw = Math.atan2(-dx, -dz);
    }
    this.burstPauseUntil = Math.max(this.burstPauseUntil, this.game.time + 0.12);
  }
  canSee(t) {
    const g = this.game;
    const e = this.eye(_v);
    const dist = e.distanceTo(t.pos);
    if (dist > this.diff.see) return false;
    // 视野角
    const dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z;
    const ang = Math.abs(wrapPi(Math.atan2(-dx, -dz) - this.yaw));
    if (ang > this.diff.fov / 2 && dist > 6) return false;
    for (const pt of [t.soldier.headWorld(_v2), t.soldier.chestWorld(_v3)]) {
      const d = pt.clone().sub(e); const L = d.length(); if (L < 0.01) return true; d.divideScalar(L);
      if (!g.world.raycast(e.x, e.y, e.z, d.x, d.y, d.z, L - 0.1, 'sight')) return true;
    }
    return false;
  }
  think() {
    const g = this.game, now = g.time;
    // 感知
    let best = null, bestD = 1e9;
    for (const a of g.actors) {
      if (!a.alive || a.team === this.team) continue;
      const d = a.pos.distanceTo(this.pos) * (this.target === a ? 0.78 : 1);
      if (d > bestD) continue;
      if (this.canSee(a)) { best = a; bestD = d; }
    }
    if (best) {
      if (!this.visible || this.target !== best) {
        const [r0, r1] = this.diff.react;
        const surprise = this.target === best && now - this.lastSeenT < 1.5 ? 0.4 : 1;
        this.reactUntil = now + (r0 + Math.random() * (r1 - r0)) * surprise;
        const k = this.diff.aimErr * (0.8 + bestD / 28);
        const a = Math.random() * Math.PI * 2;
        this.errY = Math.cos(a) * k * 1.3; this.errP = Math.sin(a) * k * 0.8 - k * 0.1;
        this.aimHead = Math.random() < this.diff.headP;
        this.burst = 0; this.burstGoal = 3 + (Math.random() * 4 | 0);
        this.contactReportAt = Math.max(this.contactReportAt, now + 0.5);
      }
      this.target = best; this.visible = true; this.lastSeen = best.pos.clone(); this.lastSeenT = now;
      if (!this.cover) this.path = null;
      // Share only confirmed visual contact, with a reporting delay and stale memory.
      if (now >= this.contactReportAt) {
        this.contactReportAt = now + 1.4;
        for (const friend of g.actors) {
          if (friend === this || !friend.alive || friend.team !== this.team || !friend.hear || friend.visible) continue;
          if (friend.pos.distanceTo(this.pos) > 22) continue;
          friend.hear(this.lastSeen, true);
        }
      }
    } else {
      this.visible = false;
      if (this.target && (!this.target.alive || now - this.lastSeenT > 5)) this.target = null;
    }
    const w = this.weapon;
    const memory = this.lastSeen && now - this.lastSeenT < 6 ? this.lastSeen : this.heard && now - this.heardT < 3 ? this.heard : null;
    const wantsCover = memory && w.def.spread && (this.hp < 42 || this.suppression > 0.52 || w.reloading || w.mag <= Math.max(2, w.def.mag * 0.2));
    if (wantsCover && !this.cover && now >= this.coverSearchAt) {
      this.coverSearchAt = now + 2.3;
      const found = findCover(this, memory);
      if (found) {
        this.cover = { point: found.point, until: now + 4.5, arrived: false };
        this.path = found.path; this.pi = found.path.length > 1 ? 1 : 0;
        this.tactic = w.reloading ? 'reload' : 'cover';
      }
    }
    if (this.cover) {
      const gap = Math.hypot(this.pos.x - this.cover.point[0], this.pos.z - this.cover.point[1]);
      if (gap < 0.8) {
        this.cover.arrived = true;
        this.crouchUntil = now + 0.3;
        if (w.mag < w.def.mag * 0.65 && w.canReload()) this.startReload();
        if (!w.reloading && this.cover.until - now > 1.2) this.cover.until = now + 1.2;
      }
      this.tactic = w.reloading ? 'reload' : 'cover';
      if (now > this.cover.until && !w.reloading) {
        this.cover = null; this.path = null; this.coverSearchAt = now + 2.5;
        this.strafeDir = this.id % 2 ? 1 : -1;
      }
    }
    // 移动决策
    if (!this.visible) {
      const objective = g.objective?.active ? g.objective : null;
      const nearbyMemory = !objective || (this.lastSeen && this.lastSeen.distanceTo(objective.position) < 20);
      if (this.cover) {
        // The cover path is retained while reloading or temporarily hidden.
      } else if (objective && (this.objectiveKey !== `${objective.position.x}:${objective.position.z}` || now > this.objectivePlanAt)) {
        this.pickGoal();
      } else if (this.lastSeen && now - this.lastSeenT < 4 && this.role !== 'hold' && nearbyMemory) {
        if (!this.path || this.huntFor !== this.lastSeenT) {
          this.setPath(this.lastSeen.x, this.lastSeen.z); this.huntFor = this.lastSeenT;
        }
        this.tactic = 'search';
      } else if (this.heard && now - this.heardT < 3 && this.role !== 'hold' && Math.random() < 0.5) {
        if (!objective || this.heard.distanceTo(objective.position) < 20) this.setPath(this.heard.x, this.heard.z);
        this.lookYaw = Math.atan2(-(this.heard.x - this.pos.x), -(this.heard.z - this.pos.z));
        this.heard = null; this.tactic = 'search';
      } else if (!this.path || this.pi >= this.path.length) {
        if (objective && this.goal && Math.hypot(this.pos.x - this.goal[0], this.pos.z - this.goal[1]) < 1.2) {
          this.tactic = 'secure';
          this.holdYaw = Math.atan2(-(objective.position.x - this.pos.x), -(objective.position.z - this.pos.z)) + Math.PI;
        } else if (this.role === 'hold' && this.goal && this.pos.distanceTo(_v.set(this.goal[0], this.pos.y, this.goal[1])) < 1.2) {
          this.holdT += 0.15;
          this.tactic = 'hold';
          if (this.holdT > 25 + Math.random() * 20) { this.holdT = 0; this.pickGoal(); }
        } else { this.stage++; this.tactic = 'advance'; this.pickGoal(); }
      }
      // 换弹
      if (w.def.mag > 1 && w.mag < w.def.mag * 0.5 && w.canReload() && now - this.lastSeenT > 1.2) this.startReload();
      // 手雷
      this.nadeT -= 0.15;
      if (!this.cover && this.nadeT <= 0 && this.lastSeen && now - this.lastSeenT < 3 && this.inv[3].mag > 0) {
        const d = this.lastSeen.distanceTo(this.pos);
        const alliesNear = g.actors.some(a => a.alive && a.team === this.team && a.pos.distanceTo(this.lastSeen) < 7.5);
        if (!alliesNear && d > 9 && d < 24 && Math.random() < 0.35) { this.nadePlan = this.lastSeen.clone(); this.nadeT = 25 + Math.random() * 25; }
      }
    } else {
      // 狙击：开镜
      if (!this.cover) this.tactic = 'engage';
      if (w.def.type === 'sniper' && !this.scoped && bestD > 7 && now >= w.boltUntil) this.wantScope = true;
      if (Math.random() < 0.12 * this.diff.strafe) this.crouchUntil = now + 0.6 + Math.random() * 1.2;
    }
    // 卡住检测
    this.stuckT += 0.15;
    if (this.stuckT > 1.0) {
      const moved = this.lastCheck.distanceTo(this.pos);
      if (this.path && this.pi < this.path.length && moved < 0.35 && (!this.visible || this.cover)) {
        this.stuckN++; this.wantJump = true;
        if (this.stuckN > 2) {
          this.stuckN = 0; this.cover = null; this.stage++;
          this.lane = chooseLane(g.actors, this.team, this, g.map?.lanes || LANES); this.pickGoal();
        }
      } else this.stuckN = 0;
      this.lastCheck.copy(this.pos); this.stuckT = 0;
    }
  }
  update(dt) {
    const g = this.game, now = g.time;
    if (!this.alive) return;
    this.suppression = Math.max(0, this.suppression - dt * 0.26);
    this.thinkT -= dt;
    if (this.thinkT <= 0) { this.thinkT = 0.13 + Math.random() * 0.06; this.think(); }
    const D = this.diff;
    let wishX = 0, wishZ = 0, fire = false, firePressed = false, alt = false, crouch = now < this.crouchUntil, walk = false;
    let sw = null;
    if (!this.nadePlan && now - this.heardT > 1.6) this.lookYaw = this.lookPitch = undefined;
    // 手雷投掷流程
    if (this.nadePlan) {
      this.throwAim = this.nadePlan.clone();
      if (this.slot !== 3) sw = 3;
      else if (now >= this.readyAt && !this.pendingThrow) {
        const d = this.nadePlan.distanceTo(this.pos);
        this.lookYaw = Math.atan2(-(this.nadePlan.x - this.pos.x), -(this.nadePlan.z - this.pos.z));
        this.lookPitch = 0.25 + d * 0.012;
        if (Math.abs(wrapPi(this.yaw - this.lookYaw)) < 0.18 && Math.abs(this.pitch - this.lookPitch) < 0.18) { firePressed = true; this.nadePlan = null; }
      }
    } else if (this.slot === 3 && this.inv[3].mag <= 0 && !this.pendingThrow && !this.autoSwitchAt) sw = 0;
    if (this.slot !== 3 && sw !== 3 && !this.nadePlan) this.throwAim = null;
    // 瞄准
    let dYaw = this.yaw, dPitch = this.pitch;
    const tgt = this.target;
    // A low-frequency think tick never grants wall tracking between ticks.
    if (tgt && this.visible && (!tgt.alive || !this.canSee(tgt))) this.visible = false;
    if (tgt && tgt.alive && this.visible) {
      const e = this.eye(_v);
      const p = this.aimHead ? tgt.soldier.headWorld(_v2) : tgt.soldier.chestWorld(_v2);
      p.addScaledVector(tgt.vel, 0.08);
      const dx = p.x - e.x, dy = p.y - e.y, dz = p.z - e.z, hd = Math.hypot(dx, dz);
      const trueYaw = Math.atan2(-dx, -dz), truePitch = Math.atan2(dy, hd);
      const k = Math.exp(-D.track * dt);
      this.errY *= k; this.errP *= k;
      const wob = (0.004 + this.suppression * 0.015) * (1 + (tgt.speed || 0) / 4);
      dYaw = trueYaw + this.errY + Math.sin(now * 3.1 + this.id) * wob;
      dPitch = truePitch + this.errP + Math.cos(now * 2.7 + this.id) * wob * 0.6 - this.punchP * D.comp;
      this.lookYaw = undefined; this.lookPitch = undefined;
      // 开火判断
      const aimErr = Math.hypot(wrapPi(this.yaw - trueYaw), this.pitch - truePitch);
      const tol = Math.atan2(0.32, hd) * 1.4 + 0.01;
      const w = this.weapon, d = w.def;
      const aimDist = Math.hypot(dx, dy, dz);
      const occluded = aimDist > 0.01 && g.world.raycast(e.x, e.y, e.z, dx / aimDist, dy / aimDist, dz / aimDist, aimDist - 0.1, 'sight');
      const allyBlocking = allyInFireLane(e, p, g.actors, this);
      if (allyBlocking) this.fireBlockedUntil = now + 0.25;
      if (d.type !== 'grenade' && !occluded && !allyBlocking && now >= this.reactUntil && aimErr < tol && now >= this.readyAt && !this.nadePlan && !w.reloading) {
        if (d.type === 'sniper') { if (this.scoped && this.scopeReady && aimErr < tol * 0.6) firePressed = true; }
        else if (d.type === 'pistol') { firePressed = Math.random() < dt * 5; }
        else if (now >= this.burstPauseUntil) {
          fire = true;
        }
      }
      if (this.wantScope) { alt = true; this.wantScope = false; }
      // 横移
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafeT = 0.65 + Math.random() * 0.8; this.strafeDir = Math.random() < 0.5 ? -1 : 1; if (Math.random() < 0.2) this.strafeDir = 0; }
      const moveK = d.type === 'sniper' ? 0 : D.strafe;
      const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
      wishX = rx * this.strafeDir * moveK; wishZ = rz * this.strafeDir * moveK;
      if (fire && hd > 16) { wishX *= 0.15; wishZ *= 0.15; }
      if (hd > 22 && d.type !== 'sniper' && this.role !== 'hold') { wishX += -Math.sin(this.yaw) * 0.5; wishZ += -Math.cos(this.yaw) * 0.5; }
      if (hd < 6 && d.type !== 'smg') { wishX += Math.sin(this.yaw) * 0.7; wishZ += Math.cos(this.yaw) * 0.7; }
      if (now < this.fireBlockedUntil) { wishX += rx * (this.id % 2 ? 0.7 : -0.7); wishZ += rz * (this.id % 2 ? 0.7 : -0.7); }
      if (!g.nav.lineFree(this.pos.x, this.pos.z, this.pos.x + wishX * 0.8, this.pos.z + wishZ * 0.8)) {
        wishX *= -0.4; wishZ *= -0.4; this.strafeDir *= -1; this.strafeT = 0.6;
      }
      if (Math.random() < D.bunny * dt && this.onGround && d.type !== 'sniper') this.wantJump = true;
    } else {
      if (this.scoped && !this.visible && now - this.lastSeenT > 2) alt = true; // 收镜
      // 沿路径行走
      if (this.path && this.pi < this.path.length) {
        const wp = this.path[this.pi];
        const dx = wp[0] - this.pos.x, dz = wp[1] - this.pos.z, dd = Math.hypot(dx, dz);
        const goalY = g.nav.heightAt?.(wp[0], wp[1]) ?? this.pos.y;
        if (dd < 0.55 && Math.abs(this.pos.y - goalY) < 0.5) this.pi++;
        else { wishX = dx / dd; wishZ = dz / dd; }
        if (this.lookYaw === undefined || now - this.heardT > 1.5) dYaw = Math.atan2(-dx, -dz);
        dPitch = 0;
        walk = this.role === 'flank' && this.stage === 1;
      } else if ((this.role === 'hold' || this.tactic === 'secure') && this.holdYaw !== undefined) {
        dYaw = this.holdYaw + Math.sin(now * 0.4 + this.id) * 0.35; dPitch = -0.02;
        crouch = crouch || Math.sin(now * 0.3 + this.id) > 0.3;
      }
      if (this.lookYaw !== undefined) { dYaw = this.lookYaw; if (this.lookPitch !== undefined) dPitch = this.lookPitch; }
    }
    if (this.throwAim && (this.slot === 3 || sw === 3)) {
      dYaw = Math.atan2(-(this.throwAim.x - this.pos.x), -(this.throwAim.z - this.pos.z));
      dPitch = 0.25 + this.throwAim.distanceTo(this.pos) * 0.012;
      fire = false;
    }
    // A retreat keeps the weapon facing the threat while movement follows cover.
    if (this.cover && this.path && this.pi < this.path.length) {
      const wp = this.path[this.pi], dx = wp[0] - this.pos.x, dz = wp[1] - this.pos.z, dd = Math.hypot(dx, dz);
      const goalY = g.nav.heightAt?.(wp[0], wp[1]) ?? this.pos.y;
      if (dd < 0.65 && Math.abs(this.pos.y - goalY) < 0.5) this.pi++;
      wishX = dd > 0.01 ? dx / dd : 0; wishZ = dd > 0.01 ? dz / dd : 0;
      crouch = this.cover.arrived; walk = false;
    } else if (this.cover?.arrived) {
      wishX = wishZ = 0; crouch = true;
    }
    // 队友分离
    for (const a of g.actors) {
      if (a === this || !a.alive || a.team !== this.team || Math.abs(a.pos.y - this.pos.y) > 1.6) continue;
      const dx = this.pos.x - a.pos.x, dz = this.pos.z - a.pos.z, d2 = dx * dx + dz * dz;
      if (d2 < 3.24 && d2 > 1e-4) { const d = Math.sqrt(d2), strength = (1.8 - d) * (a.isPlayer ? 1.5 : 0.8); wishX += dx / d * strength; wishZ += dz / d * strength; }
    }
    // 转向（限速）
    const turn = D.turn * dt * (this.visible ? 1 : 0.7);
    const ey = wrapPi(dYaw - this.yaw);
    this.yaw = wrapPi(this.yaw + THREE.MathUtils.clamp(ey, -turn, turn));
    this.pitch += THREE.MathUtils.clamp(dPitch - this.pitch, -turn * 0.6, turn * 0.6);
    // 移动 & 武器
    this.move(dt, wishX, wishZ, this.wantJump, crouch, walk);
    this.wantJump = false;
    const w = this.weapon;
    const shotsBefore = this.stats.shots;
    this.weaponUpdate(dt, { fire, firePressed: firePressed || (fire && !this.fireHeld), alt, altPressed: alt, reload: false, sw });
    // Burst lengths are counted in bullets, not rendered frames.
    if (this.stats.shots > shotsBefore) {
      this.burst += this.stats.shots - shotsBefore;
      const distance = this.lastSeen ? this.lastSeen.distanceTo(this.pos) : 25;
      if (w.def.auto && distance > 12 && this.burst >= this.burstGoal) {
        this.burst = 0; this.burstGoal = 3 + (Math.random() * 4 | 0);
        this.burstPauseUntil = now + 0.22 + Math.min(0.35, distance / 120) + this.suppression * 0.3;
      }
    }
    this.fireHeld = fire;
  }
}
