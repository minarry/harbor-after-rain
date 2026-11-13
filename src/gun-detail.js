// Small, material-batched weapon parts. Model coordinates: forward -Z, up +Y.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const WEAPON_SIGHTS = {
  m4a1: { y: .145, rear: -.075, front: -.125, z: -.265, kind: 'reflex' },
  ak47: { y: .104, rear: -.15, front: -.55, z: -.29, kind: 'iron' },
  mp5: { y: .107, rear: .015, front: -.38, z: -.28, kind: 'iron' },
  deagle: { y: .101, rear: .025, front: -.19, z: -.35, kind: 'iron' },
  awm: { y: .118, rear: .13, front: -.296, z: -.36, kind: 'scope' },
};
const TAU = Math.PI * 2;
const box = (w,h,d,r=.001) => new RoundedBoxGeometry(w,h,d,1,Math.min(r,w*.24,h*.24,d*.24));
const cyl = (r,l,n=12) => new THREE.CylinderGeometry(r,r,l,n).rotateX(Math.PI/2);
const put=(g,geo,mat,x,y,z,rx=0,ry=0,rz=0,name='')=>{const o=new THREE.Mesh(geo,mat);o.position.set(x,y,z);o.rotation.set(rx,ry,rz);o.name=name;g.add(o);return o;};
const socket=(g,name,p)=>{const a=new THREE.Object3D();a.name=name;a.position.set(...p);g.add(a);return a;};
function ringTube(outer,inner,length){
  const shape=new THREE.Shape();shape.absarc(0,0,outer,0,TAU,false);
  const hole=new THREE.Path();hole.absarc(0,0,inner,0,TAU,true);shape.holes.push(hole);
  return new THREE.ExtrudeGeometry(shape,{depth:length,bevelEnabled:false,curveSegments:8}).translate(0,0,-length/2);
}
// Four real walls leave an open throat. There is no plate across the underside.
function magazineWell(g,material,centre,innerWidth,innerDepth,bottom,top,wall=.004){
  const h=top-bottom,y=(bottom+top)/2,[x,z]=centre;
  for(const sign of[-1,1]){
    put(g,box(wall,h,innerDepth+wall*2,.0008),material,x+sign*(innerWidth+wall)/2,y,z);
    put(g,box(innerWidth,h,wall,.0008),material,x,y,z+sign*(innerDepth+wall)/2);
  }
}
export function pistolGripShell(){
  const rounded=(path,cx,cy,w,h,r)=>{
    const x=cx-w/2,y=cy-h/2;
    path.moveTo(x+r,y);path.lineTo(x+w-r,y);path.quadraticCurveTo(x+w,y,x+w,y+r);
    path.lineTo(x+w,y+h-r);path.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    path.lineTo(x+r,y+h);path.quadraticCurveTo(x,y+h,x,y+h-r);
    path.lineTo(x,y+r);path.quadraticCurveTo(x,y,x+r,y);path.closePath();
  };
  const shape=new THREE.Shape(),hole=new THREE.Path();
  rounded(shape,0,0,.034,.055,.006);
  // The magazine axis is forward of the thick backstrap, rather than centred
  // inside the original solid rubber block.
  rounded(hole,0,-.007235,.024,.036,.0015);shape.holes.push(hole);
  return new THREE.ExtrudeGeometry(shape,{depth:.115,bevelEnabled:false,curveSegments:3})
    .translate(0,0,-.0575).rotateX(Math.PI/2);
}

function magazineMount(g,id){
  const mag=g.getObjectByName('mag');if(!mag)return;
  const specs={
    m4a1:{seatDepth:.034,clearance:.046,travel:.18,gripPoint:[0,-.09,.008],headPoint:[0,.015,.002],mouth:[0,-.0555,-.075],innerSize:[.033,.061]},
    ak47:{seatDepth:.032,clearance:.050,travel:.19,gripPoint:[0,-.10,.008],headPoint:[0,.007,-.032],mouth:[0,-.020,-.10],innerSize:[.033,.072],rockAngle:.22,rockPivot:[0,.004,-.032]},
    mp5:{seatDepth:.030,clearance:.045,travel:.18,gripPoint:[0,-.085,.008],headPoint:[0,.002,0],mouth:[0,-.028,-.13],innerSize:[.029,.056]},
    awm:{seatDepth:.017,clearance:.030,travel:.15,gripPoint:[0,-.035,.008],headPoint:[0,0,0],mouth:[0,-.052,-.07],innerSize:[.036,.087]},
    deagle:{seatDepth:.108023,clearance:.115,travel:.20,gripPoint:[0,-.055,.008],headPoint:[0,.042,0],mouth:[0,-.094132,.004304],innerSize:[.024,.036],pullAxis:[0,-Math.cos(.24),-Math.sin(.24)]},
  };
  const spec=specs[id];if(!spec)return;
  mag.userData.reload={pullAxis:[0,-1,0],...spec};
  const mouth=g.getObjectByName('magwell');if(mouth)mouth.position.fromArray(spec.mouth);
}
let marks=null;
function markingMaterial() {
  if(marks)return marks;
  const c=document.createElement('canvas');c.width=1024;c.height=256;
  const x=c.getContext('2d');x.clearRect(0,0,1024,256);
  x.fillStyle='#c6c8bf';x.font='600 33px monospace';x.fillText('HARBOR // FIELD ARMORY',26,46);
  x.font='24px monospace';x.fillText('5.56 × 45    MOD. 04    SELECT FIRE',26,84);
  x.font='17px monospace';x.fillText('SER. 08–2716     SERVICE / ALL WEATHER',26,115);
  x.fillStyle='#dfb176';x.fillRect(28,148,80,6);x.font='19px monospace';x.fillText('SAFE    SEMI    AUTO',131,163);
  x.fillStyle='#adb2ab';for(let i=0;i<42;i++)x.fillRect(710+i*5,145,2+(i%3),40+(i%4)*3);
  x.font='15px monospace';x.fillText('PORT AUTHORITY / 07',26,224);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;
  marks=new THREE.MeshStandardMaterial({map:t,color:0xffffff,roughness:.7,metalness:.12,transparent:true,alphaTest:.1,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1});
  marks.name='weapon-markings';return marks;
}
function label(g,x,y,z,w=.13,h=.033,side=1){return put(g,new THREE.PlaneGeometry(w,h),markingMaterial(),x,y,z,0,side*Math.PI/2,0);}
function screw(g,m,x,y,z,side=1,r=.0023){
  put(g,cyl(r,.002,8).rotateY(Math.PI/2),m.steel,x,y,z);
  put(g,box(.0025,.00065,r*1.2,.0001),m.black,x+side*.0012,y,z,0,0,.5);
}
function slotPanel(g,m,x,y,z,len=.23){
  const sh=new THREE.Shape();sh.moveTo(-len/2,-.017);sh.lineTo(len/2,-.017);sh.lineTo(len/2,.017);sh.lineTo(-len/2,.017);sh.closePath();
  for(let i=0;i<5;i++){
    const u=-len*.38+i*len*.19, h=new THREE.Path();
    h.moveTo(u-.012,-.004);h.lineTo(u+.012,-.004);h.absarc(u+.012,0,.004,-Math.PI/2,Math.PI/2,false);h.lineTo(u-.012,.004);h.absarc(u-.012,0,.004,Math.PI/2,Math.PI*1.5,false);sh.holes.push(h);
  }
  const geo=new THREE.ExtrudeGeometry(sh,{depth:.0026,bevelEnabled:true,bevelThickness:.00035,bevelSize:.00035,bevelSegments:1,curveSegments:4}).rotateY(Math.PI/2);
  put(g,geo,m.metal,x,y,z);
}
function bore(g,m,position,r=.009){
  const [x,y,z]=position;
  put(g,new THREE.TorusGeometry(r*.76,r*.20,6,16),m.steel,x,y,z+.0002);
  put(g,new THREE.CylinderGeometry(r*.56,r*.56,.024,14,1,true).rotateX(Math.PI/2),m.black,x,y,z+.011);
  // Recessed darkness, rather than a painted disk flush with the muzzle.
  put(g,new THREE.CircleGeometry(r*.55,14),m.rubber,x,y,z+.024,0,Math.PI,0);
}
function receiverShell(){
  // A milled opening has an inner wall and changes silhouette during bolt travel.
  // This replaces the old solid rounded block plus a dark rectangle on its side.
  const s=new THREE.Shape();
  for(const [i,p]of[[-.102,-.0205],[.102,-.0205],[.105,-.0175],[.105,.0175],[.102,.0205],[-.102,.0205],[-.105,.0175],[-.105,-.0175]].entries())i?s.lineTo(...p):s.moveTo(...p);
  s.closePath();
  const h=new THREE.Path();h.moveTo(-.031,-.006);h.lineTo(-.031,.010);h.lineTo(.033,.010);h.lineTo(.033,-.006);h.closePath();s.holes.push(h);
  return new THREE.ExtrudeGeometry(s,{depth:.044,bevelEnabled:false,curveSegments:1}).translate(0,0,-.022).rotateY(Math.PI/2);
}
export function buildDetailedM4(m){
  const g=new THREE.Group();
  put(g,receiverShell(),m.black,0,.058,-.025,0,0,0,'receiver-shell');
  put(g,new THREE.BoxGeometry(.003,.036,.204),m.black,-.020,.058,-.025);
  put(g,box(.04,.050,.122,.004),m.metal,0,.015,.006);
  put(g,box(.041,.021,.067,.002),m.black,0,-.006,-.075);
  // The lower housing rises into the upper receiver along all four sides.
  // The former 3.5 mm upper/lower slit and hanging front magwell are gone.
  for(const x of [-.019,.019])put(g,box(.005,.0995,.066),m.black,x,-.00575,-.075);
  put(g,box(.04,.0995,.005),m.black,0,-.00575,-.107);
  put(g,box(.04,.0995,.005),m.black,0,-.00575,-.043);
  put(g,box(.029,.094,.038,.006),m.rubber,0,-.053,.035,.3);
  // Grip ribs follow the grip's local -Y axis. Moving them toward +Z as they
  // descend exposes long floating plates behind the hand during a reload.
  for(let i=0;i<7;i++){
    const y=.034-i*.011;
    put(g,box(.030,.002,.039,.0006),m.black,0,-.053+y*Math.cos(.3),.035+y*Math.sin(.3),.3);
  }
  put(g,box(.008,.007,.065),m.metal,0,-.026,-.005);
  put(g,box(.008,.026,.007),m.metal,0,-.017,-.036);
  put(g,box(.006,.017,.007,.002),m.steel,0,-.002,-.009,-.3);
  // Floating railed handguard with real M-LOK apertures and a visible inner barrel.
  put(g,ringTube(.023,.009,.040),m.metal,0,.051,-.145,0,0,0,'barrel-nut');
  put(g,cyl(.008,.48,16),m.metal,0,.051,-.373);
  slotPanel(g,m,-.026,.048,-.28);slotPanel(g,m,.0234,.048,-.28);
  put(g,box(.05,.005,.24),m.black,0,.031,-.28);
  put(g,box(.037,.006,.24),m.black,0,.068,-.28,0,0,0,'handguard-top');
  // The rail teeth share a continuous extrusion seated into the handguard and receiver.
  put(g,new THREE.BoxGeometry(.024,.014,.46),m.metal,0,.077,-.175,0,0,0,'rail-spine');
  for(let i=0;i<27;i++)put(g,box(.027,.0045,.007,.0006),m.metal,0,.084,-.397+i*.017,0,0,0,'rail-tooth');
  for(const z of [-.165,-.395])put(g,cyl(.028,.008,12),m.metal,0,.05,z);
  put(g,cyl(.013,.047,16),m.metal,0,.051,-.604);
  for(let i=0;i<6;i++){const a=i*TAU/6;put(g,box(.004,.004,.028),m.black,Math.cos(a)*.012,.051+Math.sin(a)*.012,-.606,0,0,a);}
  // Buffer tube, adjustable stock, cheek piece and a textured rubber butt plate.
  put(g,cyl(.015,.22,16),m.metal,0,.05,.175);
  put(g,box(.043,.043,.115,.008),m.black,0,.041,.219);
  put(g,box(.04,.067,.07,.006),m.black,0,.011,.268,-.12);
  put(g,box(.044,.091,.012,.004),m.rubber,0,.014,.304);
  for(let i=0;i<8;i++)put(g,box(.041,.003,.002),m.black,0,-.02+i*.009,.311);
  put(g,box(.027,.016,.07,.005),m.rubber,0,.069,.211);
  // Seat the latch into the stock underside; the old 3 cm air gap made this
  // loose steel piece appear to float on the exposed wrist during reloads.
  put(g,box(.013,.01,.035),m.steel,0,.017,.185,-.14,0,0,'stock-latch');
  // Ejection-port recess, carrier and charging handle are separate moving parts.
  put(g,new THREE.BoxGeometry(.001,.018,.068),m.rubber,-.017,.060,-.026);
  put(g,box(.003,.012,.054),m.steel,.018,.061,-.026,0,0,0,'carrier');
  put(g,box(.003,.009,.065),m.black,.024,.045,-.026,0,0,-.45);
  put(g,box(.035,.008,.025),m.metal,0,.078,.078,0,0,0,'bolt');
  put(g,box(.009,.022,.015),m.black,.027,.039,.028,.5);
  put(g,cyl(.005,.006,10).rotateY(Math.PI/2),m.steel,-.025,.02,.006);
  put(g,box(.003,.012,.021),m.metal,-.027,.019,-.003,0,0,-.65);
  for(const side of [-1,1])for(const [y,z]of[[.021,.041],[.015,-.042],[.058,.048]])screw(g,m,side*.023,y,z,side);
  // Open reflex housing; the reticle and sight anchors share the exact same axis.
  put(g,new THREE.BoxGeometry(.034,.008,.05),m.metal,0,.087,-.096,0,0,0,'optic-clamp');
  put(g,box(.031,.013,.064),m.metal,0,.096,-.096,0,0,0,'optic-base');
  put(g,new THREE.BoxGeometry(.028,.009,.018),m.metal,0,.106,-.096,0,0,0,'optic-riser');
  for(const side of [-1,1])put(g,box(.005,.043,.022,.0012),m.black,side*.021,.134,-.096);
  put(g,box(.039,.005,.022),m.black,0,.157,-.096);
  put(g,box(.038,.006,.022),m.black,0,.112,-.096,0,0,0,'optic-bottom');
  put(g,cyl(.009,.012,14).rotateY(Math.PI/2),m.metal,.03,.125,-.096);
  const lensMat=new THREE.MeshPhysicalMaterial({color:0x669eaa,metalness:.1,roughness:.04,transparent:true,opacity:.09,depthWrite:false});lensMat.name='reflex-lens';
  const lens=put(g,new THREE.PlaneGeometry(.035,.038),lensMat,0,.135,-.101);lens.userData.viewOnly=true;
  const dotMat=new THREE.MeshBasicMaterial({color:new THREE.Color(3.5,.12,.025),toneMapped:false,depthWrite:false});dotMat.name='reflex-reticle';
  const dot=put(g,new THREE.CircleGeometry(.0009,12),dotMat,0,.145,-.112);dot.userData.viewOnly=true;
  const mag=new THREE.Group();mag.name='mag';mag.position.set(0,-.037,-.075);g.add(mag);
  put(mag,box(.027,.014,.055,.001),m.metal,0,.008,.002);
  put(mag,box(.028,.145,.061,.003),m.metal,0,-.07,.006,-.08);
  put(mag,box(.03,.023,.06,.003),m.black,0,-.15,.012,-.08);
  for(const side of [-1,1])for(let i=0;i<3;i++)put(mag,box(.0015,.116,.003,.0004),m.black,side*.0145,-.075,-.014+i*.02,-.08);
  put(mag,box(.034,.009,.067,.002),m.black,0,-.163,.014);
  socket(g,'grip',[0,-.04,.034]);socket(g,'fore',[-.003,.025,-.275]);socket(g,'muzzle',[0,.051,-.628]);socket(g,'eject',[.029,.062,-.025]);socket(g,'magwell',[0,-.06,-.075]);
  return g;
}
export function detailGun(g,id,m){
  const sight=WEAPON_SIGHTS[id];
  if(sight){socket(g,'sightRear',[0,sight.y,sight.rear]);socket(g,'sightFront',[0,sight.y,sight.front]);g.userData.sight={...sight};}
  const muzzle=g.getObjectByName('muzzle');if(muzzle&&id!=='knife'&&id!=='he')bore(g,m,[muzzle.position.x,muzzle.position.y,muzzle.position.z],id==='deagle'?.009:.01);
  // Keep the stencil on the solid lower receiver, below the milled ejection port.
  if(id==='m4a1')label(g,.0203,.015,.006,.10,.025);
  if(id==='ak47'){
    magazineWell(g,m.metal,[0,-.10],.033,.072,-.020,.016);
    label(g,.0235,.041,.004,.115,.029);
    for(const side of [-1,1]){
      for(const z of[-.135,-.071,.055])screw(g,m,side*.024,.035,z,side,.0028);
      put(g,box(.003,.018,.065),m.metal,side*.027,.047,-.27);
      for(let i=0;i<4;i++)put(g,box(.003,.012,.013),m.rubber,side*.027,.04,-.33+i*.035);
      put(g,box(.004,.014,.018),m.metal,side*.008,.098,-.15);
    }
    put(g,box(.002,.003,.003),m.steel,0,.103,-.552);
    put(g,box(.004,.009,.07),m.black,.026,.023,.016,0,0,.13);
    put(g,cyl(.013,.012,12),m.metal,0,.064,-.4);
    const mag=g.getObjectByName('mag');
    put(mag,box(.024,.006,.008,.0007),m.metal,0,.004,-.032);
    put(mag,box(.020,.004,.008,.0007),m.metal,0,.002,.031);
    for(const side of[-1,1])for(let i=0;i<5;i++)put(mag,box(.002,.028,.051),m.wood,side*.0155,-.032-i*.039,-i*i*.0026,-i*.09);
  } else if(id==='deagle'){
    const slide=g.getObjectByName('slide');
    label(slide,.0164,.065,-.081,.15,.025);
    // Rear notch and three-dot sights; center sight line sits above the slide.
    for(const side of[-1,1]){
      put(slide,box(.006,.015,.012),m.metal,side*.009,.096,.025);
      put(slide,new THREE.SphereGeometry(.00135,6,4),m.steel,side*.009,.101,.032);
      screw(g,m,side*.018,-.035,.025,side,.0033);
    }
    put(slide,new THREE.SphereGeometry(.0012,6,4),m.steel,0,.101,-.185);
    put(slide,box(.001,.019,.046),m.rubber,.0165,.067,-.039);
    put(slide,box(.0014,.011,.027),m.metal,.0171,.064,-.038);
    put(g,box(.004,.009,.023),m.metal,-.019,.025,.013);
    const mag=g.getObjectByName('mag');put(mag,box(.035,.009,.054),m.rubber,0,-.064,.006);
  } else if(id==='mp5'){
    magazineWell(g,m.black,[0,-.13],.029,.056,-.028,.018);
    put(g,box(.034,.025,.095,.003),m.black,0,.009,-.005);
    // Join the front sight block to the barrel without moving the sight line.
    put(g,box(.020,.021,.018,.002),m.black,0,.0605,-.38);
    for(const z of[.015,-.38])put(g,new THREE.TorusGeometry(.0105,.002,5,14),m.metal,0,.107,z);
    put(g,box(.002,.009,.003),m.steel,0,.103,-.38);
    label(g,.0215,.047,-.075,.13,.026);
  }else if(id==='awm'){
    magazineWell(g,m.metal,[0,-.07],.036,.087,-.052,-.026,.0045);
    label(g,.0282,.014,-.12,.14,.034);
    for(const z of[-.14,0])for(const side of[-1,1])screw(g,m,side*.018,.108,z,side);
  }
  magazineMount(g,id);
  return g;
}
// A few shared finishes replace hundreds of individual meshes. Only the magazine,
// carrier, bolt and slide remain independently animated.
const MOVING=new Set(['mag','bolt','slide','carrier','pin','lever']);
export function batchWeapon(root){
  const assemble=(group)=>{
    group.updateMatrixWorld(true);
    const inv=new THREE.Matrix4().copy(group.matrixWorld).invert(), batches=new Map(), remove=[];
    const walk=(o)=>{
      if(o!==group&&MOVING.has(o.name)){assemble(o);return;}
      if(o.isMesh&&o!==group){
        const material=o.material;
        if(!Array.isArray(material)){
          const g=o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv,o.matrixWorld));
          const ng=g.index?g.toNonIndexed():g;if(ng!==g)g.dispose();
          if(!ng.attributes.uv)ng.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(ng.attributes.position.count*2),2));
          for(const attr of Object.keys(ng.attributes))if(!['position','normal','uv'].includes(attr))ng.deleteAttribute(attr);
          const key=material.uuid+(o.userData.viewOnly?'_view':'');
          if(!batches.has(key))batches.set(key,{material,geos:[],viewOnly:!!o.userData.viewOnly});
          batches.get(key).geos.push(ng);remove.push(o);
        }
      }
      for(const c of [...o.children])walk(c);
    };
    walk(group);
    for(const o of remove){o.removeFromParent();o.geometry.dispose();}
    for(const b of batches.values()){
      const geometry=mergeGeometries(b.geos,false);for(const a of b.geos)a.dispose();
      const mesh=new THREE.Mesh(geometry,b.material);mesh.userData.viewOnly=b.viewOnly;mesh.frustumCulled=false;group.add(mesh);
    }
  };
  assemble(root);return root;
}
export function applyGunFinish(material,kind='metal'){
  if(!material.isMeshStandardMaterial||material.transparent)return material;
  const uniform={value:.8};material.userData.wetUniform=uniform;material.userData.finishKind=kind;
  material.onBeforeCompile=(shader)=>{
    shader.uniforms.uGunWet=uniform;
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vGunP; varying vec3 vGunN;').replace('#include <begin_vertex>','#include <begin_vertex>\nvGunP=position;vGunN=normal;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      uniform float uGunWet; varying vec3 vGunP; varying vec3 vGunN;
      float gunHash(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
      float gunFine=gunHash(floor(vGunP*3300.0));
      float gunUpper=smoothstep(.1,.9,normalize(vGunN).y);
      float gunWet=clamp(uGunWet*(.16+.84*gunUpper),0.0,1.0);
      vec2 gunCell=fract(vGunP.xz*190.0)-.5;
      float gunBead=(1.0-smoothstep(.13,.27,length(gunCell)))*step(.72,gunHash(floor(vec3(vGunP.xz*190.0,0.0))));
      roughnessFactor=clamp(mix(roughnessFactor,${kind==='polymer'?'.38':'.28'},gunWet*.48)+ (gunFine-.5)*${kind==='polymer'?'.12':'.055'}-gunBead*gunWet*.055,.19,.98);`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
      float gunH=gunBead*gunWet*.000065;
      vec3 gunDx=dFdx(-vViewPosition),gunDy=dFdy(-vViewPosition);
      vec3 gunR1=cross(gunDy,normal),gunR2=cross(normal,gunDx);
      float gunDet=dot(gunDx,gunR1);
      vec3 gunBump=abs(gunDet)*normal-sign(gunDet)*(dFdx(gunH)*gunR1+dFdy(gunH)*gunR2);
      normal=dot(gunBump,gunBump)>1e-20?normalize(gunBump):normal;`);
  };
  material.customProgramCacheKey=()=>`harbor-gun-v4-${kind}`;return material;
}
export function cloneViewMaterials(g){
  const cache=new Map();g.traverse(o=>{if(!o.isMesh)return;
    if(!cache.has(o.material)){
      const source=o.material,copy=source.clone();
      if(source.userData.finishKind)applyGunFinish(copy,source.userData.finishKind);
      cache.set(source,copy);
    }o.material=cache.get(o.material);
  });g.userData.ownedMaterials=[...cache.values()];return g;
}
export function setGunWetness(g,wet){for(const m of g.userData.ownedMaterials||[])if(m.userData.wetUniform)m.userData.wetUniform.value=wet;}
