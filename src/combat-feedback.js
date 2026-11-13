// Directional, damped camera impulses. Fixed substeps keep automatic fire from
// producing frame-rate-dependent jumps; the player's mouse angles stay intact.
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export function lowHealthAmount(hp, alive = true) {
  if (!alive) return 0;
  const t = clamp((45 - hp) / 35, 0, 1);
  return t * t * (3 - 2 * t);
}

export class DamageResponse {
  constructor() { this.reset(); }
  reset() {
    this.pitch = this.yaw = this.roll = 0;
    this.vp = this.vy = this.vr = 0;
    this.trauma = this.time = 0;
    this.offset = { pitch: 0, yaw: 0, roll: 0, x: 0, y: 0 };
    this.side = 0; this.front = 1;
  }
  hit(amount, direction, yaw, head = false) {
    if (!(amount > 0)) return;
    const strength = clamp(amount / 45, .16, 1.3) * (head ? 1.16 : 1);
    const dx = direction?.x || 0, dz = direction?.z || 0, length = Math.hypot(dx, dz) || 1;
    this.side = clamp((dx * Math.cos(yaw) - dz * Math.sin(yaw)) / length, -1, 1);
    this.front = clamp((dx * Math.sin(yaw) + dz * Math.cos(yaw)) / length, -1, 1);
    this.vp = clamp(this.vp + (.42 + .1 * this.front) * strength, -.85, .85);
    this.vy = clamp(this.vy + this.side * .42 * strength, -.7, .7);
    this.vr = clamp(this.vr - this.side * .65 * strength, -1.1, 1.1);
    this.trauma = Math.min(1, this.trauma + .28 + strength * .4);
  }
  update(dt) {
    if (!(dt > 0)) return this.offset;
    let remaining = Math.min(dt, .25);
    while (remaining > 1e-7) {
      const h = Math.min(remaining, 1 / 120); remaining -= h; this.time += h;
      for (const [x, v] of [['pitch', 'vp'], ['yaw', 'vy'], ['roll', 'vr']]) {
        this[v] += (-180 * this[x] - 18 * this[v]) * h;
        this[x] = clamp(this[x] + this[v] * h, -.065, .065);
      }
      this.trauma *= Math.exp(-h * 8.5);
    }
    const t = this.time, n = this.trauma * this.trauma;
    Object.assign(this.offset, {
      pitch: this.pitch + n * .007 * (Math.sin(t * 43.1) + .5 * Math.sin(t * 71.7)),
      yaw: this.yaw + n * .005 * Math.sin(t * 37.3 + 2.1),
      roll: this.roll + n * .01 * Math.sin(t * 29.7 + .7),
      x: n * .013 * Math.sin(t * 61.3), y: -n * .018,
    });
    return this.offset;
  }
}
