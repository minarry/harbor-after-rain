// Structural geometry is independent of paint textures and gameplay collision.
// Each sheet has four flat facets per rib; no height subdivisions are needed.
import * as THREE from 'three';

export const CONTAINER_PROFILE = Object.freeze({ depth: .036, inset: .012, rail: .07, ribs20: 22, ribs40: 44 });

function bufferBuilder() {
  const p=[], n=[], uv=[], idx=[];
  function quad(a,b,c,d,tex=[[0,0],[1,0],[1,1],[0,1]]) {
    const ab=new THREE.Vector3().subVectors(new THREE.Vector3(...b),new THREE.Vector3(...a));
    const ac=new THREE.Vector3().subVectors(new THREE.Vector3(...c),new THREE.Vector3(...a));
    const normal=ab.cross(ac).normalize(), start=p.length/3;
    for(let i=0;i<4;i++){p.push(...[a,b,c,d][i]);n.push(normal.x,normal.y,normal.z);uv.push(...tex[i]);}
    idx.push(start,start+1,start+2,start,start+2,start+3);
  }
  function finish() {
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
    g.setAttribute('normal',new THREE.Float32BufferAttribute(n,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);
    g.computeBoundingBox();g.computeBoundingSphere();return g;
  }
  return {quad,finish};
}

function profileAt(u, ribs, post) {
  if(u<=post||u>=1-post)return 0;
  const t=(u-post)/(1-2*post)*ribs, f=t-Math.floor(t);
  const h=f<.15?f/.15:f<.45?1:f<.6?1-(f-.45)/.15:0;
  return (h-1)*CONTAINER_PROFILE.depth;
}

/** A front-facing (+Z) sheet, cropped in the original whole-container UV space.
 * UV cropping keeps rib phase and labels continuous across windows and hatches.
 * Outer posts/rails are flat. All deformation is inward from the old wall plane.
 */
export function createCorrugatedPanel(width,height,{long=false,u0=0,u1=1,v0=0,v1=1}={}) {
  const ribs=long?CONTAINER_PROFILE.ribs40:CONTAINER_PROFILE.ribs20, post=long?.015:.03;
  const {quad,finish}=bufferBuilder(), xs=[u0,u1], ys=[v0,v1];
  for(const u of[post,1-post])if(u>u0+1e-8&&u<u1-1e-8)xs.push(u);
  for(let i=0;i<ribs;i++)for(const f of[0,.15,.45,.6]){
    const u=post+(i+f)/ribs*(1-2*post);if(u>u0+1e-8&&u<u1-1e-8)xs.push(u);
  }
  for(const v of[CONTAINER_PROFILE.rail,1-CONTAINER_PROFILE.rail])if(v>v0+1e-8&&v<v1-1e-8)ys.push(v);
  xs.sort((a,b)=>a-b);ys.sort((a,b)=>a-b);
  const at=(u,v,z)=>[(u-u0)/(u1-u0)*width-width/2,(v-v0)/(v1-v0)*height-height/2,z];
  for(let y=0;y<ys.length-1;y++){
    const lo=ys[y],hi=ys[y+1];
    const flat=(lo+hi)/2<CONTAINER_PROFILE.rail||(lo+hi)/2>1-CONTAINER_PROFILE.rail;
    const spans=flat?[u0,u1]:xs;
    for(let i=0;i<spans.length-1;i++){
    const a=spans[i],b=spans[i+1];
    if(b-a<1e-9)continue;
    // Frames occupy complete flat strips; the sheet terminates underneath them.
    const za=flat?0:profileAt(a,ribs,post),zb=flat?0:profileAt(b,ribs,post);
    quad(at(a,lo,za),at(b,lo,zb),at(b,hi,zb),at(a,hi,za),[[a,lo],[b,lo],[b,hi],[a,hi]]);
    }
  }
  const g=finish();g.userData.structuralProfile={depth:CONTAINER_PROFILE.depth,ribs,uv:[u0,v0,u1,v1]};return g;
}

/** Cast corner fitting with three real apertures and an enclosed wall cavity.
 * Positive X/Z/Y faces are exposed; callers rotate/mirror it toward the corner.
 * Rectangular slots are sufficient at player distance and bound the cost to 84 triangles.
 */
export function createCornerCasting() {
  const {quad,finish}=bufferBuilder(),half=[.089,.061,.081],wall=.014;
  const faces=[
    {n:[1,0,0],u:[0,0,-1],v:[0,1,0],w:.162,h:.122,hole:[.064,.046]},
    {n:[0,1,0],u:[1,0,0],v:[0,0,-1],w:.178,h:.162,hole:[.104,.058]},
    {n:[0,0,1],u:[1,0,0],v:[0,1,0],w:.178,h:.122,hole:[.078,.046]},
  ];
  for(const f of faces) {
    const dist=f.n.reduce((s,n,i)=>s+Math.abs(n)*half[i],0);
    const pt=(x,y,d)=>f.n.map((n,i)=>n*d+f.u[i]*x+f.v[i]*y);
    const outer=[[-f.w/2,-f.h/2],[f.w/2,-f.h/2],[f.w/2,f.h/2],[-f.w/2,f.h/2]];
    const inner=[[-f.hole[0]/2,-f.hole[1]/2],[f.hole[0]/2,-f.hole[1]/2],[f.hole[0]/2,f.hole[1]/2],[-f.hole[0]/2,f.hole[1]/2]];
    for(let i=0;i<4;i++){
      const j=(i+1)%4,o=outer[i],p=outer[j],a=inner[i],b=inner[j];
      quad(pt(...o,dist),pt(...p,dist),pt(...b,dist),pt(...a,dist));
      quad(pt(...p,dist-wall),pt(...o,dist-wall),pt(...a,dist-wall),pt(...b,dist-wall));
      quad(pt(...a,dist),pt(...b,dist),pt(...b,dist-wall),pt(...a,dist-wall));
    }
    // The opposite side closes the casting; visible holes lead into its volume.
    quad(...[...outer].reverse().map(p=>pt(...p,-dist)));
    quad(...outer.map(p=>pt(p[0],p[1],-dist+wall)));
  }
  const g=finish();g.userData.apertures=3;g.userData.wallThickness=wall;return g;
}
