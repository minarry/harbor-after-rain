import test from 'node:test';
import assert from 'node:assert/strict';
import { DamageResponse, lowHealthAmount } from '../src/combat-feedback.js';
import { Player } from '../src/player.js';
import * as THREE from 'three';

test('hits from opposite sides kick the camera in opposite directions and settle', () => {
  const right = new DamageResponse(), left = new DamageResponse();
  right.hit(30, {x:1,z:0}, 0); left.hit(30, {x:-1,z:0}, 0);
  right.update(1/60); left.update(1/60);
  assert.ok(right.yaw > 0 && left.yaw < 0);
  assert.ok(right.roll < 0 && left.roll > 0);
  for (let i=0;i<3;i++) { right.update(1/60); left.update(1/60); }
  assert.ok(Math.abs(right.offset.roll) > .008);
  for (let i=0;i<180;i++) { right.update(1/60); left.update(1/60); }
  for (const x of Object.values(right.offset)) assert.ok(Math.abs(x)<1e-7);
});
test('automatic fire impulses remain bounded and stable at different frame rates', () => {
  const slow = new DamageResponse(), fast = new DamageResponse();
  slow.hit(40,{x:.7,z:.7},.4); fast.hit(40,{x:.7,z:.7},.4);
  for(let i=0;i<30;i++) slow.update(1/30);
  for(let i=0;i<120;i++) fast.update(1/120);
  assert.ok(Math.abs(slow.pitch-fast.pitch)<1e-10);
  for(let i=0;i<200;i++) {
    slow.hit(99,{x:1,z:0},0,true); slow.update(1/60);
    for(const x of Object.values(slow.offset)) assert.ok(Number.isFinite(x) && Math.abs(x)<.085);
  }
  const pose={...slow.offset};slow.update(0);assert.deepEqual(slow.offset,pose);
  slow.reset(); assert.ok(Object.values(slow.offset).every(x=>x===0));
});
test('health glow starts below 45 HP, strengthens progressively and stops at death', () => {
  assert.equal(lowHealthAmount(100),0); assert.equal(lowHealthAmount(45),0);
  assert.ok(lowHealthAmount(35)>0 && lowHealthAmount(35)<lowHealthAmount(20));
  assert.equal(lowHealthAmount(10),1); assert.equal(lowHealthAmount(0,false),0);
});
test('aimed bullets stay on the visible camera axis during a directional hit', () => {
  const p=Object.create(Player.prototype);
  Object.assign(p,{pitch:.15,yaw:-.8,punchP:.03,punchY:-.01,aimPunch:.02,damageResponse:new DamageResponse()});
  p.damageResponse.hit(35,{x:1,z:0},p.yaw); const kick=p.damageResponse.update(1/60);
  const cameraDirection=new THREE.Vector3(0,0,-1).applyEuler(new THREE.Euler(p.pitch+p.punchP*.75+p.aimPunch+kick.pitch,p.yaw+p.punchY*.75+kick.yaw,kick.roll,'YXZ'));
  assert.ok(p.forward(new THREE.Vector3()).distanceTo(cameraDirection)<1e-10);
});
test('shot origin uses the current moving camera without advancing its spring twice', () => {
  const p=Object.create(Player.prototype),camera=new THREE.PerspectiveCamera(78,1.6,.05,100);
  Object.assign(p,{game:{renderer:{camera},opts:{fov:78},fx:{shake:0}},alive:true,pos:new THREE.Vector3(5,0,2),
    eyeH:1.62,pitch:.1,yaw:.3,punchP:0,punchY:0,aimPunch:0,speed:4,onGround:true,ads:0,scoped:0,
    bobT:0,land:0,keys:new Set(),camRoll:0,explosionOffset:new THREE.Vector2(),damageResponse:new DamageResponse(),
    inv:[{def:{type:'rifle'}}],slot:0});
  p.damageResponse.hit(30,{x:1,z:0},p.yaw);p.updateCamera(1/60);
  const state={spring:p.damageResponse.time,bob:p.bobT};p.pos.x+=.1;p.yaw+=.02;
  const origin=p.shotOrigin(new THREE.Vector3());
  assert.deepEqual({spring:p.damageResponse.time,bob:p.bobT},state);
  assert.ok(origin.distanceTo(camera.position)<1e-10);
  assert.ok(origin.distanceTo(p.eye(new THREE.Vector3()))>.001);
  const direction=new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion);
  assert.ok(direction.distanceTo(p.forward(new THREE.Vector3()))<1e-10);
});
