import * as THREE from 'three';
import {box,floor,label,range,toggle,select,galleryCameras,check} from '../common.js';
export function create(ctx){
  const sharpness=ctx.r.getFeatures().sharpness;
  floor(ctx);
  for(let i=0;i<6;i++){
    const m=new THREE.MeshStandardMaterial({color:i<3?0xa1aab2:0xb97537,metalness:i<3?0:1,roughness:.06+(i%3)*.4});
    const s=new THREE.Mesh(new THREE.SphereGeometry(.7,40,24),m);s.position.set(-5+i*2,.72,0);s.castShadow=s.receiveShadow=true;ctx.scene.add(s);
    label(ctx,`${i<3?'介质':'金属'} · ${m.roughness.toFixed(2)}`,[-5+i*2,.15,1.4],1.7);
  }
  for(let i=0;i<5;i++)box(ctx,[-5+i*2.5,2,-3],[1.2,4,.5],ctx.materials.bulkhead.mat);
  box(ctx,[0,4.2,-3],[13,.4,.5],ctx.materials.darkSteel.mat);
  box(ctx,[0,.45,4],[3,.9,1.8],ctx.materials.darkSteel.mat);
  box(ctx,[1,1.35,4.4],[1,.9,1],ctx.materials.yellow.mat);
  box(ctx,[-3,1,3],[.13,2,.13],ctx.materials.lamp.mat);
  // Thin diagonals expose aliasing without relying on a single subjective view.
  const grille=new THREE.Group();grille.position.set(4,1.6,3.4);grille.rotation.z=.16;
  // This AA target must not stripe the adjacent material spheres. The wall,
  // stacked boxes and spheres remain the independent shadow/contact fixtures.
  for(let i=0;i<9;i++){const rod=new THREE.Mesh(new THREE.CylinderGeometry(.018,.018,1.8,8),ctx.materials.steel.mat);rod.position.x=(i-4)*.15;grille.add(rod);}ctx.scene.add(grille);
  return {cameras:[...galleryCameras(),{id:'edges',label:'斜边与细栏杆',pos:[5,2.2,8],target:[3.5,1.5,3.4]}],controls:[toggle('post','完整后期',true),toggle('aa','边缘抗锯齿',true),toggle('sharpen','细节锐化',true),range('sharpness','锐化强度',sharpness,0,.35,.01),toggle('ao','接触遮蔽',true),toggle('haze','空间光雾',true),select('hazeDistribution','光雾采样','near',[{value:'near',label:'近密远疏'},{value:'uniform',label:'均匀采样'}]),toggle('bloom','高光辉光',true),toggle('bloomStable','抑制辉光闪点',true),toggle('softShadows','柔化阴影',true),range('shadowSoftness','阴影柔度',1,0,2,.1),toggle('grade','色彩调整',true),toggle('lens','镜头雨滴',true),range('aoStrength','遮蔽强度',.55,0,1),range('exposure','曝光',.84,.25,2.5),select('toneMapping','高光映射','hybrid',[{value:'hybrid',label:'电影混合'},{value:'agx',label:'AgX'},{value:'aces',label:'ACES'}])],
    control:(k,v)=>ctx.r.setFeatures({[k]:v}),
    checks:()=>[check('使用正式游戏后期链',ctx.r.composer.passes.length>=6),check('场景深度可用于接触遮蔽',!!ctx.r.composer.renderTarget1.depthTexture)],
    metrics:()=>({后期通道:ctx.r.composer.passes.filter(p=>p.enabled).length,曝光:ctx.r.renderer.toneMappingExposure.toFixed(2)})};
}
