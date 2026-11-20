import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera } from 'three';
import { createLandscapeOrbit } from '../src/lab/landscape-orbit.js';

class Surface {
  listeners = new Map();
  addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(listener); }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  emit(type, event = {}) { for (const listener of [...(this.listeners.get(type) || [])]) listener(event); }
}
function fixture(rotated) {
  const host = new Surface(), document = new Surface(), canvas = new Surface(), captures = new Set();
  Object.assign(canvas, { ownerDocument: document, style: {}, clientWidth: 844, clientHeight: 390,
    getRootNode: () => document, setPointerCapture: id => captures.add(id),
    hasPointerCapture: id => captures.has(id), releasePointerCapture: id => captures.delete(id) });
  const viewport = { window: host, rotated, clientToLocal: (x, y) => viewport.rotated ? { x: y, y: 390 - x } : { x, y } };
  const camera = new PerspectiveCamera(60, 844 / 390, .1, 1000); camera.position.set(0, 3, 10);
  const orbit = createLandscapeOrbit(camera, canvas, viewport);
  const event = (id, x, y, type = 'touch') => {
    const p = viewport.rotated ? { x: 390 - y, y: x } : { x, y };
    return { pointerId: id, pointerType: type, clientX: p.x, clientY: p.y, pageX: p.x, pageY: p.y,
      button: 0, ctrlKey: false, metaKey: false, shiftKey: false, preventDefault() {} };
  };
  const send = (type, id, x, y, pointerType) => (type === 'pointerdown' ? canvas : document).emit(type, event(id, x, y, pointerType));
  return { host, document, canvas, captures, viewport, camera, orbit, event, send };
}
const state = f => [...f.camera.position.toArray(), ...f.camera.quaternion.toArray(), ...f.orbit.target.toArray()];
const close = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-10, `${i}: ${v} ≈ ${b[i]}`));

test('rotated touch and mouse drags produce the same camera motion as landscape', () => {
  for (const pointerType of ['touch', 'mouse']) {
    const normal = fixture(false), rotated = fixture(true);
    for (const f of [normal, rotated]) {
      f.send('pointerdown', 1, 200, 200, pointerType);
      f.send('pointermove', 1, 260, 185, pointerType);
      f.send('pointerup', 1, 260, 185, pointerType);
    }
    close(state(normal), state(rotated));
    assert.ok(normal.camera.position.x < -.1);
    normal.orbit.dispose(); rotated.orbit.dispose();
  }
});

test('two-finger pinch/pan and surviving-finger handoff map once without a camera jump', () => {
  const normal = fixture(false), rotated = fixture(true);
  for (const f of [normal, rotated]) {
    f.send('pointerdown', 1, 200, 200); f.send('pointerdown', 2, 300, 200);
    f.send('pointermove', 2, 330, 210); f.send('pointermove', 1, 195, 190);
    f.send('pointerup', 2, 330, 210);
    const before = state(f); f.send('pointermove', 1, 195, 190); close(state(f), before);
    f.send('pointermove', 1, 210, 185); f.send('pointerup', 1, 210, 185);
  }
  close(state(normal), state(rotated));
  normal.orbit.dispose(); rotated.orbit.dispose();
});

test('viewport changes cancel ownership; old contacts cannot move or end a new gesture', () => {
  const f = fixture(true);
  f.send('pointerdown', 1, 200, 200); f.send('pointerdown', 2, 300, 200);
  f.send('pointermove', 2, 320, 200);
  f.viewport.rotated = false; f.host.emit('gameviewportresize');
  assert.equal(f.captures.size, 0); assert.equal(f.orbit._pointers.length, 0);
  assert.equal(Object.keys(f.orbit._pointerPositions).length, 0);
  const before = state(f); f.send('pointerdown', 3, 200, 200);
  f.send('pointermove', 1, 700, 100); f.send('pointerup', 2, 700, 100);
  close(state(f), before); assert.deepEqual(f.orbit._pointers, [3]);
  f.send('pointermove', 3, 220, 200); assert.notDeepEqual(state(f), before);
  f.orbit.dispose(); assert.equal(f.captures.size, 0);
  assert.equal(f.host.listeners.get('gameviewportresize').size, 0);
  assert.equal(f.document.listeners.get('pointermove').size, 0);
});

test('wheel native methods keep their receiver and match normal landscape zoom', () => {
  const normal = fixture(false), rotated = fixture(true);
  for (const f of [normal, rotated]) {
    const event = { ...f.event(0, 200, 200, 'mouse'), deltaMode: 0, deltaY: -40 };
    let prevented = false;
    event.preventDefault = function () { assert.equal(this, event); prevented = true; };
    f.canvas.emit('wheel', event); assert.equal(prevented, true);
  }
  close(state(normal), state(rotated));
  normal.orbit.dispose(); rotated.orbit.dispose();
});
