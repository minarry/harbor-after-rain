const MANUAL_HINT = '浏览器未自动旋转时，请手动横放手机。对局中转回横屏后，点击「继续」。';

// Orientation is a play constraint, not a reason to resume a paused match.
// Permission requests are separate and must be called from a user gesture.
export class MobileLandscape {
  constructor(game, { window: win = globalThis.window, document: doc = globalThis.document, screen = win?.screen ?? globalThis.screen } = {}) {
    this.g = game; this.win = win; this.doc = doc; this.screen = screen;
    this.enabled = !!game.touchMode;
    this.gate = doc?.getElementById('landscapeGate');
    this.button = doc?.getElementById('btnLandscape');
    this.hint = doc?.getElementById('landscapeHint');
    this.listeners = []; this.pending = null;
    this.wasBlocked = false; this.syncing = false; this.disposed = false;
    if (this.enabled) {
      const sync = () => this.sync();
      for (const type of ['resize', 'orientationchange']) this.listen(win, type, sync);
      this.listen(screen?.orientation, 'change', sync);
      this.listen(doc, 'fullscreenchange', sync);
      this.bindButton();
    }
    this.sync();
  }

  listen(target, type, handler) {
    if (!target?.addEventListener) return;
    target.addEventListener(type, handler);
    this.listeners.push([target, type, handler]);
  }

  bindButton() {
    const button = this.button, pressed = new Set();
    let fallback = null;
    // A second thumb may not emit click while the old game contact remains
    // down after rotation. Require a fresh down/up inside this same button.
    this.listen(button, 'pointerdown', event => {
      if (event.pointerType === 'touch' && !event.isPrimary && !button.disabled && !this.gate?.hidden) pressed.add(event.pointerId);
    });
    this.listen(button, 'pointerup', event => {
      if (!pressed.delete(event.pointerId) || event.pointerType !== 'touch' || event.isPrimary) return;
      const box = button.getBoundingClientRect();
      if (this.gate?.hidden || button.disabled || !box.width || !box.height || event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) return;
      if (event.cancelable) event.preventDefault();
      fallback = { id: event.pointerId, time: performance.now() };
      void this.requestPreferred();
    });
    for (const type of ['pointercancel', 'lostpointercapture']) this.listen(button, type, event => pressed.delete(event.pointerId));
    for (const type of ['blur', 'resize', 'orientationchange']) this.listen(this.win, type, () => pressed.clear());
    this.listen(this.doc, 'visibilitychange', () => { if (this.doc.hidden) pressed.clear(); });
    this.listen(button, 'click', event => {
      const age = fallback ? performance.now() - fallback.time : Infinity;
      if (event.detail !== 0 && age < 600 && (event.pointerId === fallback?.id || (event.pointerId === undefined && age < 50))) {
        fallback = null; return;
      }
      fallback = null;
      void this.requestPreferred();
    });
  }

  portrait() { return this.enabled && this.win.innerHeight >= this.win.innerWidth; }
  get blocked() { return this.portrait(); }

  sync() {
    const blocked = this.blocked;
    if (this.disposed) return !blocked;
    if (this.gate) {
      if (this.gate.hidden !== !blocked) this.gate.hidden = !blocked;
      if (this.gate.classList.contains('hidden') !== !blocked) this.gate.classList.toggle('hidden', !blocked);
    }
    if (this.syncing) return !blocked;
    const entered = blocked && !this.wasBlocked;
    // Set both guards before Game.pause/clearInput can call back into sync.
    this.wasBlocked = blocked; this.syncing = true;
    try {
      const shouldPause = blocked && this.g.playing && !this.g.ended && !this.g.paused && !this.g.inLoadout;
      if (entered || shouldPause) this.g.clearInput?.();
      if (shouldPause) this.g.pause();
    } finally { this.syncing = false; }
    return !blocked;
  }

  ensureLandscape() { return this.sync(); }

  setHint(text) { if (this.hint && this.hint.textContent !== text) this.hint.textContent = text; }

  requestPreferred() {
    if (!this.enabled || this.disposed) return Promise.resolve(false);
    if (this.pending) return this.pending;
    let resolve;
    const request = new Promise(done => { resolve = done; });
    // Reserve the request before calling browser APIs, including synchronous
    // fullscreen/resize events. Do not defer fullscreen past the user gesture.
    this.pending = request;
    this.setHint('正在尝试进入横屏；若未自动旋转，请手动横放手机。');
    if (this.button) this.button.disabled = true;
    const run = async () => {
      const root = this.doc?.documentElement;
      if (!this.doc?.fullscreenElement && typeof root?.requestFullscreen === 'function') {
        try { await root.requestFullscreen(); } catch { /* Manual rotation remains available. */ }
      }
      // Some installed browsers can lock without fullscreen, so still try
      // when fullscreen is unsupported or refused. Never leave user fullscreen.
      const orientation = this.screen?.orientation;
      if (!this.disposed && typeof orientation?.lock === 'function') {
        try { await orientation.lock('landscape'); } catch { /* Safari/permissions may disallow locking. */ }
      }
      this.pending = null;
      if (!this.disposed) {
        if (this.button) this.button.disabled = false;
        this.setHint(MANUAL_HINT);
        resolve(this.sync());
      } else resolve(!this.blocked);
    };
    void run();
    return request;
  }

  dispose() {
    this.disposed = true;
    for (const [target, type, handler] of this.listeners) target.removeEventListener(type, handler);
    this.listeners = [];
    // We did not acquire ownership of the browser's fullscreen/orientation.
  }
}
