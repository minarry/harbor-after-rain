import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/physics.js';
import { WeaponState, currentSpread } from '../src/weapons.js';

test('sea is hit beyond the ship but never acts as ground or sight obstruction', () => {
  const world = new World(); world.setWaterLevel(-7.5); world.build();
  const h = world.raycast(0, 2, 20, 0, -1, 0, 30, 'bullet');
  assert.equal(h.collider.mat, 'water'); assert.equal(h.t, 9.5); assert.equal(h.ny, 1);
  assert.equal(world.raycast(0, 2, 20, 0, -1, 0, 30, 'move'), null);
  assert.equal(world.raycast(0, 2, 20, 0, -1, 0, 30, 'sight'), null);
  assert.equal(world.support(0, 20, .4, 0), null);
});
test('solid deck or container wins before the sea and penetrable surfaces keep ordered exits', () => {
  const world = new World(); world.setWaterLevel(-7.5);
  world.add({x:0,y:-.5,z:0,sx:4,sy:1,sz:4,mat:'deck'});
  world.add({x:0,y:1,z:0,sx:1,sy:.2,sz:1,mat:'wood',bullet:'pen'}); world.build();
  const hits=world.raycastAll(0,3,0,0,-1,0,30);
  assert.deepEqual(hits.map(h=>h.collider.mat),['wood','deck','water']);
  assert.ok(hits[0].exit>hits[0].t && hits[0].exit<hits[1].t);
  assert.equal(world.raycast(1,3,0,0,-1,0,30).collider.mat,'deck');
});
test('water rejects upward, parallel, below-surface and out-of-range shots', () => {
  const world = new World(); world.setWaterLevel(-7.5); world.build();
  for(const [y,dy,range] of [[2,1,30],[2,0,30],[-8,-1,30],[2,-1,8]])
    assert.equal(world.raycast(0,y,20,0,dy,0,range),null);
});
test('ADS tightens gun spread without erasing airborne penalties or changing sniper optics', () => {
  const w=new WeaponState('m4a1'); w.spreadAcc=.015;
  const grounded={speed:0,onGround:true,crouch:false,ads:0};
  const hip=currentSpread(w,grounded), aimed=currentSpread(w,{...grounded,ads:1});
  assert.ok(aimed<hip*.5 && aimed>0);
  const air=currentSpread(w,{...grounded,onGround:false,ads:1});
  assert.ok(air-aimed>=w.def.spread.air-.000001);
  const sniper=new WeaponState('awm');
  assert.equal(currentSpread(sniper,{...grounded,ads:1,scoped:true,scopeReady:true}),sniper.def.spread.scoped);
});
