// 运输船地图构建
// 坐标：X 沿船长方向（-X 船尾/上层建筑/潜伏者出生点，+X 船头/保卫者出生点），Z 沿船宽，Y 向上，甲板 Y=0，海面 Y=-7.5
import * as THREE from 'three';
import {createSurfaceMaterials} from './surface-materials.js';
import {createPropBuilders} from './props.js';
import { SIGN_UV, mulberry32 } from './textures.js';

export const CH = 2.59, CW = 2.44, L20 = 6.06, L40 = 12.19;
export const SEA_Y = -7.5;
export const DECK_HALF_Z = 9.4;   // 主甲板半宽（两侧为集装箱管道）
export const H2 = 2.6;            // 二楼高度
export const MAP_BOUNDS = Object.freeze({ minX: -37, maxX: 37, minZ: -18.3, maxZ: 18.3 });
export const NAV_BOUNDS = Object.freeze({ x0: -36.2, z0: -17.9, x1: 36.2, z1: 17.9 });
const HULL_HALF_Z = 18.25;

const FACE = {
  px: { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  nx: { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  py: { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  ny: { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  pz: { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  nz: { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
};

// 按材质合批的几何缓冲
class Batch {
  constructor() { this.p = []; this.n = []; this.uv = []; this.idx = []; this.count = 0; }
  quad(v0, v1, v2, v3, nrm, uvs) {
    const b = this.count;
    this.p.push(...v0, ...v1, ...v2, ...v3);
    for (let i = 0; i < 4; i++) this.n.push(nrm[0], nrm[1], nrm[2]);
    this.uv.push(...uvs);
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    this.count += 4;
  }
  geom(g, m4) {
    const gi = g.index ? g : g;
    const pos = gi.attributes.position, nor = gi.attributes.normal, uv = gi.attributes.uv;
    const b = this.count;
    const v = new THREE.Vector3(), nn = new THREE.Vector3();
    const nm = new THREE.Matrix3().getNormalMatrix(m4);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m4);
      this.p.push(v.x, v.y, v.z);
      nn.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      this.n.push(nn.x, nn.y, nn.z);
      if (uv) this.uv.push(uv.getX(i), uv.getY(i)); else this.uv.push(0, 0);
    }
    if (gi.index) for (let i = 0; i < gi.index.count; i++) this.idx.push(b + gi.index.getX(i));
    else for (let i = 0; i < pos.count; i++) this.idx.push(b + i);
    this.count += pos.count;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

export function buildMap(scene, T, world, opts = {}) {
  const rnd = mulberry32(2024);
  const batches = new Map();
  const matDefs = {};
  const footprints = []; // 用于烘焙甲板 AO
  const lampSpots = [];
  const navigationChecks = [];
  const anim = [];

  Object.assign(matDefs, createSurfaceMaterials(T));
  if (opts.materialsOnly) return { materials: matDefs };

  const batch = (key) => {
    let b = batches.get(key);
    if (!b) { b = new Batch(); batches.set(key, b); }
    return b;
  };

  // ---------- 几何工具 ----------
  // 盒子：faces 为 {px,nx,py,ny,pz,nz: matKey|null} 或单一 matKey
  function box(cx, cy, cz, sx, sy, sz, yaw, faces, uvOff) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const half = [sx / 2, sy / 2, sz / 2], size = [sx, sy, sz];
    const off = uvOff ?? [rnd(), rnd()];
    for (const fk in FACE) {
      const key = typeof faces === 'string' ? faces : faces[fk];
      if (!key) continue;
      const F = FACE[fk], def = matDefs[key];
      const su = Math.abs(F.u[0] * size[0] + F.u[1] * size[1] + F.u[2] * size[2]);
      const sv = Math.abs(F.v[0] * size[0] + F.v[1] * size[1] + F.v[2] * size[2]);
      const ctr = [F.n[0] * half[0], F.n[1] * half[1], F.n[2] * half[2]];
      const corner = (a, b) => {
        const lx = ctr[0] + F.u[0] * su * a + F.v[0] * sv * b;
        const ly = ctr[1] + F.u[1] * su * a + F.v[1] * sv * b;
        const lz = ctr[2] + F.u[2] * su * a + F.v[2] * sv * b;
        return [cx + c * lx + s * lz, cy + ly, cz - s * lx + c * lz];
      };
      const n = [c * F.n[0] + s * F.n[2], F.n[1], -s * F.n[0] + c * F.n[2]];
      let u0 = 0, v0 = 0, u1 = 1, v1 = 1;
      if (def.uv !== 'unit' && def.uv !== 'custom') {
        const tu = Array.isArray(def.uv) ? def.uv[0] : def.uv, tv = Array.isArray(def.uv) ? def.uv[1] : def.uv;
        u0 = off[0]; v0 = Array.isArray(def.uv) ? 0 : off[1];
        u1 = u0 + su / tu; v1 = v0 + sv / tv;
      }
      batch(key).quad(corner(-0.5, -0.5), corner(0.5, -0.5), corner(0.5, 0.5), corner(-0.5, 0.5), n, [u0, v0, u1, v0, u1, v1, u0, v1]);
    }
  }
  function solid(cx, cy, cz, sx, sy, sz, yaw, props = {}) {
    return world.add({ x: cx, y: cy, z: cz, sx, sy, sz, yaw, ...props });
  }
  function foot(cx, cz, sx, sz, yaw, dark = 0.6) { footprints.push({ cx, cz, sx, sz, yaw, dark }); }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), vs = new THREE.Vector3(1, 1, 1);
  function geom(key, g, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    e.set(rx, ry, rz); q.setFromEuler(e); vs.set(sx, sy, sz);
    m4.compose(new THREE.Vector3(x, y, z), q, vs);
    batch(key).geom(g, m4);
  }
  // 两点之间的圆柱
  const up = new THREE.Vector3(0, 1, 0);
  function rod(key, x0, y0, z0, x1, y1, z1, r) {
    const d = new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0); const L = d.length(); d.normalize();
    q.setFromUnitVectors(up, d); vs.set(r, L, r);
    m4.compose(new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), q, vs);
    batch(key).geom(cylG8, m4);
  }
  // 自定义 UV 的矩形贴片（标识牌）
  function decal(key, cx, cy, cz, w, h, yaw, pitch, rect, texW = 1024) {
    const c = Math.cos(yaw), s = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    // 局部：u 沿 +X，v 沿 +Y，法线 +Z；先绕 X 俯仰再绕 Y 偏航
    const tr = (lx, ly) => {
      const y1 = ly * cp, z1 = ly * sp;
      return [cx + c * lx + s * z1, cy + y1, cz - s * lx + c * z1];
    };
    const nz = [s * cp, -sp, c * cp];
    const [rx, ry, rw, rh] = rect;
    const u0 = rx / texW, u1 = (rx + rw) / texW, v1 = 1 - ry / texW, v0 = 1 - (ry + rh) / texW;
    batch(key).quad(tr(-w / 2, -h / 2), tr(w / 2, -h / 2), tr(w / 2, h / 2), tr(-w / 2, h / 2), nz, [u0, v0, u1, v0, u1, v1, u0, v1]);
  }

  // ---------- 预制件 ----------
  const cylG = new THREE.CylinderGeometry(1, 1, 1, 16, 1);
  const cylG8 = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
  const sphG = new THREE.SphereGeometry(1, 10, 8);
  const torG = new THREE.TorusGeometry(0.32, 0.07, 8, 20);

  const {container,corrugatedWall,crate,barrel,railing,fence,lamp,lifeRing}=createPropBuilders({T,box,solid,foot,geom,rod,rnd,batch,matDefs,lampSpots,cylG,cylG8,sphG,torG,geometryDetail:opts.geometryDetail!==false});
  function finishBatches() {
    const meshes=[];
    for(const [key,b] of batches){if(!b.count)continue;const def=matDefs[key],mesh=new THREE.Mesh(b.build(),def.mat);mesh.castShadow=def.shadow!==false;mesh.receiveShadow=true;mesh.matrixAutoUpdate=false;mesh.updateMatrix();mesh.name=key;if(def.alpha)mesh.customDepthMaterial=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,map:def.mat.map,alphaTest:.5});scene.add(mesh);meshes.push(mesh);}
    // Batch owns copies; dispose the temporary primitive buffers.
    for(const geo of [cylG,cylG8,sphG,torG])geo.dispose();
    return meshes;
  }
  if(opts.showcase==='props'){
    box(0,-.2,0,34,.4,25,0,'deck');solid(0,-.2,0,34,.4,25,0,{mat:'deck',tag:'deck',navSurface:true});
    container(-5,-3,0,20,0);container(4,-3,0,20,3);
    crate(-7,3,1.2,1.1,1.1,1);crate(-5.5,3,1,1.5,1,2);
    barrel(-2,3,'red');barrel(-.9,3,'yellow');barrel(.2,3,'green');
    railing(3,3,7,3);fence(3,5,7,5,0,2);lamp(8,3,2,true);lifeRing(8,1.4,2,0);
    const meshes=finishBatches();world.build();
    return {materials:matDefs,meshes,lampSpots,update(){},galleryCount:10};
  }

  // ================== 甲板与边界 ==================
  // 甲板：按船体轮廓生成
  {
    const pts = [];
    for (let i = 0; i < 160; i++) { const [x, z] = hullContour(i / 160, 1, 1); pts.push(new THREE.Vector2(x, -z)); }
    const sg = new THREE.ShapeGeometry(new THREE.Shape(pts));
    sg.rotateX(-Math.PI / 2);
    const pos = sg.attributes.position, uv = sg.attributes.uv;
    const uv1 = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      uv.setXY(i, x / 4, -z / 4);
      uv1[i * 2] = (x - MAP_BOUNDS.minX) / 74; uv1[i * 2 + 1] = 1 - (z - MAP_BOUNDS.minZ) / 36.6;
    }
    sg.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
    sg.computeVertexNormals();
    const deckMesh = new THREE.Mesh(sg, matDefs.deck.mat);
    deckMesh.receiveShadow = true; deckMesh.name = 'deck';
    scene.add(deckMesh);
  }
  solid(0, -0.5, 0, 74, 1, 36.3, 0, { mat: 'deck', surface: 'metal', tag: 'deck', navSurface: true });
  // 舷侧看不见的墙（防止跳海）与两端
  for (const sz of [-1, 1]) solid(0, 4, sz * 18.15, 80, 8, 0.1, 0, { bullet: 'pass', sight: false, tag: 'boundary' });
  solid(-36.6, 6, 0, 0.4, 12, 36.6, 0, { mat: 'metal', tag: 'boundary' });
  solid(36.6, 6, 0, 0.4, 12, 36.6, 0, { mat: 'metal', tag: 'boundary' });

  // 舷边栏杆（整船）
  for (const sz of [-1, 1]) {
    for (let x = -64; x < 56; x += 10) railing(x, sz * 18.05, Math.min(x + 10, 56), sz * 18.05, 0, 'railYellow', 1.1, false);
    box(-4, 0.08, sz * 18.12, 120, 0.16, 0.06, 0, 'yellow');
  }

  // ================== 对称结构（s=+1 潜伏者一侧；s=-1 旋转 180° 为保卫者一侧） ==================
  const sideColors = { 1: [1, 3, 7, 1, 3], [-1]: [0, 5, 4, 0, 5] };
  for (const s of [1, -1]) {
    const X = (x) => x * s, Z = (z) => z * s, YAW = (deg) => deg + (s < 0 ? 180 : 0);
    const R = (deg) => YAW(deg) * Math.PI / 180;
    const col = sideColors[s];

    // ---- 出生点舱壁（带两扇门）----
    const wallX = X(-28.15), wallTh = 0.3, wallH = 4.5, doorH = 2.5;
    const doors = [[-16.8, -13.8], [-4.6, -1.8], [2.8, 5.4], [13.8, 16.8]];
    // The existing upper-container approach at 6.8..12.3 remains open above head height.
    const segs = [[-18.1, -16.8], [-13.8, -4.6], [-1.8, 2.8], [5.4, 6.8], [12.3, 13.8], [16.8, 18.1]];
    for (const [z0, z1] of segs) {
      const zc = Z((z0 + z1) / 2), L = z1 - z0;
      box(wallX, wallH / 2, zc, wallTh, wallH, L, 0, 'bulkhead');
      solid(wallX, wallH / 2, zc, wallTh, wallH, L, 0, { mat: 'metal' });
      foot(wallX, zc, wallTh, L, 0, 0.5);
    }
    for (const [z0, z1] of doors) {
      const zc = Z((z0 + z1) / 2), L = z1 - z0;
      box(wallX, doorH + (wallH - doorH) / 2, zc, wallTh, wallH - doorH, L, 0, 'bulkhead');
      solid(wallX, doorH + (wallH - doorH) / 2, zc, wallTh, wallH - doorH, L, 0, { mat: 'metal' });
      // 门框警示条
      for (const face of [-1, 1]) {
        const fx = wallX + face * (wallTh / 2 + 0.005);
        decal('signs', fx, doorH + 0.12, zc, L + 0.3, 0.24, face * Math.PI / 2, 0, SIGN_UV.hazard);
        for (const zz of [z0, z1]) decal('signs', fx, doorH / 2, Z(zz) + (zz === z0 ? 0.12 : -0.12) * s, 0.24, doorH, face * Math.PI / 2, 0, [0, 0, 128, 128]);
      }
      // 门槛
      box(wallX, 0.05, zc, wallTh + 0.2, 0.1, L, 0, 'darkSteel');
    }
    // 舱壁标识
    for (const face of [-1, 1]) {
      const fx = wallX + face * (wallTh / 2 + 0.006);
      decal('signs', fx, 3.4, Z(-8.2), 3.2, 0.8, face * Math.PI / 2, 0, SIGN_UV.hold);
      decal('signs', fx, 3.3, Z(0.5), 2.4, 0.84, face * Math.PI / 2, 0, s > 0 ? SIGN_UV.bl : SIGN_UV.gr);
      decal('signs', fx, 1.6, Z(-6.2), 0.6, 0.6, face * Math.PI / 2, 0, SIGN_UV.nosmoke);
    }
    lamp(wallX + s * 0.35, 3.0, Z(-3.2), false);
    lamp(wallX + s * 0.35, 3.0, Z(4.1), false);
    lamp(wallX - s * 0.35, 3.0, Z(-3.2), false);
    // 消防箱
    box(wallX - s * 0.3, 1.3, Z(-9.8), 0.25, 0.8, 0.6, 0, 'red');
    decal('signs', wallX - s * 0.43, 2.05, Z(-9.8), 0.5, 0.5, s > 0 ? -Math.PI / 2 : Math.PI / 2, 0, SIGN_UV.hydrant);

    // ---- 出生点内：吊机底座、楼梯、平台 ----
    // 吊机底座
    const cx = X(-33), cz = Z(-9.6);
    geom('yellow', cylG, cx, 3, cz, 0, 0, 0, 1.15, 6, 1.15);
    geom('darkSteel', cylG, cx, 0.15, cz, 0, 0, 0, 1.45, 0.3, 1.45);
    solid(cx, 3, cz, 2.2, 6, 2.2, R(45), { mat: 'metal' });
    solid(cx, 3, cz, 2.2, 6, 2.2, 0, { mat: 'metal' });
    foot(cx, cz, 2.6, 2.6, 0, 0.6);
    // 楼梯（上二楼）
    const nSteps = 10, stepH = H2 / nSteps, sx0 = -34, sx1 = -29.5, tread = (sx1 - sx0) / nSteps;
    const stz0 = 6.9, stz1 = 8.5;
    for (let i = 0; i < nSteps; i++) {
      const x0 = sx0 + i * tread;
      const cxs = X((x0 + sx1) / 2), h = (i + 1) * stepH;
      box(cxs, h / 2, Z((stz0 + stz1) / 2), sx1 - x0, h, stz1 - stz0, 0, { py: 'grating', px: 'darkSteel', nx: 'darkSteel', pz: 'darkSteel', nz: 'darkSteel' });
      box(X(x0 + 0.03), h - 0.02, Z((stz0 + stz1) / 2), 0.06, 0.04, stz1 - stz0, 0, 'railYellow');
      solid(cxs, h / 2, Z((stz0 + stz1) / 2), sx1 - x0, h, stz1 - stz0, 0, { mat: 'metal', surface: 'grate' });
    }
    foot(X((sx0 + sx1) / 2), Z((stz0 + stz1) / 2), sx1 - sx0, stz1 - stz0, 0, 0.5);
    // 楼梯斜扶手
    rod('railYellow', X(sx0), 1.0, Z(stz0), X(sx1), H2 + 1.0, Z(stz0), 0.03);
    rod('railYellow', X(sx0), 0.55, Z(stz0), X(sx1), H2 + 0.55, Z(stz0), 0.025);
    for (let i = 0; i <= 4; i++) { const t = i / 4; const hx = sx0 + (sx1 - sx0) * t, hy = H2 * t; rod('railYellow', X(hx), hy, Z(stz0), X(hx), hy + 1.0, Z(stz0), 0.03); }
    // 平台支撑块
    box(X(-28.75), H2 / 2, Z(8.1), 1.5, H2, 2.6, 0, { py: 'grating', px: 'darkSteel', nx: 'darkSteel', pz: 'darkSteel', nz: 'darkSteel' });
    solid(X(-28.75), H2 / 2, Z(8.1), 1.5, H2, 2.6, 0, { mat: 'metal', surface: 'grate' });
    foot(X(-28.75), Z(8.1), 1.5, 2.6, 0, 0.6);
    railing(X(-29.5), Z(6.8), X(-28.0), Z(6.8), H2, 'railYellow', 1.1, true);

    // 出生点杂物
    crate(X(-29.6), Z(-6.6), 1.3, 1.3, 1.3, 4, 0, 10);
    crate(X(-29.5), Z(-5.3), 1.0, 0.9, 1.0, 5, 0, -5);
    crate(X(-35.6), Z(4.2), 1.4, 1.4, 1.4, 4, 0, 0);
    for (const bz of [-11.3, 11.3]) { // 系缆桩
      const bx = X(-35.3), bzz = Z(bz);
      geom('black', cylG, bx - 0.35, 0.35, bzz, 0, 0, 0, 0.2, 0.7, 0.2);
      geom('black', cylG, bx + 0.35, 0.35, bzz, 0, 0, 0, 0.2, 0.7, 0.2);
      box(bx, 0.05, bzz, 1.3, 0.1, 0.55, 0, 'black');
      solid(bx, 0.35, bzz, 1.2, 0.7, 0.45, 0, { mat: 'metal' });
    }
    lifeRing(X(-31.5), 0.85, Z(11.98), s > 0 ? 0 : Math.PI);
    lifeRing(X(-34.5), 0.85, Z(-11.98), s > 0 ? Math.PI : 0);
    // 蘑菇通风筒
    for (const [vx, vz] of [[-35.4, -7.8], [-35.4, 0.3]]) {
      geom('white', cylG, X(vx), 0.6, Z(vz), 0, 0, 0, 0.18, 1.2, 0.18);
      geom('white', sphG, X(vx), 1.25, Z(vz), 0, 0, 0, 0.36, 0.2, 0.36);
      solid(X(vx), 0.7, Z(vz), 0.5, 1.4, 0.5, 0, { mat: 'metal' });
    }

    // ---- 集装箱管道（单向小道）+ 二楼 ----
    const tz0 = 9.4, tz1 = 9.4 + CW, tzc = (tz0 + tz1) / 2; // 9.4 .. 11.84
    const tx0 = -29.5;
    const segCols = [col[0], col[1], col[2]];
    const wT = 0.08;
    for (let k = 0; k < 3; k++) {
      const x0 = tx0 + k * L40, x1 = x0 + L40, xc = (x0 + x1) / 2;
      const ci = segCols[k] % T.containers.length;
      // Paired side hatches turn the old long tube into a route with regular escape/crossfire choices.
      const door0 = xc - 1.15, door1 = xc + 1.15, hatchH = 2.25;
      const panel = (a, b, z, faces) => {
        for (const [lo, hi] of [[a, Math.min(b, door0)], [Math.max(a, door1), b]]) {
          if (hi <= lo) continue;
          corrugatedWall(X((lo + hi) / 2), CH / 2, Z(z), hi - lo, CH, wT, R(0), faces,{u0:(lo-x0)/L40,u1:(hi-x0)/L40});
          solid(X((lo + hi) / 2), CH / 2, Z(z), hi - lo, CH, wT, 0, { mat: 'metal', tag: 'corridor-wall' });
        }
        const lo = Math.max(a, door0), hi = Math.min(b, door1);
        if (hi > lo) {
          corrugatedWall(X((lo + hi) / 2), (hatchH + CH) / 2, Z(z), hi - lo, CH - hatchH, wT, R(0), faces,{u0:(lo-x0)/L40,u1:(hi-x0)/L40,v0:hatchH/CH,v1:1});
          solid(X((lo + hi) / 2), (hatchH + CH) / 2, Z(z), hi - lo, CH - hatchH, wT, 0, { mat: 'metal', tag: 'corridor-header' });
        }
      };
      // 面向甲板的内墙
      panel(x0, x1, tz0 + wT / 2, { nz: `c${ci}s40`, pz: 'interior' });
      // 外墙：实墙 + 铁丝网窗
      const win = [x0 + 3.2, x0 + 8.4];
      let cur = x0;
      for (const wx of win) {
        const a = cur, b2 = wx;
        panel(a, b2, tz1 - wT / 2, { pz: `c${ci}s40`, nz: 'interior' });
        // 网窗 1.6m
        const f0 = wx, f1 = wx + 1.6;
        fence(X(f0), Z(tz1 - wT / 2), X(f1), Z(tz1 - wT / 2), 0.9, 2.2, 'railYellow', false);
        corrugatedWall(X((f0 + f1) / 2), 0.45, Z(tz1 - wT / 2), 1.6, 0.9, wT, R(0), { pz: `c${ci}s40`, nz: 'interior' },{u0:(f0-x0)/L40,u1:(f1-x0)/L40,v0:0,v1:.9/CH});
        corrugatedWall(X((f0 + f1) / 2), (2.2 + CH) / 2, Z(tz1 - wT / 2), 1.6, CH - 2.2, wT, R(0), { pz: `c${ci}s40`, nz: 'interior' },{u0:(f0-x0)/L40,u1:(f1-x0)/L40,v0:2.2/CH,v1:1});
        solid(X((f0 + f1) / 2), CH / 2, Z(tz1 - wT / 2), 1.6, CH, wT, 0, { mat: 'metal', bullet: 'pass', sight: false });
        cur = f1;
      }
      panel(cur, x1, tz1 - wT / 2, { pz: `c${ci}s40`, nz: 'interior' });
      // 顶板（二楼地面）与内顶
      box(X(xc), CH - 0.07, Z(tzc), L40, 0.14, CW + 0.001, R(0), { py: `c${ci}roof`, ny: 'interior' });
      solid(X(xc), CH - 0.07, Z(tzc), L40, 0.14, CW, 0, { mat: 'metal', surface: 'container' });
      // 角柱
      for (const px of [x0, x1]) for (const pz of [tz0, tz1]) box(X(px), CH / 2, Z(pz), 0.16, CH, 0.16, 0, 'darkSteel');
      // 管道内灯
      lamp(X(xc - 3), CH - 0.25, Z(tzc), k !== 1);
      lamp(X(xc + 3), CH - 0.25, Z(tzc), false);
      // 外侧管线
      for (const [lo, hi] of [[x0, door0], [door1, x1]]) {
        geom('darkSteel', cylG, X((lo + hi) / 2), 0.35, Z(tz1 - 0.3), 0, 0, Math.PI / 2, 0.16, hi - lo, 0.16);
        geom('red', cylG, X((lo + hi) / 2), 0.75, Z(tz1 - 0.28), 0, 0, Math.PI / 2, 0.08, hi - lo, 0.08);
        solid(X((lo + hi) / 2), 0.4, Z(tz1 - 0.3), hi - lo, 0.8, 0.36, 0, { mat: 'metal', bullet: 'pass' });
      }
      for (const pz of [tz0, tz1]) {
        for (const dx of [door0, door1]) box(X(dx), hatchH / 2, Z(pz), 0.09, hatchH, 0.12, 0, 'railYellow');
        box(X(xc), hatchH, Z(pz), 2.4, 0.09, 0.12, 0, 'railYellow');
      }
      navigationChecks.push({ name: `横舱门 ${s}:${k}`, x: X(xc), z: Z(tzc), y: 0 });
    }
    const tEnd = tx0 + 3 * L40; // ≈7.07
    // 入口处敞开并贴在箱壁上的箱门
    for (const [ex, dir] of [[tx0, 1], [tEnd, -1]]) {
      const ciD = segCols[dir > 0 ? 0 : 2] % T.containers.length;
      box(X(ex + dir * 0.62), CH / 2, Z(tz0 - 0.05), 1.2, CH - 0.12, 0.06, R(0), { nz: `c${ciD}door`, pz: `c${ciD}door` });
      box(X(ex + dir * 0.62), CH / 2, Z(tz1 + 0.05), 1.2, CH - 0.12, 0.06, R(0), { nz: `c${ciD}door`, pz: `c${ciD}door` });
    }
    // 管道内掩体
    crate(X(-18.5), Z(9.9), 0.8, 0.8, 0.8, 1, 0, 0);
    crate(X(-4.0), Z(9.95), 0.9, 1.0, 0.9, 5, 0, 0);
    // 管道尽头：20尺集装箱（可上）+ 40尺双层（挡住二楼）
    container(X(11.83), Z(tzc), YAW(0), 20, col[3]);
    container(X(21.05), Z(tzc), YAW(0), 40, col[4]);
    container(X(21.05), Z(tzc), YAW(0), 40, col[0] + 2, 1);
    // 二楼栏杆（外侧）与内侧局部栏杆
    railing(X(tx0), Z(11.8), X(14.86), Z(11.8), H2, 'railYellow', 1.1, true);
    railing(X(-24), Z(9.45), X(-16), Z(9.45), H2, 'railYellow', 1.1, true);
    railing(X(-8), Z(9.45), X(-2), Z(9.45), H2, 'railYellow', 1.1, true);
    // 管道出口外的箱子（可跳上二楼）
    for (let i = 0; i < 5; i++) crate(X(8.8 + 0.59 + i * 1.18), Z(8.85), 1.16, 0.9, 1.1, i % 2 ? 1 : 3, 0, 0);
    crate(X(11.5), Z(8.85), 1.2, 0.95, 1.2, 0, 0.9, 5);
    crate(X(11.3), Z(7.5), 1.6, 1.6, 1.6, 2, 0, -6);

    // ---- 主甲板障碍（半场）----
    container(X(-21.5), Z(-1.8), YAW(90), 20, col[1]);         // A
    container(X(-12.8), Z(0.9), YAW(90), 20, col[2]);          // B1
    container(X(-13.6), Z(5.15), YAW(0), 20, col[0]);          // B2
    container(X(-13.6), Z(5.15), YAW(0), 20, col[3] + 1, 1);   // B2 上层
    crate(X(-14.65), Z(2.3), 1.2, 1.8, 1.2, 4, 0, 0);          // 上 B1 的台阶
    crate(X(-15.8), Z(2.3), 1.0, 0.9, 1.0, 1, 0, 8);
    crate(X(-26.9), Z(0.4), 1.6, 1.6, 1.6, 4, 0, 0);           // 出生点门前掩体
    crate(X(-26.6), Z(2.1), 1.2, 1.2, 1.2, 5, 0, 15);
    crate(X(-6.4), Z(8.3), 1.4, 1.4, 1.4, s > 0 ? 0 : 2, 0, 4);
    barrel(X(-19.2), Z(-8.3), 'red'); barrel(X(-18.5), Z(-8.7), 'red'); barrel(X(-18.8), Z(-7.7), 'green');
    barrel(X(-9.6), Z(8.7), 'green'); barrel(X(-9.0), Z(8.95), 'red');
    // 甲板黄线（通道标线）
    for (const lz of [-7.2, 7.4]) box(X(-17), 0.004, Z(lz), 16, 0.001, 0.12, 0, { py: 'paintY' });
    decal('signs', X(-24.5), 0.006, Z(-6.5), 1.2, 1.2, s > 0 ? -Math.PI / 2 : Math.PI / 2, -Math.PI / 2, SIGN_UV.arrow);
  }

  // ---- 中路：V 形斜放集装箱 + 木箱 ----
  container(-1.1, -4.4, -39, 20, 2);
  container(0.9, 4.0, 33, 20, 6);
  crate(-6.9, 1.3, 1.6, 1.6, 1.6, 0, 0, 3);
  crate(-5.2, 1.4, 1.2, 1.2, 1.2, 2, 0, -8);
  crate(-6.9, 1.3, 1.0, 0.8, 1.0, 1, 1.6, 20);

  // ================== 新增侧舷：贯通维护舱、观察甲板和地面旁路 ==================
  // Inspired by the reference's yard / workshop / quay connections: every enclosed
  // room has two end doors and a lateral hatch, and every high route has two stairs.
  const routeChecks = [];
  for (const side of [-1, 1]) {
    const z = 15.7 * side, inner = 13.5 * side, outer = 17.9 * side;
    for (const x of [-21, 21]) {
      const length = 8, height = 3.15, thickness = 0.16, doorWidth = 2.4, doorH = 2.5;
      const wall = (cx, cy, cz, sx, sy, sz, key = 'bulkhead') => {
        box(cx, cy, cz, sx, sy, sz, 0, key);
        solid(cx, cy, cz, sx, sy, sz, 0, { mat: 'metal', tag: 'maintenance-room' });
      };
      // Outside wall; inside wall has a transverse shortcut to the container hatches.
      wall(x, height / 2, outer, length, height, thickness);
      for (const dx of [-1, 1]) wall(x + dx * (length + doorWidth) / 4, height / 2, inner,
        (length - doorWidth) / 2, height, thickness);
      wall(x, (doorH + height) / 2, inner, doorWidth, height - doorH, thickness);
      // Broad end doors keep the side route open in both directions.
      const width = Math.abs(outer - inner);
      for (const end of [-1, 1]) {
        for (const dz of [-1, 1]) wall(x + end * length / 2, height / 2, z + dz * (width + doorWidth) / 4,
          thickness, height, (width - doorWidth) / 2);
        wall(x + end * length / 2, (doorH + height) / 2, z, thickness, height - doorH, doorWidth);
        decal('signs', x + end * (length / 2 + 0.09), 2.78, z, 2.6, 0.28, end * Math.PI / 2, 0, SIGN_UV.hazard);
        lamp(x + end * 3.4, 2.78, z, false);
      }
      // A real roof collider is used by rain, lighting, bullets, and head clearance.
      box(x, height + 0.06, z, length + 0.2, 0.12, width + 0.2, 0, { py: 'darkSteel', ny: 'interior', px: 'darkSteel', nx: 'darkSteel', pz: 'darkSteel', nz: 'darkSteel' });
      solid(x, height + 0.06, z, length + 0.2, 0.12, width + 0.2, 0, { mat: 'metal', tag: 'maintenance-roof' });
      foot(x, z, length, width, 0, 0.28);
      // Equipment is offset from the centreline: cover without blocking the through route.
      crate(x - 1.7, z + side * 1.25, 1.35, 1.25, 0.8, 4);
      crate(x + 1.7, z - side * 1.25, 1.35, 0.95, 0.8, 1);
      for (const dx of [-2.6, 0, 2.6]) box(x + dx, 2.95, z, 1.1, 0.04, 0.12, 0, 'lamp');
      box(x, 2.4, outer - side * 0.15, 5.8, 0.1, 0.1, 0, 'red');
      decal('signs', x + 1.7, 1.6, inner - side * 0.09, 0.55, 0.55, side > 0 ? Math.PI : 0, 0, SIGN_UV.nosmoke);
      navigationChecks.push({ name: `维护舱 ${x}:${side}`, x, z, y: 0 });
      routeChecks.push({ name: `设备舱贯通 ${x}:${side}`, from: [x - 5, 0, z], to: [x + 5, 0, z] });
    }
    // Solid machinery plinth under the observation deck. The lower shortcut runs
    // beside it (z=12.7), so navigation never confuses two floors at one grid cell.
    const platformZ = side * 16.05, platformW = 3.6, platformL = 12;
    box(0, H2 / 2, platformZ, platformL, H2, platformW, 0,
      { py: 'grating', px: 'darkSteel', nx: 'darkSteel', pz: 'bulkhead', nz: 'bulkhead' });
    solid(0, H2 / 2, platformZ, platformL, H2, platformW, 0,
      { mat: 'metal', surface: 'grate', navSurface: true, tag: 'observation-platform' });
    foot(0, platformZ, platformL, platformW, 0, 0.4);
    for (const end of [-1, 1]) {
      const steps = 14, run = 6.5, tread = run / steps;
      for (let i = 0; i < steps; i++) {
        const height = (i + 1) * H2 / steps, xx = end * (12.5 - (i + 0.5) * tread);
        box(xx, height / 2, platformZ, tread + 0.002, height, platformW, 0,
          { py: 'grating', px: 'darkSteel', nx: 'darkSteel', pz: 'darkSteel', nz: 'darkSteel' });
        solid(xx, height / 2, platformZ, tread + 0.002, height, platformW, 0,
          { mat: 'metal', surface: 'grate', navSurface: true, tag: 'observation-stair' });
        box(xx + end * (tread / 2 - 0.025), height + 0.006, platformZ, 0.05, 0.014, platformW, 0, 'railYellow');
        for (const railZ of [platformZ - platformW / 2, platformZ + platformW / 2]) {
          solid(xx, height + 0.65, railZ, tread, 1.3, 0.07, 0, { mat: 'metal', bullet: 'pass', sight: false, tag: 'stair-rail' });
        }
      }
      for (const railZ of [platformZ - platformW / 2, platformZ + platformW / 2]) {
        rod('railYellow', end * 12.5, 1.1, railZ, end * 6, H2 + 1.1, railZ, 0.035);
        rod('railYellow', end * 12.5, 0.55, railZ, end * 6, H2 + 0.55, railZ, 0.025);
        for (let i = 0; i <= 5; i++) { const k = i / 5; rod('railYellow', end * (12.5 - k * 6.5), k * H2, railZ, end * (12.5 - k * 6.5), k * H2 + 1.1, railZ, 0.025); }
      }
      navigationChecks.push({ name: `平台梯脚 ${end}:${side}`, x: end * 13.2, z: platformZ, y: 0 });
    }
    railing(-6, platformZ + platformW / 2, 6, platformZ + platformW / 2, H2);
    railing(-6, platformZ - platformW / 2, 6, platformZ - platformW / 2, H2);
    // Two low machine boxes break a single uninterrupted firing line along the upper lane.
    for (const x of [-3.6, 3.6]) {
      box(x, H2 + 0.45, platformZ + side * 0.75, 1.5, 0.9, 0.8, 0, 'darkSteel');
      solid(x, H2 + 0.45, platformZ + side * 0.75, 1.5, 0.9, 0.8, 0, { mat: 'metal', tag: 'platform-cover' });
      box(x, H2 + 0.92, platformZ + side * 0.75, 1.56, 0.04, 0.86, 0, 'yellow');
    }
    navigationChecks.push({ name: side > 0 ? '右舷观察甲板' : '左舷观察甲板', x: 0, z: platformZ, y: H2 });
    navigationChecks.push({ name: `平台下侧旁路 ${side}`, x: 0, z: side * 12.8, y: 0 });
    routeChecks.push({ name: `双楼梯平台 ${side}`, from: [-13.2, 0, platformZ], via: [0, H2, platformZ], to: [13.2, 0, platformZ] });
    routeChecks.push({ name: `全长侧路 ${side}`, from: [-32, 0, side * 15.7], to: [32, 0, side * 15.7] });
    for (const x of [-33, 33]) {
      // Spawn-side screens prevent a direct end-to-end sightline through all four doors.
      crate(x, side * 12.6, 2, 1.25, 1.2, side > 0 ? 4 : 1);
      box(Math.sign(x) * 36.35, 1.75, side * 15.1, 0.2, 3.5, 6.1, 0, 'bulkhead');
      lifeRing(x, 0.85, side * 18.0, side > 0 ? 0 : Math.PI);
    }
    for (const x of [-29.7, -14.4, 14.4, 29.7]) {
      decal('signs', x, 0.008, side * 15.7, 1.3, 1.3, x < 0 ? -Math.PI / 2 : Math.PI / 2, -Math.PI / 2, SIGN_UV.arrow);
      box(x, 0.006, side * 13.0, 2.6, 0.006, 0.10, 0, { py: 'paintY' });
    }
  }

  // ================== 保卫者背后：集装箱墙与船头 ==================
  const stackCols = [0, 5, 4, 1, 2, 6, 3, 7];
  for (let tier = 0; tier < 3; tier++) for (let i = 0; i < 4; i++) {
    container(37.6, -9.09 + i * L20, 90, 20, stackCols[(i + tier * 3) % 8], tier, { collide: tier === 0 });
  }
  solid(37.6, 6, 0, CW, 12, 24.4, 0, { mat: 'metal' });
  // 更远处的堆场
  for (let row = 0; row < 3; row++) for (let bay = 0; bay < 8; bay++) {
    const h = 2 + ((row * 7 + bay * 3) % 3);
    for (let tier = 0; tier < h; tier++) container(41 + row * 7, -10.6 + bay * 3.03, 0, 20, (bay + row * 3 + tier * 5) % 8, tier, { collide: false, noEnds: tier < h - 1 && false });
  }
  // 前桅
  geom('white', cylG, 64, 8, 0, 0, 0, 0, 0.35, 16, 0.35);
  geom('white', cylG8, 64, 13, 0, 0, 0, Math.PI / 2, 0.08, 6, 0.08);
  geom('redLamp', sphG, 64, 16.3, 0, 0, 0, 0, 0.2, 0.2, 0.2);

  // ================== 上层建筑（潜伏者背后） ==================
  const sx0 = -56, sx1 = -36.7, sw = 11.2;
  for (let lvl = 0; lvl < 5; lvl++) {
    const y0 = lvl * 3, inset = lvl * 0.4;
    const x1 = sx1 - (lvl > 3 ? 1.5 : 0);
    const wz = sw - (lvl === 4 ? 0 : 0) + (lvl === 4 ? 3 : 0);
    box((sx0 + x1) / 2, y0 + 1.5, 0, x1 - sx0 - inset, 3, wz * 2, 0, { px: 'superWall', pz: 'superWall', nz: 'superWall', nx: 'superWall' }, [0, 0]);
    box((sx0 + x1) / 2, y0 + 3 - 0.08, 0, x1 - sx0 - inset + 0.6, 0.16, wz * 2 + 0.6, 0, 'white');
    if (lvl < 4) {
      // 每层前方走廊栏杆
      railing(x1 + 0.3, -wz, x1 + 0.3, wz, y0 + 3, 'railWhite', 1.0, false);
    }
  }
  box((sx0 + sx1) / 2, 15.1, 0, sx1 - sx0 - 1, 0.2, 29, 0, 'white');
  decal('signs', sx1 - 1.49, 13.3, 0, 12, 1.9, Math.PI / 2, 0, SIGN_UV.shipname);
  // 驾驶台窗户带（黑玻璃）
  box(sx1 - 1.52, 13.4, 0, 0.05, 1.3, 26, 0, 'black');
  // 烟囱
  const fx = -51;
  box(fx, 20, 0, 5, 10, 4.2, 0, { px: 'white', nx: 'white', pz: 'white', nz: 'white', py: 'black' });
  box(fx, 22.5, 0, 5.05, 1.6, 4.25, 0, { px: 'red', nx: 'red', pz: 'red', nz: 'red' });
  box(fx, 24.8, 0, 5.1, 0.6, 4.3, 0, 'black');
  const funnelTop = new THREE.Vector3(fx, 25.3, 0);
  // 雷达桅
  geom('white', cylG, -45, 18.5, 0, 0, 0, 0, 0.18, 7, 0.18);
  box(-45, 21.5, 0, 0.3, 0.3, 4, 0, 'white');
  const radar = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.18, 3.2), matDefs.white.mat);
  radar.position.set(-45, 22.4, 0); radar.castShadow = true; scene.add(radar);
  anim.push((dt) => { radar.rotation.y += dt * 1.6; });
  geom('redLamp', sphG, -45, 22.1, 1.9, 0, 0, 0, 0.12, 0.12, 0.12);
  geom('greenLamp', sphG, -45, 22.1, -1.9, 0, 0, 0, 0.12, 0.12, 0.12);
  // 救生艇（橙色）
  for (const sz of [-1, 1]) {
    const lb = new THREE.CapsuleGeometry(1.1, 5.2, 4, 12);
    geom('orange', lb, -46, 7.2, sz * 12.4, 0, 0, Math.PI / 2, 1, 1, 1);
    box(-46, 8.15, sz * 12.4, 6, 0.3, 1.6, 0, 'white');
    for (const dx of [-2.6, 2.6]) geom('white', cylG8, -46 + dx, 7.8, sz * 11.8, sz * 0.5, 0, 0, 0.08, 3, 0.08);
  }
  // 上层建筑前门
  for (const dz of [-6, 6]) box(sx1 + 0.02, 1.1, dz, 0.06, 2.2, 1.1, 0, 'darkSteel');

  // ================== 吊机 ==================
  function crane(px, pz, yawDeg, luff, jibLen, tipHook) {
    const yaw = yawDeg * Math.PI / 180;
    const g = new THREE.Group();
    g.position.set(px, 6, pz); g.rotation.y = yaw;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.6, 2.6), matDefs.yellow.mat); cab.position.set(-0.4, 1.3, 0);
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1, 1.8), matDefs.black.mat); win.position.set(1.21, 1.6, 0);
    const jibPivot = new THREE.Group(); jibPivot.position.set(0.8, 1.8, 0); jibPivot.rotation.z = luff;
    const jibGeo = new THREE.BoxGeometry(jibLen, 0.7, 0.9); jibGeo.translate(jibLen / 2, 0, 0);
    const jib = new THREE.Mesh(jibGeo, matDefs.yellow.mat);
    const jib2Geo = new THREE.BoxGeometry(jibLen * 0.98, 0.12, 1.3); jib2Geo.translate(jibLen / 2, 0.4, 0);
    const jib2 = new THREE.Mesh(jib2Geo, matDefs.yellow.mat);
    jibPivot.add(jib, jib2);
    g.add(cab, win, jibPivot);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(g);
    g.updateMatrixWorld(true);
    const tip = new THREE.Vector3(jibLen, 0, 0);
    jibPivot.localToWorld(tip);
    return tip;
  }
  const tipA = crane(-33, -9.6, -12, 0.36, 30, true);
  crane(33, 9.6, 168, 0.95, 22, false);
  // 吊着的集装箱（随风轻摆）
  const hang = new THREE.Group();
  const hc = new THREE.Mesh(new THREE.BoxGeometry(L20, CH, CW), [
    matDefs.c5door.mat, matDefs.c5door.mat, matDefs.c5roof.mat, matDefs.c5roof.mat, matDefs.c5s20.mat, matDefs.c5s20.mat]);
  hc.castShadow = true; hc.receiveShadow = true;
  const cableLen = tipA.y - 12;
  hc.position.y = -cableLen - CH / 2 - 0.4;
  const spreader = new THREE.Mesh(new THREE.BoxGeometry(L20 - 0.2, 0.25, CW - 0.2), matDefs.yellow.mat);
  spreader.position.y = -cableLen - 0.2;
  const cableGeo = new THREE.CylinderGeometry(0.03, 0.03, cableLen, 4); cableGeo.translate(0, -cableLen / 2, 0);
  for (const dx of [-0.25, 0.25]) { const cb = new THREE.Mesh(cableGeo, matDefs.black.mat); cb.position.x = dx; hang.add(cb); }
  hang.add(hc, spreader);
  hang.position.copy(tipA);
  scene.add(hang);
  anim.push((dt, t) => {
    hang.rotation.z = Math.sin(t * 0.55) * 0.018;
    hang.rotation.x = Math.sin(t * 0.4 + 1) * 0.012;
    hc.rotation.y = Math.sin(t * 0.21) * 0.1;
  });

  // ================== 船体 ==================
  buildHull(scene, matDefs.hull.mat);

  // ================== 生成合批网格 ==================
  const meshes = finishBatches();
  // 甲板 AO 烘焙
  const ao = opts.skipAO ? null : bakeDeckAO(footprints);
  matDefs.deck.mat.aoMap = ao; matDefs.deck.mat.aoMapIntensity = 1; matDefs.deck.mat.lightMap = null;
  matDefs.deck.mat.needsUpdate = true;
  matDefs.paintY.mat.aoMap = null;

  world.build();

  // ================== 出生点 ==================
  const spawns = { BL: [], GR: [] };
  for (let i = 0; i < 10; i++) {
    const zz = -6.6 + (i % 5) * 3.0, xx = -34.0 + Math.floor(i / 5) * 2.8;
    spawns.BL.push({ x: xx, z: zz, yaw: -Math.PI / 2 });
    spawns.GR.push({ x: -xx, z: -zz, yaw: Math.PI / 2 });
  }
  for (const x of [-34, -31.2]) for (const z of [-15.7, 15.7]) {
    spawns.BL.push({ x, z, yaw: -Math.PI / 2 });
    spawns.GR.push({ x: -x, z: -z, yaw: Math.PI / 2 });
  }

  const relayPoints = [
    { x: 0, y: 0, z: -6.8, label: '左舷货道' },
    { x: 0, y: H2, z: 16.05, label: '右舷观察甲板' },
    { x: -2.5, y: 0, z: 0, label: '中央甲板' },
    { x: 0, y: H2, z: -16.05, label: '左舷观察甲板' },
    { x: 0, y: 0, z: 6.8, label: '右舷货道' },
  ];

  return {
    spawns, lampSpots, funnelTop, meshes, materials: matDefs,
    bounds: { ...MAP_BOUNDS }, navBounds: { ...NAV_BOUNDS },
    spawnBounds: { BL: { maxX: -28.3 }, GR: { minX: 28.3 } },
    relayPoints, navigationChecks, routeChecks, lanes: [-16.05, -6.8, -0.4, 6.8, 16.05],
    update(dt, t) { for (const f of anim) f(dt, t); },
  };
}

// 甲板环境光遮蔽：把所有落地物体的投影模糊后作为 aoMap
function bakeDeckAO(fps) {
  const W = 2048, H = 1014; // 74m x 36.6m
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  const sx = W / 74, sz = H / 36.6;
  const draw = (blur, grow, alphaMul) => {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,1)'; ctx.shadowBlur = blur; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    for (const f of fps) {
      ctx.save();
      ctx.translate((f.cx + 37) * sx, (f.cz + 18.3) * sz);
      ctx.rotate(-f.yaw); // 画布 y 向下 = +Z
      ctx.fillStyle = `rgba(0,0,0,${f.dark * alphaMul})`;
      ctx.fillRect(-(f.sx / 2 + grow) * sx, -(f.sz / 2 + grow) * sz, (f.sx + grow * 2) * sx, (f.sz + grow * 2) * sz);
      ctx.restore();
    }
    ctx.restore();
  };
  draw(40, 0.1, 0.35);
  draw(12, 0.02, 0.45);
  // 管道内部较暗
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect((-29.5 + 37) * sx, (9.4 + 18.3) * sz, 36.6 * sx, 2.44 * sz);
  ctx.fillRect((29.5 - 36.6 + 37) * sx, (-11.84 + 18.3) * sz, 36.6 * sx, 2.44 * sz);
  const t = new THREE.CanvasTexture(c);
  t.channel = 1;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// 船体轮廓：t∈[0,1) 沿边界一周；右舷(0..0.35) 船头(0.35..0.5) 左舷(0.5..0.85) 船尾(0.85..1)
export function hullContour(t, sc, bowK) {
  const halfW = HULL_HALF_Z * sc;
  const xs = -66, xb0 = 58, xb1 = 58 + 28 * bowK;
  if (t < 0.35) { const k = t / 0.35; return [xs + (xb0 - xs) * k, halfW]; }
  if (t < 0.5) {
    const a = ((t - 0.35) / 0.15) * Math.PI;
    return [xb0 + (xb1 - xb0) * Math.sin(a) ** 0.8, halfW * Math.cos(a) * (1 - 0.1 * Math.sin(a))];
  }
  if (t < 0.85) { const k = (t - 0.5) / 0.35; return [xb0 + (xs - xb0) * k, -halfW]; }
  const a = ((t - 0.85) / 0.15) * Math.PI;
  return [xs - 3 * Math.sin(a) * sc, -halfW * Math.cos(a)];
}

// 程序生成船体：多层轮廓环
function buildHull(scene, mat) {
  const rings = [
    { y: 0.12, s: 1.0, bow: 1.0 }, { y: -0.4, s: 1.0, bow: 1.0 }, { y: -2.5, s: 0.995, bow: 0.97 },
    { y: -5, s: 0.985, bow: 0.93 }, { y: -7.5, s: 0.965, bow: 0.88 }, { y: -9.5, s: 0.93, bow: 0.82 },
    { y: -12, s: 0.85, bow: 0.74 },
  ];
  const N = 120;
  const contour = hullContour;
  const pos = [], uv = [], idx = [];
  const lens = [];
  for (let r = 0; r < rings.length; r++) {
    const R = rings[r];
    let acc = 0, prev = null;
    for (let i = 0; i <= N; i++) {
      const [x, z] = contour((i % N) / N, R.s, R.bow);
      if (prev) acc += Math.hypot(x - prev[0], z - prev[1]);
      prev = [x, z];
      pos.push(x, R.y, z);
      uv.push(acc / 16, (R.y + 12) / 13.5);
    }
    lens.push(acc);
  }
  const row = N + 1;
  for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < N; i++) {
    const a = r * row + i, b = a + 1, c = a + row, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  mat.side = THREE.DoubleSide;
  m.receiveShadow = true;
  scene.add(m);
  return m;
}
