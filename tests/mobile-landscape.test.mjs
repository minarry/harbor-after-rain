import test from 'node:test';
import assert from 'node:assert/strict';
import { MobileLandscape } from '../src/mobile-landscape.js';

class Element extends EventTarget {
  constructor() {
    super(); this.hidden = true; this.disabled = false; this.textContent = ''; this.writes = 0;
    const classes = new Set(['hidden']);
    this.classList = {
      contains: name => classes.has(name),
      toggle: (name, on) => { this.writes++; on ? classes.add(name) : classes.delete(name); },
    };
  }
  getBoundingClientRect() { return { left: 20, right: 200, top: 300, bottom: 350, width: 180, height: 50 }; }
}

function pointer(type, id, x = 80, y = 325) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { pointerId: id, pointerType: 'touch', isPrimary: false, clientX: x, clientY: y });
  return event;
}

function fixture({ touch = true, portrait = false, playing = false, paused = false, inLoadout = false, ended = false } = {}) {
  const win = new EventTarget(); win.innerWidth = portrait ? 390 : 844; win.innerHeight = portrait ? 844 : 390;
  const doc = new EventTarget(); doc.documentElement = {}; doc.fullscreenElement = null;
  const gate = new Element(), button = new Element(), hint = new Element();
  doc.getElementById = id => ({ landscapeGate: gate, btnLandscape: button, landscapeHint: hint })[id] || null;
  const screen = { orientation: new EventTarget() }; screen.orientation.type = 'landscape-primary';
  const calls = { clear: 0, pause: 0, fullscreen: 0, lock: [], resume: 0, exit: 0, unlock: 0 };
  doc.exitFullscreen = () => calls.exit++;
  screen.orientation.unlock = () => calls.unlock++;
  const g = {
    touchMode: touch, playing, paused, inLoadout, ended,
    input: { fire: true, move: 1 },
    clearInput() { calls.clear++; this.input = { fire: false, move: 0 }; this.landscape?.sync(); },
    pause() { calls.pause++; this.paused = true; this.clearInput(); this.landscape?.sync(); },
    resume() { calls.resume++; this.paused = false; },
  };
  const control = new MobileLandscape(g, { window: win, document: doc, screen }); g.landscape = control;
  return { win, doc, screen, gate, button, hint, calls, g, control,
    rotate(portrait, event = 'resize') { win.innerWidth = portrait ? 390 : 844; win.innerHeight = portrait ? 844 : 390; win.dispatchEvent(new Event(event)); },
  };
}

test('desktop portrait never blocks play or requests mobile browser permissions', async () => {
  const f = fixture({ touch: false, portrait: true, playing: true });
  f.doc.documentElement.requestFullscreen = () => f.calls.fullscreen++;
  f.screen.orientation.lock = mode => f.calls.lock.push(mode);
  assert.equal(f.control.blocked, false); assert.equal(f.control.ensureLandscape(), true);
  assert.equal(f.gate.hidden, true); assert.equal(f.gate.classList.contains('hidden'), true);
  await f.control.requestPreferred(); f.button.dispatchEvent(new Event('click'));
  assert.equal(f.calls.clear, 0); assert.equal(f.calls.pause, 0);
  assert.equal(f.calls.fullscreen, 0); assert.deepEqual(f.calls.lock, []);
  f.control.dispose();
});

test('viewport dimensions override stale orientation metadata and menu does not pause', () => {
  const f = fixture({ portrait: true });
  assert.equal(f.control.blocked, true); assert.equal(f.control.ensureLandscape(), false);
  assert.equal(f.gate.hidden, false); assert.equal(f.gate.classList.contains('hidden'), false);
  assert.equal(f.calls.pause, 0); assert.equal(f.calls.clear, 1);
  f.win.innerWidth = 844; f.win.innerHeight = 390; // No orientation event has arrived yet.
  assert.equal(f.control.blocked, false); assert.equal(f.control.ensureLandscape(), true);
  assert.equal(f.gate.hidden, true); assert.equal(f.calls.resume, 0);
  f.control.dispose();
});

test('a square viewport remains blocked until it is wider than tall', () => {
  const f = fixture({ playing: true });
  f.win.innerWidth = f.win.innerHeight = 600;
  assert.equal(f.control.blocked, true); assert.equal(f.control.ensureLandscape(), false);
  assert.equal(f.gate.hidden, false); assert.equal(f.g.paused, true);
  f.win.innerWidth = 601;
  assert.equal(f.control.ensureLandscape(), true); assert.equal(f.gate.hidden, true);
  assert.equal(f.g.paused, true); assert.equal(f.calls.resume, 0);
  f.control.dispose();
});

test('rotating a live match clears input and pauses once despite reentrant game callbacks', () => {
  const f = fixture({ playing: true });
  f.rotate(true);
  assert.equal(f.g.paused, true); assert.equal(f.calls.pause, 1);
  assert.deepEqual(f.g.input, { fire: false, move: 0 });
  const cleared = f.calls.clear;
  for (let i = 0; i < 120; i++) f.control.sync();
  f.screen.orientation.dispatchEvent(new Event('change'));
  assert.equal(f.calls.clear, cleared); assert.equal(f.calls.pause, 1);
  f.rotate(false, 'orientationchange');
  assert.equal(f.gate.hidden, true); assert.equal(f.g.paused, true); assert.equal(f.calls.resume, 0);
  f.control.dispose();
});

test('rotation preserves an existing pause, loadout and ended screen', () => {
  for (const state of [{ playing: true, paused: true }, { playing: true, paused: true, inLoadout: true }, { playing: false, ended: true }]) {
    const f = fixture(state), before = { paused: f.g.paused, inLoadout: f.g.inLoadout, ended: f.g.ended };
    f.rotate(true); f.rotate(false);
    assert.deepEqual({ paused: f.g.paused, inLoadout: f.g.inLoadout, ended: f.g.ended }, before);
    assert.equal(f.calls.pause, 0); assert.equal(f.calls.resume, 0);
    f.control.dispose();
  }
});

test('ensureLandscape catches an attempted unpause while still portrait', () => {
  const f = fixture({ playing: true, portrait: true });
  f.g.paused = false; f.g.input.fire = true;
  assert.equal(f.control.ensureLandscape(), false);
  assert.equal(f.g.paused, true); assert.equal(f.g.input.fire, false); assert.equal(f.calls.pause, 2);
  f.control.dispose();
});

test('gesture request awaits fullscreen before locking and coalesces concurrent requests', async () => {
  const f = fixture({ portrait: true }), order = [];
  let releaseFullscreen;
  f.doc.documentElement.requestFullscreen = () => {
    order.push('fullscreen'); f.calls.fullscreen++;
    return new Promise(resolve => { releaseFullscreen = () => { f.doc.fullscreenElement = f.doc.documentElement; resolve(); }; });
  };
  f.screen.orientation.lock = async mode => { order.push(mode); f.calls.lock.push(mode); f.rotate(false); };
  const first = f.control.requestPreferred();
  assert.strictEqual(f.control.requestPreferred(), first);
  assert.deepEqual(order, ['fullscreen']); assert.equal(f.button.disabled, true);
  releaseFullscreen(); assert.equal(await first, true);
  assert.deepEqual(order, ['fullscreen', 'landscape']); assert.equal(f.button.disabled, false);
  assert.equal(f.control.pending, null); assert.equal(f.gate.hidden, true);
  assert.equal(f.calls.exit, 0); assert.equal(f.calls.unlock, 0);
  f.control.dispose();
});

test('fullscreen and orientation rejection resolve safely with the manual gate still available', async () => {
  for (const synchronous of [false, true]) {
    const f = fixture({ portrait: true });
    f.doc.documentElement.requestFullscreen = () => {
      f.calls.fullscreen++; if (synchronous) throw Error('denied'); return Promise.reject(Error('denied'));
    };
    f.screen.orientation.lock = mode => {
      f.calls.lock.push(mode); if (synchronous) throw Error('unsupported'); return Promise.reject(Error('unsupported'));
    };
    assert.equal(await f.control.requestPreferred(), false);
    assert.equal(f.gate.hidden, false); assert.equal(f.button.disabled, false);
    assert.match(f.hint.textContent, /手动横放/);
    f.control.sync(); f.rotate(true); f.doc.dispatchEvent(new Event('fullscreenchange'));
    assert.equal(f.calls.fullscreen, 1); assert.deepEqual(f.calls.lock, ['landscape']);
    f.control.dispose();
  }
});

test('missing APIs use manual rotation and an existing fullscreen is preserved', async () => {
  const f = fixture({ portrait: true });
  assert.equal(await f.control.requestPreferred(), false); assert.equal(f.gate.hidden, false);
  f.doc.fullscreenElement = {};
  f.doc.documentElement.requestFullscreen = () => f.calls.fullscreen++;
  f.screen.orientation.lock = async mode => { f.calls.lock.push(mode); };
  await f.control.requestPreferred();
  assert.equal(f.calls.fullscreen, 0); assert.deepEqual(f.calls.lock, ['landscape']);
  const existing = f.doc.fullscreenElement;
  f.control.dispose();
  assert.strictEqual(f.doc.fullscreenElement, existing); assert.equal(f.calls.exit, 0); assert.equal(f.calls.unlock, 0);
});

test('the gate button requests once per gesture; sync and resize never request automatically', async () => {
  const f = fixture({ portrait: true });
  let finish;
  f.screen.orientation.lock = mode => { f.calls.lock.push(mode); return new Promise(resolve => { finish = resolve; }); };
  for (let i = 0; i < 60; i++) f.control.sync();
  f.rotate(true); assert.deepEqual(f.calls.lock, []);
  f.button.dispatchEvent(new Event('click')); f.button.dispatchEvent(new Event('click'));
  const pending = f.control.pending;
  assert.deepEqual(f.calls.lock, ['landscape']); finish(); await pending;
  assert.equal(f.control.pending, null);
  f.control.dispose(); f.button.dispatchEvent(new Event('click'));
  assert.deepEqual(f.calls.lock, ['landscape']);
});

test('unchanged frame sync avoids class mutations and disposal detaches viewport listeners', () => {
  const f = fixture({ playing: true });
  const writes = f.gate.writes;
  for (let i = 0; i < 120; i++) f.control.sync();
  assert.equal(f.gate.writes, writes);
  f.control.dispose(); f.rotate(true);
  assert.equal(f.calls.pause, 0); assert.equal(f.gate.hidden, true);
});

test('a second-thumb gate gesture works without click and suppresses only its duplicate click', async () => {
  const f = fixture({ portrait: true });
  f.screen.orientation.lock = async mode => { f.calls.lock.push(mode); };
  f.button.dispatchEvent(pointer('pointerdown', 7)); f.button.dispatchEvent(pointer('pointerup', 7));
  await f.control.pending;
  assert.deepEqual(f.calls.lock, ['landscape']);
  const click = new Event('click'); Object.assign(click, { detail: 1, pointerId: 7 });
  f.button.dispatchEvent(click); assert.equal(f.calls.lock.length, 1);
  const keyboard = new Event('click'); Object.assign(keyboard, { detail: 0 });
  f.button.dispatchEvent(keyboard); await f.control.pending;
  assert.equal(f.calls.lock.length, 2, 'keyboard activation remains available after a touch');
  f.control.dispose();
});

test('cancelled, moved-out and pre-rotation contacts cannot activate the gate button', () => {
  const f = fixture({ portrait: true });
  f.screen.orientation.lock = async mode => { f.calls.lock.push(mode); };
  f.button.dispatchEvent(pointer('pointerup', 1));
  for (const type of ['pointercancel', 'lostpointercapture']) {
    f.button.dispatchEvent(pointer('pointerdown', 2)); f.button.dispatchEvent(pointer(type, 2)); f.button.dispatchEvent(pointer('pointerup', 2));
  }
  f.button.dispatchEvent(pointer('pointerdown', 3)); f.button.dispatchEvent(pointer('pointerup', 3, 280, 400));
  f.button.dispatchEvent(pointer('pointerdown', 4)); f.rotate(true); f.button.dispatchEvent(pointer('pointerup', 4));
  assert.deepEqual(f.calls.lock, []);
  f.control.dispose();
});
