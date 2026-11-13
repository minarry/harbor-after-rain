import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHandMaterials, setHandWetness } from '../src/view-hand-materials.js';
import { createViewArm, poseGlove, solveViewArm } from '../src/view-hands.js';

const materialKeys = ['glove', 'skin', 'nail', 'sleeve'];
const textureKeys = ['map', 'normalMap', 'roughnessMap'];
const disposeMaterials = materials => materialKeys.forEach(key => materials[key].dispose());

test('hand materials keep independent responses while reusing their immutable surface textures', () => {
  const a = createHandMaterials(), b = createHandMaterials();
  try {
    for (const key of materialKeys) {
      assert.notEqual(a[key], b[key], `${key}: material instances must not share mutable state`);
      assert.equal(a[key].metalness, 0, `${key}: skin, nails and cloth are dielectric`);
      assert.equal(a[key].vertexColors, true);
      for (const slot of textureKeys) assert.equal(a[key][slot], b[key][slot], `${key}/${slot}: texture cache is shared`);
    }
    assert.ok(a.skin.isMeshPhysicalMaterial && a.nail.isMeshPhysicalMaterial);
    assert.notEqual(a.skin, a.glove); assert.notEqual(a.nail, a.skin);
    const untouched = b.skin.color.clone(), dry = b.skin.roughness;
    a.skin.color.setRGB(.3, .4, .5); setHandWetness(a, 1);
    assert.ok(b.skin.color.equals(untouched)); assert.equal(b.skin.roughness, dry);
    assert.notEqual(a.skin.map, a.glove.map, 'skin cannot inherit the glove weave');
    assert.notEqual(a.sleeve.normalMap, a.glove.normalMap, 'sleeves have their own fabric scale');
  } finally { disposeMaterials(a); disposeMaterials(b); }
});

test('hand albedo is sRGB while normal and roughness data remain linear and bounded', () => {
  const materials = createHandMaterials(), textures = new Set();
  try {
    for (const key of ['glove', 'skin', 'sleeve']) {
      const material = materials[key];
      for (const slot of textureKeys) {
        const texture = material[slot]; textures.add(texture);
        assert.ok(texture?.isTexture, `${key}/${slot}`);
        assert.equal(texture.colorSpace, slot === 'map' ? THREE.SRGBColorSpace : THREE.NoColorSpace);
        const { width, height, data } = texture.image;
        assert.ok(width > 0 && height > 0 && data.length === width * height * 4);
      }
      const normal = material.normalMap.image.data;
      for (let i = 0; i < normal.length; i += 4) {
        const x = normal[i] / 127.5 - 1, y = normal[i + 1] / 127.5 - 1, z = normal[i + 2] / 127.5 - 1;
        assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < .015, `${key}: encoded normal is normalized`);
        assert.ok(z > 0, `${key}: detail normal faces out of the surface`);
      }
    }
    const bytes = [...textures].reduce((total, texture) => total + texture.image.data.byteLength, 0);
    assert.ok(bytes < 16 * 1024 * 1024, 'shared hand surfaces stay within a small texture budget');
  } finally { disposeMaterials(materials); }
});

test('wet hands retain finite dielectric shading without allocating or updating textures', () => {
  const materials = createHandMaterials();
  const initial = Object.fromEntries(materialKeys.map(key => [key, materials[key].roughness]));
  const textures = materialKeys.flatMap(key => textureKeys.map(slot => materials[key][slot])).filter(Boolean);
  const snapshots = textures.map(texture => ({ texture, data: texture.image.data, version: texture.version }));
  try {
    for (const amount of [-100, 0, .25, .75, 1, 100, 0]) {
      setHandWetness(materials, amount);
      for (const key of materialKeys) {
        const material = materials[key];
        assert.ok(Number.isFinite(material.roughness) && material.roughness > 0 && material.roughness <= 1);
        assert.ok(material.roughness <= initial[key], `${key}: wetness does not increase dry roughness`);
        assert.equal(material.metalness, 0);
      }
      for (const snapshot of snapshots) {
        assert.equal(snapshot.texture.image.data, snapshot.data);
        assert.equal(snapshot.texture.version, snapshot.version, 'wetness cannot trigger a texture upload');
      }
    }
    for (const key of materialKeys) assert.equal(materials[key].roughness, initial[key], `${key}: drying restores the dry response`);
    assert.deepEqual(materialKeys.flatMap(key => textureKeys.map(slot => materials[key][slot])).filter(Boolean), textures);
  } finally { disposeMaterials(materials); }
});

function makeArms() {
  const materials = createHandMaterials();
  const arms = ['R', 'L'].map(side => createViewArm(side, [materials.glove, materials.skin, materials.nail], materials.sleeve));
  return { materials, arms, dispose() {
    for (const arm of arms) {
      arm.mesh.skeleton.dispose();
      for (const mesh of [arm.mesh, arm.fore, arm.upper]) mesh.geometry.dispose();
    }
    disposeMaterials(materials);
  } };
}
function groupArea(geometry, group) {
  const p = geometry.attributes.position, index = geometry.index;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let area = 0;
  for (let i = group.start; i < group.start + group.count; i += 3) {
    a.fromBufferAttribute(p, index.getX(i)); b.fromBufferAttribute(p, index.getX(i + 1)); c.fromBufferAttribute(p, index.getX(i + 2));
    area += b.sub(a).cross(c.sub(a)).length() * .5;
  }
  return area;
}
function ringCentre(mesh, ring) {
  const { sides } = mesh.geometry.userData, p = mesh.geometry.attributes.position, centre = new THREE.Vector3();
  for (let s = 0; s < sides; s++) centre.add(new THREE.Vector3().fromBufferAttribute(p, ring * (sides + 1) + s));
  return centre.divideScalar(sides);
}
function ringPoints(mesh, ring) {
  const { sides } = mesh.geometry.userData, p = mesh.geometry.attributes.position;
  return Array.from({ length: sides }, (_, side) => new THREE.Vector3().fromBufferAttribute(p, ring * (sides + 1) + side));
}
function cuffTriangles(arm) {
  const geo = arm.mesh.geometry, part = geo.userData.parts.find(part => part.name === 'cuff');
  assert.ok(part, 'a real glove cuff is needed to cover the wrist transition');
  const p = geo.attributes.position, index = geo.index, triangles = [];
  for (let i = 0; i < index.count; i += 3) {
    const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    if (ids.every(id => id >= part.vertexStart && id < part.vertexStart + part.vertexCount)) {
      triangles.push(ids.map(id => new THREE.Vector3().fromBufferAttribute(p, id)));
    }
  }
  return triangles;
}
function assertJointFacesOutward(mesh, label) {
  const geo = mesh.geometry, { rings, sides } = geo.userData, p = geo.attributes.position, index = geo.index;
  const centres = Array.from({ length: rings + 1 }, (_, ring) => ringCentre(mesh, ring));
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), face = new THREE.Vector3(), radial = new THREE.Vector3(), origin = new THREE.Vector3();
  for (let i = 0; i < index.count; i += 3) {
    const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)], rows = ids.map(id => Math.floor(id / (sides + 1)));
    if (Math.min(...rows) >= 2 && Math.max(...rows) <= rings - 2) continue;
    a.fromBufferAttribute(p, ids[0]); b.fromBufferAttribute(p, ids[1]); c.fromBufferAttribute(p, ids[2]);
    face.subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    origin.copy(centres[rows[0]]).add(centres[rows[1]]).add(centres[rows[2]]).divideScalar(3);
    radial.copy(a).add(b).add(c).divideScalar(3).sub(origin);
    assert.ok(face.lengthSq() > 1e-16, `${label}: joint loft triangles cannot collapse`);
    assert.ok(face.dot(radial) > 0, `${label}/strip${Math.min(...rows)}: joint triangles face outward geometrically, independent of smoothed vertex normals`);
  }
}

test('forearms have exposed skin, a rolled sleeve and a flattened wrist with real taper', () => {
  const fixture = makeArms();
  try {
    for (const arm of fixture.arms) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(.15, -.3, .7));
      solveViewArm(arm, new THREE.Vector3(arm.side === 'R' ? .12 : -.08, -.16, -.45), q, new THREE.Vector3());
      const geo = arm.fore.geometry, groups = geo.groups, { rings, sides } = geo.userData;
      assert.deepEqual(groups.map(group => arm.fore.material[group.materialIndex]), [fixture.materials.sleeve, fixture.materials.skin]);
      assert.equal(arm.upper.material, fixture.materials.sleeve);
      assert.equal(groups[0].start, 0); assert.equal(groups[1].start, groups[0].count);
      assert.equal(groups[0].count + groups[1].count, geo.index.count);
      const clothArea = groupArea(geo, groups[0]), skinArea = groupArea(geo, groups[1]);
      assert.ok(clothArea > .001 && skinArea > clothArea, 'the elbow remains clothed while most of the forearm is visibly bare');
      const skinVertices = new Set();
      for (let i = groups[1].start; i < groups[1].start + groups[1].count; i++) skinVertices.add(geo.index.getX(i));
      const firstSkinRing = Math.min(...skinVertices) / (sides + 1) | 0;
      assert.ok(rings - firstSkinRing > rings / 2, 'skin exposure extends along the arm, not just one decorative strip');
      for (const i of skinVertices) {
        const color = geo.attributes.color;
        assert.ok(Math.min(color.getX(i), color.getY(i), color.getZ(i)) > .65, 'bare forearm cannot retain dark sleeve vertex tint');
      }
      const profile = ring => {
        const centre = ringCentre(arm.fore, ring), distances = ringPoints(arm.fore, ring).map(point => point.distanceTo(centre));
        return { max: Math.max(...distances), min: Math.min(...distances), mean: distances.reduce((a, b) => a + b) / distances.length };
      };
      const wrist = profile(rings);
      assert.ok(wrist.max / wrist.min > 1.15, 'wrist cross-section is wide and flat, not a circular hose');
      const belly = Math.max(...Array.from({ length: rings - firstSkinRing }, (_, i) => profile(firstSkinRing + i).mean));
      assert.ok(belly > wrist.mean * 1.1, 'forearm volume narrows materially toward the wrist');
    }
  } finally { fixture.dispose(); }
});

test('forearm roll changes independently of a fixed palm while the bone and wrist connection stay straight', () => {
  const fixture=makeArms(),arm=fixture.arms[1];
  try {
    const holder=new THREE.Quaternion().setFromEuler(new THREE.Euler(.045,.165,.02));
    const handQ=holder.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0,0,Math.PI-.15)))
      .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-.45,.75,0)));
    const position=new THREE.Vector3(.064,-.153,-.77),shift=new THREE.Vector3();
    const {rings,sections}=arm.fore.geometry.userData;
    const middle=sections.findIndex(t=>t>=.60);
    const axis=()=>ringPoints(arm.fore,middle)[0].sub(ringCentre(arm.fore,middle)).normalize();
    solveViewArm(arm,position,handQ,shift,{forearmQuaternion:handQ,wristFlexLimit:28});
    const beforeAxis=axis(),beforeFrame=arm.forearmQuaternion.clone(),beforeCuff=ringPoints(arm.fore,rings);
    const reference=handQ.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),.6));
    solveViewArm(arm,position,handQ,shift,{forearmQuaternion:reference,wristFlexLimit:28});
    assert.ok(arm.hand.position.distanceTo(position)<1e-10&&arm.hand.quaternion.angleTo(handQ)<1e-6,'changing forearm roll cannot move the palm off its grip');
    assert.ok(beforeAxis.angleTo(axis())>.1,'the actual forearm surface rotates, not only a diagnostic quaternion');
    assert.ok(beforeFrame.angleTo(arm.forearmQuaternion)>.2);
    assert.ok(arm.forearmQuaternion.clone().multiply(arm.wristQuaternion).angleTo(handQ)<1e-6);
    ringPoints(arm.fore,rings).forEach((point,i)=>assert.ok(point.distanceTo(beforeCuff[i])<1e-7,'the cuff remains aligned to the fixed hand'));
    const bone=new THREE.Line3(arm.elbow,arm.wrist),closest=new THREE.Vector3();
    for(let ring=0;ring<=rings;ring++) {
      const centre=ringCentre(arm.fore,ring);bone.closestPointToPoint(centre,true,closest);
      assert.ok(centre.distanceTo(closest)<.0025,'the anatomical forearm cannot bend into a hose; slight muscle asymmetry is allowed');
    }
    assertJointFacesOutward(arm.fore,'independent forearm roll');
  } finally {fixture.dispose();}
});

test('half gloves expose real finger and nail surfaces with normalized skinning and bounded geometry', () => {
  const fixture = makeArms();
  try {
    for (const arm of fixture.arms) {
      const geo = arm.mesh.geometry, p = geo.attributes.position, weights = geo.attributes.skinWeight, indices = geo.attributes.skinIndex;
      assert.equal(arm.mesh.skeleton.bones.length, 16);
      assert.ok(geo.index.count / 3 < 18000, 'hand stays within its agreed triangle budget');
      for (const sleeve of [arm.fore, arm.upper]) assert.ok(sleeve.geometry.index.count / 3 < 3000);
      const groups = geo.groups;
      assert.deepEqual(groups.map(group => arm.mesh.material[group.materialIndex]), [fixture.materials.glove, fixture.materials.skin, fixture.materials.nail]);
      assert.equal(groups.reduce((count, group) => count + group.count, 0), geo.index.count, 'all triangles have a material');
      let nextIndex = 0;
      for (const group of groups) { assert.equal(group.start, nextIndex, 'material groups cannot overlap or leave holes'); nextIndex += group.count; }
      assert.ok(groupArea(geo, groups[1]) > .0001, 'bare skin is a surface, not an unused material slot');
      assert.ok(groupArea(geo, groups[2]) > .00001, 'visible nails have actual surface area');
      for (let i = 0; i < p.count; i++) {
        let total = 0;
        for (let k = 0; k < 4; k++) {
          const weight = weights.array[i * 4 + k], bone = indices.array[i * 4 + k];
          assert.ok(Number.isFinite(weight) && weight >= 0 && weight <= 1);
          assert.ok(Number.isInteger(bone) && bone >= 0 && bone < arm.mesh.skeleton.bones.length);
          total += weight;
        }
        assert.ok(Math.abs(total - 1) < 1e-6);
      }
      const { parts, digits } = geo.userData;
      assert.equal(digits.length, 5);
      for (const digit of digits) {
        const glove = parts.find(part => part.name === digit.name + '-glove');
        const skin = parts.find(part => part.name === digit.name + '-skin');
        const nail = parts.find(part => part.name === digit.name + '-nail');
        assert.ok(glove && skin && nail, `${digit.name}: half glove, bare finger and nail are present`);
        const furthest = part => {
          let d = 0;
          for (let i = part.vertexStart; i < part.vertexStart + part.vertexCount; i++) d = Math.max(d, digit.base[2] - p.getZ(i));
          return d;
        };
        assert.ok(furthest(skin) > furthest(glove) + .01, `${digit.name}: fingertip extends beyond the glove opening`);
        for (let i = nail.vertexStart; i < nail.vertexStart + nail.vertexCount; i++) {
          let distal = 0;
          for (let k = 0; k < 4; k++) if (indices.array[i * 4 + k] === digit.boneIds[2]) distal += weights.array[i * 4 + k];
          assert.ok(distal > .95, `${digit.name}: nail follows the distal finger joint`);
        }
        const color = geo.attributes.color;
        for (const part of [skin, nail]) for (let i = part.vertexStart; i < part.vertexStart + part.vertexCount; i++) {
          assert.ok(Math.min(color.getX(i), color.getY(i), color.getZ(i)) > .65, 'skin pigmentation must not be multiplied by dark glove vertex colors');
        }
      }
    }
  } finally { fixture.dispose(); }
});

test('left and right hands mirror geometry without reversing exposed finger or nail faces', () => {
  const fixture = makeArms();
  try {
    const [right, left] = fixture.arms.map(arm => arm.mesh.geometry);
    assert.equal(right.attributes.position.count, left.attributes.position.count);
    assert.equal(right.index.count, left.index.count);
    for (const attribute of ['position', 'normal']) {
      const r = right.attributes[attribute], l = left.attributes[attribute];
      for (let i = 0; i < r.count; i++) {
        assert.ok(Math.abs(r.getX(i) + l.getX(i)) < 1e-6);
        assert.ok(Math.abs(r.getY(i) - l.getY(i)) < 1e-6);
        assert.ok(Math.abs(r.getZ(i) - l.getZ(i)) < 1e-6);
      }
    }
    for (const geo of [right, left]) {
      const p = geo.attributes.position, normal = geo.attributes.normal;
      for (const digit of geo.userData.digits) {
        const skin = geo.userData.parts.find(part => part.name === digit.name + '-skin');
        let outward = 0, checked = 0;
        for (let i = skin.vertexStart; i < skin.vertexStart + skin.vertexCount; i++) {
          const x = p.getX(i) - digit.base[0], y = p.getY(i) - digit.base[1];
          if (Math.hypot(x, y) < .001) continue;
          checked++; if (x * normal.getX(i) + y * normal.getY(i) > 0) outward++;
        }
        assert.ok(checked > 20 && outward / checked > .99, `${digit.name}: finger side normals face away from its centreline`);
        const nail = geo.userData.parts.find(part => part.name === digit.name + '-nail');
        for (let i = nail.vertexStart; i < nail.vertexStart + nail.vertexCount; i++) assert.ok(normal.getY(i) > 0, `${digit.name}: nail face points dorsally`);
      }
      const nailGroup = geo.groups.find(group => group.materialIndex === 2), index = geo.index;
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      for (let i = nailGroup.start; i < nailGroup.start + nailGroup.count; i += 3) {
        a.fromBufferAttribute(p, index.getX(i)); b.fromBufferAttribute(p, index.getX(i + 1)); c.fromBufferAttribute(p, index.getX(i + 2));
        assert.ok(b.sub(a).cross(c.sub(a)).y > 0, 'mirrored nail triangles remain front-facing');
      }
    }
  } finally { fixture.dispose(); }
});

test('animated fingers stay finite and sleeves remain connected while wrist roll changes', () => {
  const fixture = makeArms();
  const poses = ['open', 'grip', 'support', 'pistol-support', 'magazine', 'rack', 'knife', 'grenade'];
  try {
    for (const arm of fixture.arms) for (let pose = 0; pose < poses.length; pose++) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(.15 + pose * .08, -.3 + pose * .09, -.9 + pose * .37));
      const position = new THREE.Vector3(arm.side === 'R' ? .12 : -.08, -.16 + pose * .007, -.42 - pose * .015);
      for (let step = 0; step < 15; step++) poseGlove(arm, poses[pose], pose % 2, 1 / 60);
      solveViewArm(arm, position, q, new THREE.Vector3(.02, .03, -.02));
      arm.g.updateMatrixWorld(true); arm.mesh.skeleton.update();
      const p = arm.mesh.geometry.attributes.position, point = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        arm.mesh.applyBoneTransform(i, point.fromBufferAttribute(p, i));
        assert.ok(point.toArray().every(Number.isFinite));
        assert.ok(point.length() < .35, `${arm.side}/${poses[pose]}: skin cannot form a stretched spike`);
      }
      for (const sleeve of [arm.fore, arm.upper]) for (const name of ['position', 'normal']) {
        assert.ok(sleeve.geometry.attributes[name].array.every(Number.isFinite));
      }
      for (const sleeve of [arm.fore, arm.upper]) {
        const { rings, sides } = sleeve.geometry.userData, p = sleeve.geometry.attributes.position, n = sleeve.geometry.attributes.normal;
        const first = new THREE.Vector3(), last = new THREE.Vector3();
        for (let ring = 0; ring <= rings; ring++) {
          const begin = ring * (sides + 1), end = begin + sides;
          first.fromBufferAttribute(p, begin); last.fromBufferAttribute(p, end);
          assert.ok(first.distanceTo(last) < 1e-7, 'a sleeve fold must close around its circumference');
          first.fromBufferAttribute(n, begin); last.fromBufferAttribute(n, end);
          assert.ok(first.distanceTo(last) < 1e-7, 'a closed seam must not leave a lighting crease');
        }
        assertJointFacesOutward(sleeve, `${arm.side}/${poses[pose]}/${sleeve === arm.fore ? 'fore' : 'upper'}`);
      }
      const foreEnd = ringCentre(arm.fore, arm.fore.geometry.userData.rings);
      assert.ok(foreEnd.distanceTo(arm.wrist) < 1e-7, 'forearm ends at the glove cuff');
      assert.ok(ringCentre(arm.fore, 0).distanceTo(arm.elbow) < 1e-7);
      assert.ok(ringCentre(arm.upper, arm.upper.geometry.userData.rings).distanceTo(arm.elbow) < 1e-7);
      const upperRing = ringPoints(arm.upper, arm.upper.geometry.userData.rings), foreRing = ringPoints(arm.fore, 0);
      const upperNormals = arm.upper.geometry.attributes.normal, foreNormals = arm.fore.geometry.attributes.normal;
      const upperStart = arm.upper.geometry.userData.rings * (arm.upper.geometry.userData.sides + 1);
      for (let i = 0; i < upperRing.length; i++) {
        let nearest = 0;
        for (let j = 1; j < foreRing.length; j++) if (upperRing[i].distanceToSquared(foreRing[j]) < upperRing[i].distanceToSquared(foreRing[nearest])) nearest = j;
        assert.ok(upperRing[i].distanceTo(foreRing[nearest]) < 1e-7, 'upper arm and forearm share the elbow surface, allowing reversed ring phase');
        const n1 = new THREE.Vector3().fromBufferAttribute(upperNormals, upperStart + i), n2 = new THREE.Vector3().fromBufferAttribute(foreNormals, nearest);
        assert.ok(n1.dot(n2) > .85, 'elbow shading cannot flip or form a hard orientation break');
      }
      const { rings, sides } = arm.fore.geometry.userData;
      const cuffAxis = new THREE.Vector3().fromBufferAttribute(arm.fore.geometry.attributes.position, rings * (sides + 1)).sub(foreEnd).normalize();
      const wristX = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      assert.ok(cuffAxis.dot(wristX) > .999, 'elliptical cuff rotates with the wrist instead of staying world-up');
      const triangles = cuffTriangles(arm), cuffZ = triangles.flat().map(point => point.z);
      const ray = new THREE.Ray(), hit = new THREE.Vector3();
      for (const point of ringPoints(arm.fore, rings)) {
        const local = arm.hand.worldToLocal(arm.fore.localToWorld(point));
        assert.ok(local.z > Math.min(...cuffZ) + .0001 && local.z < Math.max(...cuffZ) - .0001, 'skin ends inside the glove cuff instead of merely touching its rim');
        ray.set(local, new THREE.Vector3(local.x, local.y, 0).normalize());
        let nearest = Infinity;
        for (const [a, b, c] of triangles) if (ray.intersectTriangle(a, b, c, false, hit)) nearest = Math.min(nearest, local.distanceTo(hit));
        assert.ok(nearest > 0 && nearest < .01, 'the actual cuff surface covers the wrist skin in every radial direction');
      }
    }
  } finally { fixture.dispose(); }
});
