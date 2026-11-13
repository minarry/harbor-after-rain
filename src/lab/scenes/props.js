import {buildMap} from '../../map.js';
import {toggle,range,check,camera,label} from '../common.js';
export function create(ctx){
  const geometryDetail=ctx.labConfig?.controls?.geometryDetail!==false;
  const map=buildMap(ctx.scene,ctx.T,ctx.world,{showcase:'props',geometryDetail});ctx.map=map;
  for(const [name,x,z] of [['20 英尺货箱 · 门杆 / 角件',0,-1],['木箱 / 金属箱',-6,4.5],['卷边油桶',-.9,4.5],['护栏 / 网格 / 救生圈',6,6.5]])label(ctx,name,[x,.2,z],3.6);
  return {cameras:[camera('overview','道具阵列',[15,11,19],[0,1,0]),camera('cargo','货箱结构',[1.6,3,3],[-2,1.2,-3]),camera('barrel','卷边与桶盖',[1.1,1.7,5.2],[-1, .5,3])],
    controls:[{...toggle('geometryDetail','立体箱体（切换后重开）',geometryDetail),reload:true},toggle('wireframe','查看结构线',false),range('wetness','表面湿度',.85,0,1)],
    control(k,v){if(k==='wireframe')map.meshes.forEach(m=>m.material.wireframe=v);if(k==='wetness')ctx.env.atmosphere.setWetness(v);},
    checks:()=>[check('真实地图预制件',map.galleryCount===10),check('几何按材质合批',map.meshes.length<40),check('碰撞体已生成',ctx.world.colliders.length>4)],metrics:()=>({道具类别:map.galleryCount,材质批次:map.meshes.length,碰撞体:ctx.world.colliders.length,箱体结构:geometryDetail?'真实截面':'平面法线'}),report:()=>({geometryDetail,modelTriangles:map.meshes.reduce((n,m)=>n+(m.geometry.index?.count||m.geometry.attributes.position.count)/3,0)})};
}
