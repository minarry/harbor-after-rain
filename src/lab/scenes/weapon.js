import * as THREE from 'three';
import {ViewModel} from '../../viewmodel.js';
import {audio} from '../../audio.js';
import {box,floor,range,select,toggle,action,camera,check} from '../common.js';
export function create(ctx){
  floor(ctx);box(ctx,[0,1.4,-7],[6,2.8,.4],ctx.materials.c3s20.mat);
  const vm=ctx.vm=new ViewModel(ctx.r.vmScene,ctx.T,'BL');vm.equip('m4a1',.01);
  const st={speed:0,onGround:true,crouch:false,ads:0,ammo:30,wetness:.85,light:1,velocityY:0};
  const jointState=a=>({
    forearm:a.forearmQuaternion?.toArray()||null,
    wristRelative:a.wristQuaternion?.toArray()||null,
    hand:a.hand.quaternion.toArray(),
    bendDegrees:Number.isFinite(a.wristBend)?THREE.MathUtils.radToDeg(a.wristBend):null,
    palmDirection:new THREE.Vector3(0,-1,0).applyQuaternion(a.hand.quaternion).toArray(),
  });
  const validJoint=a=>a.forearmQuaternion&&a.wristQuaternion&&Number.isFinite(a.wristBend)
    &&a.forearmQuaternion.clone().multiply(a.wristQuaternion).angleTo(a.hand.quaternion)<1e-5;
  let scrub=-1,shots=0;vm.onAction=e=>{if(e.type==='mechanism'||e.type==='reload')audio.playReload(vm.id,e.phase);if(e.type==='shell'&&ctx.fx)ctx.fx.ejectShell(vm.ejectionWorld(ctx.camera,ctx.r.vmCamera),new THREE.Vector3(0,0,-1));};
  return {cameras:[camera('overview','第一人称',[0,1.65,6],[0,1.65,-5])],lockCamera:true,
    controls:[select('weapon','武器','m4a1',['m4a1','ak47','mp5','awm','deagle','knife','he']),range('ads','瞄准进度',0,0,1),range('speed','行走速度',0,0,7,.1),toggle('crouch','下蹲',false),range('wetness','枪械湿度',.85,0,1),range('reloadPhase','换弹逐帧（−1 自动）',-1,-1,1,.01)],
    actions:[action('fire','射击'),action('reload','空仓换弹'),action('inspect','检视武器'),action('cancel','恢复持枪')],
    control(k,v){if(k==='weapon'){vm.equip(v,.35);scrub=-1;}else if(k==='reloadPhase'){scrub=v;if(v>=0){vm.reload(2.6,true);vm.anim.t=v*2.6;}}else st[k]=v;},
    action(id){scrub=-1;if(id==='fire'){if(vm.id==='knife')vm.melee(false);else if(vm.id==='he')vm.throwNade();else{vm.fire();audio.playShot(vm.id);shots++;ctx.fx.impact(new THREE.Vector3(0,1.5,-6.75),new THREE.Vector3(0,0,1),'metal',new THREE.Vector3(0,0,-1));}}if(id==='reload'){vm.reload(2.6,true);audio.playReload(vm.id,'start');}if(id==='inspect')vm.inspect();if(id==='cancel')vm.cancelAnim();},
    update(dt){st.fireHeld=vm.flashT>0;if(scrub>=0){if(!vm.anim||vm.anim.type!=='reload')vm.reload(2.6,true);vm.drawT=1;vm.anim.t=scrub*2.6;for(const arm of Object.values(vm.arms))arm.poseReady=false;vm.update(0,st);}else vm.update(dt,st);},
    checks:()=>[check('双手使用独立骨骼',Object.keys(vm.arms).length===2),check('握点位置有效',Object.values(vm.arms).every(a=>a.hand.position.toArray().every(Number.isFinite))),check('手掌与前臂关节组合有效',Object.values(vm.arms).filter(a=>a.g.visible).every(validJoint)),check('半指手套、皮肤和指甲独立材质',Object.values(vm.arms).every(a=>[0,1,2].every(i=>a.mesh.geometry.groups.some(g=>g.materialIndex===i&&g.count>0)))),check('换弹定格不叠加抽枪姿态',scrub<0||vm.drawT===1),check('枪口挂点存在',!!vm.parts.muzzle||['knife','he'].includes(vm.id))],
    metrics:()=>({武器:vm.id,动作:vm.anim?.type||'持枪',动作进度:vm.anim?(vm.anim.t/vm.anim.dur).toFixed(2):'—',射击次数:shots,
      左腕弯曲:Number.isFinite(vm.arms.L.wristBend)?`${THREE.MathUtils.radToDeg(vm.arms.L.wristBend).toFixed(1)}°`:'—',
      右腕弯曲:Number.isFinite(vm.arms.R.wristBend)?`${THREE.MathUtils.radToDeg(vm.arms.R.wristBend).toFixed(1)}°`:'—'}),
    report:()=>({weapon:vm.id,animation:vm.anim?.type||null,ads:vm.ads,shots,drawProgress:vm.drawT,hands:Object.fromEntries(Object.entries(vm.arms).map(([side,a])=>[side,{pose:a.poseKind,triangles:a.mesh.geometry.index.count/3,materials:a.mesh.material.map(m=>m.name),joint:jointState(a)}]))})};
}
