// One scene per document: selection/reset reloads the document, releasing its GL
// context, pooled resources and listeners as a unit. No accumulating hidden games.
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {Renderer} from '../render.js';
import {Environment} from '../env.js';
import {Effects} from '../effects.js';
import {World} from '../physics.js';
import {buildTextures,mulberry32} from '../textures.js';
import {createSurfaceMaterials} from '../surface-materials.js';
import {SEA_Y} from '../map.js';
import {audio} from '../audio.js';
import {renderPanel} from './panel.js';
import {LAB_MODULES,findLabModule} from './catalog.js';
import {LAB_IDS,STEP,parseLabConfig,validateControl,withRandom} from './config.js';
import * as render from './scenes/render.js';
import * as mats from './scenes/mats.js';
import * as props from './scenes/props.js';
import * as level from './scenes/level.js';
import * as backdrop from './scenes/backdrop.js';
import * as ground from './scenes/ground.js';
import * as fx from './scenes/fx.js';
import * as weapon from './scenes/weapon.js';
import * as enemies from './scenes/enemies.js';
const scenes={render,mats,props,level,backdrop,ground,fx,weapon,enemies};

export async function startLab(){
  const config=parseLabConfig(location.search),entry=findLabModule(config.id),errors=[];
  const error=e=>{errors.push(String(e?.message||e?.reason||e));};
  window.addEventListener('error',error);window.addEventListener('unhandledrejection',error);
  document.title=`${entry.title} · 运输船模块展示场`;
  document.body.classList.add('lab-mode');document.querySelector('#ui').hidden=true;
  let ctx,definition,orbit,ready=false,paused=config.shot,time=0,frame=0,currentCamera=config.camera,uiClock=0;
  const rng=mulberry32(config.seed),seeded=fn=>withRandom(rng,fn),values={};
  const url=(id=config.id,reset=false)=>{
    const u=new URL(location.href);u.search='';u.searchParams.set('lab',id);u.searchParams.set('seed',config.seed);u.searchParams.set('q',config.quality);
    if(id===config.id&&!reset){u.searchParams.set('cam',currentCamera);u.searchParams.set('c',JSON.stringify(values));if(ready)u.searchParams.set('view',JSON.stringify([...ctx.orbitPosition.toArray(),...orbit.target.toArray(),r.camera.fov]));}
    if(config.shot||paused){u.searchParams.set('shot','1');u.searchParams.set('t',ready?Math.min(30,Math.round(time*1e6)/1e6):config.time);}return u;
  };
  const navigate=(id,reset=false)=>{if(!LAB_IDS.includes(id))throw new RangeError('未知展示模块');location.assign(url(id,reset));};
  const panel=renderPanel({catalog:LAB_MODULES,selected:config.id,
    onSelect:id=>navigate(id),onControl:(k,v)=>api.control(k,v),onAction:id=>{audio.init();api.action(id);},
    onCamera:id=>api.camera(id),onPause:v=>api.pause(v),onReset:()=>navigate(config.id,true),
    onCopy:async()=>{try{await navigator.clipboard.writeText(url().href);}catch{const input=document.createElement('textarea');input.value=url().href;document.body.append(input);input.select();document.execCommand('copy');input.remove();}},
    onExport:()=>{const blob=new Blob([JSON.stringify(api.snapshot(),null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`harbor-lab-${config.id}-${config.seed}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}});
  panel.update({selected:config.id,title:entry.title,description:'正在生成程序材质与场景…',loading:true});
  await new Promise(resolve=>requestAnimationFrame(resolve));
  const canvas=document.querySelector('#c');panel.viewport.append(canvas);
  const r=new Renderer(canvas,config.quality);r.adaptive=false;
  const T=seeded(()=>buildTextures(config.quality)),world=new World();world.setWaterLevel(SEA_Y);
  ctx={r,T,world,scene:r.scene,camera:r.camera,viewport:panel.viewport,materials:createSurfaceMaterials(T),time:0,labConfig:config};
  definition=seeded(()=>scenes[config.id].create(ctx));world.build();
  ctx.env=seeded(()=>new Environment(r.renderer,r.scene,config.quality));ctx.env.extraScenes=[r.vmScene];ctx.env.apply('dusk');ctx.env.setWorld(world);
  ctx.env.atmosphere.registerScene(r.scene);
  definition.afterEnvironment?.();
  ctx.fx=seeded(()=>new Effects(r.scene,T,r.camera));ctx.fx.setWorld(world);ctx.fx.setWaterHeightSampler((x,z)=>ctx.env.waterHeightAt(x,z,time));
  ctx.fx.onShellImpact=(p,surface,energy)=>audio.playShellDrop(p,{surface,energy});
  r.setFeatures({autoExposure:false});
  ctx.env.atmosphere.setWeather({rain:['ground','backdrop','level'].includes(config.id)?.85:0,wetness:.85,immediate:true});
  orbit=new OrbitControls(r.camera,canvas);orbit.enableDamping=false;orbit.minDistance=.5;orbit.maxDistance=400;orbit.enabled=!definition.lockCamera;
  const resize=()=>{const b=panel.viewport.getBoundingClientRect();r.resize(b.width,b.height);if(ready)renderFrame();};
  const observer=new ResizeObserver(resize);observer.observe(panel.viewport);resize();
  function setCamera(id){
    const preset=definition.cameras.find(c=>c.id===id)||definition.cameras[0];currentCamera=preset.id;r.camera.position.set(...preset.pos);orbit.target.set(...preset.target);r.camera.fov=config.id==='weapon'?78:60;r.camera.updateProjectionMatrix();orbit.update();ctx.orbitPosition=r.camera.position.clone();ctx.orbitQuaternion=r.camera.quaternion.clone();definition.onCamera?.(preset.id);
  }
  setCamera(config.camera);
  if(config.view){r.camera.position.fromArray(config.view);orbit.target.fromArray(config.view,3);r.camera.fov=config.view[6];r.camera.updateProjectionMatrix();orbit.update();ctx.orbitPosition=r.camera.position.clone();ctx.orbitQuaternion=r.camera.quaternion.clone();}
  function stepOne(){
    time+=STEP;frame++;ctx.time=time;
    // Reset the camera baseline before applying the shared damage response.
    if(config.id==='enemies'){r.camera.position.copy(ctx.orbitPosition);r.camera.quaternion.copy(ctx.orbitQuaternion);}
    seeded(()=>{ctx.map?.update(STEP,time);ctx.env.update(STEP,time,r.camera.position);definition.update?.(STEP,time);ctx.fx.update(STEP,time,r.camera,ctx.env.shipSpeed);});
    if(audio.ready){audio.setListener(r.camera.position,r.camera.getWorldDirection(new THREE.Vector3()),r.camera.up);audio.setEnvironment({rain:ctx.env.atmosphere.rainLevel,indoor:1-ctx.env.atmosphere.exposure});audio.update(STEP);}
    r.fx.uniforms.uTime.value=time;r.haze.uniforms.uTime.value=time;
  }
  function renderFrame(){withRandom(mulberry32(config.seed^0x51a7),()=>r.render());}
  function metrics(){const i=r.renderer.info;return {绘制调用:i.render.calls,三角形:i.render.triangles,几何体:i.memory.geometries,纹理:i.memory.textures,固定步长:'1 / 60 s',...definition.metrics?.()};}
  function updatePanel(){panel.update({selected:config.id,title:entry.title,description:entry.description,controls:definition.controls.map(d=>({...d,value:values[d.key]})),actions:definition.actions||[],cameraPresets:definition.cameras,camera:currentCamera,paused,time,metrics:metrics(),checks:definition.checks?.()||[],errors,referenceEvidence:entry.referenceEvidence,loading:false});}
  const api=window.__lab={
    schemaVersion:1,modules:LAB_IDS,get ready(){return ready;},get id(){return config.id;},
    select:id=>navigate(id),reset:()=>navigate(config.id,true),
    pause(value=true){paused=!!value;updatePanel();return paused;},
    control(key,value){const def=definition.controls.find(d=>d.key===key);value=validateControl(def,value);const previous=values[key];values[key]=value;if(ready&&def.reload&&previous!==value){navigate(config.id);return value;}seeded(()=>definition.control?.(key,value));if(ready){renderFrame();updatePanel();}return value;},
    action(id){if(!(definition.actions||[]).some(a=>a.id===id))throw new RangeError('未知动作');seeded(()=>definition.action?.(id));if(paused){stepOne();stepOne();}renderFrame();updatePanel();return this.snapshot();},
    camera(id){if(!definition.cameras.some(c=>c.id===id))throw new RangeError('未知视角');setCamera(id);renderFrame();updatePanel();return r.camera.position.toArray();},
    step(frames=1){if(!Number.isInteger(frames)||frames<1||frames>1800)throw new RangeError('步数应为 1–1800');paused=true;for(let i=0;i<frames;i++)stepOne();renderFrame();updatePanel();return this.snapshot();},
    snapshot(){return {schemaVersion:1,build:'1.4.7',module:config.id,seed:config.seed,time,frame,paused,quality:config.quality,controls:{...values},camera:{preset:currentCamera,position:r.camera.position.toArray(),target:orbit.target.toArray(),fov:r.camera.fov},renderer:r.getFeatures(),weather:ctx.env.atmosphere.getWeather(),metrics:metrics(),checks:definition.checks?.()||[],errors:[...errors],details:definition.report?.()||{},url:url().href,urlTimeClamped:time>30};},
    debug:ctx,
  };
  for(const d of definition.controls)api.control(d.key,d.value);
  for(const [key,value] of Object.entries(config.controls)){try{api.control(key,value);}catch{/* Ignore malformed imported controls; defaults remain. */}}
  for(let i=0;i<Math.round(config.time/STEP);i++)stepOne();
  renderFrame();renderFrame();ready=true;window.__ready=true;updatePanel();
  orbit.addEventListener('change',()=>{if(!ready)return;ctx.orbitPosition=r.camera.position.clone();ctx.orbitQuaternion=r.camera.quaternion.clone();if(paused)renderFrame();});
  function loop(){if(!paused){stepOne();renderFrame();}if(++uiClock%20===0)updatePanel();requestAnimationFrame(loop);}requestAnimationFrame(loop);
  window.addEventListener('pagehide',()=>{observer.disconnect();orbit.dispose();audio.stopAmbient();r.dispose();},{once:true});
  window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
  return api;
}
