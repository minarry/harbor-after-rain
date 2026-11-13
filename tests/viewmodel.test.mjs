import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ViewModel } from '../src/viewmodel.js';
import { Soldier } from '../src/character.js';

// Geometry and animation checks need pixel storage, but no WebGL or canvas rasterizer.
globalThis.document = { createElement() {
  const context = new Proxy({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) }, {
    get: (target, key) => key in target ? target[key] : () => {},
  });
  return { width: 1, height: 1, getContext: () => context };
} };
const st = { onGround: true, speed: 0, ads: 0, ammo: 20, light: 1, wetness: 1 };
function makeVM(id) {
  const vm = new ViewModel(new THREE.Scene(), { flash: Array.from({ length: 3 }, () => new THREE.Texture()), flashSide: new THREE.Texture() }, 'GR');
  vm.equip(id); vm.drawT = 1;
  return vm;
}
function pairedViewModels(id) {
  const active=makeVM(id),control=makeVM(id);
  const tick=(count=1)=>{for(let frame=0;frame<count;frame++){active.update(1/60,st);control.update(1/60,st);}};
  tick(60);
  return {active,control,tick};
}
function skinnedPartCentre(arm,name,accept=()=>true) {
  const geo=arm.mesh.geometry,part=geo.userData.parts.find(part=>part.name===name),p=geo.attributes.position;
  const centre=new THREE.Vector3();let count=0;
  assert.ok(part,`${name}: rendered hand region exists`);
  for(let i=part.vertexStart;i<part.vertexStart+part.vertexCount;i++)if(accept(p,i)) {
    const point=new THREE.Vector3().fromBufferAttribute(p,i);
    arm.mesh.applyBoneTransform(i,point);centre.add(arm.mesh.localToWorld(point));count++;
  }
  assert.ok(count>0,`${name}: anatomical sample contains vertices`);
  return centre.divideScalar(count);
}
function skinnedFingertip(arm,name='finger0') {
  const digit=arm.mesh.geometry.userData.digits.find(digit=>digit.name===name);
  const tipZ=digit.base[2]-digit.lengths.reduce((sum,length)=>sum+length,0);
  return skinnedPartCentre(arm,`${name}-skin`,(p,i)=>p.getZ(i)<tipZ+.006);
}
function assertSameRestPose(active,control,label) {
  assert.equal(active.anim,null,`${label}: action has completed`);
  assert.ok(Math.abs(active.t-control.t)<1e-9,'the control must have the same breathing and idle time');
  for(const side of ['R','L']) {
    const a=active.arms[side],b=control.arms[side];
    assert.ok(a.hand.position.distanceTo(b.hand.position)<.001,`${label}/${side}: the grip returns to the idle position`);
    assert.ok(a.hand.quaternion.angleTo(b.hand.quaternion)<THREE.MathUtils.degToRad(.5),`${label}/${side}: the palm returns to its idle orientation`);
    assert.ok(a.elbow.distanceTo(b.elbow)<.001,`${label}/${side}: elbow retains ${(100*a.elbow.distanceTo(b.elbow)).toFixed(2)} cm of action history`);
    assert.ok(a.forearmQuaternion.angleTo(b.forearmQuaternion)<THREE.MathUtils.degToRad(.5),`${label}/${side}: forearm retains a twist after the grip has returned`);
    for(const part of ['fore','upper']) {
      const actual=a[part].geometry.attributes.position.array,expected=b[part].geometry.attributes.position.array;
      let maximum=0;
      for(let i=0;i<actual.length;i+=3)maximum=Math.max(maximum,Math.hypot(actual[i]-expected[i],actual[i+1]-expected[i+1],actual[i+2]-expected[i+2]));
      assert.ok(maximum<.001,`${label}/${side}/${part}: the rendered arm must restore, not only its reported joints`);
    }
  }
}

test('rifle support palms face upward and meet the actual underside of the handguard', () => {
  const vm=makeVM('m4a1');
  for(const id of ['m4a1','ak47','mp5','awm']) {
    vm.equip(id);vm.drawT=1;for(let frame=0;frame<30;frame++)vm.update(1/60,st);
    vm.rig.updateMatrixWorld(true);
    const arm=vm.arms.L,geo=arm.mesh.geometry,p=geo.attributes.position,n=geo.attributes.normal;
    const palm=geo.userData.parts.find(part=>part.name==='palm'),palmNormal=new THREE.Vector3();
    let closest=Infinity;
    for(let i=palm.vertexStart;i<palm.vertexStart+palm.vertexCount;i++) {
      if(p.getY(i)>=0||n.getY(i)>-.4)continue;
      palmNormal.add(new THREE.Vector3().fromBufferAttribute(n,i));
      const point=arm.hand.localToWorld(new THREE.Vector3().fromBufferAttribute(p,i));
      closest=Math.min(closest,point.distanceTo(arm.contact));
    }
    palmNormal.normalize().applyQuaternion(arm.hand.getWorldQuaternion(new THREE.Quaternion()));
    const gunUp=new THREE.Vector3(0,1,0).applyQuaternion(vm.cur.getWorldQuaternion(new THREE.Quaternion()));
    assert.ok(palmNormal.dot(gunUp)>.8,`${id}: the rendered palmar surface must face the fore-end from below`);
    assert.ok(closest<.012,`${id}: the attachment point lies on the actual palm, not in empty space`);
    const ray=new THREE.Raycaster(arm.contact.clone(),gunUp,0,.02),hits=ray.intersectObject(vm.cur,true);
    assert.ok(hits.length&&hits[0].distance<.008,`${id}: the palm contact meets real fore-end geometry`);
    const boneDirection=arm.wrist.clone().sub(arm.elbow).normalize();
    const handForward=new THREE.Vector3(0,0,-1).applyQuaternion(arm.hand.quaternion);
    assert.ok(boneDirection.angleTo(handForward)<THREE.MathUtils.degToRad(32),`${id}: supporting the gun must not require a sharply bent wrist`);
  }
});

test('firearm firing hands face inward with thumb up and the wrist leading down toward the elbow', () => {
  const vm=makeVM('m4a1');
  // M4 has a trigger mesh; the others use their guard/open grip-front region.
  const triggerPads={m4a1:[.008,-.004,-.009],ak47:[.008,-.003,-.012],mp5:[.009,0,-.012],awm:[.010,-.040,.036],deagle:[.008,.004,-.035]};
  for(const id of ['m4a1','ak47','mp5','awm','deagle'])for(const ads of [0,.5,1]) {
    const label=`${id}/ADS${ads}`;
    vm.equip(id);vm.drawT=1;for(let frame=0;frame<60;frame++)vm.update(1/60,{...st,ads});
    vm.rig.updateMatrixWorld(true);
    const arm=vm.arms.R,gunQ=vm.cur.getWorldQuaternion(new THREE.Quaternion());
    const gunUp=new THREE.Vector3(0,1,0).applyQuaternion(gunQ),inward=new THREE.Vector3(-1,0,0).applyQuaternion(gunQ);
    const index=skinnedPartCentre(arm,'finger0-skin'),pinky=skinnedPartCentre(arm,'finger3-skin'),thumb=skinnedPartCentre(arm,'thumb-skin');
    assert.ok(index.sub(pinky).dot(gunUp)>.015,`${label}: the real index finger sits above the little finger`);
    assert.ok(thumb.sub(pinky).dot(gunUp)>.015,`${label}: the real thumb is on the upper side of the grip`);
    const palm=skinnedPartCentre(arm,'palm'),back=skinnedPartCentre(arm,'cuff').sub(palm).normalize();
    const palmar=skinnedPartCentre(arm,'palm',(p,i)=>p.getY(i)<-.005),dorsal=skinnedPartCentre(arm,'palm',(p,i)=>p.getY(i)>.005);
    assert.ok(palmar.sub(dorsal).normalize().dot(inward)>.4,`${label}: the palm faces into the grip, rather than away from it`);
    assert.ok(back.dot(gunUp)<-.1,`${label}: the anatomical wrist axis must lead down and back, not bend upward`);
    const geo=arm.fore.geometry,{rings,sides}=geo.userData,p=geo.attributes.position;
    const centre=ring=>{const point=new THREE.Vector3();for(let i=0;i<sides;i++)point.add(new THREE.Vector3().fromBufferAttribute(p,ring*(sides+1)+i));return arm.fore.localToWorld(point.divideScalar(sides));};
    const elbow=centre(0),wrist=centre(rings),forearmBack=elbow.clone().sub(wrist).normalize();
    assert.ok(elbow.y<wrist.y-.01,`${label}: the visible right elbow cannot arch above the firing wrist`);
    assert.ok(back.angleTo(forearmBack)<THREE.MathUtils.degToRad(35),`${label}: the rendered wrist and forearm must join without a sharp bend`);
    for(let frame=0;frame<45;frame++)vm.update(1/60,{...st,ads,fireHeld:true});
    vm.rig.updateMatrixWorld(true);
    const fingertip=vm.cur.worldToLocal(skinnedFingertip(arm));
    assert.ok(fingertip.distanceTo(new THREE.Vector3(...triggerPads[id]))<.006,`${label}: the actual fingertip pad must reach the trigger region`);
  }
});

test('interrupting reload and switching back preserves the original magazine transform', () => {
  const vm = makeVM('m4a1');
  for (const id of ['ak47', 'm4a1', 'mp5', 'deagle', 'awm']) {
    vm.equip(id); vm.drawT = 1;
    const position = vm.parts.mag.position.clone(), rotation = vm.parts.mag.rotation.clone();
    for(const phase of [.16,.36,.55]) {
      vm.reload(2.5,true);vm.update(1/60,{...st,reloadProgress:phase});vm.cancelAnim();
      assert.ok(vm.parts.mag.position.equals(position)&&vm.parts.mag.rotation.equals(rotation),`${id}: cancelling during extraction, carry or insertion restores the seated magazine`);
    }
    vm.reload(2.5, true); vm.update(1 / 60, { ...st, reloadProgress: .3 });
    assert.ok(vm.parts.mag.position.distanceTo(position) > .05);
    vm.equip('knife'); vm.equip(id);
    assert.ok(vm.parts.mag.position.equals(position), id);
    assert.ok(vm.parts.mag.rotation.equals(rotation), id);
  }
});

test('straight magazines clear the actual well mouth before rotating and align before seating', () => {
  const vm=makeVM('m4a1');
  for(const id of ['m4a1','mp5','awm','deagle']) {
    vm.equip(id);vm.drawT=1;
    const mag=vm.parts.mag,rig=mag.userData.reload,rest=mag.position.clone(),restQ=mag.quaternion.clone();
    assert.ok(rig?.headPoint&&rig?.mouth&&rig?.pullAxis,`${id}: the moving magazine describes its real feed head and well mouth`);
    const axis=new THREE.Vector3(...rig.pullAxis).normalize(),mouth=new THREE.Vector3(...rig.mouth);
    const seatedHead=new THREE.Vector3(...rig.headPoint).applyQuaternion(restQ).add(rest);
    assert.ok(seatedHead.clone().sub(mouth).dot(axis)<-.005,`${id}: the feed head is visibly seated inside its well`);
    let carried=false,rotated=false,engagedSamples=0;
    vm.reload(2.5,true);
    for(let frame=0;frame<=150;frame++) {
      vm.update(0,{...st,reloadProgress:frame/150});
      const head=new THREE.Vector3(...rig.headPoint).applyQuaternion(mag.quaternion).add(mag.position);
      const delta=mag.position.clone().sub(rest),along=delta.dot(axis),sideways=delta.addScaledVector(axis,-along).length();
      const angle=mag.quaternion.angleTo(restQ);
      if(head.sub(mouth).dot(axis)<.002) {
        engagedSamples++;
        assert.ok(angle<1e-6,`${id}: an engaged feed neck cannot rotate through the well walls`);
        assert.ok(sideways<1e-7,`${id}: an engaged magazine follows its real insertion axis`);
      }
      carried ||= along>rig.clearance+.02;
      rotated ||= angle>.1;
    }
    assert.ok(engagedSamples>20&&carried&&rotated,`${id}: the check covers seated, extracted and free-carry states`);
    assert.ok(mag.position.equals(rest)&&mag.quaternion.angleTo(restQ)<1e-7,`${id}: the complete path finishes at the original seat`);
  }
});

test('AK release and final latch rock around the actual front hook', () => {
  const vm=makeVM('ak47'),mag=vm.parts.mag,rig=mag.userData.reload,rest=mag.position.clone(),restQ=mag.quaternion.clone();
  assert.ok(rig?.rockPivot&&rig.rockAngle>0,'the AK has an authored front hook and rocking release');
  const pivot=new THREE.Vector3(...rig.rockPivot),seatedPivot=pivot.clone().applyQuaternion(restQ).add(rest);
  vm.reload(2.5,true);
  for(const phase of [.15,.585]) {
    vm.update(0,{...st,reloadProgress:phase});
    const movingPivot=pivot.clone().applyQuaternion(mag.quaternion).add(mag.position);
    assert.ok(movingPivot.distanceTo(seatedPivot)<1e-7,'the front hook stays engaged while the rear catch moves');
    assert.ok(mag.quaternion.angleTo(restQ)>.02,'the magazine visibly rocks instead of sliding through the latch');
  }
  vm.update(0,{...st,reloadProgress:.60});
  assert.ok(mag.position.equals(rest)&&mag.quaternion.angleTo(restQ)<1e-7,'the final rock seats both catches before the insertion sound');
});

test('magazine motion preserves release, seating and mechanism sound timing', () => {
  const vm=makeVM('m4a1'),expected=[['magout',.12],['magin',.60],['tap',.66],['boltback',.82],['boltforward',.88]];
  for(const id of ['m4a1','ak47','mp5','deagle','awm']) {
    vm.equip(id);vm.drawT=1;
    const events=[];vm.onAction=event=>{if(event.type==='reload')events.push({phase:event.phase,time:vm.anim.t});};
    const duration=2.5;vm.reload(duration,true);
    for(let frame=0;frame<160&&vm.anim;frame++)vm.update(1/60,st);
    assert.equal(vm.anim,null);
    assert.deepEqual(events.map(event=>event.phase),expected.map(([name])=>name),`${id}: one event per phase`);
    for(let i=0;i<expected.length;i++)assert.ok(events[i].time>=expected[i][1]*duration-1e-8&&events[i].time<expected[i][1]*duration+1/60+1e-8,`${id}/${expected[i][0]}: sound remains on the original simulated phase`);
  }
});

test('AWM fired casing survives immediate reload and is emitted once at bolt pull', () => {
  const vm = makeVM('awm'), shells = [];
  vm.onAction = event => { if (event.type === 'shell') shells.push(event); };
  vm.fire(); vm.reload(2.5, false);
  for (const reloadProgress of [.3, .75, .81]) vm.update(1 / 60, { ...st, reloadProgress });
  assert.equal(shells.length, 0);
  for (const reloadProgress of [.82, .87, .9, 1]) vm.update(1 / 60, { ...st, reloadProgress });
  assert.equal(shells.length, 1);
  vm.fire(); vm.equip('deagle');
  for (let i = 0; i < 100; i++) vm.update(1 / 60, st);
  assert.equal(shells.length, 1, 'holstered rifle must not eject from the pistol');
});

test('normal AWM cycle synchronizes one pull and one release sound with one shell', () => {
  const vm=makeVM('awm'), actions=[]; vm.onAction=e=>actions.push(e);
  vm.fire();for(let i=0;i<100;i++)vm.update(1/60,st);
  assert.deepEqual(actions.filter(e=>e.type==='mechanism').map(e=>e.phase),['boltback','boltforward']);
  assert.equal(actions.filter(e=>e.type==='shell').length,1);
});

test('all non-scoped sight axes align with the screen center and sockets preserve projection', () => {
  const vm = makeVM('m4a1');
  const viewCamera = new THREE.PerspectiveCamera(58, 16 / 9, .01, 50);
  const camera = new THREE.PerspectiveCamera(73, 16 / 9, .1, 200);
  camera.position.set(10, 3, -12); camera.rotation.set(.1, .8, -.03, 'YXZ'); camera.updateMatrixWorld();
  for (const id of ['ak47', 'm4a1', 'mp5', 'deagle']) {
    vm.equip(id); vm.drawT = 1; vm.update(0, { ...st, ads: 1 });
    for (const name of ['sightRear', 'sightFront']) {
      const point = vm.parts[name].getWorldPosition(new THREE.Vector3()).project(viewCamera);
      assert.ok(Math.hypot(point.x, point.y) < 1e-8, `${id} ${name}`);
    }
    const local = vm.parts.muzzle.getWorldPosition(new THREE.Vector3()).project(viewCamera);
    const world = vm.muzzleWorld(camera, viewCamera).project(camera);
    assert.ok(Math.hypot(local.x - world.x, local.y - world.y) < 1e-8, id);
  }
});

test('M4 magazine hand stays visible through the extract and insert phases', () => {
  const vm = makeVM('m4a1'), camera = new THREE.PerspectiveCamera(58, 16 / 9, .01, 50);
  vm.reload(2.5, true);
  for (const reloadProgress of [.12, .25, .3, .43, .5, .6]) {
    vm.update(1 / 60, { ...st, reloadProgress });
    const point = vm.arms.L.hand.position.clone().project(camera);
    assert.ok(Math.abs(point.x) < .8 && point.y > -.85 && point.y < .15, `${reloadProgress}: ${point.toArray()}`);
  }
});

test('M4 empty reload pulls the real carrier and releases or cancels it back into battery',()=>{
  const vm=makeVM('m4a1'),carrierRest=vm.parts.carrier.position.z,handleRest=vm.parts.bolt.position.z;
  vm.reload(2.6,true);vm.update(0,{...st,reloadProgress:.84});
  assert.ok(Math.abs(vm.parts.carrier.position.z-carrierRest-.067)<1e-8);
  assert.ok(Math.abs((vm.parts.carrier.position.z-carrierRest)-(vm.parts.bolt.position.z-handleRest))<1e-8);
  vm.update(0,{...st,reloadProgress:.90});
  assert.equal(vm.parts.carrier.position.z,carrierRest);assert.equal(vm.parts.bolt.position.z,handleRest);
  vm.update(0,{...st,reloadProgress:1});
  assert.equal(vm.parts.carrier.position.z,carrierRest);assert.equal(vm.anim,null);
  vm.reload(2.6,true);vm.update(0,{...st,reloadProgress:.84});vm.cancelAnim();
  assert.equal(vm.parts.carrier.position.z,carrierRest);assert.equal(vm.parts.bolt.position.z,handleRest);
  // A late release must not overwrite the independent, short firing cycle.
  vm.reload(2.6,true);vm.boltT=.0425;vm.update(0,{...st,reloadProgress:.90});
  assert.ok(Math.abs(vm.parts.carrier.position.z-carrierRest-.045)<1e-8);
  vm.cancelAnim();vm.boltT=.09;vm.update(0,st);assert.equal(vm.parts.carrier.position.z,carrierRest);
});

test('M4 stencil sits on the solid lower receiver without floating across the ejection port',()=>{
  const vm=makeVM('m4a1'),labels=[];
  vm.cur.traverse(o=>{if(o.isMesh&&o.material.name==='weapon-markings')labels.push(o);});
  assert.equal(labels.length,1);
  const bounds=new THREE.Box3().setFromBufferAttribute(labels[0].geometry.attributes.position);
  assert.ok(bounds.min.y>=-.006&&bounds.max.y<=.030,'stencil must stay inside the lower receiver flat area');
  assert.ok(bounds.min.z>=-.051&&bounds.max.z<=.063);
  assert.ok(bounds.min.x>.020&&bounds.max.x<.0206,'decal should sit just above the solid right receiver face');
  assert.ok(bounds.max.y<.052,'no stencil pixel may lie across the ejection aperture');
});

test('distant soldier detail shares geometry and preserves its skeleton and hitboxes', () => {
  const a=new Soldier('GR'),b=new Soldier('GR'),high=a.mesh.geometry,skeleton=a.mesh.skeleton,material=a.material;
  a.setDetail(false);b.setDetail(false);
  assert.equal(a.mesh.geometry,b.mesh.geometry);
  assert.ok(a.mesh.geometry.attributes.position.count<high.attributes.position.count*.25);
  assert.equal(a.mesh.skeleton,skeleton);assert.equal(a.material,material);
  const skin=a.mesh.geometry.attributes.skinIndex.array;
  assert.ok([...skin].every(i=>i<skeleton.bones.length));
  a.setDetail(true);assert.equal(a.mesh.geometry,high);
});

test('trigger finger articulates independently while glove joints and curved sleeves stay finite', () => {
  const vm=makeVM('m4a1');
  for(let i=0;i<30;i++)vm.update(1/60,st);
  vm.rig.updateMatrixWorld(true);
  const rest=vm.cur.worldToLocal(skinnedFingertip(vm.arms.R)),middle=vm.arms.R.fingers[1].map(b=>b.rotation.x);
  for(let i=0;i<30;i++)vm.update(1/60,{...st,fireHeld:true});
  vm.rig.updateMatrixWorld(true);
  const pressed=vm.cur.worldToLocal(skinnedFingertip(vm.arms.R)),trigger=new THREE.Vector3(.008,-.004,-.009);
  assert.ok(pressed.distanceTo(trigger)<rest.distanceTo(trigger)-.01,'the rendered fingertip moves from its resting position into the trigger');
  vm.arms.R.fingers[1].forEach((b,i)=>assert.ok(Math.abs(b.rotation.x-middle[i])<1e-7,'other fingers keep their grip'));
  for(const id of ['m4a1','ak47','mp5','deagle','awm','knife','he']) {
    vm.equip(id);vm.drawT=1;vm.update(1/60,st);vm.rig.updateMatrixWorld(true);
    for(const side of ['R','L']) {
      const arm=vm.arms[side];if(!arm.g.visible)continue;
      assert.equal(arm.mesh.skeleton.bones.length,16);
      arm.mesh.skeleton.update();
      for(const chain of [...arm.fingers,arm.thumb]) {
        assert.equal(chain.length,3);
        chain.forEach(b=>assert.ok(b.matrixWorld.elements.every(Number.isFinite)));
      }
      const geo=arm.mesh.geometry,p=geo.attributes.position;
      for(let i=0;i<p.count;i++) {
        const point=arm.mesh.applyBoneTransform(i,new THREE.Vector3().fromBufferAttribute(p,i));
        assert.ok(point.toArray().every(Number.isFinite));
        assert.ok(point.length()<.30,`${id} ${side}: finger must not form a stretched spike`);
      }
      for(const sleeve of [arm.fore,arm.upper]) {
        assert.ok([...sleeve.geometry.attributes.position.array,...sleeve.geometry.attributes.normal.array].every(Number.isFinite));
      }
      const {rings,sides}=arm.fore.geometry.userData,positions=arm.fore.geometry.attributes.position,end=new THREE.Vector3();
      for(let i=0;i<sides;i++)end.add(new THREE.Vector3().fromBufferAttribute(positions,rings*(sides+1)+i));
      assert.ok(end.divideScalar(sides).distanceTo(arm.wrist)<1e-7,'sleeve joins the glove cuff');
    }
  }
});

test('left hand remains attached to the visible magazine through removal, transport and insertion', () => {
  const vm=makeVM('m4a1');vm.reload(2.5,true);
  let relative=null;
  for(const reloadProgress of [.12,.2,.3,.37,.4,.43,.52,.60]) {
    vm.update(1/60,{...st,reloadProgress});vm.rig.updateMatrixWorld(true);
    const arm=vm.arms.L;
    assert.equal(arm.poseKind,'magazine');assert.equal(arm.graspSocket,vm.parts.mag);
    assert.equal(vm.parts.mag.visible,true,'transported magazine cannot vanish from the hand');
    assert.ok(arm.hand.localToWorld(arm.localContact.clone()).distanceTo(arm.contact)<1e-8,'finger contact stays on the magazine');
    const orientation=vm.parts.mag.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(arm.hand.quaternion);
    if(relative)assert.ok(orientation.angleTo(relative)<1e-7,'wrist rotates with the magazine');
    relative=orientation;
  }
});

test('real M4 support and reload poses keep forearm surfaces outward on both arms', () => {
  const vm=makeVM('m4a1');for(let i=0;i<30;i++)vm.update(1/60,st);
  for(const phase of [null,.45,.80]) {
    if(phase!==null){vm.reload(2.5,true);vm.update(0,{...st,reloadProgress:phase});}
  for(const side of ['R','L']) {
    const geo=vm.arms[side].fore.geometry,{rings,sides}=geo.userData,p=geo.attributes.position,index=geo.index;
    const centres=Array.from({length:rings+1},(_,ring)=>{
      const centre=new THREE.Vector3();
      for(let s=0;s<sides;s++)centre.add(new THREE.Vector3().fromBufferAttribute(p,ring*(sides+1)+s));
      return centre.divideScalar(sides);
    });
    const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),face=new THREE.Vector3(),radial=new THREE.Vector3(),origin=new THREE.Vector3(),edge=new THREE.Vector3();
    for(let i=0;i<index.count;i+=3) {
      const ids=[index.getX(i),index.getX(i+1),index.getX(i+2)],rows=ids.map(id=>Math.floor(id/(sides+1)));
      a.fromBufferAttribute(p,ids[0]);b.fromBufferAttribute(p,ids[1]);c.fromBufferAttribute(p,ids[2]);
      face.subVectors(b,a).cross(edge.subVectors(c,a));
      origin.copy(centres[rows[0]]).add(centres[rows[1]]).add(centres[rows[2]]).divideScalar(3);
      radial.copy(a).add(b).add(c).divideScalar(3).sub(origin);
      assert.ok(face.lengthSq()>1e-16&&face.dot(radial)>0,`${side}/phase${phase}/strip${Math.min(...rows)}: M4 forearm must not fold inward`);
    }
  }
  }
});

for(const id of ['m4a1','ak47','mp5','deagle','awm'])test(`${id} reload turns the wrist independently without elbow or forearm branch jumps`, () => {
  const vm=makeVM(id);for(let i=0;i<30;i++)vm.update(1/60,st);vm.reload(2.5,true);
  const previous={},initial={},maximumWristChange={R:0,L:0};
  for(let frame=0;frame<=150;frame++) {
    const phase=frame/150;vm.update(1/60,{...st,reloadProgress:phase});
    for(const side of ['R','L']) {
      const arm=vm.arms[side],now={elbow:arm.elbow.clone(),hand:arm.hand.quaternion.clone(),forearm:arm.forearmQuaternion.clone(),wrist:arm.wristQuaternion.clone()};
      const composed=now.forearm.clone().multiply(now.wrist);
      assert.ok(composed.angleTo(now.hand)<1e-6,'forearm and wrist rotations compose into the actual hand pose');
      if(previous[side]) {
        assert.ok(now.elbow.distanceTo(previous[side].elbow)<.08,`${side} elbow changes branch at reload ${phase}`);
        assert.ok(now.hand.angleTo(previous[side].hand)<.45,`${side} palm rotation jumps at reload ${phase}`);
        assert.ok(now.forearm.angleTo(previous[side].forearm)<.65,`${side} forearm rotation jumps at reload ${phase}`);
        assert.ok(now.wrist.angleTo(previous[side].wrist)<.65,`${side} wrist relative rotation jumps at reload ${phase}`);
      } else initial[side]=now.wrist.clone();
      maximumWristChange[side]=Math.max(maximumWristChange[side],initial[side].angleTo(now.wrist));
      previous[side]=now;
    }
  }
  assert.ok(maximumWristChange.L>.25,'the support hand must rotate relative to its forearm while handling the magazine and charging handle');
});

test('empty reload hand paths continuously transfer between support, magazine and bolt', () => {
  const vm=makeVM('m4a1');
  for(const id of ['m4a1','ak47','mp5','deagle','awm']) {
    vm.equip(id);vm.drawT=1;vm.reload(2.5,true);
    let previous=null,previousQ=null;
    for(let frame=0;frame<=250;frame++) {
      vm.update(.01,{...st,reloadProgress:frame/250});
      for(const side of ['R','L']) for(const mesh of [vm.arms[side].fore,vm.arms[side].upper]) {
        assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite),`${id}/${side}: finite arm surface throughout reload`);
        assert.ok(mesh.geometry.attributes.normal.array.every(Number.isFinite),`${id}/${side}: finite arm normals throughout reload`);
      }
      const hand=vm.arms.L.hand;
      if(previous)assert.ok(hand.position.distanceTo(previous)<.04,`${id}: hand teleport at ${frame/250}`);
      if(previousQ)assert.ok(hand.quaternion.angleTo(previousQ)<.22,`${id}: wrist snap at ${frame/250}`);
      previous=hand.position.clone();previousQ=hand.quaternion.clone();
    }
  }
});

for(const id of ['m4a1','ak47','mp5','deagle','awm'])test(`${id} restores the same idle arms after repeated empty and tactical reloads`, () => {
  const pair=pairedViewModels(id),{active,control,tick}=pair;
  for(const [cycle,empty] of [true,false,true,false].entries()) {
    active.reload(2.5,empty);
    let frames=0;
    const advance=()=>{
      const previous=Object.fromEntries(['R','L'].map(side=>[side,active.arms[side].elbow.clone()]));
      tick();
      for(const side of ['R','L'])assert.ok(active.arms[side].elbow.distanceTo(previous[side])<.08,`${id}/${side}: restoration must not snap the elbow at the end of reload`);
    };
    while(active.anim&&frames++<180)advance();
    assert.equal(active.anim,null,'a continuous reload finishes without manually scrubbing its progress');
    // Give the gun's release impulse and the rest-pose attraction at most 0.6s.
    for(let frame=0;frame<36;frame++)advance();
    assertSameRestPose(active,control,`${id}/cycle${cycle+1}/${empty?'empty':'tactical'}`);
  }
});

test('cancelling reload releases arm history and returns to the same timed idle pose', () => {
  for(const phase of [.3,.8]) {
    const {active,control,tick}=pairedViewModels('m4a1');
    active.reload(2.5,true);tick(Math.round(phase*150));active.cancelAnim();tick(36);
    assertSameRestPose(active,control,`cancel at ${phase}`);
  }
});

test('switching away during reload cannot carry the old elbow solution into either weapon', () => {
  const pair=pairedViewModels('m4a1'),active=pair.active;
  active.reload(2.5,true);pair.tick(75);
  for(const id of ['ak47','m4a1']) {
    active.equip(id);active.drawT=1;
    const fresh=makeVM(id);fresh.t=active.t;
    for(let frame=0;frame<36;frame++){active.update(1/60,st);fresh.update(1/60,st);}
    assertSameRestPose(active,fresh,`fresh ${id} after interrupting reload`);
  }
});
