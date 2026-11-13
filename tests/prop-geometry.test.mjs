import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createCorrugatedPanel,createCornerCasting} from '../src/prop-geometry.js';
import {buildMap} from '../src/map.js';
import {World} from '../src/physics.js';
import {buildDetailedM4} from '../src/gun-detail.js';
import {buildGun} from '../src/guns.js';

const tex={map:null,normalMap:null,roughnessMap:null,emissiveMap:null};
const T=Object.fromEntries(['deck','bulkhead','darkSteel','yellowSteel','redSteel','greenSteel','superWall','hull'].map(k=>[k,{...tex}]));
T.containers=Array.from({length:8},()=>({color:{rgb:[90,110,120]},side20:null,side40:null,n20:null,n40:null,detailN20:null,detailN40:null,door:null,doorN:null,roof:null,roofN:null}));
T.crates=Array.from({length:6},(_,i)=>({...tex,kind:i%2?'wood':'metal'}));Object.assign(T,{fence:null,grating:null,signs:null});
const tris=g=>(g.index?.count??g.attributes.position.count)/3;
const cast=(mesh,p,d)=>{mesh.updateMatrixWorld(true);return new THREE.Raycaster(new THREE.Vector3(...p),new THREE.Vector3(...d)).intersectObject(mesh,true);};

test('container ribs have real depth, hard facet normals and bounded geometry',()=>{
  for(const long of[false,true]){
    const g=createCorrugatedPanel(long?12.19:6.06,2.59,{long}),n=g.attributes.normal;
    assert.ok(g.boundingBox.min.z<-.035&&g.boundingBox.max.z===0);
    assert.ok(tris(g)<(long?370:190));
    let angled=0;
    for(let i=0;i<n.count;i++){const v=new THREE.Vector3().fromBufferAttribute(n,i);assert.ok(Math.abs(v.length()-1)<1e-5);if(Math.abs(v.x)>.3)angled++;}
    assert.ok(angled>100,'side lighting must come from actual sloped facets');
    g.dispose();
  }
});

test('window and hatch crops preserve the full sheet profile instead of stretching ribs',()=>{
  const full=createCorrugatedPanel(12.19,2.59,{long:true}),left=createCorrugatedPanel(12.19*.43,2.59,{long:true,u0:0,u1:.43});
  const a=new THREE.Mesh(full,new THREE.MeshBasicMaterial()),b=new THREE.Mesh(left,a.material);b.position.x=-12.19*(1-.43)/2;
  for(const x of[-5.8,-4.9,-3.75,-2.4,-1.1]){
    const fa=cast(a,[x,0,1],[0,0,-1])[0],fb=cast(b,[x,0,1],[0,0,-1])[0];
    assert.ok(fa&&fb);assert.ok(fa.point.distanceTo(fb.point)<1e-6,`profile jumps at ${x}`);
  }
});

test('cast corner slots enter a real cavity while their surrounding rims remain solid',()=>{
  const g=createCornerCasting(),mesh=new THREE.Mesh(g,new THREE.MeshBasicMaterial());
  assert.equal(tris(g),84);
  for(const axis of[0,1,2]){
    const p=[0,0,0],d=[0,0,0];p[axis]=.5;d[axis]=-1;
    const hole=cast(mesh,p,d)[0];assert.ok(hole);assert.ok(hole.point.getComponent(axis)<0,'slot must not hit a painted front cap');
    p[(axis+1)%3]=axis===0?.05:axis===1?.07:.075;
    const rim=cast(mesh,p,d)[0];assert.ok(rim);assert.ok(rim.point.getComponent(axis)>0,'rim must remain present');
  }
});

test('game and gallery share detailed props without changing a collider or exceeding static budgets',()=>{
  for(const showcase of['props',undefined]){
    const builds=[false,true].map(geometryDetail=>{const world=new World(),map=buildMap(new THREE.Scene(),T,world,{showcase,geometryDetail,skipAO:true});return{world,map};});
    assert.deepEqual(builds[0].world.colliders,builds[1].world.colliders,'render detail must not affect simulation');
    const count=builds.map(b=>b.map.meshes.reduce((n,m)=>n+tris(m.geometry),0));
    assert.ok(count[1]>count[0]);assert.ok(count[1]-count[0]<(showcase?4300:48000),`${showcase||'game'}: ${count}`);
    assert.ok(builds[1].map.meshes.length-builds[0].map.meshes.length<=16,'material batching must survive added parts');
    if(showcase){
      const group=new THREE.Group();group.add(...builds[1].map.meshes);
      const opening=cast(group,[-1.47,2.59-.061,-3+1.22-.09],[-1,0,0])[0];
      assert.ok(opening.distance>.60,'the complete prop must not hide its corner hole with a door/roof backing plane');
      const topHole=cast(group,[-5+3.03-.09,3.2,-3+1.22-.09],[0,-1,0])[0];
      assert.ok(topHole.distance>.68,'roof sheet must not cap the upper corner slot');
      const roofJoint=cast(group,[-5+3.03-.13,3.2,-3],[0,-1,0])[0];
      assert.ok(Math.abs(roofJoint.point.y-2.59)<1e-6,'roof must reach the end rail without a transverse gap');
    }
    for(const b of builds)for(const m of b.map.meshes){m.geometry.dispose();m.material.dispose();}
  }
});

test('M4 receiver exposes its cavity when the carrier retracts without altering grip or sight layout',()=>{
  const m=Object.fromEntries(['black','metal','rubber','steel'].map(k=>[k,new THREE.MeshStandardMaterial()]));
  const gun=buildDetailedM4(m),portRay=[.1,.061,-.026];
  const closed=cast(gun,portRay,[-1,0,0])[0];assert.equal(closed.object.name,'carrier');
  gun.getObjectByName('carrier').position.z+=.08;
  const open=cast(gun,portRay,[-1,0,0])[0];assert.ok(open.point.x<0,`opening remained covered at ${open.point.x}`);
  assert.ok(tris(gun.getObjectByName('receiver-shell').geometry)<150);
  assert.deepEqual(gun.getObjectByName('grip').position.toArray(),[0,-.04,.034]);
});

test('M4 rail and optic form a connected support chain without lifting the sight axis',()=>{
  const m=Object.fromEntries(['black','metal','rubber','steel'].map(k=>[k,new THREE.MeshStandardMaterial()]));
  const gun=buildDetailedM4(m);gun.updateMatrixWorld(true);
  const bounds=name=>new THREE.Box3().setFromObject(gun.getObjectByName(name));
  const spine=bounds('rail-spine');
  for(const name of['handguard-top','receiver-shell','optic-clamp'])assert.ok(spine.intersectsBox(bounds(name)),`rail spine separated from ${name}`);
  const teeth=gun.children.filter(o=>o.name==='rail-tooth');assert.equal(teeth.length,27);
  for(const tooth of teeth)assert.ok(spine.intersectsBox(new THREE.Box3().setFromObject(tooth)),'floating rail tooth');
  for(const[a,b]of[['optic-clamp','optic-base'],['optic-base','optic-riser'],['optic-riser','optic-bottom']])assert.ok(bounds(a).intersectsBox(bounds(b)),`${a} separated from ${b}`);
  assert.ok(bounds('optic-riser').max.y<.112,'support must not enter the optic viewing window');
  assert.equal(['rail-spine','optic-clamp','optic-riser'].reduce((n,key)=>n+tris(gun.getObjectByName(key).geometry),0),36);
  const reticle=gun.children.find(o=>o.material?.name==='reflex-reticle');
  assert.deepEqual(reticle.position.toArray(),[0,.145,-.112]);
  assert.deepEqual(gun.getObjectByName('grip').position.toArray(),[0,-.04,.034]);
});

function testGun(id){
  globalThis.document??={createElement(){
    const context=new Proxy({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)})},{get:(target,key)=>key in target?target[key]:()=>{}});
    return{width:1,height:1,getContext:()=>context};
  }};
  const g=buildGun(id);g.updateMatrixWorld(true);return g;
}

test('magazine wells have four continuous real walls and an empty insertion throat',()=>{
  // These samples are physical cross sections of the rendered geometry, not
  // the reload metadata used by the animation system.
  const sections={
    m4a1:{z:-.075,bottom:-.0555,top:.043,side:.019,front:-.107,back:-.043,depth:.038},
    ak47:{z:-.10,bottom:-.020,top:.014,side:.0185,front:-.138,back:-.062,depth:.025},
    mp5:{z:-.13,bottom:-.028,top:.017,side:.0165,front:-.160,back:-.100,depth:.039},
    awm:{z:-.07,bottom:-.052,top:-.027,side:.02025,front:-.11575,back:-.02425,depth:.0175},
  };
  for(const[id,s]of Object.entries(sections)){
    const g=testGun(id);g.getObjectByName('mag').removeFromParent();g.updateMatrixWorld(true);
    const throat=cast(g,[0,s.bottom-.003,s.z],[0,1,0])[0];
    assert.ok(throat&&throat.distance>=s.depth+.003-1e-6,`${id}: an empty mouth was capped or filled`);
    for(let y=s.bottom+.003;y<s.top;y+=.002){
      for(const x of[-s.side,s.side]){
        const hit=cast(g,[x,y,s.z+.16],[0,0,-1])[0];
        assert.ok(hit&&hit.point.z>s.z-.06,`${id}: side wall separated at y=${y}`);
      }
      for(const z of[s.front,s.back]){
        const hit=cast(g,[.10,y,z],[-1,0,0])[0];
        assert.ok(hit&&hit.point.x>0,`${id}: front/rear wall separated at y=${y}`);
      }
    }
  }
});

test('M4 lower receiver, barrel nut and MP5 grip neck close the actual structural gaps',()=>{
  const m4=testGun('m4a1');
  for(const y of[.033,.035,.037,.039]){
    const hit=cast(m4,[.1,y,.006],[-1,0,0])[0];
    assert.ok(hit&&hit.point.x>.014,`M4 upper/lower receiver seam is open at ${y}`);
  }
  for(const z of[-.159,-.145,-.132]){
    const hit=cast(m4,[.018,.12,z],[0,-1,0])[0];
    assert.ok(hit&&hit.point.y>.055,`M4 handguard is connected only by the thin barrel at ${z}`);
  }
  const mp5=testGun('mp5');
  for(const y of[.007,.010,.013]){
    const hit=cast(mp5,[.1,y,.022],[-1,0,0])[0];
    assert.ok(hit&&hit.point.x>.012,`MP5 grip neck separated at ${y}`);
  }
  for(const y of[.054,.060,.067,.070]){
    const hit=cast(mp5,[.1,y,-.38],[-1,0,0])[0];
    assert.ok(hit&&hit.point.x>.005,`MP5 front sight floats above its barrel at ${y}`);
  }
  assert.deepEqual(mp5.getObjectByName('sightFront').position.toArray(),[0,.107,-.38]);
});

test('Desert Eagle magazine fits a real angled grip cavity with its floorplate seated at the mouth',()=>{
  const gun=testGun('deagle'),mag=gun.getObjectByName('mag');
  const q=mag.quaternion.clone(),origin=mag.position.clone(),up=new THREE.Vector3(0,1,0).applyQuaternion(q);
  const body=mag.children.find(o=>o.isMesh&&o.material.name==='weapon-metal');
  const plate=mag.children.find(o=>o.isMesh&&o.material.name==='weapon-rubber');
  body.geometry.computeBoundingBox();plate.geometry.computeBoundingBox();
  const halfX=(body.geometry.boundingBox.max.x-body.geometry.boundingBox.min.x)/2;
  const halfZ=(body.geometry.boundingBox.max.z-body.geometry.boundingBox.min.z)/2;
  const mouth=origin.clone().addScaledVector(up,-.066023);
  mag.removeFromParent();gun.updateMatrixWorld(true);
  const clear=new THREE.Raycaster(mouth.clone().addScaledVector(up,-.003),up).intersectObject(gun,true)[0];
  assert.ok(clear&&clear.distance>.105,'the removed magazine must reveal a deep opening, not a solid rubber grip');
  for(const y of[-.050,-.025,0,.030])for(const[axis,half]of[[0,halfX],[2,halfZ]])for(const sign of[-1,1]){
    const p=origin.clone().addScaledVector(up,y),d=new THREE.Vector3().setComponent(axis,sign).applyQuaternion(q);
    const wall=new THREE.Raycaster(p,d).intersectObject(gun,true)[0];
    assert.ok(wall&&wall.distance>half+.0005,`magazine penetrates the angled cavity at ${y}/${axis}/${sign}`);
    assert.ok(wall.distance<half+.012,'grip cavity is excessively loose');
  }
  const projection=plate.geometry.boundingBox.min.y+.066023;
  assert.ok(projection<-.001&&projection>-.006,'seated floorplate must meet the mouth instead of floating below it');
});
