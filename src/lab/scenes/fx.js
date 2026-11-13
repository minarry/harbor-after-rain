import * as THREE from 'three';
import {audio} from '../../audio.js';
import {box,floor,label,select,action,camera,check,range} from '../common.js';
export function create(ctx){
  floor(ctx);let surface='metal',emitted=0,sound='kill',collisionSurface=null;
  const targets={metal:[-6,1.2,0],wood:[-3,1.2,0],deck:[0,.03,1],armor:[3,1.2,0],flesh:[6,1.2,0],water:[0,-7.5,16]};
  for(const [k,x,m] of [['metal',-6,'c0s20'],['wood',-3,'crate1'],['armor',3,'darkSteel'],['flesh',6,'red']]){const target=box(ctx,[x,1.2,0],[2,2.4,.45],ctx.materials[m].mat);target.userData.labCollider.mat=k;label(ctx,k,[x,2.8,0],2);}
  label(ctx,'deck',[0,.08,1.5],2);
  const emit=()=>{const target=new THREE.Vector3(...targets[surface]),n=new THREE.Vector3(0,surface==='deck'||surface==='water'?1:0,surface==='deck'||surface==='water'?0:1),origin=target.clone().addScaledVector(n,5),dir=n.clone().negate();
    const hit=ctx.world.raycast(origin.x,origin.y,origin.z,dir.x,dir.y,dir.z,12,'bullet',{});if(!hit)throw new Error('靶场射线没有命中');
    const p=origin.clone().addScaledVector(dir,hit.t);n.set(hit.nx,hit.ny,hit.nz);collisionSurface=hit.collider.mat;if(collisionSurface==='water')p.y=ctx.env.waterHeightAt(p.x,p.z,ctx.time);
    ctx.fx.impact(p,n,collisionSurface,dir);ctx.fx.tracer(origin,p);ctx.fx.muzzle(origin,dir);audio.playImpact(p,collisionSurface);emitted++;};
  return {cameras:[camera('overview','材质命中靶',[12,7,16],[0,1,0]),camera('impact','命中细节',[-5,2,5],[-5,1.2,0]),camera('water','海面命中',[7,-3,23],[0,-7.5,16])],
    controls:[select('surface','命中表面',surface,Object.keys(targets)),select('sound','反馈试听',sound,[{value:'kill',label:'击杀确认'},{value:'head',label:'爆头确认'},{value:'hurt',label:'受击'},{value:'death',label:'死亡'},{value:'footstep',label:'湿地脚步'}]),range('volume','试听音量',.65,0,1)],
    actions:[action('impact','单次命中'),action('burst','密集命中 × 20'),action('explosion','爆炸'),action('shell','抛壳碰地'),action('sound','播放所选声音'),action('clear','清理特效')],
    control(k,v){if(k==='surface')surface=v;if(k==='sound')sound=v;if(k==='volume')audio.setVolumes({master:v,sfx:v});},
    action(id){if(id==='impact')emit();if(id==='burst')for(let i=0;i<20;i++)emit();if(id==='explosion')ctx.fx.explosion(new THREE.Vector3(0,.3,3));if(id==='shell')ctx.fx.ejectShell(new THREE.Vector3(0,1.7,5),new THREE.Vector3(1,0,0));if(id==='clear')ctx.fx.resetTransient();if(id==='sound'){if(sound==='kill'||sound==='head')audio.playKillConfirm(sound==='head');if(sound==='hurt')audio.playHurt(38);if(sound==='death')audio.playDeath();if(sound==='footstep')audio.playFootstep(new THREE.Vector3(0,0,0),'metal',{wet:true});}},
    checks:()=>{const s=ctx.fx.stats();return [check('对象池容量受限',s.activeSparks<=s.effectCapacity.sparks&&s.activeDebris<=s.effectCapacity.debris),check('命中反馈来自正式游戏',typeof ctx.fx.impact==='function')];},metrics:()=>({命中次数:emitted,最近碰撞材质:collisionSurface||'未射击',...ctx.fx.stats()}),report:()=>({surface,collisionSurface,emitted,audioReady:audio.ready})};
}
