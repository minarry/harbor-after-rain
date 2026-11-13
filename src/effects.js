// 特效：粒子、贴花、曳光、枪口火焰、爆炸、烟囱排烟、海鸥
import * as THREE from 'three';
import { BallisticPool, RipplePool } from './impact-pools.js';

class Particles {
  constructor(scene, tex, additive, max) {
    this.max = max;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, scale: { value: 800 } },
      vertexShader: `attribute float size; attribute vec4 color; varying vec4 vC; uniform float scale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec4 vC;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC.rgb * t.rgb, vC.a * t.a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 5 : 4;
    scene.add(this.points);
    // 模拟数据
    this.p = []; // {x,y,z,vx,vy,vz,life,max,s0,s1,r,g,b,a0,a1,grav,drag}
  }
  emit(o) { if (this.p.length < this.max) this.p.push(o); else this.p[(Math.random() * this.max) | 0] = o; }
  clear() { this.p.length = 0; this.geo.setDrawRange(0, 0); }
  update(dt) {
    const P = this.p;
    let n = 0;
    for (let i = 0; i < P.length; i++) {
      const q = P[i];
      q.life += dt;
      if (q.life >= q.max) continue;
      const dr = Math.exp(-q.drag * dt);
      q.vx *= dr; q.vy = q.vy * dr - q.grav * dt; q.vz *= dr;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      if (q.floor !== undefined && q.y < q.floor) { q.y = q.floor; q.vy *= -0.3; q.vx *= 0.5; q.vz *= 0.5; }
      const t = q.life / q.max;
      this.pos[n * 3] = q.x; this.pos[n * 3 + 1] = q.y; this.pos[n * 3 + 2] = q.z;
      this.col[n * 4] = q.r; this.col[n * 4 + 1] = q.g; this.col[n * 4 + 2] = q.b;
      this.col[n * 4 + 3] = q.a0 + (q.a1 - q.a0) * t;
      this.size[n] = q.s0 + (q.s1 - q.s0) * t;
      P[n] = q; n++;
    }
    P.length = n;
    this.geo.setDrawRange(0, n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
  }
}

class Decals {
  constructor(scene, tex, max, opts = {}) {
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: 0.9, metalness: 0, ...opts });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, max);
    this.mesh.count = 0; this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.max = max; this.i = 0;
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.q2 = new THREE.Quaternion();
  }
  add(p, n, size) {
    const q = this.q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    q.multiply(this.q2.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.random() * Math.PI * 2));
    this.m.compose(new THREE.Vector3(p.x + n.x * 0.004, p.y + n.y * 0.004, p.z + n.z * 0.004), q, new THREE.Vector3(size, size, size));
    this.mesh.setMatrixAt(this.i % this.max, this.m);
    this.i++;
    this.mesh.count = Math.min(this.i, this.max);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  clear() { this.i = 0; this.mesh.count = 0; }
}

function tracerTex() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 16;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 16);
  g.addColorStop(0, 'rgba(255,220,150,0)'); g.addColorStop(0.5, 'rgba(255,245,210,1)'); g.addColorStop(1, 'rgba(255,220,150,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 16);
  const g2 = x.createLinearGradient(0, 0, 64, 0);
  g2.addColorStop(0, 'rgba(0,0,0,1)'); g2.addColorStop(1, 'rgba(0,0,0,0)');
  x.globalCompositeOperation = 'destination-out'; x.fillStyle = g2; x.fillRect(0, 0, 64, 16);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Effects {
  constructor(scene, T, camera) {
    this.scene = scene; this.camera = camera; this.T = T;
    this.add = new Particles(scene, T.glow, true, 900);
    this.smoke = new Particles(scene, T.puff, false, 900);
    this.sparks = new BallisticPool(scene, { max: 180, stretch: true,
      geometry: new THREE.CylinderGeometry(0.5, 0.5, 1, 4),
      material: new THREE.MeshBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }),
    });
    this.sparks.mesh.renderOrder = 5;
    this.droplets = new BallisticPool(scene, { max: 160, stretch: true,
      geometry: new THREE.SphereGeometry(0.5, 4, 3),
      material: new THREE.MeshStandardMaterial({ color: 0xd5edf1, roughness: 0.16, metalness: 0.25, transparent: true, opacity: 0.8, depthWrite: false }),
    });
    this.droplets.mesh.name = 'impact-water-drops';
    this.fragments = new BallisticPool(scene, { max: 160, collide: true,
      geometry: new THREE.BoxGeometry(1, 1, 1), material: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.3 }),
    });
    const profile = [[0, -.025], [.0065, -.025], [.0065, -.022], [.0055, -.021], [.0055, .012], [.0042, .017], [.0042, .025], [.0032, .025], [.0032, .019]];
    this.shells = new BallisticPool(scene, { max: 80, collide: true,
      geometry: new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), 8),
      material: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.86 }),
    });
    this.shells.mesh.name = 'brass-shells';
    this.shells.onCollision = (p, surface, energy) => this.onShellImpact?.(p, surface, energy);
    this.ripples = new RipplePool(scene);
    this._p = new THREE.Vector3(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3();
    this._n = new THREE.Vector3(); this._reflection = new THREE.Vector3();
    this._shellScale = new THREE.Vector3(1, 1, 1);
    this._sparkColor = new THREE.Color().setRGB(4.8, 2.3, 0.45);
    this._waterColor = new THREE.Color().setRGB(0.75, 1.05, 1.2);
    this.decals = {
      metal: new Decals(scene, T.holeMetal, 160),
      wood: new Decals(scene, T.holeWood, 100),
      blood: new Decals(scene, T.blood, 60),
      scorch: new Decals(scene, T.scorch, 12),
    };
    // 曳光
    this.tracerMax = 48;
    this.tracers = [];
    this.tracerMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: tracerTex(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: 0xffe0a0, toneMapped: false }), this.tracerMax);
    this.tracerMesh.frustumCulled = false; this.tracerMesh.count = 0; this.tracerMesh.renderOrder = 6;
    scene.add(this.tracerMesh);
    // 第三人称枪口火焰
    this.flashes = [];
    for (let i = 0; i < 12; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.flash[i % 3], blending: THREE.AdditiveBlending, depthWrite: false, color: 0xffd8a0, toneMapped: false }));
      s.visible = false; s.renderOrder = 7; scene.add(s);
      this.flashes.push({ s, t: 0 });
    }
    this.flashI = 0;
    // 动态点光源池
    this.lights = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffa850, 0, 9, 2);
      scene.add(l); this.lights.push({ l, t: 0, peak: 0, dur: 0.06 });
    }
    this.lightI = 0;
    this.shake = 0;
    this.funnelT = 0;
    this.birds = [];
  }
  setWorld(world) { this.world = world; this.shells.world = world; this.fragments.world = world; }
  setWaterHeightSampler(fn) {
    this.waterHeight = typeof fn === 'function' ? fn : null;
    this.ripples.waterHeight = this.waterHeight;
    this.shells.waterHeight = this.waterHeight; this.fragments.waterHeight = this.waterHeight;
  }
  ejectShell(pos, dir, velocity) {
    const rightX = -dir.z, rightZ = dir.x;
    const horizontal = Math.hypot(rightX, rightZ) || 1;
    const speed = 1.6 + Math.random() * 0.8;
    this._v.set(rightX / horizontal * speed, 1.1 + Math.random() * 0.8, rightZ / horizontal * speed);
    this._v.addScaledVector(dir, -0.5 + Math.random() * 0.3);
    if (velocity) this._v.addScaledVector(velocity, 0.6);
    this.shells.emit({ p: pos, v: this._v, scale: this._shellScale, color: 0xbca15b, life: 5.5, drag: 0.12, shell: true });
  }
  resetTransient() {
    this.add.clear(); this.smoke.clear(); this.sparks.clear(); this.droplets.clear(); this.fragments.clear(); this.shells.clear(); this.ripples.clear();
    for (const decal of Object.values(this.decals)) decal.clear();
    this.tracers.length = 0; this.tracerMesh.count = 0;
    for (const f of this.flashes) { f.t = 0; f.s.visible = false; }
    for (const l of this.lights) { l.t = 0; l.l.intensity = 0; }
    this.shake = 0;
  }
  stats() {
    const active = pool => pool.items.reduce((n, p) => n + (p.active ? 1 : 0), 0);
    return { activeShells: active(this.shells), activeDebris: active(this.fragments), activeRipples: active(this.ripples),
      activeSparks: active(this.sparks), activeDroplets: active(this.droplets), particleCount: this.add.p.length + this.smoke.p.length,
      tracerCount: this.tracers.length, decalCount: Object.values(this.decals).reduce((n, d) => n + d.mesh.count, 0),
      effectCapacity: { shells: this.shells.max, debris: this.fragments.max, ripples: this.ripples.max,
        sparks: this.sparks.max, droplets: this.droplets.max, particles: this.add.max + this.smoke.max, tracers: this.tracerMax } };
  }
  light(pos, intensity, dur, color = 0xffa850, dist = 9) {
    const L = this.lights[this.lightI++ % this.lights.length];
    L.l.position.copy(pos); L.l.color.set(color); L.l.distance = dist;
    L.t = dur; L.dur = dur; L.peak = intensity; L.l.intensity = intensity;
  }
  muzzle(pos, dir, big = 1) {
    const F = this.flashes[this.flashI++ % this.flashes.length];
    F.s.position.copy(pos).addScaledVector(dir, 0.06);
    F.s.material.rotation = Math.random() * 6.28;
    F.s.scale.setScalar(0.45 * big * (0.8 + Math.random() * 0.4));
    F.s.visible = true; F.t = 0.05;
    this.light(pos, 6 * big, 0.06);
    // 枪口烟
    this.smoke.emit({ x: pos.x, y: pos.y, z: pos.z, vx: dir.x * 1.5, vy: 0.4, vz: dir.z * 1.5, life: 0, max: 0.7, s0: 0.1, s1: 0.5, r: 0.7, g: 0.7, b: 0.7, a0: 0.18, a1: 0, grav: -0.3, drag: 3 });
  }
  tracer(from, to) {
    const d = to.clone().sub(from); const L = d.length();
    if (L < 2) return;
    d.divideScalar(L);
    this.tracers.push({ from: from.clone(), dir: d, len: L, t: 0 });
    if (this.tracers.length > this.tracerMax) this.tracers.shift();
  }
  impact(p, n, mat, dir) {
    this._n.copy(n || new THREE.Vector3(0, 1, 0)).normalize();
    this._reflection.copy(dir || this._n).reflect(this._n).normalize();
    // The ricochet cone follows the incoming ray, with an outward bias so chips never enter the wall.
    this._reflection.multiplyScalar(0.65).addScaledVector(this._n, 0.8).normalize();
    const nx = this._n.x, ny = this._n.y, nz = this._n.z;
    this._p.copy(p).addScaledVector(this._n, 0.025);
    const origin = this._p;
    if (mat === 'water') { this.splash(p, 1, true); return; }
    if (mat === 'flesh') {
      for (let i = 0; i < 5; i++) this.smoke.emit({ x: origin.x, y: origin.y, z: origin.z,
        vx: nx * 0.7 + (Math.random() - 0.5), vy: ny * 0.5 + Math.random() * 0.5, vz: nz * 0.7 + (Math.random() - 0.5),
        life: 0, max: 0.2 + Math.random() * 0.16, s0: 0.045, s1: 0.18,
        r: 0.24, g: 0.018, b: 0.012, a0: 0.6, a1: 0, grav: 1.2, drag: 4 });
      return;
    }
    const metal = mat === 'metal' || mat === 'deck' || mat === 'armor';
    if (metal) {
      this.sparkBurst(origin, this._reflection, mat === 'metal' ? 10 : mat === 'armor' ? 5 : 3);
      this.add.emit({ x: origin.x, y: origin.y, z: origin.z, vx: 0, vy: 0, vz: 0, life: 0,
        max: 0.045, s0: mat === 'metal' ? 0.2 : 0.13, s1: 0.04, r: 2.5, g: 1.7, b: 0.6, a0: 0.8, a1: 0, grav: 0, drag: 0 });
      if (mat !== 'armor') this.decals.metal.add(p, this._n, 0.12 + Math.random() * 0.04);
      if (mat === 'deck') this.splash(p, 0.38, false);
    }
    if (mat === 'wood') this.decals.wood.add(p, this._n, 0.15 + Math.random() * 0.05);
    // Real, tumbling splinters and paint flakes. Armor does not leave a stationary decal.
    const chips = mat === 'armor' ? 0 : mat === 'wood' ? 9 : mat === 'deck' ? 2 : 5;
    for (let i = 0; i < chips; i++) {
      const sp = 1.4 + Math.random() * 3.2;
      this._v.copy(this._reflection).multiplyScalar(sp);
      this._v.x += (Math.random() - 0.5) * 2; this._v.y += Math.random() * 1.2; this._v.z += (Math.random() - 0.5) * 2;
      if (mat === 'wood') this._s.set(0.018 + Math.random() * 0.02, 0.06 + Math.random() * 0.09, 0.01);
      else this._s.set(0.018 + Math.random() * 0.028, 0.003, 0.025 + Math.random() * 0.025);
      this.fragments.emit({ p: origin, v: this._v, scale: this._s,
        color: mat === 'wood' ? (i % 2 ? 0x9b7950 : 0x5c3e26) : (i % 2 ? 0xa3a8a6 : 0x3c4b50),
        life: 1.4 + Math.random() * 0.8, drag: 0.5 });
    }
    const dust = mat === 'wood' ? [0.55, 0.4, 0.24] : mat === 'armor' ? [0.23, 0.26, 0.27] : [0.4, 0.43, 0.43];
    for (let i = 0, count = mat === 'deck' ? 0 : mat === 'armor' ? 2 : 3; i < count; i++) this.smoke.emit({ x: p.x + nx * 0.05, y: p.y + ny * 0.05, z: p.z + nz * 0.05,
      vx: nx * (0.4 + Math.random()) + (Math.random() - 0.5) * 0.3, vy: ny * 0.6 + 0.25, vz: nz * (0.4 + Math.random()) + (Math.random() - 0.5) * 0.3,
      life: 0, max: metal ? 0.35 + Math.random() * 0.2 : 0.6 + Math.random() * 0.5, s0: 0.075, s1: metal ? 0.3 : 0.5,
      r: dust[0], g: dust[1], b: dust[2], a0: metal ? 0.3 : 0.5, a1: 0, grav: -0.1, drag: 2.5 });
  }
  sparkBurst(p, direction, count) {
    for (let i = 0; i < count; i++) {
      this._v.copy(direction);
      this._v.x += (Math.random() - 0.5) * 0.8; this._v.y += (Math.random() - 0.5) * 0.8; this._v.z += (Math.random() - 0.5) * 0.8;
      this._v.normalize().multiplyScalar(3 + Math.random() * 7);
      this._s.set(0.008 + Math.random() * 0.007, 0.16 + Math.random() * 0.18, 0.01);
      this.sparks.emit({ p, v: this._v, scale: this._s, color: this._sparkColor, life: 0.18 + Math.random() * 0.23, drag: 1.8 });
    }
  }
  splash(p, strength = 1, water = true) {
    const y = water && this.waterHeight ? this.waterHeight(p.x, p.z) : p.y;
    this._p.set(p.x, y + 0.03, p.z);
    this.ripples.emit(this._p, water ? 1.15 : 0.3, water);
    const count = water ? 19 : 9;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const outward = (0.8 + Math.random() * 2.1) * strength;
      this._v.set(Math.cos(a) * outward, (water && i < 7 ? 4.2 : 1.2 + Math.random() * 2.2) * strength, Math.sin(a) * outward);
      this._s.set(0.02 + Math.random() * 0.018, 0.08 + Math.random() * 0.07, 0.025);
      this.droplets.emit({ p: this._p, v: this._v, scale: this._s, color: this._waterColor, life: water ? 0.65 + Math.random() * 0.25 : 0.24 + Math.random() * 0.12, drag: 0.4 });
    }
    // Narrow upward spray followed by a broader, low mist at the waterline.
    for (let i = 0, count = water ? 5 : 2; i < count; i++) this.smoke.emit({ x: p.x, y: y + 0.05 + i * 0.06, z: p.z,
      vx: (Math.random() - 0.5) * strength, vy: (1.6 + i * 0.3) * strength, vz: (Math.random() - 0.5) * strength,
      life: 0, max: water ? 0.48 : 0.23, s0: 0.07 * strength, s1: 0.42 * strength,
      r: 0.7, g: 0.83, b: 0.87, a0: 0.38, a1: 0, grav: 3, drag: 2 });
  }
  bloodSplat(p) { this.decals.blood.add(p, new THREE.Vector3(0, 1, 0), 0.24 + Math.random() * 0.18); }
  explosion(p) {
    this.light(p, 60, 0.35, 0xff9040, 22);
    this.add.emit({ x: p.x, y: p.y + 0.3, z: p.z, vx: 0, vy: 0, vz: 0, life: 0, max: 0.18, s0: 2, s1: 7, r: 2.2, g: 1.6, b: 0.9, a0: 1, a1: 0, grav: 0, drag: 0 });
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * 6.28, e = Math.random() * 1.2, sp = 3 + Math.random() * 6;
      this.add.emit({ x: p.x, y: p.y + 0.3, z: p.z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp + 1, vz: Math.sin(a) * Math.cos(e) * sp, life: 0, max: 0.35 + Math.random() * 0.35, s0: 0.9, s1: 2.2, r: 1.8, g: 0.8, b: 0.25, a0: 0.9, a1: 0, grav: -1, drag: 4 });
    }
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * 6.28, sp = 8 + Math.random() * 14;
      this.add.emit({ x: p.x, y: p.y + 0.2, z: p.z, vx: Math.cos(a) * sp, vy: Math.random() * 10, vz: Math.sin(a) * sp, life: 0, max: 0.4 + Math.random() * 0.5, s0: 0.06, s1: 0.02, r: 1.8, g: 1.2, b: 0.5, a0: 1, a1: 0.4, grav: 12, drag: 1.2, floor: 0.02 });
    }
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * 6.28, sp = 1 + Math.random() * 3;
      this.smoke.emit({ x: p.x + Math.cos(a) * 0.5, y: p.y + 0.4 + Math.random(), z: p.z + Math.sin(a) * 0.5, vx: Math.cos(a) * sp, vy: 1 + Math.random() * 2, vz: Math.sin(a) * sp, life: 0, max: 3 + Math.random() * 3, s0: 1.2, s1: 5, r: 0.22, g: 0.21, b: 0.2, a0: 0.75, a1: 0, grav: -0.4, drag: 1.2 });
    }
    this.decals.scorch.add(new THREE.Vector3(p.x, 0.01, p.z), new THREE.Vector3(0, 1, 0), 3.2);
    this.shake = Math.max(this.shake, 1);
  }
  // 烟囱排烟 & 海鸥
  initAmbient(funnelTop) {
    this.funnelTop = funnelTop;
    const birdMat = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.8, side: THREE.DoubleSide });
    const tipMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.8, side: THREE.DoubleSide });
    for (let i = 0; i < 6; i++) {
      const b = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.35, 3, 6), birdMat); body.rotation.x = Math.PI / 2;
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.1, 0.75, 0.05, 0.05, 0, 0, 0.15, 0.75, 0.05, 0.05, 1.05, 0, 0.12, 0.75, 0.05, 0.05], 3));
      wg.computeVertexNormals();
      const wR = new THREE.Mesh(wg, birdMat), wL = new THREE.Mesh(wg, birdMat); wL.scale.x = -1;
      const tipG = new THREE.BufferGeometry(); tipG.setAttribute('position', new THREE.Float32BufferAttribute([0.75, 0.05, 0.05, 1.05, 0, 0.12, 1.2, 0, 0.18], 3)); tipG.computeVertexNormals();
      const tR = new THREE.Mesh(tipG, tipMat), tL = new THREE.Mesh(tipG, tipMat); tL.scale.x = -1;
      const wrR = new THREE.Group(); wrR.add(wR, tR); const wrL = new THREE.Group(); wrL.add(wL, tL);
      b.add(body, wrR, wrL);
      b.scale.setScalar(1.1);
      this.scene.add(b);
      this.birds.push({ g: b, wR: wrR, wL: wrL, r: 25 + Math.random() * 30, h: 18 + Math.random() * 16, sp: 0.18 + Math.random() * 0.12, ph: Math.random() * 6.28, cx: -10 + Math.random() * 30, flap: Math.random() * 6 });
    }
  }
  update(dt, t, camera, shipSpeed) {
    this.add.update(dt); this.smoke.update(dt);
    this.sparks.update(dt); this.droplets.update(dt); this.fragments.update(dt); this.shells.update(dt); this.ripples.update(dt);
    const h = window.innerHeight * Math.min(window.devicePixelRatio, 2);
    const sc = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    this.add.mat.uniforms.scale.value = sc; this.smoke.mat.uniforms.scale.value = sc;
    // 曳光
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
    const camPos = camera.position;
    let n = 0;
    const speed = 380;
    this.tracers = this.tracers.filter((tr) => {
      tr.t += dt;
      const travel = tr.t * speed;
      const head = Math.min(tr.len, travel), tail = Math.max(0, travel - 7);
      if (tail >= tr.len) return false;
      const mid = pv.copy(tr.from).addScaledVector(tr.dir, (head + tail) / 2);
      const toCam = camPos.clone().sub(mid).normalize();
      const up = new THREE.Vector3().crossVectors(tr.dir, toCam).normalize();
      const nrm = new THREE.Vector3().crossVectors(tr.dir, up);
      const basis = new THREE.Matrix4().makeBasis(tr.dir, up, nrm);
      q.setFromRotationMatrix(basis);
      const dist = mid.distanceTo(camPos);
      sv.set(head - tail, 0.018 + dist * 0.0012, 1);
      m.compose(mid, q, sv);
      if (n < this.tracerMax) this.tracerMesh.setMatrixAt(n++, m);
      return true;
    });
    this.tracerMesh.count = n; this.tracerMesh.instanceMatrix.needsUpdate = true;
    for (const F of this.flashes) if (F.t > 0) { F.t -= dt; if (F.t <= 0) F.s.visible = false; }
    for (const L of this.lights) { if (L.t > 0) { L.t -= dt; L.l.intensity = Math.max(0, L.t / L.dur) * L.peak; } else L.l.intensity = 0; }
    this.shake *= Math.exp(-dt * 5);
    // 烟囱排烟
    if (this.funnelTop) {
      this.funnelT -= dt;
      if (this.funnelT <= 0) {
        this.funnelT = 0.14;
        const f = this.funnelTop;
        const g = 0.18 + Math.random() * 0.1;
        this.smoke.emit({ x: f.x + (Math.random() - 0.5) * 2, y: f.y, z: f.z + (Math.random() - 0.5) * 1.5, vx: -shipSpeed * 0.9 - Math.random(), vy: 2.2 + Math.random(), vz: (Math.random() - 0.5) * 0.8, life: 0, max: 9, s0: 2.2, s1: 11, r: g, g: g, b: g * 1.02, a0: 0.42, a1: 0, grav: -0.05, drag: 0.08 });
      }
    }
    for (const b of this.birds) {
      b.ph += dt * b.sp;
      const x = b.cx + Math.cos(b.ph) * b.r, z = Math.sin(b.ph) * b.r * 0.6, y = b.h + Math.sin(b.ph * 2.3) * 3;
      b.g.position.set(x, y, z);
      b.g.rotation.y = -b.ph + Math.PI;
      b.g.rotation.z = Math.sin(b.ph) * 0.3;
      b.flap += dt * 7;
      const gl = Math.sin(b.ph * 0.7) > 0.3;
      const fa = gl ? 0.08 : Math.sin(b.flap) * 0.6;
      b.wR.rotation.z = fa; b.wL.rotation.z = -fa;
    }
  }
}
