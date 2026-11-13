// Serializable render controls; toggles never create or replace GPU resources.
export class RenderFeatures {
  constructor(quality = 'high') {
    this.state = { post: true, bloom: quality !== 'low', haze: quality !== 'low', ao: quality !== 'low', grade: true, lens: quality !== 'low', grain: true, vignette: true, feedback: true, autoExposure: true, exposure: null, toneMapping: 'hybrid', aoStrength: .55, bloomStrength: .2,
      aa: true, sharpen: true, sharpness: quality === 'high' ? .12 : quality === 'medium' ? .10 : .08, bloomStable: true, softShadows: true, shadowSoftness: 1, hazeDistribution: 'near' };
  }
  set(patch = {}) {
    if (!patch || typeof patch !== 'object') return this.get();
    for (const key of ['post','bloom','haze','ao','grade','lens','grain','vignette','feedback','autoExposure','aa','sharpen','bloomStable','softShadows'])
      if (typeof patch[key] === 'boolean') this.state[key] = patch[key];
    for (const [key, lo, hi] of [['exposure', .25, 2.5], ['aoStrength', 0, 1.5], ['bloomStrength', 0, 1], ['sharpness',0,.35], ['shadowSoftness',0,2]])
      if (Number.isFinite(patch[key])) this.state[key] = Math.max(lo, Math.min(hi, patch[key]));
    if (patch.exposure === null) this.state.exposure = null;
    if (['hybrid','agx','aces'].includes(patch.toneMapping)) this.state.toneMapping = patch.toneMapping;
    if (['uniform','near'].includes(patch.hazeDistribution)) this.state.hazeDistribution = patch.hazeDistribution;
    return this.get();
  }
  get() { return { ...this.state }; }
}
