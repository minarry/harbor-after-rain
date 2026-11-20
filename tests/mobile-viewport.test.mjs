import test from 'node:test';
import assert from 'node:assert/strict';
import { MobileViewport, swapMediaQuery } from '../src/mobile-viewport.js';

class Style {
  constructor() { this.values = new Map(); this.priorities = new Map(); }
  getPropertyValue(name) { return this.values.get(name) || ''; }
  getPropertyPriority(name) { return this.priorities.get(name) || ''; }
  setProperty(name, value, priority = '') { this.values.set(name, String(value)); this.priorities.set(name, priority); }
  removeProperty(name) { this.values.delete(name); this.priorities.delete(name); }
}
class DetailEvent extends Event {
  constructor(type, { detail } = {}) { super(type); this.detail = detail; }
}
function fixture({ width = 390, height = 844, coarse = true, search = '' } = {}) {
  const window = new EventTarget(), nativeQueries = new Map();
  Object.assign(window, { innerWidth: width, innerHeight: height, location: { search }, visualViewport: new EventTarget(), CustomEvent: DetailEvent, navigator: { userActivation: { isActive: true } }, screen: { orientation: {} } });
  const match = query => {
    if (query.includes('pointer:coarse')) return coarse;
    const parts = [...query.matchAll(/\((min|max)-(width|height):\s*(\d+)px\)/g)];
    if (!parts.length) return query === '(prefers-reduced-motion:reduce)';
    return parts.every(([, bound, axis, limit]) => bound === 'min' ? window[axis === 'width' ? 'innerWidth' : 'innerHeight'] >= Number(limit) : window[axis === 'width' ? 'innerWidth' : 'innerHeight'] <= Number(limit));
  };
  window.matchMedia = query => {
    if (!nativeQueries.has(query)) {
      const media = new EventTarget();
      Object.defineProperty(media, 'matches', { get: () => match(query) });
      media.media = query; nativeQueries.set(query, media);
    }
    return nativeQueries.get(query);
  };
  const medium = { media: { mediaText: '(max-width:760px)' }, cssRules: [] };
  const nested = { media: { mediaText: '(max-height:560px) and (min-width:761px)' }, cssRules: [medium] };
  const document = { body: { style: new Style() }, documentElement: { style: new Style() }, styleSheets: [{ cssRules: [nested] }], fullscreenElement: null };
  document.body.style.setProperty('width', '100%', 'important');
  const viewport = new MobileViewport({ window, document });
  const events = []; window.addEventListener('gameviewportresize', e => events.push(e.detail));
  viewport.init();
  return { viewport, window, document, medium, nested, nativeQueries, events, resize(w, h) { window.innerWidth = w; window.innerHeight = h; window.dispatchEvent(new Event('resize')); } };
}

test('portrait mobile uses a landscape body and logical viewport units without a gate', () => {
  const f = fixture(), v = f.viewport, s = f.document.documentElement.style, body = f.document.body.style;
  assert.equal(v.enabled, true); assert.equal(v.rotated, true);
  assert.equal(v.width, 844); assert.equal(v.height, 390);
  assert.equal(s.getPropertyValue('--game-vw'), '8.44px'); assert.equal(s.getPropertyValue('--game-vh'), '3.9px');
  assert.equal(s.getPropertyValue('--game-vmin'), '3.9px'); assert.equal(s.getPropertyValue('--game-vmax'), '8.44px');
  assert.equal(body.getPropertyValue('width'), '844px'); assert.equal(body.getPropertyValue('height'), '390px');
  assert.equal(body.getPropertyValue('transform'), 'translateX(390px) rotate(90deg)');
  assert.equal(body.getPropertyValue('transform-origin'), '0 0');
  assert.deepEqual(f.events, [{ width: 844, height: 390, rotated: true }]);
});

test('touch points and bounding rectangles invert the visible rotation', () => {
  const { viewport: v } = fixture();
  for (const p of [{ x: 0, y: 0 }, { x: 844, y: 390 }, { x: 517, y: 120 }, { x: 35.5, y: 241.25 }]) {
    const client = v.toClient(p.x, p.y);
    assert.deepEqual(v.clientToLocal(client.x, client.y), p);
  }
  assert.deepEqual(v.clientToLocal(390, 0), { x: 0, y: 0 });
  assert.deepEqual(v.toClient(844, 390), { x: 0, y: 844 });
  assert.deepEqual(v.rectToLocal({ left: 260, top: 70, right: 310, bottom: 190 }), { x: 70, y: 80, left: 70, top: 80, right: 190, bottom: 130, width: 120, height: 50 });
  assert.deepEqual(v.rectToLocal({ left: 260, top: 70, width: 50, height: 120 }), v.rectToLocal({ left: 260, top: 70, right: 310, bottom: 190 }));
});

test('resize restores original body styling and safe areas without changing logical landscape dimensions', () => {
  const f = fixture(), body = f.document.body.style, root = f.document.documentElement.style;
  const rotatedSides = ['right', 'bottom', 'left', 'top'];
  ['top', 'right', 'bottom', 'left'].forEach((side, i) => assert.equal(root.getPropertyValue(`--game-safe-${side}`), `env(safe-area-inset-${rotatedSides[i]}, 0px)`));
  f.resize(844, 390);
  assert.equal(f.viewport.rotated, false); assert.equal(f.viewport.width, 844); assert.equal(f.viewport.height, 390);
  assert.equal(body.getPropertyValue('transform'), ''); assert.equal(body.getPropertyValue('position'), '');
  assert.equal(body.getPropertyValue('width'), '100%'); assert.equal(body.getPropertyPriority('width'), 'important');
  assert.deepEqual(f.viewport.clientToLocal(70, 80), { x: 70, y: 80 });
  for (const side of ['top', 'right', 'bottom', 'left']) assert.equal(root.getPropertyValue(`--game-safe-${side}`), `env(safe-area-inset-${side}, 0px)`);
  const count = f.events.length; f.viewport.init(); f.resize(844, 390); assert.equal(f.events.length, count);
  f.window.innerHeight = 360; f.window.visualViewport.dispatchEvent(new Event('resize'));
  assert.equal(f.viewport.height, 360); assert.equal(f.events.length, count + 1);
});

test('CSS media conditions swap once from their saved originals and restore across repeated rotations', () => {
  const f = fixture();
  assert.equal(f.medium.media.mediaText, '(max-height:760px)');
  assert.equal(f.nested.media.mediaText, '(max-width:560px) and (min-height:761px)');
  f.resize(400, 900); assert.equal(f.medium.media.mediaText, '(max-height:760px)');
  f.resize(900, 400); assert.equal(f.medium.media.mediaText, '(max-width:760px)');
  f.resize(400, 900); assert.equal(f.medium.media.mediaText, '(max-height:760px)');
  assert.equal(swapMediaQuery('(min-width:800px) and (orientation:landscape), (max-height:400px)'), '(min-height:800px) and (orientation:portrait), (max-width:400px)');
  assert.equal(swapMediaQuery('(pointer:coarse) and (prefers-reduced-motion:reduce)'), '(pointer:coarse) and (prefers-reduced-motion:reduce)');
  f.document.styleSheets.push(Object.defineProperty({}, 'cssRules', { get() { throw new Error('Cross-origin'); } }));
  assert.doesNotThrow(() => f.resize(390, 844));
});

test('logical matchMedia updates subscribers only when the logical query result changes', () => {
  const f = fixture(), media = f.viewport.matchMedia('(max-width:920px)'), events = [];
  const callback = e => events.push({ matches: e.matches, media: e.media });
  assert.equal(media.matches, true); media.addEventListener('change', callback);
  f.resize(844, 390); assert.equal(media.matches, true); assert.equal(events.length, 0);
  f.resize(400, 1000); assert.equal(media.matches, false);
  assert.deepEqual(events, [{ matches: false, media: '(max-width:920px)' }]);
  f.resize(390, 844); assert.equal(media.matches, true); assert.equal(events.length, 2);
  media.removeEventListener('change', callback); assert.equal(f.viewport.mediaQueries.size, 0);
  f.resize(500, 1200); assert.equal(media.matches, false); assert.equal(events.length, 2);
});

test('logical matchMedia supports native changes, legacy listeners and onchange', () => {
  const f = fixture({ width: 1000, height: 500 }), media = f.viewport.matchMedia('(max-width:920px)'), events = [];
  const listener = e => events.push(`legacy:${e.matches}`);
  media.addListener(listener); media.onchange = e => events.push(`onchange:${e.matches}`);
  f.window.innerWidth = 800;
  f.nativeQueries.get('(max-width:920px)').dispatchEvent(new Event('change'));
  assert.equal(media.matches, true); assert.deepEqual(events, ['onchange:true', 'legacy:true']);
  media.removeListener(listener); media.onchange = null;
  assert.equal(f.viewport.mediaQueries.size, 0);
});

test('desktop preserves physical orientation and body style while touch preview opts into landscape', async () => {
  const f = fixture({ coarse: false });
  assert.equal(f.viewport.enabled, false); assert.equal(f.viewport.rotated, false);
  assert.equal(f.viewport.width, 390); assert.equal(f.viewport.height, 844);
  assert.equal(f.document.body.style.getPropertyValue('transform'), '');
  assert.equal(f.medium.media.mediaText, '(max-width:760px)');
  f.document.documentElement.requestFullscreen = () => { throw new Error('Must not request on desktop'); };
  f.window.screen.orientation.lock = () => { throw new Error('Must not lock desktop'); };
  assert.equal(await f.viewport.requestLock(), false);
  const preview = fixture({ coarse: false, search: '?touch' });
  assert.equal(preview.viewport.rotated, true); assert.equal(preview.viewport.width, 844);
});

test('native landscape lock waits for fullscreen and deduplicates simultaneous requests', async () => {
  const f = fixture(), calls = [];
  let completeFullscreen;
  f.document.documentElement.requestFullscreen = () => { calls.push('fullscreen'); return new Promise(resolve => { completeFullscreen = resolve; }); };
  f.window.screen.orientation.lock = async mode => { calls.push(mode); };
  const first = f.viewport.requestLock(), second = f.viewport.requestLock();
  assert.equal(first, second); assert.deepEqual(calls, ['fullscreen']);
  completeFullscreen(); assert.equal(await first, true);
  assert.deepEqual(calls, ['fullscreen', 'landscape']); assert.equal(f.viewport.lockPending, null);
});

test('unsupported APIs, missing activation and rejected fullscreen keep the CSS fallback silently', async () => {
  const f = fixture(), calls = [];
  f.document.documentElement.requestFullscreen = async () => { calls.push('fullscreen'); };
  assert.equal(await f.viewport.requestLock(), false); assert.deepEqual(calls, []);
  f.window.screen.orientation.lock = async () => { calls.push('lock'); };
  delete f.document.documentElement.requestFullscreen;
  assert.equal(await f.viewport.requestLock(), false); assert.deepEqual(calls, []);
  f.document.documentElement.requestFullscreen = async () => { throw new Error('Denied'); };
  assert.equal(await f.viewport.requestLock(), false); assert.deepEqual(calls, []);
  assert.equal(f.viewport.rotated, true); assert.equal(f.viewport.lockPending, null);
  f.window.navigator.userActivation.isActive = false;
  f.document.documentElement.requestFullscreen = async () => { calls.push('fullscreen'); };
  assert.equal(await f.viewport.requestLock(), false); assert.deepEqual(calls, []);
});

test('an existing fullscreen only requests the landscape lock and catches its rejection', async () => {
  const f = fixture(), calls = [];
  f.document.fullscreenElement = f.document.documentElement;
  f.document.documentElement.requestFullscreen = async () => { calls.push('fullscreen'); };
  f.window.screen.orientation.lock = async mode => { calls.push(mode); throw new Error('Unavailable'); };
  assert.equal(await f.viewport.requestLock(), false); assert.deepEqual(calls, ['landscape']);
  assert.equal(f.viewport.rotated, true); assert.equal(f.viewport.lockPending, null);
});
