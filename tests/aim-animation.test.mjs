import test from 'node:test';
import assert from 'node:assert/strict';
import { Actor } from '../src/actor.js';
import { Game } from '../src/game.js';
import { Player } from '../src/player.js';
import { WeaponState } from '../src/weapons.js';
import { audio } from '../src/audio.js';
import * as THREE from 'three';

function actor() {
  const g={time:1,onSwitch(){},onReloadStart(){},onReloadDone(){},onScope(){}};
  const a=Object.create(Actor.prototype);
  Object.assign(a,{game:g,inv:[new WeaponState('m4a1'),new WeaponState('deagle')],slot:0,readyAt:0,ads:0,scoped:0,
    aimPunch:0,punchP:0,punchY:0,scopeReady:false,soldier:{setWeapon(){}},isPlayer:true,touch:{aim:false}});
  return a;
}
function step(a,n,input) { for(let i=0;i<n;i++) {a.game.time+=1/60;a.weaponUpdate(1/60,input);} }
test('ADS enters, releases smoothly and cannot stay up during reload or weapon draw',()=>{
  const a=actor(); step(a,30,{alt:true}); assert.ok(a.ads>.98);
  step(a,1,{alt:false}); assert.ok(a.ads>0 && a.ads<.98);
  step(a,30,{alt:false}); assert.ok(a.ads<.01);
  step(a,30,{alt:true}); a.weapon.mag=4; step(a,1,{alt:true,reload:true});
  assert.equal(a.weapon.reloading,true); step(a,15,{alt:true}); assert.ok(a.ads<.01);
  const old=a.weapon; step(a,1,{sw:1,alt:true});
  assert.equal(old.reloading,false); assert.equal(a.weapon.id,'deagle'); assert.equal(a.ads,0);
});
test('scheduled reload clicks are discarded when that reload was cancelled',()=>{
  const g=Object.create(Game.prototype), w=new WeaponState('m4a1'); w.mag=0;w.reloadUntil=5;
  Object.assign(g,{time:2,timers:[],vm:{reload(){}}});
  const a={alive:true,isPlayer:true,weapon:w};
  g.onReloadStart(a,true); const scheduled=g.timers.splice(0);
  const previous=audio.playReload, heard=[]; audio.playReload=(...args)=>heard.push(args);
  try { w.reloadUntil=0;for(const t of scheduled)t.fn();assert.equal(heard.length,0); }
  finally {audio.playReload=previous;}
});
test('player ray follows exactly the visible recoil and aim-punch camera rotation',()=>{
  const p=Object.create(Player.prototype);
  Object.assign(p,{pitch:.15,yaw:-.8,punchP:.06,punchY:-.015,aimPunch:.025});
  const cameraDirection=new THREE.Vector3(0,0,-1).applyEuler(new THREE.Euler(p.pitch+p.punchP*.75+p.aimPunch,p.yaw+p.punchY*.75,.03,'YXZ'));
  assert.ok(p.forward(new THREE.Vector3()).distanceTo(cameraDirection)<1e-10);
});
