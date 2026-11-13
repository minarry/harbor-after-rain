import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { WeaponState } from '../src/weapons.js';

test('clearing input releases mouse edges and held touch controls', () => {
  const g=Object.create(Game.prototype);
  let resets=0;g.touch={reset(){resets++;}};
  g.player={ keys:new Set(['KeyW']),pressed:new Set(['KeyR']),mouse:{l:true,lp:true,dx:20},touch:{fire:true,firePressed:true,crouch:true,aim:true,mx:1,mz:1},touchLook:{x:10,y:10} };
  g.clearInput();
  assert.equal(g.player.keys.size,0);assert.equal(g.player.pressed.size,0);
  assert.equal(g.player.mouse.lp,false);assert.equal(g.player.touch.fire,false);
  assert.equal(g.player.touch.mx,0);assert.equal(g.player.touchLook.x,0);
  assert.equal(g.player.touch.firePressed,false);assert.equal(g.player.touch.crouch,false);assert.equal(g.player.touch.aim,false);
  assert.equal(resets,1);
});
test('pointer ownership is released even between player instances',()=>{
  const g=Object.create(Game.prototype);let resets=0;g.touch={reset(){resets++;}};
  g.clearInput();assert.equal(resets,1);
});
test('portrait gate blocks starting, resuming and leaving loadout before state changes',()=>{
  const g=Object.create(Game.prototype);let checks=0;
  g.landscape={ensureLandscape(){checks++;return false;},requestPreferred(){}};
  Object.assign(g,{playing:false,paused:true,inLoadout:true});
  g.startMatch();g.resume();g.closeLoadout();
  assert.equal(checks,3);assert.equal(g.playing,false);assert.equal(g.paused,true);assert.equal(g.inLoadout,true);
});
test('portrait sync runs before simulation and freezes queued actions immediately',()=>{
  const {g,calls}=runningMatch('relay',42);let timers=0;
  g.landscape={sync(){g.paused=true;}};g.timers.push({t:42,fn(){timers++;}});
  g.simulate(1/60);
  assert.equal(g.time,42);assert.equal(g.timeLeft,138);assert.equal(timers,0);assert.equal(calls.player,0);
});
test('immediate loadout change exits previous sniper scope', () => {
  const g=Object.create(Game.prototype);
  g.time=1;g.opts={};g.hud={saveOpts(){},slots(){},toast(){}};g.vm={equip(){}};
  g.map={spawnBounds:{BL:{maxX:-28.3},GR:{minX:28.3}}};
  g.player={alive:true,team:'BL',pos:{x:-33},scoped:2,scopeReady:true,reScope:5,inv:[new WeaponState('awm')],soldier:{setWeapon(){}}};
  g.chooseLoadout('m4a1');
  assert.equal(g.player.inv[0].id,'m4a1');assert.equal(g.player.scoped,0);
  assert.equal(g.player.scopeReady,false);assert.equal(g.player.reScope,0);
});
test('fixed step exits immediately when the first substep pauses', () => {
  const previous=globalThis.requestAnimationFrame;globalThis.requestAnimationFrame=()=>0;
  try {
    const g=Object.create(Game.prototype);let calls=0;
    Object.assign(g,{last:0,playing:true,paused:false,ended:false,renderer:{camera:{}},renderFrame(){},simulate(){calls++;this.paused=true;}});
    g.loop(100);assert.equal(calls,1);assert.equal(g.simAccumulator,0);
  } finally {globalThis.requestAnimationFrame=previous;}
});
test('match-ending timer stops the same simulation step before players act', () => {
  const g=Object.create(Game.prototype);let calls=0;
  Object.assign(g,{time:170,timeLeft:10,playing:true,paused:false,ended:false,renderer:{camera:{}},timers:[{t:170,fn(){g.ended=true;g.playing=false;}}],player:{update(){calls++;}}});
  g.simulate(1/60);assert.equal(calls,0);
});

function runningMatch(mode='tdm',time=0) {
  const g=Object.create(Game.prototype),calls={player:0,nades:0,objective:0,end:0,lastAction:0};
  Object.assign(g,{
    mode,time,timeLeft:180-time,playing:true,paused:false,ended:false,
    renderer:{camera:{}},timers:[],actors:[],tags:[],score:{BL:10,GR:9},goal:50,
    player:{update(){calls.player++;calls.lastAction=g.time;}},
    updateNades(){calls.nades++;},objective:{update(){calls.objective++;}},
    endMatch(){calls.end++;this.ended=true;this.playing=false;},
  });
  return {g,calls};
}

for(const mode of ['tdm','relay']) test(`${mode} reaches exactly three minutes without granting a final scoring step`,()=>{
  const {g,calls}=runningMatch(mode);
  for(let i=0;i<179*60;i++)g.simulate(1/60);
  assert.equal(g.ended,false);assert.ok(Math.abs(g.timeLeft-1)<1e-8);
  g.timers.push({t:180,fn(){g.score.GR+=2;}});
  for(let i=0;i<60;i++)g.simulate(1/60);
  assert.equal(g.time,180);assert.equal(g.timeLeft,0);
  assert.equal(g.ended,true);assert.equal(g.playing,false);assert.equal(calls.end,1);
  assert.equal(calls.player,180*60-1);assert.equal(calls.nades,calls.player);assert.equal(calls.objective,calls.player);
  assert.ok(calls.lastAction<180,'no actor, grenade or objective update runs at the cutoff');
  assert.deepEqual(g.score,{BL:10,GR:9},'the expired timer cannot change the winner');
  const before={...calls};g.simulate(2);
  assert.deepEqual(calls,before);assert.equal(g.time,180);assert.equal(g.timeLeft,0);
});

test('a step before the cutoff runs normally but an overshooting step only settles the match',()=>{
  const {g,calls}=runningMatch('tdm',179.95);
  let timers=0;g.timers.push({t:179.96,fn(){timers++;}});
  g.simulate(1/60);
  assert.equal(timers,1);assert.equal(calls.player,1);assert.equal(calls.end,0);assert.ok(g.timeLeft>0);
  g.timers.push({t:179.99,fn(){timers++;g.score.GR=99;}});
  g.simulate(.1);
  assert.equal(g.time,180);assert.equal(g.timeLeft,0);assert.equal(calls.end,1);
  assert.equal(timers,1);assert.equal(calls.player,1);assert.equal(g.score.GR,9);
});

test('paused, stopped and ended matches freeze the clock and queued events',()=>{
  for(const state of [{paused:true},{playing:false},{ended:true}]){
    const {g,calls}=runningMatch('relay',42);
    Object.assign(g,state);let timers=0;g.timers.push({t:42,fn(){timers++;}});
    g.simulate(1/60);g.simulate(300);
    assert.equal(g.time,42);assert.equal(g.timeLeft,138);assert.equal(timers,0);
    assert.equal(calls.player,0);assert.equal(calls.end,0);
  }
  const {g,calls}=runningMatch('relay',42);
  g.paused=true;g.simulate(120);g.paused=false;g.simulate(1/60);
  assert.equal(calls.player,1);assert.ok(Math.abs(g.time-42-1/60)<1e-12);
  assert.ok(Math.abs(g.time+g.timeLeft-180)<1e-12);
});

test('an earlier victory cancels later callbacks and keeps its remaining time',()=>{
  const {g,calls}=runningMatch('tdm',21);
  g.timers.push({t:21,fn(){g.score.GR=99;}},{t:21,fn(){g.score.BL=g.goal;g.endMatch();}});
  g.simulate(1/60);
  assert.equal(calls.end,1);assert.equal(calls.player,0);assert.equal(g.score.BL,g.goal);assert.equal(g.score.GR,9);
  assert.ok(g.timeLeft>150);
  const remaining=g.timeLeft;g.simulate(200);assert.equal(g.timeLeft,remaining);

  const relay=runningMatch('relay',30);
  relay.g.objective.update=()=>{relay.calls.objective++;relay.g.score.BL=relay.g.goal;relay.g.endMatch();};
  relay.g.simulate(1/60);
  assert.equal(relay.calls.end,1);assert.equal(relay.calls.objective,1);assert.ok(relay.g.timeLeft>149);
});
