import test from 'node:test';
import assert from 'node:assert/strict';
import { RelayState } from '../src/relay-state.js';
import { NavGrid, World } from '../src/physics.js';

test('neutral relay requires a full capture and only then awards points', () => {
  const r = new RelayState();
  for (let i = 0; i < 69; i++) r.update(0.1, { BL: 1 });
  assert.equal(r.owner, null); assert.equal(r.score.BL, 0);
  r.update(0.1, { BL: 1 });
  assert.equal(r.owner, 'BL'); assert.equal(r.score.BL, 0);
  for (let i = 0; i < 30; i++) r.update(0.1, { BL: 1 });
  assert.equal(r.score.BL, 3);
});
test('contested relay freezes capture and scoring; enemies must neutralize first', () => {
  const r = new RelayState(); r.update(7, { BL: 1 });
  r.update(3, { BL: 1, GR: 3 });
  assert.equal(r.progress, -1); assert.equal(r.score.BL, 0); assert.equal(r.contested, true);
  r.update(7, { GR: 1 });
  assert.equal(r.owner, null); assert.equal(r.progress, 0);
  r.update(7, { GR: 1 }); assert.equal(r.owner, 'GR');
});
test('rotation keeps scores but never transfers occupants to the new point', () => {
  const r = new RelayState({ rotationSeconds: 10 });
  r.update(7, { BL: 1 }); r.update(2, { BL: 1 });
  const event = r.update(1, { BL: 9 });
  assert.equal(event.rotated, true); assert.equal(r.index, 1);
  assert.equal(r.owner, null); assert.equal(r.progress, 0); assert.equal(r.score.BL, 2);
});
test('navigation clamps blocked destinations to reachable free cells', () => {
  const world = new World();
  const nav = new NavGrid(world, 0, 0, 5, 5, 1, 0.3);
  nav.block[nav.idx(3.5, 3.5)] = 1;
  const path = nav.findPath(0.5, 0.5, 3.5, 3.5);
  assert.ok(path?.length);
  const end = path.at(-1);
  assert.ok(nav.walkable(nav.idx(end[0], end[1])));
  assert.equal(nav.nearestFree(-1), -1);
  assert.equal(nav.walkable(nav.block.length), false);
});
