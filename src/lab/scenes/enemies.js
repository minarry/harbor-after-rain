import * as THREE from 'three';
import {Soldier} from '../../character.js';
import {DamageResponse,lowHealthAmount} from '../../combat-feedback.js';
import {audio} from '../../audio.js';
import {createTacticalProbe} from '../tactical-probe.js';
import {floor,label,range,select,toggle,action,camera,check} from '../common.js';
export function create(ctx){
  floor(ctx);const probe=createTacticalProbe(ctx);probe.root.visible=false;
  const soldiers=['BL','GR'].map((team,i)=>{const s=new Soldier(team);s.root.position.set(i*3-1.5,0,0);s.root.rotation.y=Math.PI;s.setWeapon('m4a1');ctx.scene.add(s.root);label(ctx,team,[i*3-1.5,.1,1.4],1.6);return s;});
  const skeletons=soldiers.map(s=>{const h=new THREE.SkeletonHelper(s.mesh);h.visible=false;ctx.scene.add(h);return h;});
  const damage=new DamageResponse();let speed=0,crouch=false,pitch=0,hp=100,hit=0,reloading=false;
  const badge=document.createElement('div');badge.className='lab-feedback';badge.textContent='生命 100';ctx.viewport.append(badge);
  return {cameras:[camera('overview','双阵营',[0,2.2,6.5],[0,1,0]),camera('detail','角色近景',[1.6,1.6,2.2],[1.5,1.25,0]),camera('side','侧向动作',[5,2,2],[0,1,0]),probe.camera],onCamera:id=>{probe.root.visible=id==='tactics';},
    controls:[range('speed','行走速度',0,0,6,.1),toggle('crouch','下蹲',false),range('pitch','瞄准俯仰',0,-.8,.8),toggle('highDetail','精细模型',true),toggle('skeleton','骨架',false),toggle('reloading','换弹姿态',false),range('hp','玩家生命值',100,0,100,1),select('weapon','手持武器','m4a1',['m4a1','ak47','awm','mp5','deagle'])],
    actions:[action('flinch','敌人受击'),action('kill','击杀 / 倒地'),action('hurt','玩家受击'),action('death','玩家阵亡'),action('resetActors','复位角色'),...probe.actions],
    control(k,v){if(k==='speed')speed=v;if(k==='crouch')crouch=v;if(k==='pitch')pitch=v;if(k==='hp')hp=v;if(k==='highDetail')soldiers.forEach(s=>s.setDetail(v));if(k==='skeleton')skeletons.forEach(s=>s.visible=v);if(k==='reloading')reloading=v;if(k==='weapon')soldiers.forEach(s=>s.setWeapon(v));},
    action(id){if(probe.action(id)){window.__lab.camera('tactics');return;}if(id==='flinch')soldiers.forEach(s=>s.flinch(new THREE.Vector3(1,0,-1),'chest',35));if(id==='kill'){soldiers.forEach(s=>s.die(1,-1,true));audio.playKillConfirm(true);}if(id==='hurt'){damage.hit(35,{x:1,z:1},0);hp=Math.max(0,hp-35);hit=1;audio.playHurt(35);}if(id==='death'){hp=0;audio.playDeath();}if(id==='resetActors'){soldiers.forEach(s=>{s.reset();s.root.position.y=0;});hp=100;damage.reset();}},
    update(dt,t){probe.update(dt);soldiers.forEach(s=>s.update(dt,{speed,crouch,pitch,fwd:1,side:0,onGround:true,reloading,t}));hit*=Math.exp(-dt*5);const u=ctx.r.fx.uniforms;u.uDamage.value=hit;u.uLowHP.value=lowHealthAmount(hp,hp>0);u.uDeath.value=hp===0?1:0;u.uHeartbeat.value=t*1.4;const off=damage.update(dt);ctx.camera.position.copy(ctx.orbitPosition||ctx.camera.position);if(ctx.orbitPosition){ctx.camera.position.x+=off.x;ctx.camera.position.y+=off.y;ctx.camera.rotateX(off.pitch);ctx.camera.rotateY(off.yaw);ctx.camera.rotateZ(off.roll);}badge.textContent=hp===0?'已阵亡':`生命 ${hp} · ${hp<=35?'低血量':'状态正常'}`;badge.dataset.danger=String(hp<=35);},
    checks:()=>[check('模型共用真实骨骼动画',soldiers.every(s=>s.bones.length===19)),check('倒地与材质状态有效',soldiers.every(s=>Number.isFinite(s.opacity))),...probe.checks()],metrics:()=>({角色:soldiers.length,骨骼:soldiers[0].bones.length,模型细节:soldiers[0].highDetail?'精细':'远景',生命:hp,...probe.metrics()}),report:()=>({hp,damage:damage.offset,actors:soldiers.map(s=>({dead:s.deadT>=0,highDetail:s.highDetail})),tactics:probe.report()})};
}
