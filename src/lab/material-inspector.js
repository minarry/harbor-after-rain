import * as THREE from 'three';

// ORM is data, not a colour image. Inspect one channel with the same scalar
// multiplier as MeshStandardMaterial instead of displaying a misleading RGB map.
export function resolveMaterialChannel(material,channel){
  const orm=material.map?.userData?.weatherORM;
  if(channel==='roughness')return {texture:material.roughnessMap,component:1,value:material.roughness};
  if(channel==='metalness')return {texture:material.metalnessMap,component:2,value:material.metalness};
  if(channel==='occlusion')return {texture:orm||material.aoMap,component:0,value:1};
  if(channel==='oxide')return {texture:orm?.userData?.pbrSource?.schema===2?orm:null,component:3,value:orm?.userData?.pbrSource?.schema===2?1:0};
  if(channel==='normal')return {texture:material.normalMap,component:4,value:1};
  throw new RangeError('Unsupported material data channel');
}
export function makeChannelMaterial(material,channel){
  if(channel==='color')return new THREE.MeshBasicMaterial({map:material.map,color:material.color,toneMapped:false});
  const c=resolveMaterialChannel(material,channel);
  if(c.texture?.matrixAutoUpdate)c.texture.updateMatrix();
  return new THREE.ShaderMaterial({toneMapped:false,uniforms:{tMap:{value:c.texture||null},hasMap:{value:c.texture?1:0},channel:{value:c.component},scalar:{value:c.value},uvTransform:{value:c.texture?.matrix?.clone()||new THREE.Matrix3()}},
    vertexShader:'uniform mat3 uvTransform;varying vec2 vDataUv;void main(){vDataUv=(uvTransform*vec3(uv,1.0)).xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:'uniform sampler2D tMap;uniform float hasMap,channel,scalar;varying vec2 vDataUv;void main(){vec4 t=hasMap>.5?texture2D(tMap,vDataUv):vec4(1.0);vec3 c;if(channel>3.5){c=hasMap>.5?t.rgb:vec3(.5,.5,1.0);}else{float v=channel<.5?t.r:channel<1.5?t.g:channel<2.5?t.b:t.a;c=vec3(clamp(v*scalar,0.0,1.0));}gl_FragColor=vec4(c,1.0);#include <colorspace_fragment>\n}'.replace(';#include',';\n#include')});
}
