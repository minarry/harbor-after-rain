import test from 'node:test';
import assert from 'node:assert/strict';
import { Player } from '../src/player.js';

function fixture(options={}) {
  const p=Object.create(Player.prototype),shots=[];
  const g={opts:{sens:1,touchSens:1,fov:78,...options},renderer:{camera:{fov:78}}};
  Object.assign(p,{game:g,keys:new Set(),pressed:new Set(),mouse:{dx:0,dy:0,l:false,r:false,lp:false,rp:false,wheel:0},
    touch:{mx:0,mz:0,fire:false,firePressed:false,jump:false,crouch:false,aim:false},touchLook:{x:0,y:0},
    alive:true,yaw:0,pitch:0,scoped:0,ads:0,inv:[],move(){},updateCamera(){},weaponUpdate(dt,input){shots.push(input);}});
  return{p,g,shots,tick(){p.update(1/60);}};
}
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-12,`${actual} ≈ ${expected}`);

test('mouse and touch add in the same frame and both are consumed exactly once',()=>{
  const f=fixture();f.p.touchLook={x:20,y:-10};f.p.mouse.dx=5;f.p.mouse.dy=3;f.tick();
  close(f.p.yaw,-25*.0022);close(f.p.pitch,7*.0022);
  const before={yaw:f.p.yaw,pitch:f.p.pitch};f.tick();close(f.p.yaw,before.yaw);close(f.p.pitch,before.pitch);
});
test('touch and mouse sensitivities are independent',()=>{
  const run=opts=>{const f=fixture(opts);f.p.mouse.dx=10;f.p.touchLook.x=20;f.tick();return f.p.yaw;};
  const baseline=run({});
  close(run({touchSens:2})-baseline,-20*.0022);
  close(run({sens:2})-baseline,-10*.0022);
});
test('scoping scales both aim sources together and dead players never rotate',()=>{
  const f=fixture();f.p.ads=1;f.g.renderer.camera.fov=39;
  f.p.touchLook={x:20,y:-10};f.p.mouse.dx=5;f.p.mouse.dy=3;f.tick();
  close(f.p.yaw,-25*.0022*.5);close(f.p.pitch,7*.0022*.5);
  const before={yaw:f.p.yaw,pitch:f.p.pitch};f.p.alive=false;f.p.mouse.dx=20;f.p.touchLook.x=100;f.tick();
  close(f.p.yaw,before.yaw);close(f.p.pitch,before.pitch);
});
test('tap fire survives until the update, drives automatic fire once, and never becomes held fire',()=>{
  const f=fixture();f.p.touch.firePressed=true;f.tick();
  assert.equal(f.shots[0].fire,true);assert.equal(f.shots[0].firePressed,true);
  assert.equal(f.p.touch.fire,false);assert.equal(f.p.touch.firePressed,false);
  f.tick();assert.equal(f.shots[1].fire,false);assert.equal(f.shots[1].firePressed,false);
});
