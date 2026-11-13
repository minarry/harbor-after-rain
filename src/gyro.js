import { GyroState } from './gyro-state.js';

export class GyroControls {
  constructor(game, { window: win = globalThis.window, document: doc = globalThis.document, now = () => win.performance.now(), noDataMs = 3000 } = {}) {
    this.g = game; this.win = win; this.doc = doc; this.now = now; this.noDataMs = noDataMs;
    this.state = new GyroState(); this.enabled = false; this.pending = null; this.active = false;
    this.player = null; this.lastData = null; this.startedAt = 0; this.angle = this.screenAngle();
    this.epoch = 0; this.disposed = false; this.blurred = false; this.listeners = []; this.published = '';
    this.onData = event => this.receive(event);
    this.status = this.availability() || 'off';
    const reset = () => { this.reset(); this.sync(); };
    for (const type of ['resize', 'orientationchange']) this.listen(win, type, reset);
    this.listen(win.screen?.orientation, 'change', reset);
    this.listen(win, 'blur', () => { this.blurred = true; reset(); });
    this.listen(win, 'focus', () => { this.blurred = false; reset(); });
    this.listen(doc, 'visibilitychange', reset);
    this.sync();
  }
  listen(target, type, fn) { if (target?.addEventListener) { target.addEventListener(type, fn); this.listeners.push([target, type, fn]); } }
  availability() {
    if (!this.g.touchMode) return 'unsupported';
    if (this.win.isSecureContext === false) return 'insecure';
    if (!this.win.DeviceOrientationEvent && !('ondeviceorientation' in this.win)) return 'unsupported';
    return null;
  }
  get supported() { return !this.availability(); }
  screenAngle() {
    const value = this.win?.screen?.orientation?.angle;
    const angle = Number.isFinite(value) ? value : Number.isFinite(this.win?.orientation) ? this.win.orientation : 0;
    return ((angle % 360) + 360) % 360;
  }
  playable() {
    const g = this.g;
    return this.enabled && this.status === 'ready' && g.playing && !g.ended && !g.paused && !g.inLoadout && g.player?.alive && !this.doc.hidden && !this.blurred && !g.landscape?.blocked;
  }
  get statusText() {
    const messages = {
      off: '陀螺仪已关闭', requesting: '正在请求姿态传感器权限…', waiting: '已开启，等待姿态数据…',
      'no-data': '尚未收到姿态数据，请检查浏览器传感器权限；仍可滑动瞄准。',
      denied: '未允许姿态传感器，请在浏览器中允许后重试；仍可滑动瞄准。',
      unsupported: '此浏览器或设备未提供姿态传感器，仍可滑动瞄准。',
      insecure: '陀螺仪需要安全连接（HTTPS），仍可滑动瞄准。',
      error: '无法开启姿态传感器，请重试或使用滑动瞄准。',
    };
    if (this.status !== 'ready') return messages[this.status];
    if (this.calibrating) return '保持舒适握姿，下一次读数将作为新基准。';
    if (this.g.landscape?.blocked) return '已收到姿态数据，请横屏使用。';
    if (this.doc.hidden || this.blurred || this.g.paused || this.g.inLoadout) return '已启用，暂停期间不转动镜头。';
    if (!this.g.playing || this.g.ended) return '已启用，进入对局后生效。';
    if (!this.g.player?.alive) return '已启用，复活后生效。';
    return '陀螺仪已启用，可与滑动瞄准同时使用。';
  }
  snapshot() {
    return { enabled: this.enabled, pending: !!this.pending, supported: this.supported, canRecenter: this.enabled && this.status === 'ready', status: this.status, message: this.statusText };
  }
  publish() {
    const state = this.snapshot(), serialized = JSON.stringify(state);
    if (serialized !== this.published) { this.published = serialized; this.g.hud?.updateGyro?.(state); }
  }
  enable() {
    if (this.disposed) return Promise.resolve(false);
    if (this.pending) return this.pending;
    const unavailable = this.availability();
    if (unavailable) { this.status = unavailable; this.publish(); return Promise.resolve(false); }
    if (this.enabled) return Promise.resolve(true);
    const epoch = ++this.epoch;
    let resolve;
    const request = new Promise(done => { resolve = done; }); this.pending = request;
    this.status = 'requesting'; this.publish();
    const run = async () => {
      let failure = null;
      try {
        const api = this.win.DeviceOrientationEvent;
        // Called immediately from the HUD gesture, before any await. No
        // permission call is made by construction, sync or lifecycle events.
        if (typeof api?.requestPermission === 'function' && await api.requestPermission() !== 'granted') failure = 'denied';
      } catch (error) { failure = error?.name === 'NotAllowedError' ? 'denied' : 'error'; }
      if (epoch !== this.epoch || this.disposed) { resolve(false); return; }
      this.pending = null;
      if (failure) { this.status = failure; this.publish(); resolve(false); return; }
      this.enabled = true; this.status = 'waiting'; this.startedAt = this.now(); this.lastData = null; this.referenceAbsolute = null;
      this.reset(); this.win.addEventListener('deviceorientation', this.onData); this.sync(); resolve(true);
    };
    void run(); return request;
  }
  disable() {
    this.epoch++; this.pending = null; this.enabled = false; this.active = false; this.lastData = null;
    this.win.removeEventListener('deviceorientation', this.onData);
    this.reset(); this.status = this.availability() || 'off'; this.publish();
  }
  reset() { this.state.reset(); this.calibrating = false; }
  recenter() {
    if (!this.enabled) return false;
    this.reset(); this.calibrating = true; this.publish(); return true;
  }
  sync() {
    if (this.disposed) return false;
    const angle = this.screenAngle();
    if (angle !== this.angle) { this.angle = angle; this.reset(); }
    if (this.enabled && this.now() - (this.lastData ?? this.startedAt) >= this.noDataMs && this.status !== 'no-data') {
      this.status = 'no-data'; this.reset();
    }
    const active = !!this.playable(), player = this.g.player;
    if (active !== this.active || player !== this.player) { this.reset(); this.active = active; this.player = player; }
    this.publish(); return active;
  }
  receive(event) {
    if (!this.enabled || ![event.alpha, event.beta, event.gamma].every(Number.isFinite)) return;
    const time = this.now();
    this.lastData = time; this.status = 'ready'; this.calibrating = false;
    const absolute = !!event.absolute;
    if (this.referenceAbsolute !== null && absolute !== this.referenceAbsolute) this.reset();
    this.referenceAbsolute = absolute;
    if (this.sync()) this.state.sample(event, this.angle, time);
  }
  takeLook() { if (!this.sync()) return { yaw: 0, pitch: 0 }; return this.state.takeLook(); }
  debugSnapshot() { return { ...this.snapshot(), active: this.active, screenAngle: this.angle, samples: this.state.samples, rejected: this.state.rejected, lastDataAgeMs: this.lastData === null ? null : Math.max(0, this.now() - this.lastData) }; }
  dispose() {
    this.disable(); this.disposed = true;
    for (const [target, type, fn] of this.listeners) target.removeEventListener(type, fn);
    this.listeners = [];
  }
}
