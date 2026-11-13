import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLabConfig,validateControl,withRandom} from '../src/lab/config.js';
test('lab configuration bounds invalid routes, quality, seed, time and malformed controls',()=>{
  const c=parseLabConfig('?lab=missing&q=ultra&seed=-3&t=999&c=%7Bbad');
  assert.equal(c.id,'render');assert.equal(c.quality,'high');assert.equal(c.seed,0);assert.equal(c.time,30);assert.deepEqual(c.controls,{});
  assert.equal(parseLabConfig('?show=weapon&shot=1&t=0').time,0);
});
test('automation rejects invalid controls and random scope always restores the host RNG',()=>{
  assert.equal(validateControl({type:'range',min:0,max:1},2),1);
  assert.throws(()=>validateControl({type:'range',min:0,max:1},NaN));
  assert.throws(()=>validateControl({type:'toggle'},'false'));
  assert.throws(()=>validateControl({type:'select',options:[{value:'metal'}]},'invalid'));
  const original=Math.random;assert.throws(()=>withRandom(()=>.5,()=>{assert.equal(Math.random(),.5);throw new Error('expected');}));assert.equal(Math.random,original);
});
