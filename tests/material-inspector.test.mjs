import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {resolveMaterialChannel,makeChannelMaterial} from '../src/lab/material-inspector.js';
test('material inspector separates packed ORM data and does not infer oxide from brightness',()=>{
  const orm=new THREE.DataTexture(new Uint8Array([224,181,22,117]),1,1);orm.userData.pbrSource={schema:2};
  const m=new THREE.MeshStandardMaterial({roughness:.7,metalness:.9});m.map=new THREE.Texture();m.map.userData.weatherORM=orm;m.roughnessMap=m.metalnessMap=orm;
  assert.equal(resolveMaterialChannel(m,'roughness').component,1);assert.equal(resolveMaterialChannel(m,'roughness').value,.7);
  assert.equal(resolveMaterialChannel(m,'metalness').component,2);assert.equal(resolveMaterialChannel(m,'oxide').texture,orm);
  assert.equal(resolveMaterialChannel(m,'occlusion').component,0);
  const debug=makeChannelMaterial(m,'metalness');assert.equal(debug.uniforms.tMap.value,orm);assert.equal(debug.uniforms.scalar.value,.9);debug.dispose();
  delete orm.userData.pbrSource;assert.equal(resolveMaterialChannel(m,'oxide').value,0);assert.equal(resolveMaterialChannel(m,'oxide').texture,null);
  assert.throws(()=>resolveMaterialChannel(m,'unknown'));
});
