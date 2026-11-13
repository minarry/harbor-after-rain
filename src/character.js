// 第三人称士兵：刚性蒙皮 + 程序动画 + 骨骼命中盒
import * as THREE from 'three';
import { buildGunMerged } from './guns.js';
import { fbm, normalFromHeight } from './textures.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

let ATLAS = null, ATLAS_ROUGH = null, ATLAS_METAL = null, ATLAS_NORMAL = null;
function atlas() {
  if (ATLAS) return ATLAS;
  const W = 512, H = 128;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const n = fbm(W, H, 16, 4, 4, 91);
  const img = ctx.createImageData(W, H), d = img.data;
  const camo = fbm(W, H, 8, 2, 3, 92), camo2 = fbm(W, H, 8, 2, 3, 93);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    let v;
    if (x < 128) { // 布料纹理
      const weave = ((x + y) % 3 === 0 ? 0.92 : 1) * ((x - y + 300) % 4 === 0 ? 0.94 : 1);
      v = (0.82 + n[i] * 0.3) * weave;
    } else if (x < 256) { // 数码迷彩
      const qx = Math.floor(x / 4) * 4, qy = Math.floor(y / 4) * 4, qi = qy * W + qx;
      const a = camo[qi], b = camo2[qi];
      v = a > 0.56 ? 0.55 : b > 0.58 ? 1.25 : a < 0.42 ? 0.8 : 1.0;
      v *= 0.92 + n[i] * 0.15;
    } else v = 0.93 + n[i] * 0.12;
    const g = Math.min(255, v * 200);
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = g; d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  const roughData = new Uint8Array(W*H*4), metalData = new Uint8Array(W*H*4);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const i=y*W+x, kind=x<256?'cloth':x<320?'polymer':x<384?'metal':x<448?'glass':'skin';
    const rough=kind==='cloth'?.92:kind==='polymer'?.66:kind==='metal'?.35:kind==='glass'?.15:.75;
    const metal=kind==='metal'?.82:kind==='glass'?.48:.025;
    const r=Math.round(Math.max(.08,Math.min(1,rough+(n[i]-.5)*.11))*255),m=Math.round(metal*255);
    roughData.set([r,r,r,255],i*4);metalData.set([m,m,m,255],i*4);
  }
  ATLAS_ROUGH=new THREE.DataTexture(roughData,W,H);ATLAS_ROUGH.needsUpdate=true;
  ATLAS_METAL=new THREE.DataTexture(metalData,W,H);ATLAS_METAL.needsUpdate=true;
  ATLAS_NORMAL=new THREE.CanvasTexture(normalFromHeight(n,W,H,.7));
  for(const texture of[ATLAS_ROUGH,ATLAS_METAL,ATLAS_NORMAL]){texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=true;}
  ATLAS = t;
  return t;
}

const OUTFIT = {
  BL: {
    pants: [0x2c2d31, 'fab'], jacket: [0x1f2124, 'fab'], vest: [0x2e3128, 'fab'], pouch: [0x3a3d30, 'fab'],
    boots: [0x141414, 'plain'], gloves: [0x18181a, 'plain'], skin: [0xb88c6c, 'skin'], mask: [0x151618, 'fab'],
    head: [0x151618, 'fab'], band: [0xa3161a, 'plain'], armband: [0xb01c1c, 'plain'], goggles: [0x1a1a1a, 'plain'], lens: [0x744c30, 'glass'],
    pads: [0x30383a, 'plain'], metal: [0x5f6869, 'metal'], stitch: [0x656a5e, 'fab'],
  },
  GR: {
    pants: [0x5e6b7c, 'camo'], jacket: [0x566478, 'camo'], vest: [0x27344a, 'fab'], pouch: [0x2e3c52, 'fab'],
    boots: [0x16161a, 'plain'], gloves: [0x1c1d20, 'plain'], skin: [0xc49a7a, 'skin'], mask: [0x202328, 'fab'],
    head: [0x33404f, 'plain'], band: [0x1a1a1a, 'plain'], armband: [0x1f62c8, 'plain'], goggles: [0x151515, 'plain'], lens: [0x597b88, 'glass'],
    pads: [0x354751, 'plain'], metal: [0x65747a, 'metal'], stitch: [0x86918f, 'fab'],
  },
};

const BONES = [
  // name, parent, x, y, z
  ['hips', -1, 0, 0.98, 0], ['spine', 0, 0, 0.12, 0], ['chest', 1, 0, 0.2, 0], ['neck', 2, 0, 0.2, 0], ['head', 3, 0, 0.08, 0],
  ['shoulderR', 2, 0.17, 0.13, 0], ['upperArmR', 5, 0.04, 0, 0], ['forearmR', 6, 0, -0.29, 0], ['handR', 7, 0, -0.26, 0],
  ['shoulderL', 2, -0.17, 0.13, 0], ['upperArmL', 9, -0.04, 0, 0], ['forearmL', 10, 0, -0.29, 0], ['handL', 11, 0, -0.26, 0],
  ['thighR', 0, 0.1, -0.05, 0], ['shinR', 13, 0, -0.44, 0], ['footR', 14, 0, -0.44, 0],
  ['thighL', 0, -0.1, -0.05, 0], ['shinL', 16, 0, -0.44, 0], ['footL', 17, 0, -0.44, 0],
];
const BI = Object.fromEntries(BONES.map((b, i) => [b[0], i]));

function bindPositions() {
  const out = [];
  for (const [, p, x, y, z] of BONES) {
    const v = new THREE.Vector3(x, y, z);
    if (p >= 0) v.add(out[p]);
    out.push(v);
  }
  return out;
}

// 构建带蒙皮属性的合并几何
const GEO_CACHE = {};
function buildGeometry(team, low = false) {
  const key = `${team}:${low ? 'low' : 'high'}`;
  if (GEO_CACHE[key]) return GEO_CACHE[key];
  const O = OUTFIT[team];
  const bp = bindPositions();
  const parts = [];
  const add = (geo, bone, colorKey, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const g = geo.clone();
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m);
    const [col, kind] = O[colorKey];
    const n = g.attributes.position.count;
    const color = new THREE.Color(col);
    const cols = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const uvs = new Float32Array(n * 2);
    const ranges = {fab:[.015,.23],camo:[.26,.23],plain:[.51,.105],metal:[.635,.105],glass:[.76,.105],skin:[.885,.105]};
    const [u0,uw] = ranges[kind] || ranges.plain;
    const src = g.attributes.uv;
    for (let i = 0; i < n; i++) {
      cols[i * 3] = color.r; cols[i * 3 + 1] = color.g; cols[i * 3 + 2] = color.b;
      si[i * 4] = BI[bone]; sw[i * 4] = 1;
      const su = src ? src.getX(i) : 0.5, sv = src ? src.getY(i) : 0.5;
      uvs[i * 2] = u0 + THREE.MathUtils.clamp(su,0,1) * uw; uvs[i * 2 + 1] = 0.05 + THREE.MathUtils.clamp(sv,0,1) * 0.9;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', g.attributes.position);
    out.setAttribute('normal', g.attributes.normal);
    out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    out.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    out.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    out.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    if (g.index) out.setIndex(g.index);
    parts.push(out.index ? out.toNonIndexed() : out);
  };
  const cap = (r, l) => new THREE.CapsuleGeometry(r, l, low ? 2 : 3, low ? 6 : 10);
  const box = (w, h, d) => low ? new THREE.BoxGeometry(w, h, d) : new RoundedBoxGeometry(w, h, d, 1, Math.min(.014,Math.min(w,h,d)*.16));
  const sph = (r) => new THREE.SphereGeometry(r, low ? 8 : 14, low ? 6 : 10);
  const P = (name) => bp[BI[name]];
  // 腿
  for (const s of ['R', 'L']) {
    const sx = s === 'R' ? 1 : -1;
    const th = P('thigh' + s), sh = P('shin' + s), ft = P('foot' + s);
    add(cap(0.085, 0.3), 'thigh' + s, 'pants', th.x, th.y - 0.2, th.z);
    add(cap(0.068, 0.32), 'shin' + s, 'pants', sh.x, sh.y - 0.2, sh.z);
    add(box(0.12, 0.14, 0.1), 'shin' + s, 'pads', sh.x, sh.y - 0.02, sh.z - 0.06);
    add(box(0.12, 0.13, 0.27), 'foot' + s, 'boots', ft.x, ft.y + 0.03, ft.z - 0.05);
    add(box(0.11, 0.1, 0.14), 'shin' + s, 'boots', sh.x, sh.y - 0.38, sh.z);
    add(box(0.07, 0.1, 0.1), 'thigh' + s, 'pouch', th.x + sx * 0.08, th.y - 0.18, th.z);
  }
  // 躯干
  const hp = P('hips'), sp = P('spine'), ch = P('chest');
  add(box(0.36, 0.22, 0.24), 'hips', 'pants', hp.x, hp.y - 0.02, hp.z);
  add(box(0.38, 0.06, 0.26), 'hips', 'band', hp.x, hp.y + 0.08, hp.z);
  add(box(0.33, 0.22, 0.22), 'spine', 'jacket', sp.x, sp.y + 0.1, sp.z);
  add(box(0.4, 0.3, 0.25), 'chest', 'jacket', ch.x, ch.y + 0.1, ch.z);
  add(box(0.42, 0.34, 0.29), 'chest', 'vest', ch.x, ch.y + 0.06, ch.z);
  for (let i = 0; i < 3; i++) add(box(0.085, 0.11, 0.05), 'chest', 'pouch', ch.x - 0.1 + i * 0.1, ch.y - 0.02, ch.z - 0.16);
  add(box(0.3, 0.34, 0.12), 'chest', 'pouch', ch.x, ch.y + 0.05, ch.z + 0.19); // 背包
  add(box(0.03, 0.25, 0.03), 'chest', 'goggles', ch.x + 0.1, ch.y + 0.32, ch.z + 0.2); // 天线
  // 头
  const nk = P('neck'), hd = P('head');
  add(cap(0.055, 0.06), 'neck', 'skin', nk.x, nk.y + 0.04, nk.z);
  const headG = sph(0.108); headG.scale(0.95, 1.12, 1.02);
  add(headG, 'head', 'skin', hd.x, hd.y + 0.09, hd.z);
  if (team === 'GR') {
    const helm = new THREE.SphereGeometry(0.128, low ? 10 : 16, low ? 6 : 10, 0, Math.PI * 2, 0, Math.PI * 0.55); helm.scale(1, 0.95, 1.08);
    add(helm, 'head', 'head', hd.x, hd.y + 0.12, hd.z + 0.005);
    add(box(0.23, 0.05, 0.05), 'head', 'goggles', hd.x, hd.y + 0.155, hd.z - 0.1);
    add(box(0.18, 0.035, 0.02), 'head', 'lens', hd.x, hd.y + 0.155, hd.z - 0.125);
    const mask = sph(0.1); mask.scale(1, 0.62, 1.05);
    add(mask, 'head', 'mask', hd.x, hd.y + 0.035, hd.z - 0.02);
  } else {
    const hood = sph(0.114); hood.scale(0.98, 1.1, 1.05);
    add(hood, 'head', 'mask', hd.x, hd.y + 0.1, hd.z + 0.008);
    add(box(0.16, 0.035, 0.03), 'head', 'skin', hd.x, hd.y + 0.12, hd.z - 0.105);
    add(box(0.24, 0.035, 0.235), 'head', 'band', hd.x, hd.y + 0.185, hd.z);
    add(box(0.07, 0.022, 0.02), 'head', 'goggles', hd.x - 0.04, hd.y + 0.12, hd.z - 0.118);
    add(box(0.07, 0.022, 0.02), 'head', 'goggles', hd.x + 0.04, hd.y + 0.12, hd.z - 0.118);
  }
  // 手臂
  for (const s of ['R', 'L']) {
    const ua = P('upperArm' + s), fa = P('forearm' + s), hn = P('hand' + s);
    add(sph(0.085), 'upperArm' + s, 'jacket', ua.x, ua.y - 0.02, ua.z);
    add(cap(0.062, 0.2), 'upperArm' + s, 'jacket', ua.x, ua.y - 0.15, ua.z);
    add(cap(0.066, 0.05), 'upperArm' + s, 'armband', ua.x, ua.y - 0.12, ua.z);
    add(cap(0.052, 0.19), 'forearm' + s, 'jacket', fa.x, fa.y - 0.13, fa.z);
    add(box(0.075, 0.1, 0.05), 'hand' + s, 'gloves', hn.x, hn.y - 0.04, hn.z);
  }
  // Equipment shares the same skinned geometry and atlas: no per-pouch draw calls.
  for (const side of [-1, 1]) {
    // Padded shoulder straps and adjustment buckles.
    add(box(.062,.31,.024),'chest','pouch',ch.x+side*.143,ch.y+.11,ch.z-.148,0,0,side*-.08);
    add(box(.058,.032,.032),'chest','metal',ch.x+side*.143,ch.y+.16,ch.z-.167);
    add(box(.029,.017,.034),'chest','pads',ch.x+side*.143,ch.y+.16,ch.z-.173);
    add(box(.064,.035,.19),'chest','vest',ch.x+side*.145,ch.y+.275,ch.z-.005,.18);
    // Radio carrier, belt bags and retention straps.
    add(box(.055,.13,.055),'chest','pads',ch.x+side*.184,ch.y+.13,ch.z-.13,0,side*.12);
    add(box(.06,.028,.058),'chest','band',ch.x+side*.184,ch.y+.145,ch.z-.133);
    add(box(.07,.085,.07),'hips','pouch',hp.x+side*.192,hp.y-.02,hp.z+.03);
    // Integrated ear protection and headset band.
    add(box(.04,.076,.072),'head','goggles',hd.x+side*.12,hd.y+.095,hd.z+.008,0,0,side*.13);
    add(box(.012,.055,.05),'head','metal',hd.x+side*.142,hd.y+.097,hd.z+.01);
    add(box(.014,.085,.015),'head','band',hd.x+side*.107,hd.y+.171,hd.z+.006,0,0,side*-.22);
  }
  // Front plate pocket, MOLLE webbing, lower retention tabs and fasteners.
  add(box(.247,.178,.025),'chest','vest',ch.x,ch.y+.115,ch.z-.161);
  for(let row=0;row<4;row++){
    add(box(.24,.012,.008),'chest','pouch',ch.x,ch.y+.17-row*.039,ch.z-.178);
    for(let col=0;col<5;col++)add(box(.004,.018,.009),'chest','stitch',ch.x-.104+col*.052,ch.y+.17-row*.039,ch.z-.18);
  }
  for(let i=0;i<3;i++){
    const x=ch.x-.10+i*.10;
    add(box(.087,.028,.053),'chest','vest',x,ch.y+.027,ch.z-.167);
    add(box(.019,.042,.008),'chest','band',x,ch.y+.006,ch.z-.192);
    add(box(.018,.012,.01),'chest','metal',x,ch.y-.014,ch.z-.196);
  }
  // Flat identity patch: a colored stitched tab, no floating label geometry.
  add(box(.082,.035,.008),'chest','pads',ch.x-.035,ch.y+.234,ch.z-.165);
  add(box(.067,.007,.009),'chest','stitch',ch.x-.035,ch.y+.238,ch.z-.17);
  add(box(.04,.004,.009),'chest','stitch',ch.x-.046,ch.y+.228,ch.z-.17);
  // Backpack lid, compression straps and two external seams.
  add(box(.29,.045,.13),'chest','vest',ch.x,ch.y+.232,ch.z+.196);
  for(const side of[-1,1]){
    add(box(.026,.28,.013),'chest','band',ch.x+side*.105,ch.y+.065,ch.z+.259);
    add(box(.036,.025,.018),'chest','metal',ch.x+side*.105,ch.y+.105,ch.z+.267);
    add(box(.012,.29,.014),'chest','stitch',ch.x+side*.138,ch.y+.07,ch.z+.247);
  }
  add(box(.1,.024,.025),'chest','band',ch.x,ch.y+.29,ch.z+.2);
  add(box(.042,.015,.032),'hips','metal',hp.x,hp.y+.082,hp.z-.141);
  // Rigid hard shells over fabric knee pads; stitched boots and segmented soles.
  for(const side of ['R','L']){
    const sign=side==='R'?1:-1,sh=P('shin'+side),ft=P('foot'+side),fa=P('forearm'+side),hn=P('hand'+side);
    add(box(.106,.109,.025),'shin'+side,'pads',sh.x,sh.y-.02,sh.z-.119,.08);
    add(box(.07,.071,.018),'shin'+side,'metal',sh.x,sh.y-.018,sh.z-.135,.08);
    for(const dy of[-.065,.028])add(box(.14,.018,.107),'shin'+side,'band',sh.x,sh.y+dy,sh.z-.03);
    add(box(.128,.024,.28),'foot'+side,'boots',ft.x,ft.y-.037,ft.z-.052);
    for(let i=0;i<6;i++)add(box(.13,.014,.018),'foot'+side,'pads',ft.x,ft.y-.051,ft.z-.167+i*.043);
    add(box(.11,.035,.11),'foot'+side,'pads',ft.x,ft.y+.088,ft.z-.12,.12);
    for(let i=0;i<4;i++)add(box(.07,.005,.009),'foot'+side,'stitch',ft.x,ft.y+.102-i*.004,ft.z-.117+i*.027,0,0,i%2?.1:-.1);
    add(box(.055,.079,.038),'forearm'+side,'pads',fa.x+sign*.037,fa.y-.019,fa.z+.017);
    add(box(.061,.023,.055),'hand'+side,'band',hn.x,hn.y+.006,hn.z);
    for(let i=0;i<3;i++)add(box(.014,.022,.01),'hand'+side,'pads',hn.x-.02+i*.02,hn.y-.023,hn.z-.028);
  }
  // Throat mic and short flexible boom are bound to the head/neck.
  add(box(.063,.014,.013),'head','goggles',hd.x-.079,hd.y+.038,hd.z-.074,0,-.6,-.2);
  add(box(.025,.017,.02),'head','pads',hd.x-.054,hd.y+.029,hd.z-.099);

  const geo = mergeAll(parts);
  for (const part of parts) part.dispose();
  geo.computeBoundingSphere();
  GEO_CACHE[key] = geo;
  return geo;
}

function mergeAll(list) {
  let n = 0; for (const g of list) n += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  const names = ['position', 'normal', 'uv', 'color', 'skinIndex', 'skinWeight'];
  for (const name of names) {
    const s = list[0].attributes[name];
    const Arr = s.array.constructor, isz = s.itemSize;
    const arr = new Arr(n * isz);
    let o = 0;
    for (const g of list) { arr.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
    out.setAttribute(name, name === 'skinIndex' ? new THREE.Uint16BufferAttribute(arr, isz) : new THREE.BufferAttribute(arr, isz));
  }
  return out;
}

const HITBOXES = [
  // bone, cx, cy, cz, hx, hy, hz, part
  ['head', 0, 0.1, 0, 0.1, 0.12, 0.11, 'head'],
  ['chest', 0, 0.1, 0, 0.21, 0.18, 0.145, 'chest'],
  ['spine', 0, 0.09, 0, 0.17, 0.12, 0.12, 'stomach'],
  ['hips', 0, -0.02, 0, 0.18, 0.11, 0.13, 'stomach'],
  ['upperArmR', 0, -0.14, 0, 0.065, 0.16, 0.065, 'arm'], ['upperArmL', 0, -0.14, 0, 0.065, 0.16, 0.065, 'arm'],
  ['forearmR', 0, -0.13, 0, 0.055, 0.15, 0.055, 'arm'], ['forearmL', 0, -0.13, 0, 0.055, 0.15, 0.055, 'arm'],
  ['thighR', 0, -0.21, 0, 0.09, 0.24, 0.09, 'leg'], ['thighL', 0, -0.21, 0, 0.09, 0.24, 0.09, 'leg'],
  ['shinR', 0, -0.22, 0, 0.07, 0.24, 0.075, 'leg'], ['shinL', 0, -0.22, 0, 0.07, 0.24, 0.075, 'leg'],
];

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();
const DOWN = new THREE.Vector3(0, -1, 0);

export class Soldier {
  constructor(team) {
    this.team = team;
    this.highDetail = true;
    this.root = new THREE.Group();
    const geo = buildGeometry(team);
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, map: atlas(), roughness: .98, metalness: 1, roughnessMap: ATLAS_ROUGH, metalnessMap: ATLAS_METAL, normalMap: ATLAS_NORMAL, normalScale: new THREE.Vector2(.22,.22) });
    this.mesh = new THREE.SkinnedMesh(geo, this.material);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    const bp = bindPositions();
    this.bones = BONES.map(([name], i) => { const b = new THREE.Bone(); b.name = name; return b; });
    BONES.forEach(([, p, x, y, z], i) => {
      this.bones[i].position.set(x, y, z);
      if (p >= 0) this.bones[p].add(this.bones[i]); else this.mesh.add(this.bones[i]);
    });
    void bp;
    this.mesh.updateMatrixWorld(true);
    this.mesh.bind(new THREE.Skeleton(this.bones));
    this.root.add(this.mesh);
    this.B = Object.fromEntries(this.bones.map((b) => [b.name, b]));
    this.phase = Math.random() * 10;
    this.crouchK = 0;
    this.deadT = -1; this.fallDir = 1; this.fallSide = 0;
    this.recoilK = 0; this.flinchPitch = 0; this.flinchRoll = 0; this.flinchHead = 0; this.flinchV = 0;
    this.gun = null; this.gunId = null;
    this.invs = HITBOXES.map(() => new THREE.Matrix4());
    this.invFrame = -1;
    this.opacity = 1;
    this.flashT = 0;
  }
  // Both levels use identical bind positions and rigid skin indices. Cached
  // geometry is shared by the whole team; changing LOD never rebinds a skeleton.
  setDetail(high) {
    high = !!high;
    if (this.highDetail === high) return;
    this.mesh.geometry = buildGeometry(this.team, !high);
    this.highDetail = high;
  }
  setWeapon(id) {
    if (this.gunId === id) return;
    if (this.gun) this.B.chest.remove(this.gun);
    this.gunId = id;
    this.gun = buildGunMerged(id);
    // 枪挂在胸骨上，保证瞄准方向稳定
    this.B.chest.add(this.gun);
    this.gunType = id;
  }
  // 两骨骼 IK：让手到达胸骨坐标系下的目标点
  solveArm(side, targetWorld, poleWorld) {
    const up = this.B['upperArm' + side], fore = this.B['forearm' + side];
    const S = up.getWorldPosition(new THREE.Vector3());
    const a = 0.29, b = 0.28;
    const toT = _v.copy(targetWorld).sub(S);
    let d = toT.length();
    d = Math.min(d, a + b - 0.001);
    const dir = toT.normalize();
    const cosA = (a * a + d * d - b * b) / (2 * a * d);
    const ang = Math.acos(THREE.MathUtils.clamp(cosA, -1, 1));
    // 肘部方向：朝向 pole 在垂直于 dir 平面上的投影
    const pole = _v2.copy(poleWorld).sub(S);
    pole.addScaledVector(dir, -pole.dot(dir)).normalize();
    const elbowDir = dir.clone().multiplyScalar(Math.cos(ang)).addScaledVector(pole, Math.sin(ang)).normalize();
    const E = S.clone().addScaledVector(elbowDir, a);
    // 上臂
    const parentQ = up.parent.getWorldQuaternion(_q);
    const wq = _q2.setFromUnitVectors(DOWN, elbowDir);
    up.quaternion.copy(parentQ.invert().multiply(wq));
    up.updateMatrixWorld(true);
    const T2 = S.clone().addScaledVector(dir, d);
    const fdir = T2.sub(E).normalize();
    const pq = up.getWorldQuaternion(new THREE.Quaternion());
    fore.quaternion.copy(pq.invert().multiply(new THREE.Quaternion().setFromUnitVectors(DOWN, fdir)));
  }
  // st: {speed, fwd, side, crouch, pitch, onGround, dead, t}
  update(dt, st) {
    const B = this.B;
    if (this.deadT >= 0) { this.updateDeath(dt); return; }
    this.crouchK += ((st.crouch ? 1 : 0) - this.crouchK) * Math.min(1, dt * 10);
    const ck = this.crouchK;
    const sp = st.speed;
    const moving = sp > 0.3 && st.onGround;
    this.phase += dt * (moving ? 2.2 + sp * 1.15 : 0) * (ck > 0.5 ? 0.7 : 1);
    const amp = moving ? Math.min(1, sp / 5) : 0;
    this.amp = (this.amp || 0) + (amp - (this.amp || 0)) * Math.min(1, dt * 8);
    const A = this.amp;
    this.reloadPhase = st.reloading ? (this.reloadPhase || 0) + dt : 0;
    const ph = this.phase;
    const back = st.fwd < -0.3 ? -1 : 1;
    // 腿
    const swing = Math.sin(ph) * 0.62 * A * back;
    const bendR = Math.max(0, Math.sin(ph + Math.PI * 0.5 * back)) * 1.0 * A;
    const bendL = Math.max(0, Math.sin(ph + Math.PI + Math.PI * 0.5 * back)) * 1.0 * A;
    let thR = swing, thL = -swing, shR = -bendR, shL = -bendL;
    // 下蹲
    thR = thR * (1 - ck) + (1.25 + swing * 0.3) * ck;
    thL = thL * (1 - ck) + (0.55 - swing * 0.3) * ck;
    shR = shR * (1 - ck) + -1.9 * ck;
    shL = shL * (1 - ck) + (-1.2 + Math.min(0, -swing)) * ck;
    if (!st.onGround) { thR = 0.7; thL = 0.25; shR = -1.1; shL = -0.6; }
    B.thighR.rotation.set(thR, 0, 0.02); B.thighL.rotation.set(thL, 0, -0.02);
    B.shinR.rotation.set(shR, 0, 0); B.shinL.rotation.set(shL, 0, 0);
    B.footR.rotation.set(-thR - shR - 0.0, 0, 0); B.footL.rotation.set(-thL - shL, 0, 0);
    if (ck > 0.01) { B.footL.rotation.x = 0.5 * ck + B.footL.rotation.x * (1 - ck); }
    // 髋部高度
    const bob = moving ? Math.abs(Math.cos(ph)) * 0.035 * A : 0;
    B.hips.position.y = 0.98 - ck * 0.38 - bob + (st.onGround ? 0 : 0.02);
    B.hips.position.z = ck * 0.08;
    B.hips.rotation.y = Math.sin(ph) * 0.08 * A;
    // 上身跟随俯仰
    const pitch = THREE.MathUtils.clamp(st.pitch, -1.2, 1.2);
    B.spine.rotation.set(pitch * 0.3 + ck * 0.15, -B.hips.rotation.y - 0.25, 0);
    B.chest.rotation.set(pitch * 0.45 - this.recoilK * 0.08, -0.12, 0);
    B.neck.rotation.set(pitch * 0.2, 0.3, 0);
    B.head.rotation.set(0, 0.05, 0);
    B.chest.rotation.x += this.flinchPitch;
    B.chest.rotation.z += this.flinchRoll;
    B.head.rotation.x += this.flinchHead;
    B.hips.position.y -= Math.abs(this.flinchPitch) * .08;
    this.flinchPitch *= Math.exp(-dt * 11); this.flinchRoll *= Math.exp(-dt * 10); this.flinchHead *= Math.exp(-dt * 13);
    this.recoilK *= Math.exp(-dt * 12);
    // 枪相对胸骨
    if (this.gun) {
      const sniper = this.gunType === 'awm', pistol = this.gunType === 'deagle', knife = this.gunType === 'knife' || this.gunType === 'he';
      const gx = pistol ? 0.03 : 0.1, gy = pistol ? 0.14 : 0.1, gz = pistol ? -0.42 : -0.3;
      this.gun.position.set(gx, gy + (st.reloading ? -0.08 : 0), gz + this.recoilK * 0.05);
      this.gun.rotation.set(st.reloading ? -0.5 : 0, 0.37, st.reloading ? 0.4 : 0);
      if (knife) { this.gun.position.set(0.18, 0.02, -0.28); this.gun.rotation.set(-0.3, 0.37, 0); }
      void sniper;
      this.mesh.updateMatrixWorld(true);
      const an = this.gun.userData.anchors;
      const grip = this.gun.localToWorld(_v.copy(an.grip || new THREE.Vector3()));
      const gW = grip.clone();
      const poleR = this.B.chest.localToWorld(new THREE.Vector3(0.6, -0.5, 0.1));
      this.solveArm('R', gW, poleR);
      if (an.fore && !knife) {
        const leftAnchor = st.reloading && an.magwell ? an.magwell : an.fore;
        const fw = this.gun.localToWorld(_v.copy(leftAnchor));
        if (st.reloading) fw.y -= .08 + Math.sin(this.reloadPhase * 4) * .06;
        const poleL = this.B.chest.localToWorld(new THREE.Vector3(-0.5, -0.6, 0.0));
        this.solveArm('L', fw, poleL);
      } else {
        B.upperArmL.rotation.set(0.3, 0, -0.15); B.forearmL.rotation.set(0.6, 0, 0);
      }
    }
    B.handR.rotation.set(0, 0, 0); B.handL.rotation.set(0, 0, 0);
  }
  kick() { this.recoilK = 1; }
  flinch(dir, part, amount = 20) {
    if (this.deadT >= 0) return;
    const yaw = this.root.rotation.y, strength = Math.min(.24, Math.max(.035, amount / 260));
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const front = dir.x * fx + dir.z * fz, side = dir.x * Math.cos(yaw) - dir.z * Math.sin(yaw);
    this.flinchPitch = THREE.MathUtils.clamp(this.flinchPitch + front * strength, -.28, .28);
    this.flinchRoll = THREE.MathUtils.clamp(this.flinchRoll - side * strength * .7, -.2, .2);
    if (part === 'head') this.flinchHead = THREE.MathUtils.clamp(this.flinchHead - strength * 1.5, -.38, .38);
    this.invFrame = -1;
  }
  die(dirX, dirZ, headshot) {
    this.deadT = 0;
    // 倒地方向：沿子弹方向
    const fwd = new THREE.Vector3(-Math.sin(this.root.rotation.y), 0, -Math.cos(this.root.rotation.y));
    const dot = fwd.x * dirX + fwd.z * dirZ;
    this.fallDir = dot > 0 ? 1 : -1; // 被从背后打 -> 向前倒
    this.fallSide = (Math.random() - 0.5) * 0.8;
    this.fallSpeed = headshot ? 1.4 : 1;
    this.limbR = [Math.random(), Math.random(), Math.random(), Math.random()];
    this.opacity = 1; this.material.transparent = false; this.material.opacity = 1;
  }
  updateDeath(dt) {
    const B = this.B;
    this.deadT += dt;
    const t = Math.min(1, this.deadT * 1.6 * this.fallSpeed);
    const e = t * t; // 重力加速
    const ang = e * Math.PI * 0.5 * 0.96;
    this.mesh.rotation.x = -this.fallDir * ang;
    this.mesh.rotation.z = this.fallSide * e;
    B.hips.position.y = 0.98 - Math.sin(t * Math.PI) * 0.25 - t * 0.3;
    const r = this.limbR;
    const k = Math.min(1, this.deadT * 3);
    B.upperArmR.rotation.x += ((r[0] * 2 - 1) * 1.5 - B.upperArmR.rotation.x) * k * 0.2;
    B.upperArmL.rotation.x += ((r[1] * 2 - 1) * 1.5 - B.upperArmL.rotation.x) * k * 0.2;
    B.forearmR.rotation.set(0.3 * r[2], 0, 0); B.forearmL.rotation.set(0.4 * r[3], 0, 0);
    B.thighR.rotation.x *= 0.9; B.thighL.rotation.x += (0.4 * r[2] - B.thighL.rotation.x) * 0.1;
    B.shinR.rotation.x *= 0.9; B.shinL.rotation.x *= 0.9;
    B.spine.rotation.x *= 0.9; B.chest.rotation.x *= 0.9; B.neck.rotation.x += (0.3 * this.fallDir - B.neck.rotation.x) * 0.1;
    if (this.gun) this.gun.visible = this.deadT < 0.25;
    if (this.deadT > 4.5) {
      this.material.transparent = true;
      this.opacity = Math.max(0, 1 - (this.deadT - 4.5) / 1.2);
      this.material.opacity = this.opacity;
      this.root.position.y -= dt * 0.15;
    }
  }
  reset() {
    this.deadT = -1; this.mesh.rotation.set(0, 0, 0);
    this.flinchPitch = this.flinchRoll = this.flinchHead = this.recoilK = 0;
    this.material.transparent = false; this.material.opacity = 1; this.opacity = 1;
    if (this.gun) this.gun.visible = true;
  }
  // 射线命中测试，返回 {t, part}
  hitTest(o, d, maxT, frame) {
    // 粗检：到髋部的距离
    const hp = this.B.hips.getWorldPosition(_v);
    const wx = hp.x - o.x, wy = hp.y + 0.3 - o.y, wz = hp.z - o.z;
    const tc = wx * d.x + wy * d.y + wz * d.z;
    if (tc < -1.5 || tc > maxT + 1.5) return null;
    const px = wx - d.x * tc, py = wy - d.y * tc, pz = wz - d.z * tc;
    if (px * px + py * py + pz * pz > 1.6) return null;
    if (this.invFrame !== frame) {
      this.mesh.updateMatrixWorld(true);
      HITBOXES.forEach((h, i) => this.invs[i].copy(this.B[h[0]].matrixWorld).invert());
      this.invFrame = frame;
    }
    let best = maxT, part = null;
    const lo = new THREE.Vector3(), ld = new THREE.Vector3();
    for (let i = 0; i < HITBOXES.length; i++) {
      const [, cx, cy, cz, hx, hy, hz, name] = HITBOXES[i];
      lo.copy(o).applyMatrix4(this.invs[i]);
      ld.copy(d).transformDirection(this.invs[i]);
      const ox = lo.x - cx, oy = lo.y - cy, oz = lo.z - cz;
      let tmin = 0, tmax = best;
      const slab = (oo, dd, h) => {
        if (Math.abs(dd) < 1e-9) return oo >= -h && oo <= h;
        let t1 = (-h - oo) / dd, t2 = (h - oo) / dd;
        if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        return tmin <= tmax;
      };
      if (slab(ox, ld.x, hx) && slab(oy, ld.y, hy) && slab(oz, ld.z, hz) && tmin < best) { best = tmin; part = name; }
    }
    return part ? { t: best, part } : null;
  }
  muzzleWorld(out) {
    if (!this.gun) return this.B.head.getWorldPosition(out);
    return this.gun.localToWorld(out.copy(this.gun.userData.anchors.muzzle || _v.set(0, 0, -0.5)));
  }
  headWorld(out) { return this.B.head.localToWorld(out.set(0, 0.1, 0)); }
  chestWorld(out) { return this.B.chest.localToWorld(out.set(0, 0.1, 0)); }
}
