// Surface state is authored before shading: color never determines metal/rust.
// The same chip, oxide, runoff and contact masks drive albedo, relief and ORM.
const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
function rng(seed) { let n = seed >>> 0; return () => { n = Math.imul(n, 1664525) + 1013904223 >>> 0; return n / 4294967296; }; }
function grain(x, y, seed) { let n = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ seed; n = Math.imul(n ^ n >>> 13, 1274126177); return (n ^ n >>> 16) >>> 0; }
function fieldNoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return mix(mix(grain(ix, iy, seed), grain(ix + 1, iy, seed), u), mix(grain(ix, iy + 1, seed), grain(ix + 1, iy + 1, seed), u), v) / 4294967296;
}

export function createWearMasks(width, height, seed, { kind = 'paint', vertical = true, ribs = 0, amount = 1 } = {}) {
  const length = width * height, random = rng(seed), masks = {};
  for (const key of ['chip', 'oxide', 'runoff', 'grime', 'oil']) masks[key] = new Float32Array(length);
  const stamp = (field, cx, cy, rx, ry, gain, shape = null) => {
    const cs = shape ? Math.cos(shape.angle) : 1, sn = shape ? Math.sin(shape.angle) : 0;
    const bx = (Math.abs(cs) * rx + Math.abs(sn) * ry) * 1.3, by = (Math.abs(sn) * rx + Math.abs(cs) * ry) * 1.3;
    const x0 = Math.max(0, Math.floor(cx - bx)), x1 = Math.min(width - 1, Math.ceil(cx + bx));
    const y0 = Math.max(0, Math.floor(cy - by)), y1 = Math.min(height - 1, Math.ceil(cy + by));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dx = x - cx, dy = y - cy, nx = (dx * cs + dy * sn) / Math.max(.7, rx), ny = (dy * cs - dx * sn) / Math.max(.7, ry);
      let radius = Math.hypot(nx, ny), breakup = 1;
      if (shape) {
        // Correlated lobes and missing fragments change the silhouette, rather
        // than merely adding pixel noise to an otherwise intact oval.
        const edge = fieldNoise(nx * 2.3 + 8, ny * 2.3 + 5, shape.seed);
        const fracture = fieldNoise(nx * 5.7 + 13, ny * 5.7 + 9, shape.seed + 91);
        radius += (edge - .5) * .75;
        breakup = smooth(.24, .49, fracture);
      }
      const value = (1 - smooth(shape ? .56 : .48, shape ? .9 : 1, radius)) * gain * breakup, i = y * width + x;
      if (value > field[i]) field[i] = value;
    }
  };
  const aspect = width / height, count = Math.round((kind === 'deck' ? 54 : 80) * amount * Math.sqrt(aspect));
  for (let n = 0; n < count; n++) {
    let x = random() * width, y = random() * height;
    // Handling edges and raised corrugation receive the majority of abrasion.
    if (n % 3 !== 0) {
      if (ribs && n % 2) x = width * (.03 + ((Math.floor(random() * ribs) + .18) / ribs) * .94);
      else if (n % 2) x = (random() < .5 ? .025 : .975) * width + (random() - .5) * width * .02;
      else y = (random() < .5 ? .065 : .935) * height + (random() - .5) * height * .025;
    }
    const size = .002 + random() ** 2 * .011, rx = width * size / Math.sqrt(aspect), ry = height * size * (kind === 'deck' ? .8 + random() * 1.8 : 1.5 + random() * 3);
    const shape = { angle: kind === 'deck' ? random() * Math.PI * 2 : (random() - .5) * 1.1, seed: seed + n * 137 };
    stamp(masks.chip, x, y, rx, ry, .75 + random() * .25, shape);
    if (random() < .58) {
      stamp(masks.oxide, x + rx * .15, y + ry * .2, rx * .87, ry * .92, .75 + random() * .25, shape);
      if (vertical) {
        const run = height * (.045 + random() * .22);
        stamp(masks.runoff, x, y + run * .45, rx * 1.5, run * .6, .16 + random() * .35);
      }
    }
  }
  // Long rubs are different from flakes; deck traffic runs along the plate.
  for (let n = 0; n < (kind === 'deck' ? 48 : 18); n++) {
    const x = random() * width, y = random() * height;
    stamp(masks.chip, x, y, width * (.008 + random() * .045), Math.max(.65, height * .0012), .35 + random() * .5);
  }
  for (let n = 0; n < 10; n++) stamp(masks.grime, random() * width, vertical ? height * (.77 + random() * .23) : random() * height, width * (.025 + random() * .09), height * (.04 + random() * .12), .12 + random() * .2);
  if (kind === 'deck') for (let n = 0; n < 9; n++) stamp(masks.oil, random() * width, random() * height, width * (.012 + random() * .032), height * (.01 + random() * .04), .2 + random() * .42);
  return masks;
}

export function composePaintSurface({ width, height, seed, pixels, heightField, masks, kind = 'paint', baseRoughness, bare = false }) {
  masks ||= createWearMasks(width, height, seed, { kind, vertical: kind !== 'deck' });
  const color = new Uint8ClampedArray(pixels), orm = new Uint8ClampedArray(width * height * 4);
  const relief = new Float32Array(heightField), detail = new Float32Array(width * height);
  const sums = { paint: 0, exposedMetal: 0, oxide: 0, runoff: 0, grime: 0, oil: 0 };
  for (let i = 0; i < width * height; i++) {
    const x = i % width, y = Math.floor(i / width), micro = grain(x, y, seed + 73) / 4294967296;
    // Intact paint retains the same micro roughness without evaluating layers.
    if (!bare && masks.chip[i] === 0 && masks.oxide[i] === 0 && masks.runoff[i] === 0 && masks.grime[i] === 0 && masks.oil[i] === 0) {
      const p = i * 4, rough = (baseRoughness ?? (kind === 'deck' ? .8 : .55)) + (micro - .5) * .045;
      orm[p] = 255; orm[p + 1] = Math.round(clamp(rough, .22, .97) * 255); orm[p + 2] = 5;
      relief[i] += 0; // Match the full path's signed-zero float result as well.
      sums.paint += 1;
      continue;
    }
    const chip = clamp(masks.chip[i]), oxide = clamp(masks.oxide[i]), runoff = clamp(masks.runoff[i]);
    const grime = clamp(masks.grime[i]), oil = clamp(masks.oil[i]), exposed = Math.max(bare ? 1 : 0, chip) * (1 - oxide);
    const primer = smooth(.08, .42, chip) * (1 - smooth(.42, .8, chip));
    let rough = (baseRoughness ?? (kind === 'deck' ? .8 : bare ? .4 : .55)) + (micro - .5) * .045;
    rough = mix(rough, .76, primer * .5); rough = mix(rough, .31 + micro * .1, exposed);
    rough = mix(rough, .87 + micro * .08, oxide); rough = mix(rough, .77, runoff);
    rough = mix(rough, .86, grime); rough = mix(rough, .32, oil);
    let metal = mix(.018, .88, exposed); metal *= (1 - oxide * .98) * (1 - runoff * .85) * (1 - grime * .8) * (1 - oil * .95);
    const cavity = chip * (1 - chip) * .35 + oxide * .1;
    const h = -chip * .068 - primer * .012 + oxide * (.012 + micro * .027) - oil * .004;
    detail[i] = h; relief[i] += h;
    // Premultiply layer weights once, without allocating RGB arrays per pixel.
    const oilLight = 1 - oil * .3, grimeMix = grime * .65, runMix = runoff * .64;
    const belowGrime = (1 - grimeMix) * oilLight, belowRun = (1 - runMix) * belowGrime;
    const belowOxide = (1 - oxide) * belowRun, freshMix = chip * (1 - oxide), primerMix = primer * .5;
    const belowFresh = (1 - freshMix) * belowOxide;
    const baseWeight = (1 - primerMix) * belowFresh, primerWeight = primerMix * belowFresh;
    const freshWeight = freshMix * belowOxide * (.91 + micro * .12), oxideWeight = oxide * belowRun * (.84 + micro * .29);
    const runWeight = runMix * belowGrime, grimeWeight = grimeMix * oilLight, p = i * 4;
    color[p] = color[p] * baseWeight + 151 * primerWeight + 147 * freshWeight + 128 * oxideWeight + 122 * runWeight + 65 * grimeWeight;
    color[p + 1] = color[p + 1] * baseWeight + 140 * primerWeight + 152 * freshWeight + 74 * oxideWeight + 79 * runWeight + 62 * grimeWeight;
    color[p + 2] = color[p + 2] * baseWeight + 125 * primerWeight + 155 * freshWeight + 39 * oxideWeight + 46 * runWeight + 54 * grimeWeight;
    orm[i * 4] = Math.round(clamp(1 - cavity) * 255);
    orm[i * 4 + 1] = Math.round(clamp(rough, .22, .97) * 255);
    orm[i * 4 + 2] = Math.round(clamp(metal) * 255);
    orm[i * 4 + 3] = Math.round(Math.max(oxide, runoff * .7) * 255);
    sums.paint += (1 - chip) * (1 - oxide); sums.exposedMetal += exposed; sums.oxide += oxide;
    sums.runoff += runoff; sums.grime += grime; sums.oil += oil;
  }
  return { color, orm, height: relief, detail, layerStats: Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, +(v / (width * height)).toFixed(5)])) };
}

function growthProfile(random, fine = false) {
  const profile = new Float32Array(1024), scale = (profile.length - 1) / 2;
  let start = -.5;
  while (start < 1.5) {
    // Every growth interval has its own width and latewood density. There is no
    // common period that can become a stack of latitude rings on curved props.
    const span = fine ? .006 + random() * .022 : .045 + random() ** 1.5 * .17;
    const gain = .3 + random() * .7, onset = .42 + random() * .3;
    const from = Math.max(0, Math.ceil((start + .5) * scale)), to = Math.min(profile.length - 1, Math.ceil((start + span + .5) * scale));
    for (let i = from; i <= to; i++) {
      const t = ((i / scale - .5) - start) / span;
      profile[i] = smooth(onset, .88, t) * (1 - smooth(.9, 1, t)) * gain;
    }
    start += span;
  }
  return profile;
}
function sampleGrowth(profile, position) {
  const p = clamp((position + .5) * .5) * (profile.length - 1), a = Math.floor(p);
  return mix(profile[a], profile[Math.min(a + 1, profile.length - 1)], p - a);
}

export function composeWoodSurface({ width, height, seed, pixels, heightField, variant = 0, fasteners }) {
  const color = new Uint8ClampedArray(pixels), orm = new Uint8ClampedArray(width * height * 4);
  const relief = new Float32Array(heightField), detail = new Float32Array(width * height);
  const random = rng(seed), boards = Array.from({ length: 11 }, (_, index) => ({
    rings: growthProfile(random), fibers: growthProfile(random, true),
    knotX: .22 + random() * .56, knotY: .17 + random() * .66, seed: seed + index * 1877,
    cracks: Array.from({ length: 2 }, () => ({ across: .08 + random() * .84, along: random() * .75, length: .10 + random() * .27, width: .008 + random() * .006 }))
  }));
  let crackSum = 0, metalSum = 0, greySum = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, u = x / width, v = y / height, frame = .1133;
    const side = u < frame || u > 1 - frame, cap = v < frame || v > 1 - frame;
    const brace = !variant && u > frame && u < 1 - frame && v > frame && v < 1 - frame && Math.abs(u - v) < .066;
    const plankPosition = (v - frame) / (1 - 2 * frame) * 6;
    let boardIndex = Math.min(5, Math.max(0, Math.floor(plankPosition))), along = u, across = plankPosition - boardIndex;
    if (side) { boardIndex = u < frame ? 6 : 7; along = v; across = u < frame ? u / frame : (u - (1 - frame)) / frame; }
    else if (cap) { boardIndex = v < frame ? 8 : 9; across = v < frame ? v / frame : (v - (1 - frame)) / frame; }
    else if (brace) { boardIndex = 10; along = (u + v) * .5; across = (v - u + .066) / .132; }
    const board = boards[boardIndex], dx = (along - board.knotX) / .15, dy = (across - board.knotY) / .24;
    const knotWeight = Math.exp(-(dx * dx + dy * dy) * 2);
    const broad = fieldNoise(along * 2.8 + 4, across * 1.3 + 8, board.seed);
    const small = fieldNoise(along * 10.7 + 7, across * 4.3 + 6, board.seed + 311);
    const warped = across + (broad - .5) * .26 + (small - .5) * .047 + knotWeight * .17;
    const latewood = sampleGrowth(board.rings, warped), fibers = sampleGrowth(board.fibers, warped + (small - .5) * .012);
    const weather = smooth(.28, .82, broad);
    let crack = 0;
    for (const split of board.cracks) {
      const t = (along - split.along) / split.length;
      const extent = smooth(0, .16, t) * (1 - smooth(.72, 1, t));
      crack = Math.max(crack, (1 - smooth(split.width * .3, split.width, Math.abs(warped - split.across))) * extent);
    }
    const nail = fasteners ? fasteners[i] / 255 : 0, seam = heightField[i] < .22 ? .22 : 0;
    const h = (fibers - .3) * .004 + (latewood - .3) * .009 - crack * .075 + nail * .065;
    detail[i] = h; relief[i] += h;
    for (let c = 0; c < 3; c++) {
      let value = color[i * 4 + c] * (1 - latewood * .085 - knotWeight * .09 - crack * .3 + (fibers - .3) * .014);
      value = mix(value, [137, 132, 117][c] * (1 - latewood * .065), weather * .26);
      color[i * 4 + c] = mix(value, [112, 116, 113][c], nail);
    }
    const rough = mix(.77 + latewood * .04 + weather * .09 + crack * .07 - knotWeight * .06, .4, nail);
    orm[i * 4] = (1 - seam - crack * .24) * 255;
    orm[i * 4 + 1] = clamp(rough) * 255; orm[i * 4 + 2] = nail * .78 * 255; orm[i * 4 + 3] = 0;
    crackSum += crack; metalSum += nail; greySum += weather;
  }
  const n = width * height;
  return { color, orm, height: relief, detail, layerStats: { wood: +(1 - metalSum / n).toFixed(5), fasteners: +(metalSum / n).toFixed(5), cracks: +(crackSum / n).toFixed(5), weathering: +(greySum / n).toFixed(5) } };
}

export function resampleHeight(source, width, height, targetWidth, targetHeight) {
  const result = new Float32Array(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y++) for (let x = 0; x < targetWidth; x++) {
    const sx = (x + .5) * width / targetWidth - .5, sy = (y + .5) * height / targetHeight - .5;
    const x0 = Math.max(0, Math.floor(sx)), y0 = Math.max(0, Math.floor(sy));
    const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
    const a = mix(source[y0 * width + x0], source[y0 * width + x1], sx - x0);
    const b = mix(source[y1 * width + x0], source[y1 * width + x1], sx - x0);
    result[y * targetWidth + x] = mix(a, b, sy - y0);
  }
  return result;
}

// ORM alpha is oxide data, not transparency. Never resize it through Canvas's
// alpha compositing: that would erase G/B on every clean (A=0) paint pixel.
export function resampleSurfaceData(source, width, height, targetWidth, targetHeight) {
  const result = new Uint8Array(targetWidth * targetHeight * 4);
  for (let y = 0; y < targetHeight; y++) for (let x = 0; x < targetWidth; x++) {
    const x0 = Math.floor(x * width / targetWidth), x1 = Math.max(x0 + 1, Math.ceil((x + 1) * width / targetWidth));
    const y0 = Math.floor(y * height / targetHeight), y1 = Math.max(y0 + 1, Math.ceil((y + 1) * height / targetHeight));
    const count = (x1 - x0) * (y1 - y0);
    for (let channel = 0; channel < 4; channel++) {
      let sum = 0;
      for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) sum += source[(sy * width + sx) * 4 + channel];
      result[(y * targetWidth + x) * 4 + channel] = Math.round(sum / count);
    }
  }
  return result;
}
