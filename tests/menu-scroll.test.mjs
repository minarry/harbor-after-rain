import test from 'node:test';
import assert from 'node:assert/strict';
import { bindLandscapeMenuScroll } from '../src/menu-scroll.js';

// Minimal DOM/clock abstraction: scrolling clamps like an overflow element.
// Native user activation and browser gesture delivery need the browser suite.
class Surface {
  listeners = new Map();
  addEventListener(type, fn, options) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push({ fn, capture: options === true || !!options?.capture });
  }
  removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item.fn !== fn)); }
  emit(type, event = {}) {
    if (event.type !== type) event.type = type;
    for (const { fn } of [...(this.listeners.get(type) || [])].sort((a, b) => Number(b.capture) - Number(a.capture))) {
      fn(event); if (event.immediateStopped) break;
    }
    return event;
  }
  dispatchEvent(event) { this.emit(event.type, event); return !event.defaultPrevented; }
  listenerCount() { return [...this.listeners.values()].reduce((n, list) => n + list.length, 0); }
}

function fixture({ rotated = true, enabled = true } = {}) {
  const host = new Surface(), element = new Surface(), classes = new Set(), captures = new Set(), frames = new Map();
  let now = 0, frameId = 0, top = 0;
  Object.assign(host, {
    Event,
    performance: { now: () => now },
    requestAnimationFrame: fn => { const id = ++frameId; frames.set(id, fn); return id; },
    cancelAnimationFrame: id => frames.delete(id),
  });
  Object.defineProperty(element, 'scrollTop', { get: () => top, set: value => { top = Math.max(0, Math.min(600, value)); } });
  Object.assign(element, {
    classList: { contains: name => classes.has(name), toggle: (name, on) => on ? classes.add(name) : classes.delete(name), remove: name => classes.delete(name) },
    setPointerCapture: id => captures.add(id), hasPointerCapture: id => captures.has(id),
    releasePointerCapture: id => { captures.delete(id); element.emit('lostpointercapture', { target: element, pointerId: id }); },
  });
  const viewport = { rotated, enabled,
    clientToLocal(x, y) { return this.rotated ? { x: y, y: 390 - x } : { x, y }; },
    rectToLocal(rect) {
      const a = this.clientToLocal(rect.left, rect.top), b = this.clientToLocal(rect.right, rect.bottom);
      return { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
    },
  };
  const button = { closest: () => null }, input = { closest: selector => selector === 'input[type="range"]' ? null : input };
  const range = new Surface(), rangeCaptures = new Set(), rangeEvents = [];
  Object.assign(range, {
    min: '0', max: '10', step: '0.5', value: '2', disabled: false,
    closest: () => range,
    getBoundingClientRect: () => viewport.rotated ? { left: 130, top: 100, right: 150, bottom: 300, width: 20, height: 200 }
      : { left: 100, top: 240, right: 300, bottom: 260, width: 200, height: 20 },
    setPointerCapture: id => rangeCaptures.add(id), hasPointerCapture: id => rangeCaptures.has(id),
    releasePointerCapture: id => { rangeCaptures.delete(id); element.emit('lostpointercapture', { target: range, pointerId: id }); },
  });
  for (const type of ['input', 'change']) range.addEventListener(type, event => rangeEvents.push({ type, value: range.value, bubbles: event.bubbles }));
  const binding = bindLandscapeMenuScroll(element, viewport, host);
  const event = (type, x = 120, y = 250, options = {}) => {
    now += 16;
    const point = viewport.rotated ? { x: 390 - y, y: x } : { x, y };
    return { type, target: button, pointerType: 'touch', isPrimary: true, pointerId: 1,
      clientX: point.x, clientY: point.y, timeStamp: now, cancelable: true, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.immediateStopped = true; }, ...options };
  };
  const send = (type, x, y, options) => (type === 'pointerdown' || type === 'click' ? element : host).emit(type, event(type, x, y, options));
  const click = options => send('click', 120, 250, { detail: 1, ...options });
  const tick = (ms = 16) => { now += ms; const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(now); };
  return { host, element, viewport, captures, frames, button, input, range, rangeCaptures, rangeEvents, binding, event, send, click, tick };
}

test('tap keeps its original click without capture or preventing native activation', () => {
  const f = fixture();
  assert.equal(f.element.classList.contains('landscape-scroll'), true);
  const down = f.send('pointerdown'), move = f.send('pointermove', 123, 252), up = f.send('pointerup', 123, 252);
  assert.equal(down.defaultPrevented, false); assert.equal(move.defaultPrevented, false); assert.equal(up.defaultPrevented, false);
  assert.equal(f.captures.size, 0); assert.equal(f.element.scrollTop, 0);
  const click = f.click(); assert.equal(click.defaultPrevented, false); assert.equal(click.immediateStopped, undefined);
  assert.equal(f.frames.size, 0); f.binding.dispose();
});

test('drag scrolls logical Y, captures after threshold and ignores child capture loss', () => {
  const f = fixture(); f.send('pointerdown');
  f.send('pointermove', 120, 245); assert.equal(f.captures.size, 0); assert.equal(f.element.scrollTop, 0);
  const move = f.send('pointermove', 120, 220);
  assert.equal(move.defaultPrevented, true); assert.equal(f.element.scrollTop, 30); assert.ok(f.captures.has(1));
  f.element.emit('lostpointercapture', { target: f.button, pointerId: 1 });
  f.send('pointermove', 120, 200); assert.equal(f.element.scrollTop, 50, 'loss bubbling from the original button does not end the drag');
  f.send('pointercancel', 120, 200); assert.equal(f.captures.size, 0); assert.equal(f.frames.size, 0);
  f.binding.dispose();
});

test('drag suppresses its click before button actions but preserves keyboard and fresh taps', () => {
  const f = fixture(); let actions = 0;
  f.element.addEventListener('click', () => { actions++; });
  f.send('pointerdown'); f.send('pointermove', 120, 210); f.send('pointerup', 120, 210);
  assert.equal(f.click({ detail: 0 }).defaultPrevented, false); assert.equal(actions, 1, 'keyboard activation remains available');
  const dragged = f.click(); assert.equal(dragged.defaultPrevented, true); assert.equal(actions, 1, 'capture handler prevents the dragged button action');
  f.send('pointerdown', 120, 250, { pointerId: 2 }); f.send('pointerup', 120, 250, { pointerId: 2 });
  assert.equal(f.click({ pointerId: 2 }).defaultPrevented, false); assert.equal(actions, 2);
  // A browser may emit no click for a drag. A fresh tap still clears suppression.
  f.send('pointerdown'); f.send('pointermove', 120, 210); f.send('pointerup', 120, 210);
  f.send('pointerdown', 120, 250, { pointerId: 3 }); f.send('pointerup', 120, 250, { pointerId: 3 });
  assert.equal(f.click({ pointerId: 3 }).defaultPrevented, false); assert.equal(actions, 3);
  f.binding.dispose();
});

test('other form fields and native landscape remain under browser control', () => {
  for (const options of [{}, { rotated: false }, { enabled: false }]) {
    const f = fixture(options), target = options.rotated === false || options.enabled === false ? f.range : f.input;
    const down = f.send('pointerdown', 120, 250, { target });
    const move = f.send('pointermove', 120, 100, { target });
    const up = f.send('pointerup', 120, 100, { target });
    assert.equal(f.element.scrollTop, 0); assert.equal(f.captures.size, 0); assert.equal(f.frames.size, 0);
    assert.equal(f.rangeCaptures.size, 0); assert.equal(f.rangeEvents.length, 0); assert.equal(f.range.value, '2');
    for (const event of [down, move, up]) assert.equal(event.defaultPrevented, false);
    assert.equal(f.element.classList.contains('landscape-scroll'), options.rotated !== false && options.enabled !== false);
    f.binding.dispose();
  }
});

test('a second touch cannot take over or end the current scroll owner', () => {
  const f = fixture(); f.send('pointerdown');
  f.send('pointerdown', 120, 200, { pointerId: 2, isPrimary: false });
  f.send('pointermove', 120, 100, { pointerId: 2, isPrimary: false });
  f.send('pointerup', 120, 100, { pointerId: 2, isPrimary: false });
  assert.equal(f.element.scrollTop, 0);
  f.send('pointermove', 120, 200); assert.equal(f.element.scrollTop, 50);
  f.binding.dispose();
});

test('rotated range takes logical horizontal input and stops prior scroll momentum', () => {
  const f = fixture();
  f.send('pointerdown'); f.send('pointermove', 120, 200); f.send('pointerup', 120, 200);
  assert.equal(f.frames.size, 1);
  const before = f.element.scrollTop;
  const down = f.send('pointerdown', 140, 250, { target: f.range, pointerId: 2 });
  assert.equal(f.frames.size, 0, 'the slider must stop moving underneath the finger');
  assert.equal(f.range.value, '2'); assert.equal(f.rangeEvents.length, 0);
  const move = f.send('pointermove', 180, 250, { target: f.range, pointerId: 2 });
  f.tick(); assert.equal(f.element.scrollTop, before);
  assert.equal(f.captures.size, 0); assert.ok(f.rangeCaptures.has(2));
  assert.equal(down.defaultPrevented, true); assert.equal(move.defaultPrevented, true); assert.equal(f.range.value, '4');
  f.send('pointerup', 180, 250, { target: f.range, pointerId: 2 });
  assert.equal(f.rangeCaptures.size, 0); assert.equal(f.frames.size, 0); assert.equal(f.element.scrollTop, before);
  assert.deepEqual(f.rangeEvents, [{ type: 'input', value: '4', bubbles: true }, { type: 'change', value: '4', bubbles: true }]);
  assert.equal(f.click({ target: f.range, pointerId: 2 }).defaultPrevented, true, 'the compatibility click cannot adjust the range a second time');
  f.binding.dispose();
});

test('range values snap to steps, clamp at bounds and emit only for actual changes', () => {
  const f = fixture();
  f.send('pointerdown', 140, 250, { target: f.range });
  f.send('pointermove', 172, 250, { target: f.range }); assert.equal(f.range.value, '3.5');
  f.send('pointermove', 174, 250, { target: f.range }); assert.equal(f.rangeEvents.length, 1, 'motion inside the same step does not emit another input');
  f.send('pointermove', 400, 250, { target: f.range }); assert.equal(f.range.value, '10');
  f.send('pointermove', 70, 250, { target: f.range }); assert.equal(f.range.value, '0');
  f.send('pointerup', 70, 250, { target: f.range }); f.send('pointerup', 70, 250, { target: f.range });
  assert.deepEqual(f.rangeEvents.map(({ type, value }) => [type, value]), [['input', '3.5'], ['input', '10'], ['input', '0'], ['change', '0']]);
  assert.equal(f.element.scrollTop, 0); assert.equal(f.rangeCaptures.size, 0);
  f.binding.dispose();
});

test('unchanged, disabled and non-touch range interactions never emit duplicate changes', () => {
  const f = fixture();
  f.send('pointerdown', 140, 250, { target: f.range }); f.send('pointerup', 140, 250, { target: f.range });
  assert.equal(f.rangeEvents.length, 0, 'touching the existing value makes no change');
  f.range.disabled = true;
  const disabled = f.send('pointerdown', 250, 250, { target: f.range });
  f.send('pointermove', 280, 250, { target: f.range }); f.send('pointerup', 280, 250, { target: f.range });
  assert.equal(disabled.defaultPrevented, false); assert.equal(f.rangeCaptures.size, 0);
  f.range.disabled = false;
  const mouse = f.send('pointerdown', 250, 250, { target: f.range, pointerType: 'mouse' });
  assert.equal(mouse.defaultPrevented, false); assert.equal(f.rangeEvents.length, 0); assert.equal(f.range.value, '2');
  assert.equal(f.click({ detail: 0, target: f.range }).defaultPrevented, false, 'keyboard activation remains native');
  f.binding.dispose();
});

test('range cancellation and resize release ownership and ignore stale moves', () => {
  for (const reason of ['pointercancel', 'gameviewportresize', 'blur', 'dispose', 'lostpointercapture']) {
    const f = fixture();
    f.send('pointerdown', 140, 250, { target: f.range }); f.send('pointermove', 180, 250, { target: f.range });
    if (reason === 'pointercancel') f.send(reason, 180, 250, { target: f.range });
    else if (reason === 'dispose') f.binding.dispose();
    else if (reason === 'lostpointercapture') f.element.emit(reason, { target: f.range, pointerId: 1 });
    else f.host.emit(reason);
    const count = f.rangeEvents.length;
    f.send('pointermove', 280, 250, { target: f.range }); f.send('pointerup', 280, 250, { target: f.range });
    assert.equal(f.range.value, '4'); assert.equal(f.rangeEvents.length, count);
    assert.equal(f.rangeCaptures.size, 0); assert.equal(f.frames.size, 0); assert.equal(f.element.scrollTop, 0);
    assert.equal(f.rangeEvents.filter(event => event.type === 'change').length, reason === 'pointercancel' ? 1 : 0);
    f.binding.dispose();
  }
});

test('resize, blur and disposal cancel active contacts and momentum without stale movement', () => {
  for (const reason of ['gameviewportresize', 'blur', 'dispose']) {
    for (const inertial of [false, true]) {
      const f = fixture(); f.send('pointerdown'); f.send('pointermove', 120, 200);
      if (inertial) { f.send('pointerup', 120, 200); assert.equal(f.frames.size, 1); f.tick(); assert.ok(f.element.scrollTop > 50); }
      if (reason === 'dispose') f.binding.dispose(); else f.host.emit(reason);
      const before = f.element.scrollTop;
      assert.equal(f.captures.size, 0); assert.equal(f.frames.size, 0);
      f.send('pointermove', 120, 100); f.send('pointerup', 120, 100); f.tick();
      assert.equal(f.element.scrollTop, before);
      if (reason === 'dispose') { assert.equal(f.host.listenerCount(), 0); assert.equal(f.element.listenerCount(), 0); }
      else f.binding.dispose();
    }
  }
});

test('scroll boundaries clamp and momentum stops at the boundary', () => {
  const f = fixture(); f.element.scrollTop = 590;
  f.send('pointerdown'); f.send('pointermove', 120, 150); assert.equal(f.element.scrollTop, 600);
  f.send('pointerup', 120, 150); f.tick(); assert.equal(f.frames.size, 0); assert.equal(f.element.scrollTop, 600);
  f.send('pointerdown'); f.send('pointermove', 120, 1000); assert.equal(f.element.scrollTop, 0);
  f.binding.dispose();
});

test('nested pause content ignores gestures and stops momentum when its parent is hidden', () => {
  const f = fixture(); let hidden = true;
  f.element.closest = selector => selector === '.hidden' && hidden ? {} : null;
  f.send('pointerdown'); f.send('pointermove', 120, 150); f.send('pointerup', 120, 150);
  assert.equal(f.element.scrollTop, 0); assert.equal(f.frames.size, 0);
  hidden = false; f.send('pointerdown'); f.send('pointermove', 120, 200); f.send('pointerup', 120, 200);
  assert.equal(f.frames.size, 1); const before = f.element.scrollTop;
  hidden = true; f.tick(); assert.equal(f.element.scrollTop, before); assert.equal(f.frames.size, 0);
  f.binding.dispose();
});
