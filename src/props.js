// Procedural prop builders shared by gameplay batches and the isolated gallery.
// Geometry callbacks retain the map's material batching and collision policy.
import * as THREE from 'three';
import {CONTAINER_PROFILE,createCorrugatedPanel,createCornerCasting} from './prop-geometry.js';
const CH=2.59,CW=2.44,L20=6.06,L40=12.19;
// A small CPU template; the map batch copies its vertices, so it never owns GPU buffers.
const castingGeometry=createCornerCasting();
const hardwareCylinder=new THREE.CylinderGeometry(1,1,1,6,1,true);
export function createPropBuilders({T,box,solid,foot,geom,rod,rnd,batch,matDefs,lampSpots,cylG,cylG8,sphG,torG,geometryDetail=true}) {
  function corrugatedWall(cx,cy,cz,sx,sy,sz,yaw,faces,uvBounds={}) {
    if(!geometryDetail){box(cx,cy,cz,sx,sy,sz,yaw,faces);return;}
    const remaining={...faces};
    for(const face of ['pz','nz']){
      const key=faces[face];if(!/^c\d+s(?:20|40)$/.test(key||''))continue;
      delete remaining[face];
      const sign=face==='pz'?1:-1,{u0=0,u1=1,v0=0,v1=1}=uvBounds;
      const panel=createCorrugatedPanel(sx,sy,{long:key.endsWith('40'),u0:sign>0?u0:1-u1,u1:sign>0?u1:1-u0,v0,v1});
      const dz=sign*(sz/2-CONTAINER_PROFILE.inset);
      geom(matDefs[key+'Detail']?key+'Detail':key,panel,cx+Math.sin(yaw)*dz,cy,cz+Math.cos(yaw)*dz,0,yaw+(sign<0?Math.PI:0));
      panel.dispose();
    }
    box(cx,cy,cz,sx,sy,sz,yaw,remaining);
  }
  // 集装箱：yaw 为度，level 为层数
  function container(x, z, yawDeg, len, colorIdx, level = 0, o = {}) {
    const L = len === 40 ? L40 : L20;
    const yaw = yawDeg * Math.PI / 180;
    const cy = level * CH + CH / 2;
    const ci = colorIdx % T.containers.length;
    const side = `c${ci}${len === 40 ? 's40' : 's20'}`;
    const detailed=geometryDetail&&o.collide!==false;
    const shell={
      px: o.noEnds ? null : `c${ci}door`, nx: o.noEnds ? null : `c${ci}door`,
      py: o.noTop ? null : `c${ci}roof`, ny: level > 0 ? null : null,
      pz: side, nz: side,
    };
    if(detailed){
      // Cut the sheet away from the eight fittings: a painted backing plane
      // immediately behind their apertures would turn real holes into fake decals.
      for(const [a,b,low,high]of[[-L/2+.178,L/2-.178,0,CH],[-L/2,-L/2+.178,.122,CH-.122],[L/2-.178,L/2,.122,CH-.122]]){
        const mid=(a+b)/2;
        corrugatedWall(x+Math.cos(yaw)*mid,level*CH+(low+high)/2,z-Math.sin(yaw)*mid,b-a,high-low,CW,yaw,{pz:side,nz:side},{u0:a/L+.5,u1:b/L+.5,v0:low/CH,v1:high/CH});
      }
      box(x,cy,z,L,CH-.244,CW,yaw,{px:shell.px,nx:shell.nx});
      if(shell.py){
        // The roof ends at each end rail, with notches around corner apertures.
        // Preserve the original full-sheet UV instead of squeezing it into the inset.
        const roof=(a,b,lo,hi)=>{
          const point=(lx,lz)=>[x+Math.cos(yaw)*lx+Math.sin(yaw)*lz,level*CH+CH,z-Math.sin(yaw)*lx+Math.cos(yaw)*lz];
          batch(shell.py).quad(point(a,hi),point(b,hi),point(b,lo),point(a,lo),[0,1,0],[a/L+.5,.5-hi/CW,b/L+.5,.5-hi/CW,b/L+.5,.5-lo/CW,a/L+.5,.5-lo/CW]);
        };
        roof(-L/2+.178,L/2-.178,-CW/2+.07,CW/2-.07);
        roof(-L/2+.09,-L/2+.178,-CW/2+.17,CW/2-.17);
        roof(L/2-.178,L/2-.09,-CW/2+.17,CW/2-.17);
      }
    }else box(x,cy,z,L,CH,CW,yaw,shell);
    // Structural corners and door locking rods catch grazing light at close range.
    const local = (lx, ly, lz, sx, sy, sz, key) => box(x + Math.cos(yaw)*lx + Math.sin(yaw)*lz, level*CH + ly, z - Math.sin(yaw)*lx + Math.cos(yaw)*lz, sx, sy, sz, yaw, key);
    for (const a of [-1,1]) for (const b of [-1,1]) {
      local(a*(L/2-.055), CH/2, b*(CW/2-.035), .11, CH-.24, .065, 'darkSteel');
      for(const top of[false,true]){
        const h=top?CH-.061:.061;
        if(detailed){
          const lx=a*(L/2-.09),lz=b*(CW/2-.09),yb=top?b:-b;
          const turn=a===1?(yb===1?0:Math.PI/2):(yb===1?-Math.PI/2:Math.PI);
          // Proper rotations keep triangle winding correct at all eight corners.
          const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(top?0:Math.PI,turn,0));
          q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw));
          const e=new THREE.Euler().setFromQuaternion(q);
          geom('darkSteel',castingGeometry,x+Math.cos(yaw)*lx+Math.sin(yaw)*lz,level*CH+h,z-Math.sin(yaw)*lx+Math.cos(yaw)*lz,e.x,e.y,e.z);
        }else local(a*(L/2-.06),h,b*(CW/2-.035),.15,.12,.15,'steel');
      }
    }
    if(detailed){
      for(const b of[-1,1])for(const h of[.09,CH-.09])local(0,h,b*(CW/2-.035),L-.356,.18,.07,'darkSteel');
      for(const a of[-1,1])for(const h of[.061,CH-.061])local(a*(L/2-.045),h,0,.09,.122,CW-.356,'darkSteel');
    }
    if(!o.noEnds)for(const a of[-1,1]){
      if(!detailed){for(const b of[-.58,.58])local(a*(L/2+.024),CH/2,b,.036,CH-.28,.035,'steel');continue;}
      const cylinder=(lx,ly,lz,r,h,key='steel')=>geom(key,hardwareCylinder,x+Math.cos(yaw)*lx+Math.sin(yaw)*lz,level*CH+ly,z-Math.sin(yaw)*lx+Math.cos(yaw)*lz,0,yaw,0,r,h,r);
      const clampFaces={px:a>0?'darkSteel':null,nx:a<0?'darkSteel':null,py:'darkSteel',ny:'darkSteel',pz:'darkSteel',nz:'darkSteel'};
      // Four round locking bars coincide with the door paint's 14/36/64/86% lines.
      for(const u of[.14,.36,.64,.86]){
        const bz=(u-.5)*CW,rx=a*(L/2+.025),hy=CH*.45,dir=bz<0?1:-1;
        cylinder(rx,CH/2,bz,.016,CH-.18);
        for(const h of[.25,CH*.3,CH*.75,CH-.25])local(a*(L/2+.012),h,bz,.038,.043,.085,clampFaces);
        local(a*(L/2+.046),hy,bz+dir*.065,.018,.032,.17,'steel');
        local(a*(L/2+.025),hy,bz+dir*.14,.04,.075,.045,'darkSteel');
      }
      for(const b of[-1,1])for(const h of[.38,1.02,1.66,2.28]){
        local(a*(L/2+.008),h,b*(CW/2-.15),.026,.065,.21,'darkSteel');
        cylinder(a*(L/2+.025),h,b*(CW/2-.075),.019,.095);
      }
      // A physical gasket makes the meeting edge of the two leaves readable.
      local(a*(L/2+.005),CH/2,0,.012,CH-.25,.014,'black');
    }
    if (o.collide !== false) solid(x, cy, z, L, CH, CW, yaw, { mat: 'metal', surface: 'container', tag: 'container' });
    if (level === 0) foot(x, z, L, CW, yaw);
  }
  function crate(x, z, sx, sy, sz, idx, y = 0, yawDeg = 0) {
    const yaw = yawDeg * Math.PI / 180;
    box(x, y + sy / 2, z, sx, sy, sz, yaw, `crate${idx}`);
    const wood = T.crates[idx].kind === 'wood';
    solid(x, y + sy / 2, z, sx, sy, sz, yaw, { mat: wood ? 'wood' : 'metal', bullet: wood ? 'pen' : 'block', surface: wood ? 'wood' : 'metal' });
    if (y < 0.05) foot(x, z, sx, sz, yaw, 0.45);
  }
  function barrel(x, z, colorKey = 'red', y = 0) {
    geom(colorKey, cylG, x, y + 0.45, z, 0, rnd() * 6, 0, 0.3, 0.9, 0.3);
    geom('black', cylG, x, y + 0.9, z, 0, 0, 0, 0.29, 0.02, 0.29);
    for (const hy of [0.25, 0.65]) geom('darkSteel', cylG, x, y + hy, z, 0, 0, 0, 0.305, 0.03, 0.305);
    for (const hy of [.025,.875]) geom('darkSteel', cylG, x,y+hy,z,0,0,0,.308,.025,.308);
    geom('steel', cylG8, x+.13,y+.918,z,0,0,0,.038,.018,.038);
    solid(x, y + 0.45, z, 0.56, 0.9, 0.56, 0, { mat: 'metal', bullet: 'pen' });
    foot(x, z, 0.6, 0.6, 0, 0.4);
  }
  // 栏杆：从 (x0,z0) 到 (x1,z1)，底部高度 y
  function railing(x0, z0, x1, z1, y = 0, key = 'railYellow', h = 1.1, collide = true) {
    const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
    const yaw = Math.atan2(-dz, dx);
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    const n = Math.max(1, Math.round(L / 1.5));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      geom(key, cylG8, x0 + dx * t, y + h / 2, z0 + dz * t, 0, 0, 0, 0.03, h, 0.03);
    }
    for (const hh of [h, h * 0.5, 0.08]) rod(key, x0, y + hh, z0, x1, y + hh, z1, hh === 0.08 ? 0.02 : 0.028);
    if (collide) solid(mx, y + 0.8, mz, L, 1.6, 0.1, yaw, { bullet: 'pass', sight: false, mat: 'metal' });
  }
  // 铁丝网面板
  function fence(x0, z0, x1, z1, y0, y1, frameKey = 'railYellow', collide = true) {
    const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz), yaw = Math.atan2(-dz, dx);
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, h = y1 - y0;
    box(mx, (y0 + y1) / 2, mz, L, h, 0.001, yaw, { pz: 'fence' });
    geom(frameKey, cylG8, x0, (y0 + y1) / 2, z0, 0, 0, 0, 0.04, h, 0.04);
    geom(frameKey, cylG8, x1, (y0 + y1) / 2, z1, 0, 0, 0, 0.04, h, 0.04);
    rod(frameKey, x0, y1, z0, x1, y1, z1, 0.035);
    rod(frameKey, x0, y0 + 0.02, z0, x1, y0 + 0.02, z1, 0.035);
    if (collide) solid(mx, (y0 + y1) / 2, mz, L, h, 0.08, yaw, { bullet: 'pass', sight: false, mat: 'mesh' });
  }
  function lamp(x, y, z, pointLight = false) {
    geom('lamp', sphG, x, y, z, 0, 0, 0, 0.09, 0.09, 0.09);
    geom('darkSteel', cylG8, x, y + 0.1, z, 0, 0, 0, 0.12, 0.05, 0.12);
    if (pointLight) lampSpots.push(new THREE.Vector3(x, y - 0.15, z));
  }
  function lifeRing(x, y, z, yaw) {
    geom('orange', torG, x, y, z, 0, yaw, 0);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      geom('white', cylG8, x + Math.cos(yaw) * Math.cos(a) * 0.32, y + Math.sin(a) * 0.32, z - Math.sin(yaw) * Math.cos(a) * 0.32, 0, yaw, a + Math.PI / 2, 0.075, 0.12, 0.075);
    }
  }


return {container,corrugatedWall,crate,barrel,railing,fence,lamp,lifeRing};
}
