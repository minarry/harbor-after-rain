import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BallisticPool, RipplePool } from '../src/impact-pools.js';
import { World } from '../src/physics.js';

const point = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
function pool(max = 8) {
  return new BallisticPool(new THREE.Scene(), { max, collide: true,
    geometry: new THREE.BoxGeometry(1, 1, 1), material: new THREE.MeshStandardMaterial() });
}
function shell(target, p, v = point()) {
  return target.emit({ p, v, scale: point(0.02, 0.05, 0.02), shell: true, life: 5.5, drag: 0.12 });
}

test('sustained fire reuses bounded particles and clear removes every visible instance', () => {
  const p = pool();
  for (let i = 0; i < 2000; i++) {
    shell(p, point(0, 2, 0), point(1, 2, 0)); p.update(1 / 120);
    assert.ok(p.mesh.count <= p.max);
  }
  assert.equal(p.items.length, 8);
  assert.equal(p.mesh.count, 8);
  assert.ok([...p.mesh.instanceMatrix.array].every(Number.isFinite));
  p.clear();
  assert.equal(p.mesh.count, 0);
  assert.equal(p.items.some(s => s.active), false);
  shell(p, point(0, 2, 0)); p.update(1 / 60);
  assert.equal(p.mesh.count, 1);
  p.update(6);
  assert.equal(p.mesh.count, 0);
});

test('shells collide with real raised deck and emit at most two physical bounce sounds', () => {
  const p = pool(), world = new World(), sounds = [];
  world.add({ x: 0, y: 2.75, z: 0, sx: 10, sy: 0.5, sz: 10, mat: 'wood' }); world.build();
  p.world = world; p.onCollision = (pos, surface, energy) => sounds.push({ y: pos.y, surface, energy });
  const s = shell(p, point(0, 4.5, 0), point(0.2, 0, 0));
  for (let i = 0; i < 180; i++) p.update(1 / 60);
  assert.ok(s.rest, 'shell should settle on the actual elevated collider');
  assert.ok(s.p.y >= 3 && s.p.y < 3.05);
  assert.ok(sounds.length > 0 && sounds.length <= 2);
  assert.ok(sounds.every(e => e.surface === 'wood' && e.y > 3 && e.energy > 0.45));
});

test('shells outside the ship have no phantom y=0 ground and sink beneath sampled water', () => {
  const p = pool(), world = new World(); world.build();
  p.world = world; p.waterHeight = () => -7.5;
  let sounds = 0; p.onCollision = () => sounds++;
  const s = shell(p, point(0, 1, 0));
  for (let i = 0; i < 100; i++) p.update(1 / 60);
  assert.equal(s.active, false);
  assert.ok(s.p.y <= -7.5);
  assert.equal(sounds, 0);
});

test('water rings follow wave height while wet-deck rings stay on the impact plane', () => {
  const p = new RipplePool(new THREE.Scene(), 3), matrix = new THREE.Matrix4();
  let height = -7.3; p.waterHeight = () => height;
  p.emit(point(2, -7.5, 4), 1, true); p.emit(point(0, 3, 0), 0.3, false);
  p.update(0.1); p.mesh.getMatrixAt(0, matrix);
  assert.ok(Math.abs(matrix.elements[13] - (-7.275)) < 1e-5);
  height = -7; p.update(0.1); p.mesh.getMatrixAt(0, matrix);
  assert.ok(Math.abs(matrix.elements[13] - (-6.975)) < 1e-5);
  p.mesh.getMatrixAt(1, matrix); assert.ok(Math.abs(matrix.elements[13] - 3.025) < 1e-5);
  p.update(2); assert.equal(p.mesh.count, 0);
  for (let i = 0; i < 200; i++) p.emit(point(), 1, true);
  p.update(0.01); assert.equal(p.mesh.count, 3);
  p.clear(); assert.equal(p.mesh.count, 0);
});
