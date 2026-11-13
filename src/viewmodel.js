// 第一人称武器与手臂
import * as THREE from 'three';
import { buildGun } from './guns.js';
import { WEAPON_SIGHTS, setGunWetness } from './gun-detail.js';
import { createViewArm, poseGlove, solveViewArm } from './view-hands.js';
import { createHandMaterials, setHandWetness } from './view-hand-materials.js';

const HIP = {
  ak47: { p: [0.15, -0.16, -0.53], r: [0.045, 0.165, 0.02] },
  m4a1: { p: [0.14, -0.165, -0.52], r: [0.045, 0.165, 0.02] },
  awm: { p: [0.17, -0.185, -0.6], r: [0.04, 0.15, 0.02] },
  mp5: { p: [0.135, -0.15, -0.46], r: [0.05, 0.17, 0.02] },
  deagle: { p: [0.10, -0.125, -0.35], r: [0.05, 0.1, 0] },
  knife: { p: [0.17, -0.15, -0.34], r: [0.35, -0.25, 0.55] },
  he: { p: [0.13, -0.12, -0.3], r: [0.1, -0.2, 0.2] },
};
const KICK = { ak47: [0.04, 0.07], m4a1: [0.032, 0.05], awm: [0.09, 0.2], mp5: [0.024, 0.035], deagle: [0.05, 0.22] };

const ease = (t) => t * t * (3 - 2 * t);
const seg = (f, a, b) => Math.min(1, Math.max(0, (f - a) / (b - a)));
const rotation = (x,y,z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x,y,z));
const RIGHT_GRIP = rotation(-.28,0,0).multiply(rotation(0,0,-Math.PI/2));
// Keep the right palm inward and thumb above the little finger, while sending
// the wrist down and back toward the firing elbow. Compact weapons need a more
// lateral approach because their grip sits closer to the shoulder.
const RIGHT_FIREARM_GRIPS = {
  m4a1:rotation(.55,.45,0).multiply(rotation(0,0,-Math.PI/2)),
  ak47:rotation(.55,.45,0).multiply(rotation(0,0,-Math.PI/2)),
  mp5:rotation(.65,.50,0).multiply(rotation(0,0,-Math.PI/2)),
  awm:rotation(.50,.40,0).multiply(rotation(0,0,-Math.PI/2)),
  deagle:rotation(.65,.90,0).multiply(rotation(0,0,-Math.PI/2)),
};
const RIGHT_ADS_GRIPS = {
  m4a1:rotation(.60,1.05,0).multiply(rotation(0,0,-Math.PI/2)),
  ak47:rotation(.70,.95,0).multiply(rotation(0,0,-Math.PI/2)),
  mp5:rotation(.85,1.05,0).multiply(rotation(0,0,-Math.PI/2)),
  awm:rotation(1.05,.65,0).multiply(rotation(0,0,-Math.PI/2)),
  deagle:rotation(.70,1.10,0).multiply(rotation(0,0,-Math.PI/2)),
};
// Gun-local finger-pad targets. Rifles without a separate trigger mesh use the
// open space ahead of the grip; the resting finger stays along the right side.
const RIGHT_INDEX_TARGETS = {
  m4a1:{rest:[.027,.006,-.029],fire:[.008,-.004,-.009]},
  ak47:{rest:[.026,.008,-.030],fire:[.008,-.003,-.012]},
  mp5:{rest:[.026,.005,-.025],fire:[.009,0,-.012]},
  awm:{rest:[.035,-.020,.014],fire:[.010,-.040,.036]},
  deagle:{rest:[.026,.010,-.035],fire:[.008,.004,-.035]},
};
// Palm normal (-Y) faces up; fingers cross the handguard diagonally. Pitch and
// yaw bring the wrist axis back toward the shoulder instead of bending it up.
const LEFT_SUPPORT = rotation(0,0,Math.PI-.15).multiply(rotation(-.45,.75,0));
const SIDE_SUPPORT = rotation(0,0,Math.PI/2).multiply(rotation(.10,0,0));
// A pistol's support palm closes around the firing hand, rather than reaching
// forward underneath a rifle handguard.
const PISTOL_SUPPORT = rotation(0,0,Math.PI/2).multiply(rotation(.18,-.06,0));
const LEFT_MAG = rotation(0,0,Math.PI/2).multiply(rotation(.16,0,0));
// A slight pinch yaw also avoids an exactly 180-degree, numerically ambiguous
// quaternion transition from the magazine grip to the charging handle.
// Approach the charging handle from below-left. A purely horizontal wrist axis
// forced the forearm to arch above the rifle and cover the player's sightline.
const RACK_BACK = new THREE.Vector3(-.58,-.78,.18).normalize();
const RACK_SIDE = new THREE.Vector3(0,0,1).cross(RACK_BACK).normalize();
const LEFT_RACK = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(RACK_SIDE,RACK_BACK.clone().cross(RACK_SIDE),RACK_BACK)).multiply(rotation(0,.12,0));
const RIGHT_RACK_BACK = new THREE.Vector3(.55,-.50,.67).normalize();
const RIGHT_RACK_SIDE = new THREE.Vector3(0,-1,0).addScaledVector(RIGHT_RACK_BACK,RIGHT_RACK_BACK.y).normalize();
const RIGHT_RACK = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(RIGHT_RACK_SIDE,RIGHT_RACK_BACK.clone().cross(RIGHT_RACK_SIDE),RIGHT_RACK_BACK));
const OVER_RACK = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0,0,1),new THREE.Vector3(0,1,0),new THREE.Vector3(-1,0,0)));
const GRIP_CONTACT = new THREE.Vector3(.006,-.036,-.079);
const SUPPORT_CONTACT = new THREE.Vector3(0,-.020,-.046);
const UTILITY_CONTACT = new THREE.Vector3(0,-.044,-.063);
// Contacts sit just below the actual underside of each fore-end. The palm
// carries its weight while the fingers curl around its far side.
const SUPPORT_OFFSETS = { m4a1:[.003,.0015,-.005], ak47:[0,-.003,.015], mp5:[0,-.007,.005], awm:[0,-.012,.03] };
const MAG_CONTACT = new THREE.Vector3(0,-.034,-.062);
const RACK_CONTACT = new THREE.Vector3(0,-.020,-.060);
// Grip-relative twist stays continuous across a hand rotation of 180 degrees.
// A partial slerp from one fixed resting orientation changes branches there.
const WRIST_ROLL = { cradle:0, magazine:.25, rack:.65 };
const MAGAZINE_FALLBACK = {
  m4a1:{pullAxis:[0,-1,0],clearance:.040,travel:.15,gripPoint:[0,-.09,.008]},
  ak47:{pullAxis:[0,-1,0],clearance:.030,travel:.15,gripPoint:[0,-.10,.008],rockAngle:.20,rockPivot:[0,0,-.035]},
  mp5:{pullAxis:[0,-1,0],clearance:.035,travel:.15,gripPoint:[0,-.085,.008]},
  awm:{pullAxis:[0,-1,0],clearance:.035,travel:.13,gripPoint:[0,-.035,.008]},
  deagle:{pullAxis:[0,-Math.cos(.24),-Math.sin(.24)],clearance:.105,travel:.145,gripPoint:[0,-.055,.008]},
};
const magazinePull=new THREE.Vector3(),magazinePivot=new THREE.Vector3(),magazineMovedPivot=new THREE.Vector3();
const magazineRestQ=new THREE.Quaternion(),magazineRockQ=new THREE.Quaternion(),magazineTurnQ=new THREE.Quaternion();
const magazineTurnEuler=new THREE.Euler(),magazineRockAxis=new THREE.Vector3(1,0,0);
function poseMagazine(mag,rest,f,id) {
  if(f<=.12||f>=.60) {
    mag.position.copy(rest.p);mag.rotation.copy(rest.r);mag.visible=true;return;
  }
  const fallback=MAGAZINE_FALLBACK[id]||MAGAZINE_FALLBACK.m4a1,rig=mag.userData.reload||fallback;
  const rockAngle=rig.rockAngle??fallback.rockAngle??0,rocking=Math.abs(rockAngle)>1e-6;
  const clearance=rig.clearance??fallback.clearance,travel=Math.max(clearance,rig.travel??fallback.travel);
  // No sideways motion or carrying rotation while the feed neck is in its well.
  // The reverse path finishes alignment before the final straight insertion.
  const withdrawn=ease(seg(f,rocking?.18:.12,rocking?.27:.25))*(1-ease(seg(f,.51,rocking?.57:.60)));
  const carried=ease(seg(f,rocking?.27:.25,.36))*(1-ease(seg(f,.43,.51)));
  const rocked=rocking?ease(seg(f,.12,.18))*(1-ease(seg(f,.57,.60))):0;
  magazineRestQ.setFromEuler(rest.r);mag.position.copy(rest.p);mag.quaternion.copy(magazineRestQ);
  if(rocking) {
    // The AK's front lug stays on its seat while the rear catch rocks free.
    magazineRockQ.setFromAxisAngle(magazineRockAxis,rockAngle*rocked);
    mag.quaternion.multiply(magazineRockQ);
    magazinePivot.fromArray(rig.rockPivot||fallback.rockPivot);
    magazineMovedPivot.copy(magazinePivot).applyQuaternion(mag.quaternion);
    mag.position.add(magazinePivot.applyQuaternion(magazineRestQ)).sub(magazineMovedPivot);
  }
  magazinePull.fromArray(rig.pullAxis||fallback.pullAxis).normalize();
  mag.position.addScaledVector(magazinePull,clearance*withdrawn+(travel-clearance)*carried);
  mag.position.x-=.045*carried;mag.position.z+=.015*carried;
  magazineTurnEuler.set(.18*carried,0,-.16*carried);
  mag.quaternion.multiply(magazineTurnQ.setFromEuler(magazineTurnEuler));mag.visible=true;
}

function handPose(socket, offset, frame, contact, kind, orientationSocket=socket) {
  const q=orientationSocket.getWorldQuaternion(new THREE.Quaternion()).multiply(frame);
  const anchor=socket.localToWorld(new THREE.Vector3(...offset));
  return {p:anchor.clone().sub(contact.clone().applyQuaternion(q)),q,contact:anchor,localContact:contact,kind,socket,wristRoll:WRIST_ROLL[kind]||0,restWeight:kind==='magazine'||kind==='rack'?0:1};
}
function blendHands(a,b,t,bow=new THREE.Vector3()) {
  const u=ease(THREE.MathUtils.clamp(t,0,1));
  // Use the entire free transfer to turn the palm; compressing the rotation
  // forces the wrist ahead of the elbow even when both endpoint grips fit.
  const turn=u;
  // Release the resting elbow as soon as the hand leaves the gun. Attract it
  // again only on the return; competing with a departing hand twists the arm.
  const restWeight=b.restWeight===0?(u===0?a.restWeight:0):THREE.MathUtils.lerp(a.restWeight,b.restWeight,u);
  return {p:a.p.clone().lerp(b.p,u).addScaledVector(bow,Math.sin(Math.PI*u)),q:a.q.clone().slerp(b.q,turn),contact:a.contact.clone().lerp(b.contact,u),kind:a.kind,other:b.kind,blend:turn,open:Math.sin(Math.PI*u)*.32,socket:u===1?b.socket:u===0?a.socket:null,wristRoll:THREE.MathUtils.lerp(a.wristRoll||0,b.wristRoll||0,u),restWeight,indexGrip:a.indexGrip||b.indexGrip};
}

export class ViewModel {
  constructor(scene, T, team) {
    this.scene = scene;
    this.rig = new THREE.Group();
    scene.add(this.rig);
    this.holder = new THREE.Group();
    this.rig.add(this.holder);
    this.guns = {};
    this.cur = null; this.id = null;
    this.rightGripFrame=new THREE.Quaternion();
    this.rightIndexInverse=new THREE.Quaternion();this.rightIndexGunQ=new THREE.Quaternion();
    this.rightIndex={rest:new THREE.Vector3(),fire:new THREE.Vector3(),pole:new THREE.Vector3()};
    // 灯光（方向每帧同步到相机空间）
    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.position.set(0.5, 1, 0.3);
    scene.add(this.sun);
    this.fill = new THREE.HemisphereLight(0xcfe2f4, 0x40464c, 0.35);
    scene.add(this.fill);
    this.muzzleLight = new THREE.PointLight(0xffb060, 0, 1.5, 2);
    scene.add(this.muzzleLight);
    // 手臂
    this.handMaterials = createHandMaterials();
    this.gloveMat = this.handMaterials.glove;
    this.sleeveMat = this.handMaterials.sleeve;
    this.arms = {};
    for (const s of ['R', 'L']) {
      this.arms[s] = createViewArm(s, [this.gloveMat, this.handMaterials.skin, this.handMaterials.nail], this.sleeveMat);
      this.rig.add(this.arms[s].g);
    }
    // 枪口火焰
    const fm = (tex) => new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, color: 0xffd9a0 });
    this.flashTex = T.flash;
    this.flash = new THREE.Group();
    this.flashFront = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), fm(T.flash[0]));
    this.flashSide1 = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.07), fm(T.flashSide));
    this.flashSide2 = this.flashSide1.clone();
    this.flashSide1.rotation.y = Math.PI / 2; this.flashSide1.position.z = -0.1;
    this.flashSide2.rotation.set(0, Math.PI / 2, Math.PI / 2); this.flashSide2.position.z = -0.1;
    this.flashSide1.geometry = this.flashSide1.geometry.clone().rotateZ(Math.PI);
    this.flash.add(this.flashFront, this.flashSide1, this.flashSide2);
    this.flash.visible = false;
    this.flash.renderOrder = 10;
    // 状态
    this.t = 0;
    this.kick = 0; this.kickV = 0; this.kickRot = 0; this.kickRotV = 0;
    this.sway = new THREE.Vector2(); this.swayV = new THREE.Vector2();
    this.bobT = 0; this.bobK = 0;
    this.land = 0; this.roll = 0; this.rollV = 0; this.yawKick = 0; this.yawV = 0;
    this.landing = 0; this.landingV = 0; this.wasGround = true; this.lastVy = 0; this.ads = 0; this.wetness = .85; this.boltT = 9;
    this.drawT = 1; this.drawDur = 0.5;
    this.anim = null; // {type, t, dur, empty, heavy}
    this.flashT = 0;
    this.setTeam(team);
    this.visible = true;
  }
  setTeam(team) {
    this.team = team;
    this.sleeveMat.color.set(team === 'GR' ? 0x687782 : 0x817765);
  }
  equip(id, drawTime) {
    if (!this.guns[id]) {
      const g = buildGun(id, { firstPerson: true });
      g.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
      this.guns[id] = g;
    }
    if (this.cur) { this.resetParts(); this.holder.remove(this.cur); }
    this.pendingCase = false;
    this.cur = this.guns[id]; this.id = id;
    this.holder.add(this.cur);
    this.cur.visible = true;
    this.parts = {};
    this.cur.traverse((o) => { if (o.name) this.parts[o.name] = o; });
    this.partRest = this.cur.userData.partRest ||= {};
    for (const k of ['mag', 'bolt', 'slide', 'carrier', 'pin', 'lever']) if (this.parts[k] && !this.partRest[k]) this.partRest[k] = { p: this.parts[k].position.clone(), r: this.parts[k].rotation.clone() };
    const mz = this.parts.muzzle;
    if (mz) { mz.add(this.flash); }
    this.drawT = 0; this.drawDur = drawTime || 0.5;
    this.anim = null;
    this.kick = this.kickV = this.kickRot = this.kickRotV = this.roll = this.rollV = this.yawKick = this.yawV = 0;
    this.ads = 0; this.boltT = 9;
    for (const arm of Object.values(this.arms)) {
      arm.poseReady = false;
      // A new weapon starts a new reach, not the old weapon's elbow branch.
      arm.ikReady = false;
    }
    this.resetParts();
  }
  fire() {
    const k = KICK[this.id] || [0.03, 0.05];
    const control = 1 - .4 * this.ads;
    this.kickV += k[0] * 29 * control; this.kickRotV += k[1] * 24 * control;
    this.rollV += (Math.random() - .5) * .6 * control; this.yawV += (Math.random() - .5) * .3 * control; this.boltT = 0;
    this.flashT = 0.05;
    this.flash.visible = true;
    this.flashFront.material.map = this.flashTex[(Math.random() * 3) | 0];
    this.flashFront.rotation.z = Math.random() * Math.PI;
    const sc = this.id === 'awm' ? 1.6 : this.id === 'deagle' ? 1.2 : this.id === 'mp5' ? 0.8 : 1;
    this.flash.scale.setScalar(sc * (0.8 + Math.random() * 0.45));
    if (this.id === 'awm') { this.pendingCase = true; this.anim = { type: 'bolt', t: 0, dur: 1.3 }; }
    if (this.id === 'deagle' && this.parts.slide) this.slideT = 0.09;
  }
  socketWorld(name, camera, viewCamera, out = new THREE.Vector3()) {
    this.holder.updateMatrixWorld(true);
    const socket = this.parts?.[name];
    if (!socket) return out.copy(camera.position);
    socket.getWorldPosition(out);
    const ratio = Math.tan(THREE.MathUtils.degToRad(camera.fov)*.5) / Math.tan(THREE.MathUtils.degToRad(viewCamera.fov)*.5);
    out.x *= ratio; out.y *= ratio;
    return out.applyQuaternion(camera.quaternion).add(camera.position);
  }
  muzzleWorld(camera, viewCamera, out) { return this.socketWorld('muzzle', camera, viewCamera, out); }
  ejectionWorld(camera, viewCamera, out) { return this.socketWorld('eject', camera, viewCamera, out); }
  reload(dur, empty) { this.resetParts(); this.anim = { type: 'reload', t: 0, dur, empty, extract: !!this.pendingCase, phases: {} }; }
  melee(heavy) { this.anim = { type: heavy ? 'stab' : 'slash', t: 0, dur: heavy ? 0.85 : 0.38, dir: Math.random() > 0.5 ? 1 : -1 }; }
  throwNade() { this.anim = { type: 'throw', t: 0, dur: 0.75 }; }
  inspect() { if (!this.anim) this.anim = { type: 'inspect', t: 0, dur: 2.6 }; }
  cancelAnim() { if (this.anim && this.anim.type !== 'bolt') this.anim = null; this.resetParts(); }
  resetParts() {
    for (const k in this.partRest) { this.parts[k].position.copy(this.partRest[k].p); this.parts[k].rotation.copy(this.partRest[k].r); this.parts[k].visible = true; }
  }
  setVisible(v) { this.rig.visible = v; }

  // st.ads is already smoothed by Actor. Sight anchors are on the camera's -Z axis at ADS=1.
  update(dt, st) {
    dt = Math.max(0, Math.min(.06, Number(dt) || 0));
    this.t += dt;
    if (!this.cur) return;
    const id = this.id, hip = HIP[id] || HIP.ak47;
    const adsTarget = THREE.MathUtils.clamp(st.ads || 0, 0, 1);
    const ads = this.anim?.type === 'reload' || this.anim?.type === 'inspect' ? Math.min(adsTarget, this.ads * Math.exp(-dt * 22)) : adsTarget;
    this.ads = ads;
    const sight = WEAPON_SIGHTS[id];
    const steadiness = 1 - ads * .88;
    const springSteps = Math.max(1, Math.ceil(dt / .008)), h = dt / springSteps;
    for (let i = 0; i < springSteps; i++) {
      this.kickV += (-420 * this.kick - 29 * this.kickV) * h; this.kick += this.kickV * h;
      this.kickRotV += (-330 * this.kickRot - 24 * this.kickRotV) * h; this.kickRot += this.kickRotV * h;
      this.rollV += (-250 * this.roll - 21 * this.rollV) * h; this.roll += this.rollV * h;
      this.yawV += (-280 * this.yawKick - 22 * this.yawV) * h; this.yawKick += this.yawV * h;
      this.landingV += (-170 * this.landing - 17 * this.landingV) * h; this.landing += this.landingV * h;
    }
    const tx = THREE.MathUtils.clamp(-(st.lookDX || 0) * .00032, -.025, .025);
    const ty = THREE.MathUtils.clamp((st.lookDY || 0) * .00032, -.022, .022);
    this.sway.x += (tx - this.sway.x) * (1 - Math.exp(-dt * 9));
    this.sway.y += (ty - this.sway.y) * (1 - Math.exp(-dt * 9));
    const moving = st.onGround && st.speed > .3;
    this.bobK += ((moving ? Math.min(1, st.speed / 5.7) : 0) - this.bobK) * (1 - Math.exp(-dt * 8));
    this.bobT += dt * (moving ? 5.2 + st.speed * 1.55 : 0);
    const bx = Math.sin(this.bobT) * .0065 * this.bobK * steadiness;
    const by = (Math.sin(this.bobT * 2) * .0035 - Math.pow(.5 + .5 * Math.cos(this.bobT * 2 + .6), 4) * .0042) * this.bobK * steadiness;
    const breathe = Math.sin(this.t * 1.6) * .0013 * (1 - ads);
    if (this.wasGround && !st.onGround && st.velocityY > 1) this.landingV -= .15;
    if (!this.wasGround && st.onGround) this.landingV -= THREE.MathUtils.clamp(-this.lastVy * .045, 0, .55);
    this.wasGround = st.onGround;
    if (!st.onGround) this.lastVy = st.velocityY || 0;
    this.drawT = Math.min(1, this.drawT + dt / this.drawDur);
    const dr = 1 - ease(this.drawT);
    let px = THREE.MathUtils.lerp(hip.p[0], 0, ads) + bx + this.sway.x * steadiness;
    let py = THREE.MathUtils.lerp(hip.p[1], sight ? -sight.y : hip.p[1], ads) + by + breathe + this.sway.y * steadiness - dr * .19 + this.landing;
    let pz = THREE.MathUtils.lerp(hip.p[2], sight?.z ?? hip.p[2], ads) + this.kick;
    let rx = hip.r[0] * (1 - ads) + this.kickRot - dr * .75 + this.sway.y * 1.2 * steadiness + this.landing * 1.8;
    let ry = hip.r[1] * (1 - ads) + this.sway.x * 1.5 * steadiness + this.yawKick;
    let rz = hip.r[2] * (1 - ads) + bx * 1.8 + this.roll - (st.crouch ? .018 * (1 - ads) : 0);
    const P = this.parts, R = this.partRest;
    let reloadFraction = null, boltFraction = null, throwFraction = null;
    this.boltT += dt;
    const cycle = this.boltT < .085 ? Math.sin(Math.PI * this.boltT / .085) : 0;
    if (P.carrier && R.carrier) P.carrier.position.z = R.carrier.p.z + cycle * .045;
    if (P.slide && R.slide) P.slide.position.z = R.slide.p.z + Math.max(cycle * .037, st.ammo === 0 ? .031 : 0);
    const a = this.anim;
    if (a) {
      if (a.type === 'reload' && Number.isFinite(st.reloadProgress)) a.t = THREE.MathUtils.clamp(st.reloadProgress, 0, 1) * a.dur;
      else a.t += dt;
      const f = Math.min(1, a.t / a.dur);
      if (a.type === 'reload') {
        reloadFraction = f;
        const tilt = ease(seg(f, 0, .13)) * (1 - ease(seg(f, .88, 1)));
        // Present the magwell toward the camera and keep the hand in the lower third.
        const longGun = id !== 'deagle';
        rz -= tilt * (longGun ? .72 : .4); ry += tilt * (longGun ? .27 : .20);
        rx += tilt * .07; py += tilt * (longGun ? .105 : .08); px -= tilt * .055; pz -= tilt * (longGun ? .14 : .10);
        const phase = (name, time) => {
          if (f < time || a.phases?.[name]) return;
          (a.phases ||= {})[name] = true;
          this.onAction?.({ type: 'reload', phase: name, weapon: id, empty: a.empty });
        };
        phase('magout', .12); phase('magin', .60); phase('tap', .66);
        if (a.empty || a.extract) { phase('boltback', .82); phase('boltforward', .88); }
        if (P.mag) {
          poseMagazine(P.mag,R.mag,f,id);
          // Keep the transported magazine visible while the fingers grasp it.
          if (f > .60 && f < .63) this.kickRotV -= dt * 1.8;
        }
        if (P.bolt && R.bolt) P.bolt.position.copy(R.bolt.p);
        if ((a.empty || a.extract) && f >= .71 && f < .95) {
          const pull = ease(seg(f,.74,.82)) * (1 - ease(seg(f,.86,.88)));
          const socket = id === 'deagle' ? P.slide : P.bolt;
          const rest = id === 'deagle' ? R.slide : R.bolt;
          if (socket && rest) {
            socket.position.z = rest.p.z + pull * (id === 'deagle' ? .036 : .067);
            // The M4 handle pulls the carrier through the receiver aperture.
            // Keep an active firing cycle if it is farther back than the handle.
            if (id === 'm4a1' && P.carrier && R.carrier) P.carrier.position.z = R.carrier.p.z + Math.max(cycle * .045, pull * .067);
            rz -= pull * .12;
          }
          if (a.extract && f >= .82 && this.pendingCase) { this.pendingCase = false; this.onAction?.({type:'shell',weapon:id}); }
          if (f >= .88 && !a.released) { a.released = true; this.kickV -= .11; this.kickRotV += .15; }
        }
        if (id === 'deagle' && P.slide && f > .88) P.slide.position.copy(R.slide.p);
      } else if (a.type === 'bolt' && P.bolt) {
        boltFraction = f;
        const f2 = seg(f,.15,.85);
        const up = ease(seg(f2,0,.2)) * (1 - ease(seg(f2,.8,1)));
        const back = ease(seg(f2,.2,.45)) * (1 - ease(seg(f2,.55,.8)));
        P.bolt.rotation.z = up * 1.2; P.bolt.position.z = R.bolt.p.z + back * .09;
        rz += Math.sin(f2 * Math.PI) * .16; rx += Math.sin(f2 * Math.PI) * .05;
        if (f2 >= .2 && !a.pullSound) { a.pullSound = true; this.onAction?.({type:'mechanism',weapon:id,phase:'boltback'}); }
        if (f2 >= .55 && !a.releaseSound) { a.releaseSound = true; this.onAction?.({type:'mechanism',weapon:id,phase:'boltforward'}); }
        if (back > .5 && !a.ejected) { a.ejected = true; this.pendingCase = false; this.onAction?.({type:'shell',weapon:id}); }
      } else if (a.type === 'slash') {
        const sl=Math.sin(f*Math.PI),dir=a.dir;ry+=dir*(f-.5)*-2.2;rz+=dir*sl*-.6;px+=dir*(.5-f)*.12;pz-=sl*.08;rx+=sl*.3;
      } else if (a.type === 'stab') {
        const wind=ease(seg(f,0,.35)),thrust=ease(seg(f,.35,.55)),ret=ease(seg(f,.65,1));pz+=wind*.08-thrust*.22+ret*.14;rx+=wind*-.4+thrust*.9-ret*.5;py+=wind*.05-thrust*.04;
      } else if (a.type === 'throw') {
        throwFraction = f;
        const pin=seg(f,0,.3),wind=ease(seg(f,.3,.55)),thr=ease(seg(f,.55,.8));if(P.pin)P.pin.visible=pin<.6;
        py+=wind*.08-thr*.12;pz+=wind*.1-thr*.3;rx+=wind*.8-thr*1.6;if(f>.72)this.cur.visible=false;
      } else if (a.type === 'inspect') {
        const s1=ease(seg(f,0,.25))*(1-ease(seg(f,.8,1))),s2=ease(seg(f,.4,.6))*(1-ease(seg(f,.8,1)));ry+=s1*.9-s2*1.1;rz+=s1*.5;px-=s1*.08;py+=s1*.04;rx+=s2*.3;
      }
      if(f>=1){this.anim=null;this.resetParts();if(a.type==='throw')this.cur.visible=false;}
    }
    this.holder.position.set(px,py,pz);this.holder.rotation.set(rx,ry,rz);this.holder.updateMatrixWorld(true);
    // Each pose pins a point inside the curled fingers to a weapon contact.
    // Wrist positions are derived from that contact, not placed inside the gun.
    const rightKind=id==='knife'?'knife':id==='he'?'grenade':'grip';
    const rightFrame=RIGHT_FIREARM_GRIPS[id]
      ?this.rightGripFrame.copy(RIGHT_FIREARM_GRIPS[id]).slerp(RIGHT_ADS_GRIPS[id],ads):RIGHT_GRIP;
    let right=handPose(P.grip||this.cur,[0,0,0],rightFrame,GRIP_CONTACT,rightKind);
    const indexTargets=RIGHT_INDEX_TARGETS[id];
    if(indexTargets){
      this.rightIndexInverse.copy(right.q).invert();
      this.cur.getWorldQuaternion(this.rightIndexGunQ);
      for(const state of ['rest','fire'])this.rightIndex[state].fromArray(indexTargets[state])
        .applyMatrix4(this.cur.matrixWorld).sub(right.p).applyQuaternion(this.rightIndexInverse);
      this.rightIndex.pole.set(1,0,0).applyQuaternion(this.rightIndexGunQ).applyQuaternion(this.rightIndexInverse);
      right.indexGrip=this.rightIndex;
    }
    const pistol=id==='deagle',rifle=Object.hasOwn(SUPPORT_OFFSETS,id);
    const supportContact=pistol?new THREE.Vector3(0,-.038,-.067):(rifle?SUPPORT_CONTACT:UTILITY_CONTACT).clone();
    const supportOffset=rifle?SUPPORT_OFFSETS[id]:id==='he'?[-.045,-.02,0]:pistol?[.008,-.002,.005]:[0,-.024,0];
    const support=handPose(P.fore||P.grip||this.cur,supportOffset,pistol?PISTOL_SUPPORT:rifle?LEFT_SUPPORT:SIDE_SUPPORT,supportContact,id==='he'?'grenade':pistol?'pistol-support':rifle?'cradle':'support');
    let left=support;
    if(reloadFraction!==null&&P.mag){
      const f=reloadFraction,gripPoint=P.mag.userData.reload?.gripPoint||MAGAZINE_FALLBACK[id]?.gripPoint||[0,-.08,.008];
      const tap=Math.sin(seg(f,.60,.68)*Math.PI)*.013;
      const mag=handPose(P.mag,[gripPoint[0],gripPoint[1]+tap,gripPoint[2]],LEFT_MAG,MAG_CONTACT,'magazine');
      const travel=new THREE.Vector3(-.035,-.035,.035);
      if(f<.12)left=blendHands(support,mag,seg(f,.015,.12),travel);
      else if(f<=.68)left=mag;
      else if(a.empty||a.extract){
        const over=id==='deagle'||id==='ak47',socket=id==='deagle'?P.slide:P.bolt;
        const offset=id==='deagle'?[0,.105,-.045]:id==='ak47'?[0,.006,0]:[-.012,.003,.004];
        const rack=socket?handPose(socket,offset,over?OVER_RACK:LEFT_RACK,RACK_CONTACT,'rack'):support;
        if(f<.765)left=blendHands(mag,rack,seg(f,.68,.765),new THREE.Vector3(-.045,.055,.03));
        else if(f<.885)left=rack;
        else left=blendHands(rack,support,seg(f,.885,1),new THREE.Vector3(-.055,-.025,.02));
      }else left=blendHands(mag,support,seg(f,.68,.97),travel);
    }
    if(boltFraction!==null&&P.bolt){
      // Fingers follow the handle's arc, but the wrist is not welded to its
      // mechanical 1.2-radian rotation around the rifle's longitudinal axis.
      const f=boltFraction,rack=handPose(P.bolt,[.04,0,0],RIGHT_RACK,RACK_CONTACT,'rack',this.cur);
      if(f<.29)right=blendHands(right,rack,seg(f,.08,.29),new THREE.Vector3(.04,.015,.025));
      else if(f<.71)right=rack;
      else right=blendHands(rack,right,seg(f,.71,.94),new THREE.Vector3(.045,-.02,.015));
    }
    if(throwFraction!==null){
      const pin=handPose(this.cur,[.024,.052,0],LEFT_RACK,RACK_CONTACT,'rack');
      left=throwFraction<.28?blendHands(support,pin,seg(throwFraction,0,.12),new THREE.Vector3(-.02,.02,.025)):blendHands(pin,support,seg(throwFraction,.28,.48),new THREE.Vector3(-.10,-.02,.025));
      if(throwFraction>.62)right.open=seg(throwFraction,.62,.78);
    }
    const shift=this.holder.position.clone().sub(new THREE.Vector3(...hip.p));
    this.placeArm('R',right,dt,st.fireHeld&&reloadFraction===null?1:0,shift);
    this.arms.L.g.visible=id!=='knife';
    if(id!=='knife')this.placeArm('L',left,dt,0,shift);
    if(this.flashT>0){this.flashT-=dt;this.flash.visible=this.flashT>0;this.flash.getWorldPosition(this.muzzleLight.position);this.muzzleLight.intensity=this.flashT>0?2.8:0;}
    this.wetness += ((st.wetness ?? .85) - this.wetness) * (1 - Math.exp(-dt * ((st.wetness ?? .85) > this.wetness ? .8 : .08)));
    setGunWetness(this.cur,this.wetness);
    setHandWetness(this.handMaterials,this.wetness);
    if(st.sunDirCam)this.sun.position.copy(st.sunDirCam);
    this.sun.intensity=1.75*(st.light??1);this.fill.intensity=.42*(st.indoor?.65:1);
  }
  placeArm(s, pose, dt, trigger, shift) {
    const A = this.arms[s];
    poseGlove(A,pose.kind,trigger,dt,pose.other,pose.blend||0,pose.open||0,pose.indexGrip);
    // Each grip has its own wrist twist. Interpolating that scalar lets the palm
    // turn relative to the forearm without a shortest-arc branch discontinuity.
    const forearmReference=pose.q.clone().multiply(rotation(0,0,-(pose.wristRoll||0)));
    // Recover the authored elbow together with the palm's return to its grip.
    // Free magazine/bolt handling keeps the continuous action solution.
    solveViewArm(A,pose.p,pose.q,shift,{forearmQuaternion:forearmReference,wristFlexLimit:28,restWeight:pose.restWeight,dt});
    A.contact.copy(pose.contact);A.graspSocket=pose.socket;A.poseKind=pose.kind;A.poseBlend=pose.blend||0;
    A.localContact=pose.localContact||null;
  }
}
