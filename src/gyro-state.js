const RAD = Math.PI / 180;
const multiply = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const relative = (a, b) => multiply([-a[0], -a[1], -a[2], a[3]], b);
const angle = q => 2 * Math.atan2(Math.hypot(q[0], q[1], q[2]), Math.abs(q[3]));
const normalizeAngle = angle => ((angle % 360) + 360) % 360;

// Device Orientation uses intrinsic Z-X'-Y'' rotations in the device's
// natural screen axes. Screen angle is counter-clockwise from that screen.
// https://www.w3.org/TR/orientation-event/#model
export function orientationQuaternion({ alpha, beta, gamma }, screenAngle = 0) {
  if (![alpha, beta, gamma, screenAngle].every(Number.isFinite)) return null;
  const z = alpha * RAD / 2, x = beta * RAD / 2, y = gamma * RAD / 2;
  const cz = Math.cos(z), sz = Math.sin(z), cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y);
  const device = [cz * sx * cy - sz * cx * sy, cz * cx * sy + sz * sx * cy, sz * cx * cy + cz * sx * sy, cz * cx * cy - sz * sx * sy];
  const screen = -screenAngle * RAD / 2;
  return multiply(device, [0, 0, Math.sin(screen), Math.cos(screen)]);
}

function slerp(a, b, t) {
  let dot = a.reduce((sum, value, i) => sum + value * b[i], 0);
  if (dot < 0) { b = b.map(value => -value); dot = -dot; }
  if (dot > .9995) {
    const q = a.map((value, i) => value + (b[i] - value) * t), length = Math.hypot(...q);
    return q.map(value => value / length);
  }
  const theta = Math.acos(Math.min(1, dot)), divisor = Math.sin(theta);
  const from = Math.sin((1 - t) * theta) / divisor, to = Math.sin(t * theta) / divisor;
  return a.map((value, i) => value * from + b[i] * to);
}

export class GyroState {
  constructor({ smoothing = .025, deadZone = .0007, maxGap = .25, maxStep = .65, maxRate = 12 } = {}) {
    this.smoothing = smoothing; this.deadZone = deadZone; this.maxGap = maxGap; this.maxStep = maxStep; this.maxRate = maxRate;
    this.samples = 0; this.rejected = 0; this.reset();
  }
  reset() {
    this.raw = null; this.filtered = null; this.time = null; this.screenAngle = null;
    this.yaw = 0; this.pitch = 0; this.residualYaw = 0; this.residualPitch = 0;
  }
  seed(q, screenAngle, time) {
    this.reset(); this.raw = q; this.filtered = q.slice(); this.screenAngle = screenAngle; this.time = time;
  }
  sample(event, screenAngle, time) {
    const q = orientationQuaternion(event, screenAngle);
    if (!q || !Number.isFinite(time)) return 'invalid';
    this.samples++;
    screenAngle = normalizeAngle(screenAngle);
    const dt = this.time === null ? 0 : (time - this.time) / 1000;
    if (!this.raw || this.screenAngle !== screenAngle || dt > this.maxGap) {
      this.seed(q, screenAngle, time); return 'baseline';
    }
    if (dt <= 0) return 'ignored';
    if (angle(relative(this.raw, q)) > Math.min(this.maxStep, Math.max(.06, this.maxRate * dt))) {
      this.rejected++; this.seed(q, screenAngle, time); return 'rejected';
    }
    this.raw = q; this.time = time;
    const smooth = this.smoothing > 0 ? 1 - Math.exp(-dt / this.smoothing) : 1;
    const filtered = slerp(this.filtered, q, smooth), delta = relative(this.filtered, filtered);
    this.filtered = filtered;
    // Quaternion logarithm gives the small rotation in screen-local axes:
    // +X raises aim, +Y turns left; rolling the screen (+Z) does not aim.
    if (delta[3] < 0) for (let i = 0; i < 4; i++) delta[i] = -delta[i];
    const size = Math.hypot(delta[0], delta[1], delta[2]);
    const scale = size > 1e-10 ? 2 * Math.atan2(size, delta[3]) / size : 2;
    this.residualPitch += delta[0] * scale; this.residualYaw += delta[1] * scale;
    // A residual dead band suppresses tiny back-and-forth sensor jitter while
    // preserving a deliberately slow turn across multiple sensor samples.
    const length = Math.hypot(this.residualYaw, this.residualPitch);
    if (length > this.deadZone) {
      const retain = this.deadZone / length;
      this.yaw += this.residualYaw * (1 - retain); this.pitch += this.residualPitch * (1 - retain);
      this.residualYaw *= retain; this.residualPitch *= retain;
    }
    return 'sample';
  }
  takeLook() { const result = { yaw: this.yaw, pitch: this.pitch }; this.yaw = this.pitch = 0; return result; }
}
