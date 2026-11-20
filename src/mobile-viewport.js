// One landscape coordinate system for rendering, responsive UI and touch input.
// A rotated page is also the fallback when the browser cannot lock its screen.
export function swapMediaQuery(query) {
  return String(query)
    .replace(/\b((?:min-|max-)?(?:device-)?)(width|height)(\s*:)/gi, (_, prefix, axis, colon) => `${prefix}${axis.toLowerCase() === 'width' ? 'height' : 'width'}${colon}`)
    .replace(/(\borientation\s*:\s*)(portrait|landscape)\b/gi, (_, prefix, value) => prefix + (value.toLowerCase() === 'portrait' ? 'landscape' : 'portrait'));
}

const bodyProperties = ['position', 'left', 'top', 'width', 'height', 'transform', 'transform-origin'];
const physicalSize = (value) => Math.max(1, Number(value) || 1);

export class MobileViewport {
  constructor({ window: hostWindow, document: hostDocument } = {}) {
    this.window = hostWindow;
    this.document = hostDocument;
    this.enabled = false;
    this.rotated = false;
    this.width = this.height = this.physicalWidth = this.physicalHeight = 1;
    this.initialized = false;
    this.originalMedia = new WeakMap();
    this.mediaQueries = new Set();
    this.bodyStyles = new Map();
    this.lockPending = null;
    this.onResize = () => this.update();
  }

  init() {
    if (this.initialized) return this;
    this.window ||= globalThis.window;
    this.document ||= globalThis.document;
    if (!this.window || !this.document?.body) return this;
    this.initialized = true;
    const w = this.window;
    this.enabled = !!w.matchMedia?.('(pointer:coarse)').matches || new URLSearchParams(w.location?.search || '').has('touch');
    for (const name of bodyProperties) this.bodyStyles.set(name, {
      value: this.document.body.style.getPropertyValue(name),
      priority: this.document.body.style.getPropertyPriority(name),
    });
    w.addEventListener('resize', this.onResize);
    w.visualViewport?.addEventListener('resize', this.onResize);
    this.update(true);
    return this;
  }

  update(force = false) {
    if (!this.initialized) return;
    const w = physicalSize(this.window.innerWidth), h = physicalSize(this.window.innerHeight);
    const rotated = this.enabled && h > w;
    const changed = force || w !== this.physicalWidth || h !== this.physicalHeight || rotated !== this.rotated;
    if (!changed) return;
    this.physicalWidth = w; this.physicalHeight = h; this.rotated = rotated;
    this.width = this.enabled ? Math.max(w, h) : w;
    this.height = this.enabled ? Math.min(w, h) : h;
    const root = this.document.documentElement.style, body = this.document.body.style;
    root.setProperty('--game-vw', `${this.width / 100}px`);
    root.setProperty('--game-vh', `${this.height / 100}px`);
    root.setProperty('--game-vmin', `${Math.min(this.width, this.height) / 100}px`);
    root.setProperty('--game-vmax', `${Math.max(this.width, this.height) / 100}px`);
    const sides = ['top', 'right', 'bottom', 'left'];
    for (let i = 0; i < sides.length; i++) {
      const physicalSide = sides[(i + (rotated ? 1 : 0)) % sides.length];
      root.setProperty(`--game-safe-${sides[i]}`, `env(safe-area-inset-${physicalSide}, 0px)`);
    }
    if (rotated) {
      body.setProperty('position', 'fixed');
      body.setProperty('left', '0'); body.setProperty('top', '0');
      body.setProperty('width', `${this.width}px`); body.setProperty('height', `${this.height}px`);
      body.setProperty('transform-origin', '0 0');
      body.setProperty('transform', `translateX(${w}px) rotate(90deg)`);
    } else {
      for (const [name, original] of this.bodyStyles) {
        if (original.value) body.setProperty(name, original.value, original.priority);
        else body.removeProperty(name);
      }
    }
    this.updateMediaRules();
    for (const media of this.mediaQueries) media.refresh();
    const detail = { width: this.width, height: this.height, rotated: this.rotated };
    this.window.dispatchEvent(new this.window.CustomEvent('gameviewportresize', { detail }));
  }

  updateMediaRules() {
    const visit = rules => {
      for (const rule of rules) {
        if (rule.media && typeof rule.media.mediaText === 'string') {
          if (!this.originalMedia.has(rule)) this.originalMedia.set(rule, rule.media.mediaText);
          const original = this.originalMedia.get(rule);
          rule.media.mediaText = this.rotated ? swapMediaQuery(original) : original;
        }
        if (rule.cssRules) visit(rule.cssRules);
      }
    };
    for (const sheet of this.document.styleSheets) {
      // Cross-origin styles are not used by the game; inaccessible additions
      // must not prevent the inline stylesheet and the controls from working.
      try { visit(sheet.cssRules); } catch { /* Leave inaccessible sheets alone. */ }
    }
  }

  clientToLocal(x, y) {
    return this.rotated ? { x: y, y: this.physicalWidth - x } : { x, y };
  }

  toClient(x, y) {
    return this.rotated ? { x: this.physicalWidth - y, y: x } : { x, y };
  }

  rectToLocal(rect) {
    const right = rect.right ?? rect.left + rect.width, bottom = rect.bottom ?? rect.top + rect.height;
    const corners = [[rect.left, rect.top], [right, rect.top], [right, bottom], [rect.left, bottom]].map(([x, y]) => this.clientToLocal(x, y));
    const left = Math.min(...corners.map(p => p.x)), top = Math.min(...corners.map(p => p.y));
    const localRight = Math.max(...corners.map(p => p.x)), localBottom = Math.max(...corners.map(p => p.y));
    return { x: left, y: top, left, top, right: localRight, bottom: localBottom, width: localRight - left, height: localBottom - top };
  }

  matchMedia(query) {
    const viewport = this, listeners = new Set();
    let native = null, nativeQuery = '', current = false, listening = false, onchange = null;
    const detach = () => {
      if (!native || !listening) return;
      if (native.removeEventListener) native.removeEventListener('change', onNative);
      else native.removeListener?.(onNative);
      listening = false;
    };
    const bind = () => {
      const nextQuery = viewport.rotated ? swapMediaQuery(query) : String(query);
      if (!native || nativeQuery !== nextQuery) {
        detach(); nativeQuery = nextQuery; native = viewport.window.matchMedia(nextQuery);
      }
      if (!listening && (listeners.size || onchange)) {
        if (native.addEventListener) native.addEventListener('change', onNative);
        else native.addListener?.(onNative);
        listening = true;
      }
    };
    const refresh = () => {
      bind();
      const next = !!native.matches;
      if (next === current) return;
      current = next;
      const event = { type: 'change', matches: current, media: String(query), target: result, currentTarget: result };
      if (typeof onchange === 'function') onchange.call(result, event);
      for (const listener of [...listeners]) {
        if (typeof listener === 'function') listener.call(result, event);
        else listener?.handleEvent?.(event);
      }
    };
    const onNative = () => refresh();
    const subscription = { refresh };
    const subscribe = () => {
      if (listeners.size || onchange) {
        const wasSubscribed = viewport.mediaQueries.has(subscription);
        viewport.mediaQueries.add(subscription); bind();
        if (!wasSubscribed) current = !!native.matches;
      }
      else { viewport.mediaQueries.delete(subscription); detach(); }
    };
    const result = {
      media: String(query),
      get matches() { bind(); return !!native.matches; },
      get onchange() { return onchange; },
      set onchange(listener) { onchange = typeof listener === 'function' ? listener : null; subscribe(); },
      addEventListener(type, listener) { if (type === 'change' && listener) { listeners.add(listener); subscribe(); } },
      removeEventListener(type, listener) { if (type === 'change') { listeners.delete(listener); subscribe(); } },
      addListener(listener) { this.addEventListener('change', listener); },
      removeListener(listener) { this.removeEventListener('change', listener); },
    };
    bind(); current = !!native.matches;
    return result;
  }

  requestLock() {
    if (!this.enabled || !this.initialized) return Promise.resolve(false);
    if (this.lockPending) return this.lockPending;
    const w = this.window, d = this.document, orientation = w.screen?.orientation;
    const element = d.documentElement;
    if (typeof orientation?.lock !== 'function' || typeof element.requestFullscreen !== 'function') return Promise.resolve(false);
    if (w.navigator?.userActivation && !w.navigator.userActivation.isActive) return Promise.resolve(false);
    this.lockPending = (async () => {
      try {
        if (!d.fullscreenElement) await element.requestFullscreen();
        await orientation.lock('landscape');
        return true;
      } catch { return false; }
    })().finally(() => { this.lockPending = null; });
    return this.lockPending;
  }
}

export const mobileViewport = new MobileViewport();
