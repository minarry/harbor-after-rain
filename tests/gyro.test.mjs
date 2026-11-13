import test from 'node:test';
import assert from 'node:assert/strict';
import { Euler, Quaternion, Vector3, MathUtils } from 'three';
import { GyroState, orientationQuaternion } from '../src/gyro-state.js';
import { GyroControls } from '../src/gyro.js';

const axes = { pitch: new Vector3(1, 0, 0), yaw: new Vector3(0, 1, 0), roll: new Vector3(0, 0, 1) };
// Generate physical screen rotations with Three, then encode sensor events.
// This is independent of the production quaternion multiplication/extraction.
function pose(screenAngle = 90, axis = 'yaw', radians = 0) {
  const screen = new Quaternion().setFromAxisAngle(axes.pitch, .9);
  screen.multiply(new Quaternion().setFromAxisAngle(axes[axis], radians));
  const device = screen.multiply(new Quaternion().setFromAxisAngle(axes.roll, screenAngle * Math.PI / 180));
  const euler = new Euler().setFromQuaternion(device, 'ZXY');
  return { alpha: (MathUtils.radToDeg(euler.z) + 360) % 360, beta: MathUtils.radToDeg(euler.x), gamma: MathUtils.radToDeg(euler.y), absolute: false };
}
const zero = value => assert.ok(Math.abs(value) < 1e-9, `expected zero, got ${value}`);

test('physical screen yaw and pitch stay independent in both landscape directions', () => {
  for (const angle of [90, 270]) for (const axis of ['yaw', 'pitch']) {
    const state = new GyroState({ smoothing: 0, deadZone: 0 });
    state.sample(pose(angle), angle, 0); state.sample(pose(angle, axis, .035), angle, 20);
    const delta = state.takeLook();
    assert.ok(Math.abs(delta[axis] - .035) < 1e-10, `${angle}/${axis}: ${JSON.stringify(delta)}`);
    zero(delta[axis === 'yaw' ? 'pitch' : 'yaw']);
    assert.deepEqual(state.takeLook(), { yaw: 0, pitch: 0 }, 'increments are consumed once');
  }
});

test('rolling the phone does not aim and screen correction matches an actual physical pose', () => {
  for (const angle of [0, 90, 180, 270]) {
    const q = new Quaternion().fromArray(orientationQuaternion(pose(angle), angle));
    assert.ok(q.angleTo(new Quaternion().setFromAxisAngle(axes.pitch, .9)) < 1e-7);
    const state = new GyroState({ smoothing: 0, deadZone: 0 });
    state.sample(pose(angle), angle, 0); state.sample(pose(angle, 'roll', .04), angle, 20);
    const delta = state.takeLook(); zero(delta.yaw); zero(delta.pitch);
  }
});

test('alpha crossing 360 has the same small motion as crossing zero without wrapping', () => {
  const outputs = [];
  for (const start of [359, -1]) {
    const state = new GyroState({ smoothing: 0, deadZone: 0 });
    state.sample({ alpha: start, beta: 0, gamma: -60 }, 90, 0);
    state.sample({ alpha: 1, beta: 0, gamma: -60 }, 90, 20);
    outputs.push(state.takeLook()); assert.equal(state.rejected, 0);
  }
  assert.ok(Math.abs(outputs[0].yaw - outputs[1].yaw) < 1e-12);
  assert.ok(Math.abs(outputs[0].pitch - outputs[1].pitch) < 1e-12);
  assert.ok(Math.hypot(outputs[0].yaw, outputs[0].pitch) < .04);
});

test('filter suppresses tiny oscillation but preserves deliberate sub-deadband slow aiming', () => {
  const noise = new GyroState(); noise.sample(pose(), 90, 0);
  for (let i = 1; i <= 240; i++) noise.sample(pose(90, 'yaw', i % 2 ? .0002 : -.0002), 90, i * 1000 / 60);
  assert.deepEqual(noise.takeLook(), { yaw: 0, pitch: 0 });
  const slow = new GyroState(); slow.sample(pose(), 90, 0);
  for (let i = 1; i <= 240; i++) slow.sample(pose(90, 'yaw', Math.min(i, 120) * .0001), 90, i * 1000 / 60);
  const delta = slow.takeLook();
  assert.ok(delta.yaw > .011 && delta.yaw < .0121, `slow intentional motion was lost: ${delta.yaw}`); zero(delta.pitch);
});

test('smoothing converges to the same turn at 30, 60 and 120 sensor samples per second', () => {
  const totals = [30, 60, 120].map(rate => {
    const state = new GyroState(); state.sample(pose(), 90, 0);
    for (let i = 1; i <= rate * 2; i++) state.sample(pose(90, 'pitch', .2 * Math.min(i / rate, 1)), 90, i * 1000 / rate);
    return state.takeLook().pitch;
  });
  for (const total of totals) assert.ok(Math.abs(total - .2) < .001);
  assert.ok(Math.max(...totals) - Math.min(...totals) < .00001);
});

test('invalid samples, discontinuities, long gaps and screen rotation cannot jump aim', () => {
  const state = new GyroState({ smoothing: 0, deadZone: 0 });
  assert.equal(state.sample({ alpha: null, beta: 0, gamma: 0 }, 90, 0), 'invalid');
  state.sample(pose(), 90, 0); state.sample(pose(90, 'yaw', .02), 90, 16);
  assert.equal(state.sample(pose(90, 'yaw', 1.5), 90, 32), 'rejected');
  assert.deepEqual(state.takeLook(), { yaw: 0, pitch: 0 });
  assert.equal(state.sample(pose(90, 'yaw', -.5), 90, 1000), 'baseline');
  assert.deepEqual(state.takeLook(), { yaw: 0, pitch: 0 });
  state.sample(pose(270, 'pitch', .8), 270, 1020);
  assert.deepEqual(state.takeLook(), { yaw: 0, pitch: 0 });
  state.reset(); state.sample(pose(270, 'pitch', -.8), 270, 1040);
  assert.deepEqual(state.takeLook(), { yaw: 0, pitch: 0 });
});

function fixture({ touch = true, secure = true, api = true, permission, playing = true } = {}) {
  let time = 0;
  const win = new EventTarget(), doc = new EventTarget(), updates = [];
  win.isSecureContext = secure; doc.hidden = false;
  win.screen = { orientation: new EventTarget() }; win.screen.orientation.angle = 90;
  if (api) { win.DeviceOrientationEvent = class {}; if (permission) win.DeviceOrientationEvent.requestPermission = permission; }
  const game = { touchMode: touch, playing, paused: false, inLoadout: false, ended: false, player: { alive: true }, landscape: { blocked: false }, opts: { gyroSens: 1, touchSens: 1, sens: 1 }, hud: { updateGyro: state => updates.push(state) } };
  const gyro = new GyroControls(game, { window: win, document: doc, now: () => time });
  return { win, doc, game, gyro, updates,
    advance(ms) { time += ms; gyro.sync(); },
    emit(values = pose(), dt = 1000 / 60) { time += dt; win.dispatchEvent(Object.assign(new Event('deviceorientation'), values)); },
  };
}

test('permission is gesture-only, concurrent requests share one prompt and readiness requires real samples', async () => {
  let prompts = 0, grant;
  const f = fixture({ permission: () => { prompts++; return new Promise(resolve => { grant = resolve; }); } });
  f.gyro.sync(); assert.equal(prompts, 0); assert.equal(f.gyro.status, 'off');
  const request = f.gyro.enable(); assert.strictEqual(f.gyro.enable(), request);
  assert.equal(prompts, 1); assert.equal(f.gyro.status, 'requesting');
  grant('granted'); assert.equal(await request, true);
  assert.equal(f.gyro.status, 'waiting'); assert.equal(f.gyro.enabled, true);
  f.emit({ alpha: null, beta: null, gamma: null }); assert.equal(f.gyro.status, 'waiting');
  f.emit(); assert.equal(f.gyro.status, 'ready'); assert.deepEqual(f.gyro.takeLook(), { yaw: 0, pitch: 0 });
  f.emit(pose(90, 'yaw', .035)); assert.ok(f.gyro.takeLook().yaw > 0);
  f.gyro.dispose();
});

test('unsupported, insecure, denied and rejected permission states never claim working input', async () => {
  for (const [options, status] of [[{ api: false }, 'unsupported'], [{ touch: false }, 'unsupported'], [{ secure: false }, 'insecure'], [{ permission: async () => 'denied' }, 'denied'], [{ permission: () => { throw new Error('sensor error'); } }, 'error']]) {
    const f = fixture(options); assert.equal(await f.gyro.enable(), false);
    assert.equal(f.gyro.status, status); assert.equal(f.gyro.enabled, false); assert.equal(f.gyro.snapshot().canRecenter, false);
    f.emit(); assert.deepEqual(f.gyro.takeLook(), { yaw: 0, pitch: 0 }); f.gyro.dispose();
  }
});

test('no-data timeout remains honest, and a recovering sensor establishes a fresh baseline', async () => {
  const f = fixture(); await f.gyro.enable(); f.advance(3001);
  assert.equal(f.gyro.status, 'no-data'); assert.equal(f.gyro.snapshot().canRecenter, false);
  f.emit(); assert.equal(f.gyro.status, 'ready');
  f.emit(pose(90, 'yaw', .04)); assert.ok(f.gyro.takeLook().yaw > 0);
  f.advance(3100); assert.equal(f.gyro.status, 'no-data');
  f.emit(pose(90, 'yaw', 1)); assert.deepEqual(f.gyro.takeLook(), { yaw: 0, pitch: 0 });
  f.gyro.dispose();
});

test('menu can enable and report sensors without collecting camera motion', async () => {
  const f = fixture({ playing: false }); await f.gyro.enable();
  f.emit(); f.emit(pose(90, 'yaw', .04));
  assert.equal(f.gyro.status, 'ready'); assert.equal(f.gyro.active, false); assert.deepEqual(f.gyro.takeLook(), { yaw: 0, pitch: 0 });
  f.game.playing = true; f.emit(pose(90, 'yaw', .1));
  assert.deepEqual(f.gyro.takeLook(), { yaw: 0, pitch: 0 });
  f.emit(pose(90, 'yaw', .12)); assert.ok(f.gyro.takeLook().yaw > 0);
  f.gyro.dispose();
});

test('pause, death, loadout, background and portrait invalidate motion on both sides of the transition', async () => {
  for (const [enter, leave] of [
    [f => { f.game.paused = true; }, f => { f.game.paused = false; }],
    [f => { f.game.player.alive = false; }, f => { f.game.player.alive = true; }],
    [f => { f.game.inLoadout = true; }, f => { f.game.inLoadout = false; }],
    [f => { f.doc.hidden = true; }, f => { f.doc.hidden = false; }],
    [f => { f.game.landscape.blocked = true; }, f => { f.game.landscape.blocked = false; }],
  ]) {
    const f = fixture(); await f.gyro.enable(); f.emit(); f.emit(pose(90, 'yaw', .03));
    enter(f); assert.deepEqual(f.gyro.takeLook(), { yaw: 0, pitch: 0 });
    f.emit(pose(90, 'yaw', .06)); assert.deepEqual(f.gyro.takeLook(), { yaw: 0, pitch: 0 });
    leave(f); f.emit(pose(90, 'yaw', .2)); assert.deepEqual(f.gyro.takeLook(), { yaw: 0, pitch: 0 });
    f.emit(pose(90, 'yaw', .22)); assert.ok(f.gyro.takeLook().yaw > 0); f.gyro.dispose();
  }
});

test('new player, recenter, reset and screen rotation clear pending motion without altering aim', async () => {
  for (const reset of [f => { f.game.player = { alive: true }; }, f => f.gyro.recenter(), f => f.gyro.reset(), f => { f.win.screen.orientation.angle = 270; }]) {
    const f = fixture(); await f.gyro.enable(); f.emit(); f.emit(pose(90, 'pitch', .04));
    reset(f); assert.deepEqual(f.gyro.takeLook(), { yaw: 0, pitch: 0 });
    const angle = f.win.screen.orientation.angle;
    f.emit(pose(angle, 'pitch', .4)); assert.deepEqual(f.gyro.takeLook(), { yaw: 0, pitch: 0 });
    f.emit(pose(angle, 'pitch', .42)); assert.ok(f.gyro.takeLook().pitch > 0); f.gyro.dispose();
  }
});

test('raw gyro increments do not depend on mouse, swipe or gyro sensitivity settings', async () => {
  const results = [];
  for (const value of [.2, 1, 3]) {
    const f = fixture(); f.game.opts = { gyroSens: value, touchSens: 4 - value, sens: value / 2 };
    await f.gyro.enable(); f.emit(); f.emit(pose(90, 'yaw', .04)); results.push(f.gyro.takeLook()); f.gyro.dispose();
  }
  assert.deepEqual(results[0], results[1]); assert.deepEqual(results[1], results[2]);
  assert.ok(results[0].yaw > 0);
});

test('disable cancels pending permission completion and detaches sensor input', async () => {
  let grant;
  const f = fixture({ permission: () => new Promise(resolve => { grant = resolve; }) });
  const request = f.gyro.enable(); f.gyro.disable(); grant('granted');
  assert.equal(await request, false); assert.equal(f.gyro.enabled, false); assert.equal(f.gyro.status, 'off');
  f.emit(); assert.equal(f.gyro.status, 'off');
  f.win.DeviceOrientationEvent.requestPermission = async () => 'granted'; await f.gyro.enable(); f.emit();
  f.gyro.disable(); f.emit(pose(90, 'yaw', .04)); assert.equal(f.gyro.status, 'off');
  assert.deepEqual(f.gyro.takeLook(), { yaw: 0, pitch: 0 }); f.gyro.dispose();
});

test('stable frame sync does not repeat HUD status writes', async () => {
  const f = fixture(); await f.gyro.enable(); f.emit();
  const count = f.updates.length;
  for (let i = 0; i < 120; i++) f.gyro.sync();
  assert.equal(f.updates.length, count); f.gyro.dispose();
});
