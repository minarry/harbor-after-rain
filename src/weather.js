// GPU precipitation, patterned after the reference's instanced rain + crown splashes.
// A static roof-height atlas clips rain against the complete rotated collision world.
import * as THREE from 'three';
import { SEA_Y } from './map.js';

export const ROOF_RECT = new THREE.Vector4(-48, -18, 1 / 96, 1 / 36);
export const ROOF_GLSL = `
uniform sampler2D uRoof; uniform vec4 uRoofRect;
float weatherRoof(vec2 p){vec2 uv=(p-uRoofRect.xy)*uRoofRect.zw;if(uv.x<0.0||uv.y<0.0||uv.x>=1.0||uv.y>=1.0)return ${SEA_Y.toFixed(1)};return texture2D(uRoof,uv).r;}
float weatherExposed(vec3 p){return smoothstep(-.05,.16,p.y-weatherRoof(p.xz));}
`;

export class RoofAtlas {
  constructor() {
    this.width = 512; this.height = 192;
    this.rect = ROOF_RECT.clone();
    this.data = new Float32Array(this.width * this.height); this.data.fill(SEA_Y);
    this.texture = new THREE.DataTexture(this.data, this.width, this.height, THREE.RedFormat, THREE.FloatType);
    this.texture.minFilter = this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false; this.texture.needsUpdate = true;
    this.uniforms = { uRoof: { value: this.texture }, uRoofRect: { value: this.rect } };
    this.ready = false;
  }
  build(world) {
    // Keep roughly 19 cm cells as the playable ship grows. Only real opaque
    // colliders enlarge the atlas; invisible movement fences do not catch rain.
    let minX = -48, maxX = 48, minZ = -18, maxZ = 18;
    for (const c of world.colliders) {
      if (!c.solid || !c.sight || c.top < SEA_Y) continue;
      minX = Math.min(minX, c.minX - .5); maxX = Math.max(maxX, c.maxX + .5);
      minZ = Math.min(minZ, c.minZ - .5); maxZ = Math.max(maxZ, c.maxZ + .5);
    }
    minX = Math.floor(minX); minZ = Math.floor(minZ);
    maxX = Math.ceil(maxX); maxZ = Math.ceil(maxZ);
    const spanX = maxX - minX, spanZ = maxZ - minZ;
    const width = Math.min(1024, Math.ceil(spanX / 3) * 16);
    const height = Math.min(1024, Math.ceil(spanZ / 3) * 16);
    this.rect.set(minX, minZ, 1 / spanX, 1 / spanZ);
    if (width !== this.width || height !== this.height) {
      this.width = width; this.height = height;
      this.data = new Float32Array(width * height);
      // Keep the texture/uniform identity used by all compiled materials.
      this.texture.dispose();
      this.texture.image = { data: this.data, width, height };
    }
    const W = this.width, H = this.height, D = this.data;
    D.fill(SEA_Y);
    for (const c of world.colliders) {
      if (!c.solid || !c.sight || c.top < SEA_Y) continue;
      const x0 = Math.max(0, Math.floor((c.minX - .07 - minX) * W / spanX));
      const x1 = Math.min(W - 1, Math.ceil((c.maxX + .07 - minX) * W / spanX));
      const z0 = Math.max(0, Math.floor((c.minZ - .07 - minZ) * H / spanZ));
      const z1 = Math.min(H - 1, Math.ceil((c.maxZ + .07 - minZ) * H / spanZ));
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        const rx = minX + (x + .5) * spanX / W - c.x;
        const rz = minZ + (z + .5) * spanZ / H - c.z;
        if (Math.abs(c.c * rx - c.s * rz) > c.hx + .07 || Math.abs(c.s * rx + c.c * rz) > c.hz + .07) continue;
        const k = z * W + x; if (c.top > D[k]) D[k] = c.top;
      }
    }
    this.texture.needsUpdate = true; this.ready = true;
  }
  heightAt(x, z) {
    // Outside the ship's atlas is open sea, never an extended edge roof.
    const u = (x - this.rect.x) * this.rect.z, v = (z - this.rect.y) * this.rect.w;
    if (!Number.isFinite(u) || !Number.isFinite(v) || u < 0 || u >= 1 || v < 0 || v >= 1) return SEA_Y;
    const xx = Math.min(this.width - 1, Math.floor(u * this.width));
    const zz = Math.min(this.height - 1, Math.floor(v * this.height));
    return this.data[zz * this.width + xx];
  }
  exposureAt(pos) { return pos.y + .18 >= this.heightAt(pos.x, pos.z) ? 1 : 0; }
}

// The rain uses two spatial scales in one batch; impacts use four quads per
// instance (crown, horizontal ring, two ballistic droplets), still one draw.
export const WEATHER_BUDGETS = Object.freeze({
  high: Object.freeze({ rain: 3800, impacts: 560, mist: 48 }),
  medium: Object.freeze({ rain: 2200, impacts: 300, mist: 24 }),
  low: Object.freeze({ rain: 1000, impacts: 128, mist: 0 }),
});

function instancedQuads(count, seed, parts = 1) {
  const geometry = new THREE.InstancedBufferGeometry();
  const positions = [], kinds = [], indices = [];
  for (let q = 0; q < parts; q++) {
    positions.push(-.5, 0, 0, .5, 0, 0, -.5, 1, 0, .5, 1, 0);
    kinds.push(q, q, q, q);
    const n = q * 4; indices.push(n, n + 1, n + 2, n + 2, n + 1, n + 3);
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aPart', new THREE.Float32BufferAttribute(kinds, 1));
  geometry.setIndex(indices);
  const seeds = new Float32Array(count * 4);
  let a = seed;
  for (let i = 0; i < seeds.length; i++) { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; seeds[i] = a / 4294967296; }
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  geometry.instanceCount = count;
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100000);
  return geometry;
}

const LIGHT_GLSL = `
uniform vec3 uSunDir,uSunColor,uAmbient;uniform sampler2DShadow uShadow;uniform mat4 uShadowMatrix;uniform float uShadowOn;
float rainPhase(float c){float g=.7;return (1.0-g*g)/(12.566*pow(max(.04,1.0+g*g-2.0*g*c),1.5));}
float rainLit(vec3 p){if(uShadowOn<.5)return 1.0;vec4 q=uShadowMatrix*vec4(p,1);q.xyz/=max(q.w,.001);if(q.x<0.0||q.x>1.0||q.y<0.0||q.y>1.0||q.z<0.0||q.z>1.0)return 1.0;return texture(uShadow,vec3(q.xy,q.z-.0006));}
vec3 rainLight(vec3 p){vec3 eyeRay=p-cameraPosition;eyeRay/=max(length(eyeRay),.001);return uAmbient+uSunColor*rainPhase(dot(eyeRay,uSunDir))*rainLit(p);}
`;
const HASH_GLSL = `
vec2 weatherHash(vec2 p){vec3 q=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));q+=dot(q,q.yzx+33.33);return fract((q.xx+q.yz)*q.zy);}
`;

const RAIN_VERT = `
attribute vec4 aSeed;uniform float uTime,uPixel,uLevel;uniform vec3 uCenter,uWind;
varying vec2 vUv;varying float vAlpha;varying vec3 vCol,vWorld;
${ROOF_GLSL}${LIGHT_GLSL}
void main(){
  vUv=position.xy;
  float farLayer=step(.64,aSeed.w);
  vec3 box=mix(vec3(26.0,18.0,24.0),vec3(64.0,30.0,58.0),farLayer);
  vec3 vel=uWind*(.84+.34*fract(aSeed.w*7.31));
  vec3 p=aSeed.xyz*box+vel*uTime;
  p=mod(p-uCenter+box*.5,box)-box*.5+uCenter;
  // Coherent lateral gusts move each layer without respawning CPU particles.
  p.x+=sin(uTime*.68+p.z*.035)*(.2+.45*farLayer);
  float distanceToEye=length(p-cameraPosition);
  float chance=fract(aSeed.w*7.13+aSeed.x);
  float kill=step(p.y,weatherRoof(p.xz)+.09)+step(uLevel,chance);
  vec3 direction=normalize(vel);vec3 toP=p-cameraPosition;
  vec3 side=cross(direction,toP);side/=max(length(side),.0001);
  float physicalWidth=mix(.006+.004*aSeed.z,.008+.003*aSeed.z,farLayer);
  float width=max(physicalWidth,distanceToEye*uPixel*mix(.85,.7,farLayer));
  float streakLength=length(vel)*mix(.027,.045,farLayer)*(.8+.4*aSeed.x);
  vec3 world=p+direction*streakLength*(position.y-.5)+side*width*position.x;
  vWorld=world;
  float nearFade=smoothstep(.45,1.4,distanceToEye);
  float farFade=1.0-smoothstep(mix(10.0,24.0,farLayer),mix(17.0,34.0,farLayer),distanceToEye);
  float layerFade=mix(1.0,smoothstep(8.0,14.0,distanceToEye),farLayer);
  vAlpha=(physicalWidth/width)*nearFade*farFade*layerFade*(.68+.32*aSeed.z)*mix(1.0,.75,farLayer);
  vCol=min(rainLight(p),vec3(2.1));
  gl_Position=kill>.5?vec4(2,2,2,1):projectionMatrix*viewMatrix*vec4(world,1);
}`;
const RAIN_FRAG = `
varying vec2 vUv;varying float vAlpha;varying vec3 vCol,vWorld;
${ROOF_GLSL}
void main(){
 // Per-fragment tip clipping avoids stretching a streak at a cabin edge.
 if(vWorld.y<weatherRoof(vWorld.xz)+.025)discard;
 float edge=pow(max(0.0,1.0-abs(vUv.x)*2.0),.7);
 float ends=smoothstep(0.0,.10,vUv.y)*(1.0-smoothstep(.7,1.0,vUv.y));
 gl_FragColor=vec4(vCol,vAlpha*edge*ends*.9);
}`;

const SPLASH_VERT = `
attribute vec4 aSeed;attribute float aPart;uniform float uTime,uLevel;uniform vec3 uCenter;
varying vec2 vUv;varying float vLife,vAlpha,vKind,vImpactSeed;varying vec3 vCol,vWorld;
${ROOF_GLSL}${LIGHT_GLSL}${HASH_GLSL}
void main(){
 vUv=position.xy;vKind=aPart;
 float period=.38+.18*aSeed.z;float tt=uTime/period+aSeed.w*13.0;float cycle=floor(tt);float life=fract(tt);vLife=life;
 vImpactSeed=fract(aSeed.x*17.1+aSeed.z*3.7+cycle*.371);
 vec2 rnd=weatherHash(aSeed.xy*91.7+cycle*.371)-.5;
 rnd*=.4+1.2*abs(rnd); // Spend the splash budget on readable close impacts.
 vec2 xz=floor(uCenter.xz/3.0)*3.0+rnd*28.0;
 float roof=weatherRoof(xz);vec3 p=vec3(xz.x,roof+.018,xz.y);
 float kill=step(uLevel,fract(aSeed.w*5.3+cycle*.17))+step(7.0,abs(roof-cameraPosition.y));
 if(roof<${(SEA_Y + .5).toFixed(1)})kill=1.0;
 vec3 toP=p-cameraPosition;float dist=length(toP);vec3 side=vec3(toP.z,0,-toP.x)/max(length(toP.xz),.001);
 float size=.045+.05*aSeed.z*aSeed.z;vec3 world;
 if(aPart<.5){
   float crownLife=clamp(life/.68,0.0,1.0);
   float width=size*(.7+1.7*crownLife),height=size*(.3+1.6*sin(crownLife*3.14159));
   world=p+side*width*position.x*2.0+vec3(0,height*position.y,0);
   vAlpha=(1.0-crownLife)*(1.0-crownLife)*1.2;
 }else if(aPart<1.5){
   // Mostly small drops, with occasional broader rings. Large, equally sized
   // opaque circles read as markers instead of rain on a thin water film.
   float radius=.014+life*(.055+.13*vImpactSeed*vImpactSeed);
   world=p+vec3(position.x*radius*2.0,0.0,(position.y-.5)*radius*2.0);
   vAlpha=smoothstep(0.0,.05,life)*pow(1.0-life,1.6)*.58;
 }else{
   // Detached droplets follow a short ballistic arc, rather than growing
   // upward with the crown. Each impact has two independently angled drops.
   float angle=aSeed.x*6.283+aPart*2.4;float age=life*period;
   float radial=age*(.32+.32*aSeed.y);
   float lift=(1.2+.35*aSeed.z)*age-4.9*age*age;
   vec3 center=p+vec3(cos(angle)*radial,max(0.0,lift),sin(angle)*radial);
   float dropSize=.013+.007*aSeed.y;
   world=center+side*position.x*dropSize+vec3(0,(position.y-.5)*dropSize*1.6,0);
   vAlpha=(1.0-smoothstep(.13,.27,age))*step(.003,lift);
 }
 vWorld=world;vAlpha*=(1.0-smoothstep(8.0,16.0,dist))*smoothstep(.3,.8,dist);
 vCol=min(rainLight(p)*1.1+uAmbient*.35,vec3(1.6));
 gl_Position=kill>.5?vec4(2,2,2,1):projectionMatrix*viewMatrix*vec4(world,1);
}`;
const SPLASH_FRAG = `
varying vec2 vUv;varying float vLife,vAlpha,vKind,vImpactSeed;varying vec3 vCol,vWorld;
${ROOF_GLSL}
void main(){
 if(vWorld.y<weatherRoof(vWorld.xz)-.01)discard;
 float shape;
 if(vKind<.5){
   vec2 p=vec2(vUv.x*2.0,vUv.y);
   float dome=length(p*vec2(1.0,1.6));
   float lobes=.68+.32*cos(p.x*15.0+vLife*3.0);
   float crown=exp(-pow((dome-.68)/.17,2.0))*lobes*(1.0-smoothstep(.5,.95,p.y));
   float impactCore=exp(-dot(vec2(p.x*1.4,(p.y-.12)*2.4),vec2(p.x*1.4,(p.y-.12)*2.4))*18.0)*(1.0-smoothstep(.0,.25,vLife));
   shape=crown*.65+impactCore*.6;
 }else if(vKind<1.5){
   if(abs(vWorld.y-weatherRoof(vWorld.xz))>.12)discard;
   vec2 q=vec2(vUv.x*2.0,(vUv.y-.5)*2.0);
   float r=length(q),angle=atan(q.y,q.x),phase=vImpactSeed*6.283;
   float crestRadius=.81+.025*sin(angle*5.0+phase)+.012*sin(angle*9.0-phase);
   float aa=max(fwidth(r),.001),lineWidth=.017+.008*vLife;
   float width=max(lineWidth,aa*.75);
   float ring=exp(-pow((r-crestRadius)/width,2.0));
   float second=exp(-pow((r-.53)/width,2.0))*smoothstep(.25,.55,vLife)*.15;
   // Specular glints occupy uneven arcs; the underlying normal-map ripples
   // supply the rest of the water disturbance without painting a white disk.
   float arc=(.5+.5*sin(angle*3.0+phase))*(.5+.5*sin(angle*7.0-phase*.81+vLife*.5));
   float glint=.12+.88*smoothstep(.12,.57,arc);
   shape=(ring+second)*glint*min(1.0,lineWidth/aa*1.7)*.42;
 }else{
   vec2 p=vec2(vUv.x*2.0,(vUv.y-.5)*2.0);
   shape=exp(-dot(p,p)*3.6);
 }
 float alpha=shape*vAlpha;
 if(alpha<.006)discard;
 gl_FragColor=vec4(vCol,alpha);
}`;

const MIST_VERT = `
attribute vec4 aSeed;uniform float uTime,uLevel;uniform vec3 uCenter;
varying vec2 vUv;varying float vAlpha;varying vec3 vCol,vWorld;
${ROOF_GLSL}${LIGHT_GLSL}${HASH_GLSL}
void main(){
 vUv=position.xy;float tt=uTime/(2.0+aSeed.z)+aSeed.w*9.0;float life=fract(tt);
 vec2 rnd=weatherHash(aSeed.xy*41.0+floor(tt)*.77)-.5;
 vec2 xz=floor(uCenter.xz/4.0)*4.0+rnd*32.0;
 float roof=weatherRoof(xz);vec3 p=vec3(xz.x,roof+.055,xz.y);
 float kill=step(5.0,abs(roof-cameraPosition.y));if(roof<${(SEA_Y + .5).toFixed(1)})kill=1.0;
 vec3 toP=p-cameraPosition;float dist=length(toP);vec3 side=vec3(toP.z,0,-toP.x)/max(length(toP.xz),.001);
 float width=1.4+aSeed.y*1.5,height=.16+.26*aSeed.x;
 vec3 world=p+side*width*position.x+vec3(-life*.45,height*position.y,life*.13);
 vWorld=world;
 vAlpha=sin(life*3.14159)*smoothstep(2.0,5.0,dist)*(1.0-smoothstep(12.0,19.0,dist))*uLevel*.10;
 vCol=min(uAmbient*1.3+rainLight(p)*.2,vec3(.55));
 gl_Position=kill>.5?vec4(2,2,2,1):projectionMatrix*viewMatrix*vec4(world,1);
}`;
const MIST_FRAG = `
uniform float uTime;varying vec2 vUv;varying float vAlpha;varying vec3 vCol,vWorld;
${ROOF_GLSL}
void main(){
 if(vWorld.y<weatherRoof(vWorld.xz)+.015)discard;
 vec2 q=vec2(vUv.x*2.0,(vUv.y-.4)*1.7);
 float edge=max(0.0,1.0-dot(q,q));
 float grain=.58+.22*sin(vWorld.x*12.0+vWorld.z*7.0-uTime*3.1)+.13*sin(vWorld.x*31.0-vWorld.z*19.0+uTime*5.0);
 float alpha=edge*edge*grain*vAlpha*(1.0-smoothstep(.65,1.0,vUv.y));
 if(alpha<.003)discard;
 gl_FragColor=vec4(vCol,alpha);
}`;

export class Precipitation {
  constructor(scene, quality, roof) {
    this.scene = scene;this.quality = WEATHER_BUDGETS[quality] ? quality : 'high';
    this.budget = WEATHER_BUDGETS[this.quality];this.level = .96;this.targetLevel = .96;
    this.uniforms = {
      ...roof.uniforms, uTime: { value: 0 }, uLevel: { value: this.level }, uPixel: { value: .0018 },
      uCenter: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector3(-2.2, -12.8, .8) },
      uSunDir: { value: new THREE.Vector3(1, .2, .3) }, uSunColor: { value: new THREE.Color() },
      uAmbient: { value: new THREE.Color().setRGB(.12, .17, .19) }, uShadow: { value: null },
      uShadowMatrix: { value: new THREE.Matrix4() }, uShadowOn: { value: 0 },
    };
    const material = (vertexShader, fragmentShader, mist = false) => new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false,
      side: THREE.DoubleSide, blending: mist ? THREE.NormalBlending : THREE.AdditiveBlending, toneMapped: false,
    });
    this.rain = new THREE.Mesh(instancedQuads(this.budget.rain, 3911), material(RAIN_VERT, RAIN_FRAG));
    this.splashes = new THREE.Mesh(instancedQuads(this.budget.impacts, 7801, 4), material(SPLASH_VERT, SPLASH_FRAG));
    this.mist = this.budget.mist ? new THREE.Mesh(instancedQuads(this.budget.mist, 1974), material(MIST_VERT, MIST_FRAG, true)) : null;
    this.rain.name = 'harbor-rain'; this.splashes.name = 'rain-splashes';
    if(this.mist)this.mist.name='rain-ground-mist';
    this.rain.renderOrder = 20;this.splashes.renderOrder = 19;if(this.mist)this.mist.renderOrder=18;
    const before = () => {
      const env = scene.userData.harborEnvironment, shadow = env?.sun.shadow;
      this.uniforms.uShadowOn.value = shadow?.map?.depthTexture ? 1 : 0;
      if (shadow?.map?.depthTexture) { this.uniforms.uShadow.value = shadow.map.depthTexture; this.uniforms.uShadowMatrix.value.copy(shadow.matrix); }
    };
    this.group = new THREE.Group();this.group.name='harbor-precipitation';
    this.group.add(this.rain,this.splashes);if(this.mist)this.group.add(this.mist);
    for(const mesh of this.group.children){mesh.frustumCulled=false;mesh.matrixAutoUpdate=false;mesh.onBeforeRender=before;}
    scene.add(this.group);
  }
  setRain(value, immediate=false) {
    if(!Number.isFinite(value))return;
    this.targetLevel=Math.max(0,Math.min(1,value));
    if(immediate){this.level=this.targetLevel;this.uniforms.uLevel.value=this.level;this.group.visible=this.level>.01;}
  }
  update(dt, time, camera, environment, renderer) {
    const u = this.uniforms;
    const delta=Math.min(.1,Math.max(0,Number.isFinite(dt)?dt:0));
    this.level+=(this.targetLevel-this.level)*(1-Math.exp(-delta*.8));
    if(Math.abs(this.targetLevel-this.level)<.001)this.level=this.targetLevel;
    u.uLevel.value=this.level;this.group.visible=this.level>.01;
    u.uTime.value = time;
    u.uCenter.value.copy(camera);u.uCenter.value.y=camera.y+3.8;
    u.uSunDir.value.copy(environment.sunDir);
    u.uSunColor.value.copy(environment.sun.color).multiplyScalar(1.8);
    u.uAmbient.value.copy(environment.hemi.color).multiplyScalar(.32);
    const activeCamera = this.scene.userData.harborCamera;
    u.uPixel.value = 2 * Math.tan((activeCamera?.fov || 78) * Math.PI / 360) / Math.max(1, renderer.domElement.height);
  }
  dispose() {
    this.group.removeFromParent();
    for(const mesh of this.group.children){mesh.geometry.dispose();mesh.material.dispose();}
  }
}
