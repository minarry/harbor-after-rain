import * as THREE from 'three';
import {floor,label,range,select,camera,check} from '../common.js';
import {makeChannelMaterial} from '../material-inspector.js';
export function create(ctx){
  floor(ctx,40,24);
  const keys=['deck','c0s20','c1s20','c3s20','c4door','c5roof','crate1','crate2','bulkhead','darkSteel','yellow','red','green','steel','black','wood','hull','lamp'];
  const materials=keys.map(k=>ctx.materials[k].mat),base=materials.map(m=>({roughness:m.roughness,normal:m.normalScale.clone()})),samples=[],channelCache=new Map();
  keys.forEach((k,i)=>{
    const x=(i%6-2.5)*3.4,z=(Math.floor(i/6)-1)*4;
    const sphere=new THREE.Mesh(new THREE.SphereGeometry(.7,32,20),materials[i]);sphere.position.set(x,.75,z);sphere.castShadow=sphere.receiveShadow=true;ctx.scene.add(sphere);
    const cube=new THREE.Mesh(new THREE.BoxGeometry(1.3,1.3,.18),materials[i]);cube.position.set(x,1.9,z-.7);cube.castShadow=cube.receiveShadow=true;ctx.scene.add(cube);label(ctx,k,[x,.1,z+1.1],2.4);
    samples.push({mesh:sphere,original:materials[i]},{mesh:cube,original:materials[i]});
  });
  let channel='shaded';
  function showChannel(next){channel=next;for(const sample of samples){if(next==='shaded'){sample.mesh.material=sample.original;continue;}const key=sample.original.uuid+':'+next;let material=channelCache.get(key);if(!material){material=makeChannelMaterial(sample.original,next);channelCache.set(key,material);}sample.mesh.material=material;}ctx.r.setFeatures({post:next==='shaded'});}
  return {cameras:[camera('overview','材质墙',[15,12,22],[0,1,0]),camera('close','锈蚀与漆面',[-6,3.7,8],[-5,1.1,0]),camera('metal','金属与木材',[8,4.3,10],[5,1,4])],
    controls:[range('wetness','表面湿度',.85,0,1),range('roughness','粗糙度倍率',1,.25,1.5),range('normal','表面凹凸',1,0,2),select('channel','纹理通道','shaded',[{value:'shaded',label:'完整材质'},{value:'color',label:'颜色'},{value:'normal',label:'法线'},{value:'roughness',label:'粗糙度 · G'},{value:'metalness',label:'金属度 · B'},{value:'occlusion',label:'表面遮蔽 · R'},{value:'oxide',label:'锈层遮罩 · A'}])],
    control(k,v){if(k==='wetness')ctx.env.atmosphere.setWetness(v);if(k==='roughness'){materials.forEach((m,i)=>m.roughness=Math.min(1,base[i].roughness*v));for(const m of channelCache.values())m.dispose();channelCache.clear();if(channel!=='shaded')showChannel(channel);}if(k==='normal')materials.forEach((m,i)=>m.normalScale.copy(base[i].normal).multiplyScalar(v));if(k==='channel')showChannel(v);},
    afterEnvironment(){materials.forEach((m,i)=>base[i].roughness=m.roughness);},
    checks:()=>[check('与地图共用材质工厂',materials.length===18),check('数据贴图使用线性色彩空间',materials.every(m=>[m.normalMap,m.roughnessMap].every(t=>!t||t.colorSpace===THREE.NoColorSpace)))],metrics:()=>({材质样本:materials.length,有法线贴图:materials.filter(m=>m.normalMap).length,共享磨损遮罩:materials.filter(m=>m.userData.pbrSource?.schema===2).length,查看通道:channel}),report:()=>({materials:materials.map((m,i)=>({id:keys[i],source:m.userData.pbrSource||null,layers:m.map?.userData.layerStats||null,hasRoughness:!!m.roughnessMap,hasMetalness:!!m.metalnessMap})),channel})};
}
