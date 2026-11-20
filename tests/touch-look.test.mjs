import test from 'node:test';
import assert from 'node:assert/strict';
import { shapeTouchLook, touchAimScale } from '../src/touch-look.js';
import { TouchInputState } from '../src/touch-state.js';

const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} ≈ ${b}`);

test('slow precision and fast turn have bounded gain without directional distortion',()=>{
  const slow=shapeTouchLook(10,5,200,390),fast=shapeTouchLook(10,5,5,390);
  close(slow.x,10*1.6*.72);close(fast.x,10*1.6*1.3);
  close(slow.x/slow.y,2);close(fast.x/fast.y,2);assert.ok(fast.x>slow.x);
  const reverse=shapeTouchLook(-10,-5,5,390);close(reverse.x,-fast.x);close(reverse.y,-fast.y);
});

test('equal gestures measured in viewport fractions have equal turn on different screens',()=>{
  const small=shapeTouchLook(78,39,150,390),large=shapeTouchLook(156,78,150,780),compact=shapeTouchLook(64,32,150,320);
  close(small.x,large.x);close(small.y,large.y);close(small.x,compact.x);close(small.y,compact.y);
});

test('constant-speed gestures agree at 30, 60, 120 and 240 samples per second',()=>{
  const turn=rate=>{
    const state=new TouchInputState({lookResponse:(dx,dy,elapsed)=>shapeTouchLook(dx,dy,elapsed,390)});
    state.start(1,'look',0,0,{time:100});const count=rate/2;
    for(let i=1;i<=count;i++)state.move(1,i*390/count,i*39/count,100+i*500/count);
    return state.takeLook();
  };
  const baseline=turn(30);
  for(const rate of[60,120,240]){const result=turn(rate);close(result.x,baseline.x);close(result.y,baseline.y);}
});

test('invalid and repeated timestamps stay finite; stopped input has no stored drift',()=>{
  for(const time of[0,-1,NaN,Infinity,undefined,1e-6,10000]){
    const result=shapeTouchLook(4,-2,time,390);assert.ok(Number.isFinite(result.x)&&Number.isFinite(result.y));
    assert.ok(result.x>=4*1.6*.72&&result.x<=4*1.6*1.3);
  }
  assert.deepEqual(shapeTouchLook(NaN,1,16),{x:0,y:0});assert.deepEqual(shapeTouchLook(0,0,16),{x:0,y:0});
  const state=new TouchInputState({lookResponse:shapeTouchLook});state.start(1,'look',0,0,{time:20});state.move(1,40,0,36);
  assert.ok(state.takeLook().x>0);state.end(1);
  for(let frame=0;frame<120;frame++)assert.deepEqual(state.takeLook(),{x:0,y:0});
  state.start(2,'look',500,0,{time:1000});state.move(2,501,0,1016);assert.ok(state.takeLook().x<3);
});

test('aim scale follows tangent magnification and blends the independent setting',()=>{
  close(touchAimScale(78,78,0,.2),1);
  const optical=Math.tan(57*Math.PI/360)/Math.tan(78*Math.PI/360);
  close(touchAimScale(57,78,1),optical*.75);
  close(touchAimScale(57,78,.5,.5),optical*.75);
  assert.ok(touchAimScale(12,78,1)<touchAimScale(25,78,1));
  assert.ok(touchAimScale(25,78,1)<touchAimScale(57,78,1));
  assert.ok(Number.isFinite(touchAimScale(NaN,NaN,1,NaN)));
});
