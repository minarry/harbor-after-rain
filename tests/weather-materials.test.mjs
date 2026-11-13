import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {HarborAtmosphere} from '../src/atmosphere.js';

function attach(material,kind,name=kind){
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(),material);mesh.name=name;mesh.userData.weatherSurface=kind;
  const weather=Object.assign(Object.create(HarborAtmosphere.prototype),{_weatherMaterials:new WeakSet(),_tonedWood:new WeakSet(),uniforms:{uWetness:{value:1}},quality:'high'});
  assert.equal(weather.registerScene(mesh),kind==='deck'||kind==='metal'?1:0);
  return {weather,mesh};
}
function standardShader(material){
  const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
  material.onBeforeCompile(shader,{});return shader;
}
test('weather preserves authored dry deck ORM and binds wetness only once',()=>{
  const orm=new THREE.Texture(),m=new THREE.MeshStandardMaterial({roughnessMap:orm,metalnessMap:orm,roughness:.7,metalness:.2});
  const {weather,mesh}=attach(m,'deck');assert.equal(m.roughness,1);assert.equal(m.metalness,1);
  const first=m.onBeforeCompile;assert.equal(weather.registerScene(mesh),0);assert.equal(m.onBeforeCompile,first);
  const shader=standardShader(m);assert.equal(shader.uniforms.uWetness,weather.uniforms.uWetness);
  assert.match(shader.fragmentShader,/min\(roughnessFactor,\.43\)/);
  assert.doesNotMatch(shader.fragmentShader,/max\(\.65,roughnessFactor\)/);
  mesh.geometry.dispose();m.dispose();orm.dispose();
});
test('cargo reads explicit rust alpha and keeps legacy roughness fallback isolated',()=>{
  const keys=[];
  for(const schema of [2,1]){
    const orm=new THREE.Texture();orm.userData.pbrSource={schema};const map=new THREE.Texture();map.userData.weatherORM=orm;
    const m=new THREE.MeshStandardMaterial({map});const {mesh}=attach(m,'metal');const shader=standardShader(m);
    assert.equal(m.roughnessMap,orm);assert.equal(m.metalnessMap,orm);
    if(schema===2)assert.match(shader.fragmentShader,/float cargoRust=texture2D\(roughnessMap,vRoughnessMapUv\)\.a/);
    else assert.match(shader.fragmentShader,/float cargoRust=smoothstep/);
    keys.push(m.customProgramCacheKey());mesh.geometry.dispose();m.dispose();orm.dispose();map.dispose();
  }
  assert.notEqual(keys[0],keys[1]);
});
test('schema 2 wood keeps its authored colour and roughness under atmosphere registration',()=>{
  const m=new THREE.MeshStandardMaterial({color:0x82725a,roughness:1});m.userData.pbrSource={schema:2};
  const expected=m.color.clone();const {weather,mesh}=attach(m,'wood','crate1');weather.registerScene(mesh);
  assert.equal(m.roughness,1);assert.deepEqual(m.color,expected);mesh.geometry.dispose();m.dispose();
});
