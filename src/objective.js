import * as THREE from 'three';
import { RelayState } from './relay-state.js';

const COLORS = { BL: 0xffb163, GR: 0x70c6d6, neutral: 0xd7dfd5, contested: 0xff6554 };
const NAMES = ['左舷通道', '右舷通道', '中央甲板'];
export class RelayObjective {
  constructor(game) {
    this.game = game; this.rules = new RelayState();
    this.active = false; this.position = new THREE.Vector3(); this.radius = 4.25;
    this.root = new THREE.Group(); this.root.name = 'relay-objective';
    const ring = new THREE.RingGeometry(this.radius - 0.06, this.radius, 96);
    ring.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: COLORS.neutral, transparent: true, opacity: 0.65, depthWrite: false, side: THREE.DoubleSide }));
    this.ring.position.y = 0.035; this.root.add(this.ring);
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 1.6, 8), new THREE.MeshStandardMaterial({ color: 0x39464b, metalness: 0.7, roughness: 0.32 }));
    this.beacon.position.y = 0.8; this.root.add(this.beacon);
    this.light = new THREE.Mesh(new THREE.OctahedronGeometry(0.19), new THREE.MeshBasicMaterial({ color: COLORS.neutral, toneMapped: false }));
    this.light.position.y = 1.7; this.root.add(this.light);
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#111c21'; ctx.fillRect(0, 0, 256, 64);
    ctx.strokeStyle = '#ddc79d'; ctx.strokeRect(2, 2, 252, 60);
    ctx.fillStyle = '#f1e9d7'; ctx.font = '600 26px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('中继 / RELAY', 128, 32);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false }));
    label.position.y = 2.45; label.scale.set(2.15, 0.54, 1); this.root.add(label);
    game.renderer.scene.add(this.root); this.root.visible = false;
    const locations = game.map?.relayPoints || [[0, -6.8], [0, 6.8], [-2.5, 0]].map(([x, z], i) => ({ x, z, y: 0, label: NAMES[i] }));
    this.labels = locations.map(p => p.label);
    this.points = locations.map(({ x, z, y = 0 }) => {
      const k = game.nav.nearestFree(game.nav.idx(x,z));
      const p = k >= 0 ? game.nav.center(k) : [x,z];
      return new THREE.Vector3(p[0], game.nav.heightAt?.(p[0], p[1]) ?? y, p[1]);
    });
  }
  reset(active) {
    this.active = active; this.rules.reset(); this.root.visible = active;
    this.position.copy(this.points[0]); this.root.position.copy(this.position);
    if (!active) this.game.hud.updateObjective?.(null);
  }
  get owner() { return this.rules.owner; }
  get contested() { return this.rules.contested; }
  update(dt) {
    if (!this.active) return;
    const counts = { BL: 0, GR: 0 };
    for (const a of this.game.actors) {
      if (!a.alive || a.protectT > 0 || Math.abs(a.pos.y - this.position.y) > 0.85) continue;
      if (Math.hypot(a.pos.x - this.position.x, a.pos.z - this.position.z) > this.radius) continue;
      // Walls and stacked cargo prevent capturing through cover from a different lane.
      const dx = this.position.x - a.pos.x, dy = this.position.y - a.pos.y, dz = this.position.z - a.pos.z, len = Math.hypot(dx, dy, dz);
      if (len > 0.2 && this.game.world.raycast(a.pos.x, a.pos.y + 0.8, a.pos.z, dx / len, dy / len, dz / len, len - 0.15, 'sight')) continue;
      counts[a.team]++;
    }
    const result = this.rules.update(dt, counts);
    if (result.rotated) {
      this.position.copy(this.points[this.rules.index % this.points.length]);
      this.root.position.copy(this.position);
      this.game.hud.toast('中继转移 · ' + this.labels[this.rules.index % this.labels.length], 3);
    }
    if (result.captured) this.game.hud.toast((result.captured === this.game.player.team ? '我方' : '敌方') + '已控制中继', 2.4);
    this.game.score.BL = this.rules.score.BL; this.game.score.GR = this.rules.score.GR;
    if (Math.max(this.game.score.BL, this.game.score.GR) >= this.game.goal) this.game.endMatch();
  }
  render(time) {
    if (!this.active) return;
    const r = this.rules;
    const color = r.contested ? COLORS.contested : COLORS[r.owner || 'neutral'];
    this.ring.material.color.setHex(color); this.light.material.color.setHex(color);
    this.ring.material.opacity = 0.45 + Math.sin(time * 2.8) * 0.12;
    this.light.rotation.y = time;
    const player = this.game.player;
    const distance = player ? Math.round(player.pos.distanceTo(this.position)) : 0;
    this.game.hud.updateObjective?.({ visible: true, owner: r.owner, progress: r.progress, contested: r.contested,
      label: this.labels[r.index % this.labels.length], hint: `${distance} m · ${Math.ceil(r.remaining)}秒后转移${r.contested ? ' · 双方争夺中' : ' · 占领后每秒 +1 分'}` });
  }
}
