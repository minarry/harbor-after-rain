// Small, tileable surfaces for first-person hands. No weapon-metal noise or
// external images: skin, woven glove fabric and sleeves have separate responses.
import * as THREE from 'three';

const SIZE = 256, TAU = Math.PI * 2;
let surfaces;
const fract = n => n - Math.floor(n);
function hash(x, y, seed) { return fract(Math.sin(x * 127.1 + y * 311.7 + seed * 17.13) * 43758.5453); }
function noise(u, v, cells, seed) {
  const x = u * cells, y = v * cells, ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const at = (a, b) => hash((a + cells) % cells, (b + cells) % cells, seed);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(at(ix, iy), at(ix + 1, iy), sx), THREE.MathUtils.lerp(at(ix, iy + 1), at(ix + 1, iy + 1), sx), sy);
}
function texture(data, name, color = false) {
  const t = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  t.name = name; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter; t.anisotropy = 4; t.needsUpdate = true;
  return t;
}
function surface(kind) {
  const heights = new Float32Array(SIZE * SIZE), albedo = new Uint8Array(SIZE * SIZE * 4), rough = albedo.slice(), normals = albedo.slice();
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const i = y * SIZE + x, u = x / SIZE, v = y / SIZE;
    const broad = noise(u, v, 8, 11), fine = noise(u, v, 64, 27);
    let h, shade, r;
    if (kind === 'skin') {
      // Irregular shallow pores, soft palm/finger grain. Keep the albedo subtle;
      // anatomical creases and fingertip shape are supplied by the mesh.
      const pores = Math.pow(Math.max(0, (fine - .48) * 1.9), 3);
      h = .5 + (broad - .5) * .14 - pores * .24 + (fine - .5) * .035;
      shade = .955 + broad * .025 + fine * .018;
      r = .87 + broad * .08 - pores * .04;
    } else {
      const count = kind === 'sleeve' ? 32 : 40;
      const warp = Math.sin(u * count * TAU), weft = Math.sin(v * count * TAU);
      const weave = warp * weft;
      h = .5 + weave * .085 + (fine - .5) * .065 + (broad - .5) * .035;
      shade = .935 + weave * .025 + broad * .025;
      r = .92 + fine * .065;
    }
    heights[i] = h;
    for (let k = 0; k < 3; k++) { albedo[i * 4 + k] = Math.round(shade * 255); rough[i * 4 + k] = Math.round(r * 255); }
    albedo[i * 4 + 3] = rough[i * 4 + 3] = 255;
  }
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const at = (a, b) => heights[((b + SIZE) % SIZE) * SIZE + (a + SIZE) % SIZE];
    const dx = (at(x - 1, y) - at(x + 1, y)) * 1.8, dy = (at(x, y - 1) - at(x, y + 1)) * 1.8;
    const inv = 1 / Math.hypot(dx, dy, 1), i = (y * SIZE + x) * 4;
    normals[i] = Math.round((dx * inv * .5 + .5) * 255);
    normals[i + 1] = Math.round((dy * inv * .5 + .5) * 255);
    normals[i + 2] = Math.round((inv * .5 + .5) * 255); normals[i + 3] = 255;
  }
  return { map: texture(albedo, `hand-${kind}-color`, true), normalMap: texture(normals, `hand-${kind}-normal`), roughnessMap: texture(rough, `hand-${kind}-roughness`) };
}

export function createHandMaterials() {
  surfaces ||= { glove: surface('glove'), skin: surface('skin'), sleeve: surface('sleeve') };
  const glove = new THREE.MeshStandardMaterial({ name: 'view-glove-fabric', color: 0xffffff, vertexColors: true,
    metalness: 0, roughness: .88, ...surfaces.glove, normalScale: new THREE.Vector2(.28, .28) });
  const skin = new THREE.MeshPhysicalMaterial({ name: 'view-hand-skin', color: 0xd5a082, vertexColors: true,
    metalness: 0, roughness: .67, ...surfaces.skin, normalScale: new THREE.Vector2(.22, .22),
    sheen: .12, sheenColor: new THREE.Color(0xba8b76), sheenRoughness: .75, specularIntensity: .36 });
  const nail = new THREE.MeshPhysicalMaterial({ name: 'view-hand-nail', color: 0xdfb5a2, vertexColors: true,
    metalness: 0, roughness: .42, clearcoat: .12, clearcoatRoughness: .38, specularIntensity: .4 });
  const sleeve = new THREE.MeshStandardMaterial({ name: 'view-sleeve-fabric', color: 0x817765, vertexColors: true,
    metalness: 0, roughness: .94, ...surfaces.sleeve, normalScale: new THREE.Vector2(.24, .24) });
  return { glove, skin, nail, sleeve };
}

export function setHandWetness(materials, amount) {
  const wet = THREE.MathUtils.clamp(amount, 0, 1);
  materials.glove.roughness = .88 - wet * .12;
  materials.skin.roughness = .67 - wet * .10;
  materials.nail.roughness = .42 - wet * .045;
  materials.sleeve.roughness = .94 - wet * .07;
}
