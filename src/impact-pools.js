// Bounded, allocation-free update paths for ballistic impact geometry and water rings.
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const SIDE = new THREE.Vector3(0, 0, 1);
const random = (a, b) => a + Math.random() * (b - a);

export class BallisticPool {
  constructor(scene, { max = 128, geometry, material, stretch = false, collide = false }) {
    this.max = max; this.next = 0; this.stretch = stretch; this.collide = collide;
    this.mesh = new THREE.InstancedMesh(geometry, material, max);
    this.mesh.name = stretch ? 'impact-streaks' : 'impact-debris';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3).fill(1), 3).setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0; this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = !stretch;
    scene.add(this.mesh);
    this.items = Array.from({ length: max }, () => ({
      active: false, p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(),
      axis: new THREE.Vector3(), scale: new THREE.Vector3(), color: new THREE.Color(),
      age: 0, life: 0, spin: 0, bounces: 0, rest: false, shell: false, radius: 0.008,
    }));
    this.matrix = new THREE.Matrix4(); this.rotation = new THREE.Quaternion();
    this.velocityDir = new THREE.Vector3(); this.normal = new THREE.Vector3();
    this.renderScale = new THREE.Vector3(); this.renderColor = new THREE.Color();
    this.hit = {}; this.world = null; this.waterHeight = null; this.onCollision = null;
  }

  emit({ p, v, scale, color = 0xffffff, life = 1, gravity = 9.81, drag = 0.5, shell = false }) {
    const s = this.items[this.next]; this.next = (this.next + 1) % this.max;
    s.active = true; s.age = 0; s.life = life; s.rest = false; s.bounces = 0;
    s.p.copy(p); s.v.copy(v); s.scale.copy(scale); s.color.set(color);
    s.gravity = gravity; s.drag = drag; s.shell = shell;
    s.radius = shell ? 0.009 : Math.max(0.003, Math.min(scale.x, scale.y, scale.z) * 0.4);
    s.axis.set(random(-1, 1), random(-1, 1), random(-1, 1)).normalize();
    s.spin = random(12, 35); s.q.setFromAxisAngle(s.axis, random(0, Math.PI * 2));
    return s;
  }

  update(dt) {
    const steps = Math.max(1, Math.min(4, Math.ceil(dt / (1 / 60))));
    const step = Math.min(dt, 0.1) / steps;
    let count = 0;
    for (const s of this.items) {
      if (!s.active) continue;
      s.age += dt;
      if (s.age >= s.life || s.p.y < -35) { s.active = false; continue; }
      for (let i = 0; i < steps && !s.rest; i++) {
        const damp = Math.exp(-s.drag * step);
        s.v.multiplyScalar(damp); s.v.y -= s.gravity * step;
        const speed = s.v.length(), distance = speed * step;
        this.velocityDir.copy(s.v).multiplyScalar(1 / Math.max(speed, 1e-6));
        const h = this.collide && this.world && distance > 1e-7
          ? this.world.raycast(s.p.x, s.p.y, s.p.z, this.velocityDir.x, this.velocityDir.y, this.velocityDir.z, distance + s.radius, 'move', this.hit)
          : null;
        if (h) {
          s.p.addScaledVector(this.velocityDir, Math.max(0, h.t - s.radius));
          this.normal.set(h.nx, h.ny, h.nz);
          const energy = Math.max(0, -s.v.dot(this.normal));
          s.p.addScaledVector(this.normal, 0.003);
          s.v.reflect(this.normal).multiplyScalar(s.shell ? 0.42 : 0.3);
          s.spin *= 0.6; s.bounces++;
          if (s.shell && s.bounces <= 2 && energy > 0.45 && this.onCollision) {
            this.onCollision(s.p, h.collider?.mat || h.collider?.surface || 'metal', energy);
          }
          if (h.ny > 0.6 && (energy < 0.8 || s.bounces >= 4)) {
            s.rest = true; s.v.set(0, 0, 0);
            if (s.shell) {
              s.q.setFromAxisAngle(UP, random(0, Math.PI * 2));
              this.rotation.setFromAxisAngle(SIDE, Math.PI / 2);
              s.q.multiply(this.rotation);
            }
          }
        } else s.p.addScaledVector(s.v, step);
        // No invisible floor at y=0: shells leaving the ship sink below the sea.
        if (this.collide && this.waterHeight && s.p.y <= this.waterHeight(s.p.x, s.p.z)) {
          s.active = false; break;
        }
        this.rotation.setFromAxisAngle(s.axis, s.spin * step);
        s.q.multiply(this.rotation);
      }
      if (!s.active) continue;
      const fade = Math.min(1, (s.life - s.age) / (this.stretch ? 0.16 : 0.5));
      this.renderScale.copy(s.scale);
      if (this.stretch) {
        const speed = s.v.length();
        if (speed > 0.001) {
          this.velocityDir.copy(s.v).multiplyScalar(1 / speed);
          s.q.setFromUnitVectors(UP, this.velocityDir);
        }
        this.renderScale.y *= Math.max(0.6, speed * 0.08);
        this.renderScale.x *= Math.max(0.25, fade);
        this.renderScale.z *= Math.max(0.25, fade);
      } else this.renderScale.multiplyScalar(fade);
      this.matrix.compose(s.p, s.q, this.renderScale);
      this.mesh.setMatrixAt(count, this.matrix);
      this.renderColor.copy(s.color).multiplyScalar(this.stretch ? fade : 1);
      this.mesh.setColorAt(count++, this.renderColor);
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }

  clear() { for (const s of this.items) s.active = false; this.mesh.count = 0; this.next = 0; }
}

export class RipplePool {
  constructor(scene, max = 48) {
    this.max = max; this.next = 0; this.waterHeight = null;
    this.items = Array.from({ length: max }, () => ({ active: false, x: 0, y: 0, z: 0, age: 0, life: 1, size: 1, water: true }));
    const geo = new THREE.PlaneGeometry(2, 2, 12, 12);
    this.age = new THREE.InstancedBufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('rippleAge', this.age);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      vertexShader: `attribute float rippleAge; varying vec2 vUv; varying float vAge;
        void main(){ vUv=uv; vAge=rippleAge; gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.); }`,
      fragmentShader: `varying vec2 vUv; varying float vAge;
        void main(){
          float r=length(vUv*2.-1.); float a=0.;
          for(int i=0;i<3;i++){
            float age=vAge-float(i)*.12;
            float ring=.07+max(0.,age)*.9;
            float width=.014+age*.013;
            a+=exp(-pow((r-ring)/width,2.))*step(0.,age)*(1.-vAge)*(.52-float(i)*.1);
          }
          a*=1.-smoothstep(.88,1.,r); if(a<.005) discard;
          gl_FragColor=vec4(.68,.87,.94,a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.name = 'impact-water-rings'; this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.renderOrder = 3;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    this.matrix = new THREE.Matrix4(); this.q = new THREE.Quaternion();
    this.p = new THREE.Vector3(); this.scale = new THREE.Vector3();
    this.n = new THREE.Vector3(); this.forward = new THREE.Vector3(0, 0, 1);
  }
  emit(p, size = 1, water = true) {
    const s = this.items[this.next]; this.next = (this.next + 1) % this.max;
    Object.assign(s, { active: true, x: p.x, y: p.y, z: p.z, age: 0, life: water ? 1.7 : 0.7, size, water });
  }
  update(dt) {
    let count = 0;
    for (const s of this.items) {
      if (!s.active) continue;
      s.age += dt;
      if (s.age >= s.life) { s.active = false; continue; }
      this.n.set(0, 1, 0);
      let y = s.y;
      if (s.water && this.waterHeight) {
        y = this.waterHeight(s.x, s.z);
        const e = 0.2;
        this.n.set(this.waterHeight(s.x - e, s.z) - this.waterHeight(s.x + e, s.z), 2 * e,
          this.waterHeight(s.x, s.z - e) - this.waterHeight(s.x, s.z + e)).normalize();
      }
      this.p.set(s.x, y + 0.025, s.z); this.scale.setScalar(s.size);
      this.q.setFromUnitVectors(this.forward, this.n);
      this.matrix.compose(this.p, this.q, this.scale);
      this.mesh.setMatrixAt(count, this.matrix); this.age.setX(count++, s.age / s.life);
    }
    this.mesh.count = count; this.mesh.instanceMatrix.needsUpdate = true; this.age.needsUpdate = true;
  }
  clear() { for (const s of this.items) s.active = false; this.mesh.count = 0; this.next = 0; }
}
