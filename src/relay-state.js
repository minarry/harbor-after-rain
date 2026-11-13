// Deterministic objective rules, independent of rendering and browser APIs.
export class RelayState {
  constructor({ captureSeconds = 7, rotationSeconds = 75 } = {}) {
    this.captureSeconds = captureSeconds;
    this.rotationSeconds = rotationSeconds;
    this.reset();
  }
  reset() {
    this.index = 0; this.elapsed = 0; this.progress = 0;
    this.owner = null; this.contested = false; this.tick = 0;
    this.score = { BL: 0, GR: 0 };
  }
  update(dt, counts) {
    if (!Number.isFinite(dt) || dt <= 0) return { rotated: false, captured: null };
    const oldOwner = this.owner;
    this.elapsed += dt;
    let rotated = false;
    if (this.elapsed >= this.rotationSeconds) {
      this.index += Math.floor(this.elapsed / this.rotationSeconds);
      this.elapsed %= this.rotationSeconds;
      this.progress = 0; this.owner = null; this.tick = 0;
      this.contested = false;
      // The caller sampled the previous point. Never capture a new point using old occupants.
      return { rotated: true, captured: null };
    }
    const bl = Math.max(0, counts.BL || 0), gr = Math.max(0, counts.GR || 0);
    this.contested = bl > 0 && gr > 0;
    if (!this.contested && (bl || gr)) {
      const sign = bl ? -1 : 1;
      const speed = Math.min(1.6, 1 + (Math.max(bl, gr) - 1) * 0.2);
      this.progress = Math.max(-1, Math.min(1, this.progress + sign * dt * speed / this.captureSeconds));
      if (this.owner === 'BL' && this.progress >= 0) this.owner = null;
      if (this.owner === 'GR' && this.progress <= 0) this.owner = null;
      if (this.progress <= -1 + 1e-9) { this.progress = -1; this.owner = 'BL'; }
      if (this.progress >= 1 - 1e-9) { this.progress = 1; this.owner = 'GR'; }
    } else if (!bl && !gr && !this.owner) {
      this.progress = Math.sign(this.progress) * Math.max(0, Math.abs(this.progress) - dt * 0.07);
    }
    const enemyPresent = this.owner === 'BL' ? gr > 0 : bl > 0;
    if (this.owner && !this.contested && !enemyPresent) {
      // Count only intervals that started with this owner, so the capture frame is not scored twice.
      if (oldOwner === this.owner) this.tick += dt;
      while (this.tick >= 1 - 1e-9) { this.score[this.owner]++; this.tick = Math.max(0, this.tick - 1); }
    } else this.tick = 0;
    return { rotated, captured: this.owner && this.owner !== oldOwner ? this.owner : null };
  }
  get remaining() { return Math.max(0, this.rotationSeconds - this.elapsed); }
}
