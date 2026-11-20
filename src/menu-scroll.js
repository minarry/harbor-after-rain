// Safari can fail to pan an overflow container inside a 90-degree transform.
// Handle that one presentation in logical coordinates; native landscape keeps
// ordinary browser scrolling. This does not own any gameplay input.
export function bindLandscapeMenuScroll(element, viewport, host = window) {
  let gesture = null, frame = 0, suppressed = null;
  const interactive = target => target?.closest?.('input,select,textarea,[contenteditable="true"]');
  const enabled = () => viewport.enabled && viewport.rotated && !element.classList.contains('hidden') && !element.closest?.('.hidden');
  const stop = () => { if (frame) host.cancelAnimationFrame(frame); frame = 0; };
  const release = (id, target = element) => { try { if (target.hasPointerCapture?.(id)) target.releasePointerCapture(id); } catch {} };
  const cancel = () => { stop(); const old = gesture; gesture = null; if (old) release(old.id, old.range || element); };
  const sync = () => { cancel(); element.classList.toggle('landscape-scroll', !!(viewport.enabled && viewport.rotated)); };
  const momentum = velocity => {
    let previous = host.performance.now();
    const tick = now => {
      frame = 0;
      if (!enabled() || Math.abs(velocity) < .025) return;
      const dt = Math.min(32, Math.max(0, now - previous)); previous = now;
      const before = element.scrollTop; element.scrollTop += velocity * dt;
      if (Math.abs(element.scrollTop - before) < .1) return;
      velocity *= Math.exp(-dt / 150); frame = host.requestAnimationFrame(tick);
    };
    frame = host.requestAnimationFrame(tick);
  };
  const setRange = (input, point) => {
    const rect = viewport.rectToLocal(input.getBoundingClientRect());
    if (!(rect.width > 0)) return;
    const min = input.min === '' ? 0 : Number(input.min), max = input.max === '' ? 100 : Number(input.max);
    const step = input.step === 'any' ? 0 : Number(input.step || 1);
    const fraction = Math.max(0, Math.min(1, (point.x - rect.left) / rect.width));
    const raw = min + fraction * (max - min);
    const value = Math.max(min, Math.min(max, step > 0 ? min + Math.round((raw - min) / step) * step : raw));
    const next = String(Number(value.toFixed(8)));
    if (input.value !== next) { input.value = next; input.dispatchEvent(new host.Event('input', { bubbles: true })); }
  };
  const down = event => {
    if (!enabled() || gesture || event.pointerType !== 'touch' || event.isPrimary === false) return;
    stop(); suppressed = null;
    const range = event.target?.closest?.('input[type="range"]');
    if (range && !range.disabled) {
      // Native range dragging also loses its axis in some transformed pages.
      // Own only touch here; keyboard and unrotated controls remain native.
      gesture = { id: event.pointerId, range, initial: range.value };
      if (event.cancelable) event.preventDefault();
      try { range.setPointerCapture?.(event.pointerId); } catch {}
      setRange(range, viewport.clientToLocal(event.clientX, event.clientY));
      return;
    }
    if (interactive(event.target)) return;
    const point = viewport.clientToLocal(event.clientX, event.clientY);
    gesture = { id: event.pointerId, startX: point.x, startY: point.y, lastY: point.y, time: event.timeStamp, velocity: 0, dragging: false };
  };
  const move = event => {
    const g = gesture; if (!g || event.pointerId !== g.id) return;
    if (!enabled()) { cancel(); return; }
    const point = viewport.clientToLocal(event.clientX, event.clientY);
    if (g.range) {
      if (event.cancelable) event.preventDefault();
      setRange(g.range, point); return;
    }
    if (!g.dragging) {
      if (Math.hypot(point.x - g.startX, point.y - g.startY) < 8) return;
      g.dragging = true;
      // Capture only after distinguishing a drag from a tap. A normal tap must
      // still click its original button and retain browser user activation.
      try { element.setPointerCapture?.(g.id); } catch {}
    }
    if (event.cancelable) event.preventDefault();
    const delta = g.lastY - point.y, dt = Math.max(8, event.timeStamp - g.time);
    const before = element.scrollTop; element.scrollTop += delta;
    g.velocity = Math.max(-2, Math.min(2, (element.scrollTop - before) / dt));
    g.lastY = point.y; g.time = event.timeStamp;
  };
  const up = event => {
    const g = gesture; if (!g || event.pointerId !== g.id) return;
    gesture = null;
    if (g.range) {
      if (event.cancelable) event.preventDefault();
      if (event.type === 'pointerup') setRange(g.range, viewport.clientToLocal(event.clientX, event.clientY));
      if (g.range.value !== g.initial) g.range.dispatchEvent(new host.Event('change', { bubbles: true }));
      suppressed = { id: g.id, until: host.performance.now() + 700 };
      release(g.id, g.range); return;
    }
    if (g.dragging) {
      if (event.cancelable) event.preventDefault();
      suppressed = { id: g.id, until: host.performance.now() + 700 };
      if (event.type === 'pointerup' && event.timeStamp - g.time < 100) momentum(g.velocity);
    }
    release(g.id);
  };
  const click = event => {
    if (!suppressed || host.performance.now() > suppressed.until || event.detail === 0) return;
    if (event.pointerId !== undefined && event.pointerId !== suppressed.id) return;
    event.preventDefault(); event.stopImmediatePropagation(); suppressed = null;
  };
  // Taking capture from a child emits a bubbling loss from that child first.
  // Only loss by this scroller ends its gesture.
  const lost = event => { if (event.target === (gesture?.range || element) && gesture?.id === event.pointerId) cancel(); };
  element.addEventListener('pointerdown', down);
  host.addEventListener('pointermove', move, { passive: false });
  host.addEventListener('pointerup', up, { passive: false });
  host.addEventListener('pointercancel', up, { passive: false });
  element.addEventListener('lostpointercapture', lost);
  element.addEventListener('click', click, true);
  host.addEventListener('gameviewportresize', sync);
  host.addEventListener('blur', cancel);
  sync();
  return { cancel, dispose() { cancel(); element.classList.remove('landscape-scroll');
    element.removeEventListener('pointerdown', down); host.removeEventListener('pointermove', move);
    host.removeEventListener('pointerup', up); host.removeEventListener('pointercancel', up);
    element.removeEventListener('lostpointercapture', lost); element.removeEventListener('click', click, true);
    host.removeEventListener('gameviewportresize', sync); host.removeEventListener('blur', cancel);
  } };
}
