import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Renderer } from '../src/render.js';
import { RenderFeatures } from '../src/render-features.js';
import { ContactAOPass } from '../src/contact-ao.js';
import { HarborAtmosphere } from '../src/atmosphere.js';
import { FinalFinishPass } from '../src/final-finish.js';
import { StableBloomPass } from '../src/stable-bloom.js';
import { Environment, shadowFilterRadius } from '../src/env.js';

function renderHarness() {
  const r=Object.create(Renderer.prototype), uniforms=names=>Object.fromEntries(names.map(k=>[k,{value:0}]));
  Object.assign(r,{features:new RenderFeatures(),eyeAdapt:1,renderer:{},scene:{userData:{harborEnvironment:{preset:{exposure:.84},atmosphere:{exposure:0}}}},ao:{enabled:false},
    haze:{enabled:true,uniforms:uniforms(['uAOOn','uHazeOn','uAOStrength','uNearSteps'])},bloom:{enabled:true,strength:.2,highPassUniforms:uniforms(['uStable'])},
    fx:{enabled:true,uniforms:uniforms(['uGrade','uGrain','uVignetteOn','uFeedback','uLensWet'])},output:{uniforms:uniforms(['uAgxMix'])},finish:{enabled:true,uniforms:uniforms(['uAA','uSharpness','uGrain'])}});
  return r;
}

test('post master switch gates actual passes while preserving requested individual settings',()=>{
  const r=renderHarness(), resources=[r.ao,r.haze,r.bloom,r.fx];
  r.setFeatures({ao:true,haze:false,bloom:true,post:false,feedback:false});
  assert.equal(r.ao.enabled,false);assert.equal(r.haze.enabled,false);assert.equal(r.bloom.enabled,false);assert.equal(r.fx.enabled,false);
  assert.equal(r.finish.enabled,false);
  assert.equal(r.getFeatures().ao,true);
  r.setFeatures({post:true});
  assert.equal(r.ao.enabled,true);assert.equal(r.haze.enabled,true);assert.equal(r.haze.uniforms.uHazeOn.value,0);
  assert.equal(r.haze.uniforms.uAOOn.value,1);
  assert.equal(r.finish.uniforms.uAA.value,1);
  r.setFeatures({post:false,feedback:true});assert.equal(r.fx.enabled,true);assert.equal(r.fx.uniforms.uGrade.value,0);
  for(let i=0;i<100;i++)r.setFeatures({post:!!(i%2),ao:!!(i%3),lens:!!(i%2)});
  assert.deepEqual([r.ao,r.haze,r.bloom,r.fx],resources);
});

test('edge AA, bounded sharpening and stable bloom can be compared without recreating their passes',()=>{
  const r=renderHarness(),finish=r.finish,bloom=r.bloom;
  r.setFeatures({aa:false,sharpen:false,grain:false,bloomStable:false,hazeDistribution:'uniform'});
  assert.equal(r.finish.enabled,false);assert.equal(r.bloom.highPassUniforms.uStable.value,0);assert.equal(r.haze.uniforms.uNearSteps.value,0);
  r.setFeatures({aa:true,sharpness:99,sharpen:true});
  assert.equal(r.finish.enabled,true);assert.equal(r.finish.uniforms.uSharpness.value,.35);
  r.setFeatures({sharpness:NaN,hazeDistribution:'invalid'});assert.equal(r.finish.uniforms.uSharpness.value,.35);assert.equal(r.haze.uniforms.uNearSteps.value,0);
  r.setFeatures({post:false});assert.equal(r.finish.enabled,false);assert.equal(r.finish.uniforms.uGrain.value,0);
  for(const quality of ['high','medium','low'])assert.equal(new RenderFeatures(quality).get().aa,true);
  for(let i=0;i<100;i++)r.setFeatures({aa:!!(i%2),bloomStable:!!(i%2),post:!!(i%3)});
  assert.equal(r.finish,finish);assert.equal(r.bloom,bloom);
});

test('final finish tracks actual buffer size and releases its only material once',()=>{
  const pass=new FinalFinishPass(),texel=pass.uniforms.uTexel.value;let disposed=0;
  pass.material.addEventListener('dispose',()=>disposed++);
  pass.setSize(1440,900);assert.equal(texel.x,1/1440);assert.equal(texel.y,1/900);
  pass.setSize(1,0);assert.equal(texel.x,1);assert.equal(texel.y,1);assert.equal(pass.uniforms.uTexel.value,texel);
  pass.dispose();pass.dispose();assert.equal(disposed,1);
});

test('stable bloom reuses its mip chain even at tiny viewport sizes and releases bright material',()=>{
  const pass=new StableBloomPass(new THREE.Vector2(900,600));
  const targets=[pass.renderTargetBright,...pass.renderTargetsHorizontal,...pass.renderTargetsVertical],materials=[pass.materialHighPassFilter,pass.compositeMaterial,pass.blendMaterial,...pass.separableBlurMaterials];
  const texels=pass.separableBlurMaterials.map(m=>m.uniforms.invSize.value);
  pass.setSize(1,1);
  for(const rt of targets){assert.equal(rt.width,1);assert.equal(rt.height,1);}
  pass.setSize(801,451);assert.equal(pass.renderTargetBright.width,401);assert.equal(pass.renderTargetBright.height,226);
  assert.deepEqual(pass.separableBlurMaterials.map(m=>m.uniforms.invSize.value),texels);
  let disposals=0;for(const m of materials)m.addEventListener('dispose',()=>disposals++);
  for(let i=0;i<100;i++)pass.highPassUniforms.uStable.value=i%2;
  assert.deepEqual([pass.renderTargetBright,...pass.renderTargetsHorizontal,...pass.renderTargetsVertical],targets);
  pass.dispose();pass.dispose();assert.equal(disposals,materials.length);
});

test('shadow softness is consistent in metres across quality tiers and hard-edge toggle preserves the map',()=>{
  for(const size of [1024,2048,4096])assert.ok(Math.abs(shadowFilterRadius(100,size)*100/size-.045)<1e-8);
  assert.equal(shadowFilterRadius(100,4096,1,false),0);assert.equal(shadowFilterRadius(0,4096),1);
  const env=Object.create(Environment.prototype);env.sun=new THREE.DirectionalLight();env.shadowOptions={softShadows:true,shadowSoftness:1};
  const shadow=env.sun.shadow;shadow.mapSize.set(2048,2048);shadow.camera.left=-50;shadow.camera.right=50;
  env.setShadowOptions({softShadows:false});assert.equal(shadow.radius,0);
  env.setShadowOptions({softShadows:true,shadowSoftness:NaN});assert.equal(shadow.radius,shadowFilterRadius(100,2048));
  env.setShadowOptions({shadowSoftness:-2});assert.equal(shadow.radius,0);assert.equal(env.sun.shadow,shadow);
});

test('feature snapshots are isolated, invalid inputs ignored and manual exposure ignores frame time',()=>{
  const r=renderHarness();r.setFeatures({exposure:1.12,autoExposure:false,aoStrength:999,bloomStrength:-1,toneMapping:'aces'});
  assert.equal(r.renderer.toneMapping,THREE.ACESFilmicToneMapping);
  for(const dt of [0,16,10000]){r.updateExposure(dt);assert.equal(r.renderer.toneMappingExposure,1.12);}
  const f=r.getFeatures();assert.equal(f.aoStrength,1.5);assert.equal(f.bloomStrength,0);
  f.post=false;assert.equal(r.getFeatures().post,true);
  r.setFeatures({exposure:NaN,post:'false',toneMapping:'invalid'});assert.equal(r.getFeatures().exposure,1.12);assert.equal(r.getFeatures().post,true);
  r.setFeatures({exposure:null});r.updateExposure(1000);assert.equal(r.renderer.toneMappingExposure,.84);
  assert.equal(new RenderFeatures('low').get().ao,false);
  assert.equal(new RenderFeatures().get().toneMapping,'hybrid');
  r.setFeatures({toneMapping:'hybrid'});assert.equal(r.renderer.toneMapping,THREE.AgXToneMapping);assert.equal(r.output.uniforms.uAgxMix.value,.25);
  r.setFeatures({toneMapping:'agx'});assert.equal(r.output.uniforms.uAgxMix.value,1);
});

test('contact AO reuses a bounded half-resolution target and disposes exactly once',()=>{
  const pass=new ContactAOPass(new THREE.PerspectiveCamera());
  let targets=0,materials=0;
  pass.target.addEventListener('dispose',()=>targets++);pass.material.addEventListener('dispose',()=>materials++);
  const target=pass.target,material=pass.material;
  pass.setSize(801,451);assert.equal(target.width,401);assert.equal(target.height,226);
  pass.setSize(1,1);assert.equal(target.width,1);assert.equal(target.height,1);
  const resizeDisposals=targets;
  for(let i=0;i<100;i++)pass.enabled=!!(i%2);
  assert.equal(pass.target,target);assert.equal(pass.material,material);assert.equal(pass.needsSwap,false);
  pass.dispose();pass.dispose();assert.equal(targets,resizeDisposals+1);assert.equal(materials,1);
});

test('wetness and rain are independent live uniforms and later material registration is idempotent',(t)=>{
  const scene=new THREE.Scene(),weather=new HarborAtmosphere({domElement:{height:900}},scene,'high');
  const deck=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.MeshStandardMaterial());deck.userData.weatherSurface='deck';scene.add(deck);
  t.after(()=>{weather.precipitation.dispose();weather.roof.texture.dispose();weather.puddles.dispose();weather.puddles.geometry.dispose();deck.geometry.dispose();deck.material.dispose();});
  assert.equal(weather.registerScene(deck),1);const hook=deck.material.onBeforeCompile;
  assert.equal(weather.registerScene(scene),0);assert.equal(deck.material.onBeforeCompile,hook);
  assert.equal(weather.puddles.material.uniforms.uWetness,weather.wetnessUniform);
  assert.equal(weather.puddles.material.uniforms.uRainAmount,weather.rainUniform);
  weather.setWeather({rain:0,wetness:1,immediate:true});
  assert.equal(weather.precipitation.group.visible,false);assert.equal(weather.rainUniform.value,0);assert.equal(weather.puddles.visible,true);
  weather.setWetness(0);assert.equal(weather.puddles.visible,false);assert.equal(weather.wetnessAt({x:0,y:1,z:0}),0);
  weather.setWeather({rain:1,wetness:0,reflections:false,immediate:true});
  assert.equal(weather.precipitation.group.visible,true);assert.equal(weather.wetnessUniform.value,0);assert.equal(weather.puddles.visible,false);
  weather.setWetness(1);weather.setPerformanceReflections(true);assert.equal(weather.puddles.visible,false);
  weather.setWeather({reflections:true});assert.equal(weather.puddles.visible,true);
  weather.setWeather({rain:NaN,wetness:-1});assert.equal(weather.rainLevel,1);assert.equal(weather.wetness,0);
});
