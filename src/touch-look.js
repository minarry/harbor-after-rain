// Convert a gesture to the same angular input on different logical viewports.
// Only gain responds to speed: no delayed angle or inertia survives a sample.
export const TOUCH_LOOK_REFERENCE_HEIGHT = 390;
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

export function shapeTouchLook(dx, dy, elapsedMs, height = TOUCH_LOOK_REFERENCE_HEIGHT) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return { x: 0, y: 0 };
  const h = Number.isFinite(height) && height > 0 ? height : TOUCH_LOOK_REFERENCE_HEIGHT;
  const elapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? Math.max(1, elapsedMs) : 1000 / 60;
  const speed = Math.hypot(dx, dy) * 1000 / (h * elapsed);
  const t = clamp((speed - .45) / (2.2 - .45), 0, 1);
  const gain = .72 + (1.30 - .72) * t * t * (3 - 2 * t);
  const scale = 1.6 * TOUCH_LOOK_REFERENCE_HEIGHT / h * gain;
  return { x: dx * scale, y: dy * scale };
}

export function touchAimScale(currentFov, baseFov, progress, sensitivity = .75) {
  const aim = Number.isFinite(progress) ? clamp(progress, 0, 1) : 0;
  if (aim <= .01) return 1;
  const base = Number.isFinite(baseFov) ? clamp(baseFov, 1, 179) : 78;
  const fov = Number.isFinite(currentFov) ? clamp(currentFov, 1, 179) : base;
  const sens = Number.isFinite(sensitivity) ? clamp(sensitivity, .2, 2) : .75;
  const zoom = clamp(Math.tan(fov * Math.PI / 360) / Math.tan(base * Math.PI / 360), .01, 1);
  return zoom * (1 + (sens - 1) * aim);
}
