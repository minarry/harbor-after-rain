import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RoofAtlas, ROOF_GLSL, Precipitation, WEATHER_BUDGETS } from '../src/weather.js';
import { World } from '../src/physics.js';
import { SEA_Y } from '../src/map.js';

function atlasFor(t, world) {
  const atlas = new RoofAtlas();
  t.after(() => atlas.texture.dispose());
  if (world) { world.build(); atlas.build(world); }
  return atlas;
}

test('rain distinguishes exposed deck, shelter, roof tops and open sea', (t) => {
  const world = new World();
  world.add({ x: 0, y: -.5, z: 0, sx: 20, sy: 1, sz: 12 });
  world.add({ x: 0, y: 2.9, z: 0, sx: 6, sy: .2, sz: 4 });
  const atlas = atlasFor(t, world);
  assert.equal(atlas.heightAt(0, 0), 3);
  assert.equal(atlas.exposureAt({ x: 0, y: 1.7, z: 0 }), 0);
  assert.equal(atlas.exposureAt({ x: 0, y: 3.05, z: 0 }), 1);
  assert.equal(atlas.heightAt(7, 0), 0);
  assert.equal(atlas.exposureAt({ x: 7, y: 1.7, z: 0 }), 1);
  assert.equal(atlas.heightAt(7, 10), SEA_Y);
});

test('rain roof footprint follows rotated OBB rather than its broad phase bounds', (t) => {
  const world = new World();
  world.add({ x: 0, y: -.5, z: 0, sx: 20, sy: 1, sz: 16 });
  const roof = world.add({ x: 2, y: 3.8, z: -3, sx: 6, sy: .4, sz: 1.5, yaw: Math.PI / 4 });
  const atlas = atlasFor(t, world);
  for (const [lx, lz, expected] of [[0, 0, 4], [2, .3, 4], [-2, -.3, 4], [1, 1.3, 0], [-1, -1.3, 0]]) {
    const [dx, dz] = roof.toWorldDir(lx, lz), x = roof.x + dx, z = roof.z + dz;
    assert.equal(atlas.heightAt(x, z), expected);
    const hit = world.raycast(x, 20, z, 0, -1, 0, 30, 'sight');
    assert.ok(Math.abs(atlas.heightAt(x, z) - (20 - hit.t)) < 1e-6);
  }
});

test('atlas edges do not extrude a roof into the distant sea', (t) => {
  const world = new World();
  world.add({ x: 47.8, y: 4, z: 0, sx: 1, sy: 2, sz: 8 });
  const atlas = atlasFor(t, world);
  assert.equal(atlas.heightAt(47.9, 0), 5);
  for (const [x, z] of [[atlas.rect.x + 1 / atlas.rect.z, 0], [100, 0], [-49, 0], [0, 18], [0, -18.01], [NaN, 0]])
    assert.equal(atlas.heightAt(x, z), SEA_Y);
  assert.match(ROOF_GLSL, /uv\.x>=1\.0\|\|uv\.y>=1\.0/);
});

test('invisible movement fences and stale roof builds never block rain', (t) => {
  const world = new World();
  world.add({ x: 0, y: 4, z: 0, sx: 10, sy: 8, sz: .1, sight: false });
  world.add({ x: 4, y: 3, z: 0, sx: 2, sy: 6, sz: 2, solid: false });
  const atlas = atlasFor(t);
  assert.equal(atlas.heightAt(0, 0), SEA_Y);
  atlas.build(world);
  assert.equal(atlas.heightAt(0, 0), SEA_Y);
  assert.equal(atlas.heightAt(4, 0), SEA_Y);
  world.add({ x: 0, y: 1, z: 0, sx: 4, sy: 2, sz: 4 });
  atlas.build(world);
  assert.equal(atlas.heightAt(0, 0), 2);
  atlas.build({ colliders: [] });
  assert.equal(atlas.heightAt(0, 0), SEA_Y);
});

test('expanded ship cabins and platforms remain in the rain atlas without coarsening cells', (t) => {
  const world = new World();
  world.add({ x: 0, y: -.5, z: 0, sx: 74, sy: 1, sz: 36.3, tag: 'deck' });
  world.add({ x: 21, y: 3.05, z: -16, sx: 7, sy: .2, sz: 4 });
  world.add({ x: -23, y: 1.3, z: 16, sx: 9, sy: 2.6, sz: 4 });
  const atlas = atlasFor(t, world);
  assert.ok(atlas.rect.y <= -19 && atlas.rect.y + 1 / atlas.rect.w >= 19);
  assert.ok(Math.abs(atlas.heightAt(21, -16) - 3.15) < 1e-6);
  assert.equal(atlas.exposureAt({ x: 21, y: 1.7, z: -16 }), 0);
  assert.equal(atlas.exposureAt({ x: -23, y: 4.3, z: 16 }), 1);
  assert.equal(atlas.heightAt(0, 17.5), 0);
  assert.equal(atlas.heightAt(0, 22), SEA_Y);
  assert.ok(1 / atlas.rect.z / atlas.width <= .188);
  assert.ok(1 / atlas.rect.w / atlas.height <= .188);
  const texture = atlas.texture, rect = atlas.rect;
  world.add({ x: 70, y: 2, z: 28, sx: 4, sy: 4, sz: 4 });
  atlas.build(world);
  assert.equal(atlas.texture, texture);assert.equal(atlas.uniforms.uRoofRect.value, rect);
  assert.equal(atlas.heightAt(70, 28), 4);
  assert.equal(atlas.exposureAt({ x: 70, y: 1.7, z: 28 }), 0);
});

test('rain quality tiers keep bounded draw counts and reuse GPU data while updating', (t) => {
  const environment = { sunDir: new THREE.Vector3(1, .2, .3).normalize(), sun: { color: new THREE.Color(0xffb16c) }, hemi: { color: new THREE.Color(0x8cabbc) } };
  const renderer = { domElement: { height: 900 } }, camera = new THREE.Vector3(0, 1.7, 0);
  for (const quality of ['high', 'medium', 'low']) {
    const scene = new THREE.Scene(), roof = atlasFor(t), rain = new Precipitation(scene, quality, roof);
    t.after(() => rain.dispose());
    assert.equal(rain.group.children.length, quality === 'low' ? 2 : 3);
    assert.equal(rain.rain.geometry.instanceCount, WEATHER_BUDGETS[quality].rain);
    assert.equal(rain.splashes.geometry.instanceCount, WEATHER_BUDGETS[quality].impacts);
    assert.equal(rain.splashes.geometry.attributes.position.count, 16);
    const seeds = rain.rain.geometry.attributes.aSeed.array, uniforms = rain.uniforms;
    for (let frame = 0; frame < 120; frame++) rain.update(1 / 60, frame / 60, camera, environment, renderer);
    assert.equal(rain.rain.geometry.attributes.aSeed.array, seeds);
    assert.equal(rain.uniforms, uniforms);
    assert.ok(Number.isFinite(uniforms.uPixel.value) && uniforms.uPixel.value > 0);
    rain.setRain(0);
    for (let frame = 0; frame < 80; frame++) rain.update(.1, 2 + frame * .1, camera, environment, renderer);
    assert.equal(rain.group.visible, false);
    rain.setRain(NaN);assert.equal(rain.targetLevel, 0);
    rain.setRain(4);assert.equal(rain.targetLevel, 1);
  }
});
