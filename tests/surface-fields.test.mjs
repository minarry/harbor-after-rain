import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWearMasks, composePaintSurface, composeWoodSurface, resampleSurfaceData, resampleHeight } from '../src/surface-fields.js';
import { createSurfaceMaterials } from '../src/surface-materials.js';

const pixels = (length, rgb) => Uint8ClampedArray.from(Array.from({ length }, () => [...rgb, 255]).flat());
const masksFor = n => Object.fromEntries(['chip', 'oxide', 'runoff', 'grime', 'oil'].map(k => [k, new Float32Array(n)]));

test('paint, exposed steel, oxide and oil use one state for color, relief and ORM', () => {
  const masks = masksFor(4); masks.chip[1] = masks.chip[2] = 1; masks.oxide[2] = 1; masks.oil[3] = 1;
  const original = new Float32Array(4).fill(.5);
  const result = composePaintSurface({ width: 4, height: 1, seed: 7, pixels: pixels(4, [38, 72, 118]), heightField: original, masks });
  const orm = i => [...result.orm.slice(i * 4, i * 4 + 4)];
  assert.ok(orm(0)[2] < 8 && orm(0)[3] === 0, 'intact paint is dielectric, not metallic blue');
  assert.ok(orm(1)[2] > 210 && orm(1)[1] < orm(0)[1], 'freshly exposed steel is reflective');
  assert.ok(orm(2)[2] < 8 && orm(2)[1] > 215 && orm(2)[3] === 255, 'oxide remains rough and dielectric');
  assert.ok(orm(3)[1] < orm(0)[1] && orm(3)[2] < 8, 'oil changes roughness without making metal');
  assert.ok(result.height[1] < original[1] && result.height[2] < original[2]);
  assert.ok(result.color[2 * 4] > result.color[2 * 4 + 2], 'the same oxide mask supplies the brown color');
  assert.deepEqual(original, new Float32Array(4).fill(.5), 'shared corrugation height remains immutable');
  const white = composePaintSurface({ width: 4, height: 1, seed: 7, pixels: pixels(4, [240, 240, 235]), heightField: original, masks });
  assert.deepEqual(white.orm, result.orm, 'white lettering and grey paint cannot be inferred as bare metal');
  assert.deepEqual(white.height, result.height, 'paint hue does not move damage relief');
});

test('wear is seeded, sparse and provides runoff connected to the damage model', () => {
  const a = createWearMasks(256, 112, 202, { ribs: 22 }), b = createWearMasks(256, 112, 202, { ribs: 22 });
  for (const key of Object.keys(a)) assert.deepEqual(a[key], b[key]);
  const result = composePaintSurface({ width: 256, height: 112, seed: 202, pixels: pixels(256 * 112, [132, 40, 32]), heightField: new Float32Array(256 * 112), masks: a });
  assert.ok(result.layerStats.paint > .9, 'most of the cargo panel should remain intact paint');
  assert.ok(result.layerStats.oxide > 0 && result.layerStats.runoff > 0);
  assert.ok(result.layerStats.exposedMetal > 0 && result.layerStats.exposedMetal < .08);
  for (const value of result.height) assert.ok(Number.isFinite(value));
});

test('wood fibers and cracks produce relief while only explicit fasteners become metal', () => {
  const width = 64, height = 64, count = width * height, fasteners = new Uint8Array(count); fasteners[100] = 255;
  const result = composeWoodSurface({ width, height, seed: 500, pixels: pixels(count, [170, 135, 88]), heightField: new Float32Array(count).fill(.5), fasteners });
  assert.ok(result.orm[100 * 4 + 2] > 190);
  for (let i = 0; i < count; i++) {
    if (i !== 100) assert.equal(result.orm[i * 4 + 2], 0);
    assert.equal(result.orm[i * 4 + 3], 0, 'brown wood is not oxide');
  }
  assert.ok(result.layerStats.cracks > 0);
  assert.ok(Math.max(...result.height) - Math.min(...result.height) > .06);
  assert.ok(new Set(result.orm.filter((_, i) => i % 4 === 1)).size > 15, 'wood has authored roughness variation');
});

test('ORM resizing keeps RGB even when its independent oxide alpha is zero', () => {
  const source = Uint8Array.from([255, 140, 5, 0, 255, 180, 5, 0, 200, 240, 0, 255, 240, 80, 220, 0]);
  assert.deepEqual([...resampleSurfaceData(source, 2, 2, 1, 1)], [238, 160, 58, 64]);
  assert.deepEqual([...resampleSurfaceData(source.slice(0, 8), 2, 1, 1, 1)], [255, 160, 5, 0]);
  const height = Float32Array.from([0, 1, 2, 3]);
  assert.deepEqual([...resampleHeight(height, 2, 2, 1, 1)], [1.5]);
});

test('playable material factory binds ORM and separates geometric corrugation from detail normals', () => {
  const map = new THREE.Texture(), macro = new THREE.Texture(), detail = new THREE.Texture(), orm = new THREE.DataTexture(new Uint8Array([255, 140, 5, 0]), 1, 1);
  map.userData.pbrSource = { schema: 2, profile: 'container-side', seed: 200 };
  map.userData.layerStats = { paint: .96 }; map.userData.weatherORM = orm;
  macro.userData.pbrSource = { normalRole: 'macro+detail' }; detail.userData.pbrSource = { normalRole: 'detail' };
  const s = { map, normalMap: macro, ormMap: orm, emissiveMap: null };
  const T = Object.fromEntries(['deck', 'bulkhead', 'darkSteel', 'yellowSteel', 'redSteel', 'greenSteel', 'superWall', 'hull'].map(k => [k, s]));
  T.containers = [{ color: { rgb: [38, 72, 118] }, side20: map, side40: map, n20: macro, n40: macro, detailN20: detail, detailN40: detail, orm20: orm, orm40: orm, door: map, doorN: macro, roof: map, roofN: macro }];
  T.crates = [{ ...s, kind: 'wood' }, { ...s, kind: 'wood' }];
  T.fence = T.grating = T.signs = null;
  const materials = createSurfaceMaterials(T);
  const flat = materials.c0s20.mat, corrugated = materials.c0s20Detail.mat;
  assert.equal(flat.map, corrugated.map); assert.equal(flat.roughnessMap, corrugated.roughnessMap);
  assert.equal(flat.normalMap, macro); assert.equal(corrugated.normalMap, detail);
  assert.equal(corrugated.userData.pbrSource.normalRole, 'detail');
  for (const m of [flat, corrugated, materials.deck.mat, materials.crate0.mat]) {
    assert.equal(m.roughnessMap, orm); assert.equal(m.metalnessMap, orm); assert.equal(m.aoMap, orm);
    assert.equal(m.roughness, 1); assert.equal(m.metalness, 1);
    assert.doesNotThrow(() => JSON.stringify(m.userData.pbrSource));
  }
  Object.values(materials).forEach(m => m.mat.dispose());
  [map, macro, detail, orm].forEach(t => t.dispose());
});
