// Wrist-centred anatomical hands: +Y is dorsal, fingertips point along -Z.
// One skinned mesh, three contiguous material groups, and 16 bones per hand.
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const FABRIC = new THREE.Color(0x50584f), PALM = new THREE.Color(0x303633);
const EDGE = new THREE.Color(0x343d37), PANEL = new THREE.Color(0x414b42);
const STITCH = new THREE.Color(0x697066);
const FINGERS = [
  { x: -.027, z: -.074, lengths: [.033, .022, .019], radius: .0100 },
  { x: -.009, z: -.083, lengths: [.036, .024, .020], radius: .0106 },
  { x:  .010, z: -.080, lengths: [.033, .022, .019], radius: .0098 },
  { x:  .027, z: -.071, lengths: [.027, .018, .017], radius: .0085 },
];
const CURL = {
  grip: [[.12,.18,.12],[.64,1.68,.78],[.70,1.65,.82],[.78,1.60,.84]],
  support: [[1.02,1.25,.68],[1.10,1.30,.72],[1.16,1.32,.74],[1.20,1.30,.78]],
  cradle: [[.48,1.05,.58],[.52,1.18,.64],[.58,1.20,.66],[.68,1.18,.70]],
  'pistol-support': [[.82,1.28,.67],[.89,1.42,.74],[.95,1.43,.77],[1.03,1.39,.76]],
  magazine: [[.72,1.48,.72],[.78,1.55,.78],[.84,1.55,.78],[.90,1.5,.8]],
  rack: [[.35,1.05,.75],[.40,1.14,.8],[.60,1.23,.8],[.75,1.3,.8]],
  open: [[.16,.22,.12],[.20,.3,.18],[.24,.34,.2],[.3,.38,.22]],
  knife: [[.75,1.63,.85],[.75,1.68,.85],[.8,1.65,.85],[.85,1.6,.85]],
  grenade: [[.7,1.12,.6],[.8,1.18,.6],[.86,1.2,.65],[.9,1.2,.7]],
};
const TRIGGER = [.48, 1.14, .52];
const DEFAULT_ARM_HINTS = Object.freeze({});
const smooth = THREE.MathUtils.smoothstep;
const lerp = THREE.MathUtils.lerp;
const gauss = (v, width) => Math.exp(-((v / width) ** 2));

function gloveGeometry(side, root, joints) {
  const positions = [], colors = [], skin = [], weights = [];
  const indices = [[], [], []], seams = [], parts = [], digits = [];
  const sign = side === 'R' ? 1 : -1;
  const col = new THREE.Color();
  const vertex = (x, y, z, color, bone = 0, second = bone, mix = 0) => {
    positions.push(x * sign, y, z); colors.push(color.r, color.g, color.b);
    skin.push(bone, second, 0, 0); weights.push(1 - mix, mix, 0, 0);
    return positions.length / 3 - 1;
  };
  const tri = (a, b, c, material = 0) => {
    indices[material].push(a, sign > 0 ? b : c, sign > 0 ? c : b);
  };
  const part = (name, material, build) => {
    const start = positions.length / 3;
    build();
    parts.push({ name, material, vertexStart: start, vertexCount: positions.length / 3 - start });
  };
  // Cross-sections are counterclockwise viewed along +Z. The usual loft advances -Z.
  const loft = (rings, sides, sample, material = 0, reverse = false) => {
    const start = positions.length / 3;
    for (let r = 0; r < rings.length; r++) {
      for (let s = 0; s <= sides; s++) sample(rings[r], s / sides * Math.PI * 2, r);
      seams.push([start + r * (sides + 1), start + r * (sides + 1) + sides]);
    }
    for (let r = 0; r < rings.length - 1; r++) for (let s = 0; s < sides; s++) {
      const a = start + r * (sides + 1) + s, b = a + 1, c = a + sides + 1, d = c + 1;
      if (reverse) { tri(a, b, c, material); tri(b, d, c, material); }
      else { tri(a, c, b, material); tri(b, c, d, material); }
    }
    return start;
  };
  const cap = (start, sides, centre, material = 0, end = false) => {
    for (let s = 0; s < sides; s++) {
      if (end) tri(centre, start + s + 1, start + s, material);
      else tri(centre, start + s, start + s + 1, material);
    }
  };

  // A metacarpal arch with a flattened back and a fuller palmar surface. The
  // thenar volume is a deformation of this surface, not an intersecting sphere.
  const palmRings = [
    [.018,.024,.013], [.011,.026,.0155], [0,.027,.016], [-.012,.030,.0175],
    [-.027,.034,.0185], [-.043,.0375,.0182], [-.056,.0385,.0168],
    [-.067,.0375,.013], [-.077,.034,.007],
  ];
  part('palm', 0, () => {
    const sides = 28;
    const start = loft(palmRings, sides, ([z,w,h], angle, ring) => {
      const c = Math.cos(angle), s = Math.sin(angle);
      let x = w * Math.sign(c) * Math.pow(Math.abs(c), .82);
      let y = h * s * (s < 0 ? 1.08 : .88);
      const thenar = gauss(z + .030, .024) * gauss(x + .026, .019);
      x -= thenar * .0024 * Math.max(0, -c);
      y -= thenar * .0042 * Math.max(0, -s);
      const arch = smooth(ring, 5, 8) * (.010 * ((x + .004) / .039) ** 2 - .0015);
      col.copy(PALM).lerp(FABRIC, smooth(s, -.12, .5));
      col.multiplyScalar(1 - thenar * .065);
      vertex(x, y, z + arch, col);
    });
    cap(start, sides, vertex(0,0,.018,PALM));
    cap(start + (palmRings.length - 1) * (sides + 1), sides, vertex(0,0,-.075,PALM), 0, true);
  });

  // A thin sewn dorsal panel follows the palm; it does not form a hard knuckle pad.
  part('back-panel', 0, () => {
    const rows = 8, cols = 10, start = positions.length / 3;
    for (let r = 0; r <= rows; r++) for (let s = 0; s <= cols; s++) {
      const t = r / rows, u = s / cols * 2 - 1;
      const width = .021 + Math.sin(t * Math.PI) * .007;
      const x = .002 + u * width, z = -.010 - .051 * t;
      let ring=0;
      while(ring<palmRings.length-2 && z<palmRings[ring+1][0])ring++;
      const lower=palmRings[ring],upper=palmRings[ring+1];
      const along=THREE.MathUtils.clamp((z-lower[0])/(upper[0]-lower[0]),0,1);
      const w=lerp(lower[1],upper[1],along),h=lerp(lower[2],upper[2],along);
      // Conform to the same squircle as the palm, including the sloping sides.
      // A flat patch intersected the palm in a jagged line across the knuckles.
      const y=h*.88*Math.sqrt(Math.max(0,1-(Math.abs(x)/w)**(2/.82)))+.00045;
      col.copy((s === 0 || s === cols) ? EDGE : PANEL);
      vertex(x, y, z, col);
    }
    for (let r=0;r<rows;r++) for (let s=0;s<cols;s++) {
      const a=start+r*(cols+1)+s,b=a+1,c=a+cols+1,d=c+1;
      tri(a,b,c);tri(b,d,c);
    }
  });

  // Compact cuff, sewn bound edge and a flat closure instead of two swollen ribs.
  part('cuff', 0, () => {
    loft([[.004,.0272,.018],[.008,.0276,.0184],[.013,.0281,.0189],
      [.021,.0284,.0192],[.028,.0284,.0192],[.031,.0287,.0195],[.033,.0282,.019]],
    24, ([z,w,h], a) => vertex(Math.cos(a)*w, Math.sin(a)*h, z, z > .029 ? EDGE : FABRIC), 0, true);
  });
  part('wrist-closure', 0, () => {
    const rows=4, cols=12, start=positions.length/3;
    for(let r=0;r<=rows;r++)for(let s=0;s<=cols;s++){
      const x=-.011+s/cols*.032,z=.012+r/rows*.013;
      const y=Math.sqrt(Math.max(0,1-(x/.029)**2))*.0193+.0008;
      col.copy((r===0||r===rows)?EDGE:PANEL);
      if(r===1 && s>1 && s<cols-1)col.lerp(STITCH,.2);
      vertex(x,y,z,col);
    }
    for(let r=0;r<rows;r++)for(let s=0;s<cols;s++){
      const a=start+r*(cols+1)+s,b=a+1,c=a+cols+1,d=c+1;
      tri(a,c,b);tri(b,c,d);
    }
  });

  function digit(def, index, thumb = false) {
    const name = thumb ? 'thumb' : `finger${index}`, baseY = thumb ? -.004 : 0;
    const bones = [];
    let parent = root;
    for (let j = 0; j < 3; j++) {
      const b = new THREE.Bone(); b.name = `${name}_${j}`;
      b.position.set(j ? 0 : def.x * sign, j ? 0 : baseY, j ? -def.lengths[j-1] : def.z);
      parent.add(b); parent=b; bones.push(b); joints.push(b);
    }
    const ids = bones.map(b => joints.indexOf(b));
    const edge1=def.lengths[0], edge2=edge1+def.lengths[1], length=edge2+def.lengths[2];
    const cut = thumb ? edge1 + .009 : edge1 * .59;
    digits.push({name, boneIds:ids, base:[def.x*sign,baseY,def.z], lengths:[...def.lengths], cut, radius:def.radius});
    const influence = d => {
      if (d < 0) return [0, ids[0], smooth(d,-.017,0)];
      const edge=d < (edge1+edge2)*.5 ? edge1 : edge2;
      const next=edge===edge1?1:2;
      if (Math.abs(d-edge)<.006) return [ids[next-1],ids[next],smooth(d,edge-.006,edge+.006)];
      const id=ids[d>=edge2?2:d>=edge1?1:0]; return [id,id,0];
    };
    // Broad proximal section, joint volume, tapered middle phalanx, a round pad.
    const profile = d => {
      const t=Math.max(0,d)/length;
      let r=def.radius*(1.025-.27*t);
      r+=def.radius*(.075*gauss(d-edge1,.0045)+.065*gauss(d-edge2,.0038));
      if(d<0)r*=lerp(.57,1,smooth(d,-.018,0));
      const tipStart=length-.0085;
      if(d>tipStart)r*=Math.sqrt(Math.max(0,1-((d-tipStart)/.0085)**2));
      return r;
    };
    const sample = (d,a,material,offset=0) => {
      const c=Math.cos(a),s=Math.sin(a),r=profile(d)+offset;
      const jointCrease=gauss(d-edge1-.0005,.001)+gauss(d-edge2-.0004,.0008);
      const palmar=Math.max(0,-s), dorsal=Math.max(0,s);
      const x=def.x+r*Math.sign(c)*Math.pow(Math.abs(c),.9);
      const y=baseY-.0007*smooth(d,edge2,length)+s*r*(s>0?.86:.98)
        +palmar*jointCrease*.00045;
      if(material===0) {
        col.copy(PALM).lerp(FABRIC,smooth(s,-.05,.45));
        if(d>cut-.0025)col.lerp(EDGE,.8);
      } else {
        // White-base material modulation: the skin material supplies pigmentation.
        col.setRGB(1-.045*jointCrease*dorsal, .985-.07*jointCrease*dorsal-.012*palmar,
          .97-.075*jointCrease*dorsal-.020*palmar);
      }
      const [bone,second,mix]=influence(d);
      return vertex(x,y,def.z-d,col,bone,second,mix);
    };
    const sides=18;
    part(`${name}-glove`, 0, () => {
      const rings=[-.018,-.014,-.009,-.004,0,.005,.010,cut-.004,cut-.0015,cut,cut+.001];
      rings.sort((a,b)=>a-b);
      loft(rings,sides,(d,a)=>sample(d,a,0,d>cut-.0015?.00095:.00065));
      // The folded inner lip overlaps the skin without a dark empty cut surface.
      loft([cut+.001,cut+.0007,cut-.0015],sides,(d,a,i)=>sample(d,a,0,i===0?.00095:i===1?.00035:0),0,true);
    });
    part(`${name}-skin`, 1, () => {
      const rings=[cut-.0025,cut,cut+.002];
      for(let d=cut+.005;d<length-.009;d+=.004)rings.push(d);
      for(const e of [edge1,edge2])for(const off of [-.006,-.003,0,.003,.006]){
        const d=e+off;if(d>cut+.002 && d<length-.009)rings.push(d);
      }
      rings.push(length-.0085,length-.0065,length-.0045,length-.0026,length-.0012,length-.00035);
      rings.sort((a,b)=>a-b);
      const unique=rings.filter((d,i)=>!i||d-rings[i-1]>.00015);
      const start=loft(unique,sides,(d,a)=>sample(d,a,1),1);
      col.setRGB(1,.978,.952);
      const tip=vertex(def.x,baseY-.0007,def.z-length,col,ids[2]);
      cap(start+(unique.length-1)*(sides+1),sides,tip,1,true);
    });
    // Short, gently arched nails follow the distal phalanx. The perimeter stays
    // close to the skin; there is no floating white plate across the finger.
    part(`${name}-nail`, 2, () => {
      const rows=7,cols=10,start=positions.length/3;
      const first=length-(thumb?.0155:.014),last=length-.0031;
      for(let r=0;r<=rows;r++)for(let s=0;s<=cols;s++){
        const v=r/rows,u=s/cols*2-1,d=lerp(first,last,v);
        const radius=profile(d),corner=Math.sqrt(Math.max(.38,1-((v-.5)*1.45)**4));
        const width=radius*.68*corner,x=width*u;
        const dorsal=radius*.86*Math.sqrt(Math.max(0,1-(x/radius)**2));
        const lift=.0002+.00018*Math.sin(v*Math.PI)*(1-u*u);
        col.setRGB(.98,.974,.965);
        if(r===0||s===0||s===cols)col.multiplyScalar(.95);
        vertex(def.x+x,baseY-.0007*smooth(d,edge2,length)+dorsal+lift,def.z-d,col,ids[2]);
      }
      for(let r=0;r<rows;r++)for(let s=0;s<cols;s++){
        const a=start+r*(cols+1)+s,b=a+1,c=a+cols+1,d=c+1;
        tri(a,b,c,2);tri(b,d,c,2);
      }
    });
    return bones;
  }
  const fingers=FINGERS.map((def,index)=>digit(def,index));
  const thumb=digit({x:-.031,z:-.026,lengths:[.028,.025,.021],radius:.0121},4,true);
  // Thin interdigital webs bridge the palm into the finger sleeves. Their skin
  // weights fan into both neighbouring MCP joints, so the saddle remains soft
  // when the fingers spread or curl independently.
  for(let gap=0;gap<3;gap++)part(`web${gap}`,0,()=>{
    const a=FINGERS[gap],b=FINGERS[gap+1],rows=6,cols=8;
    const surface=[];
    for(const face of [1,-1]){
      const start=positions.length/3;surface.push(start);
      for(let r=0;r<=rows;r++)for(let s=0;s<=cols;s++){
        const t=r/rows,u=s/cols,mid=(a.x+b.x)*.5;
        const x=lerp(lerp(a.x+.001,b.x-.001,u),mid+(u-.5)*.0045,t);
        const z=lerp(a.z,b.z,u)+lerp(.015,-.002,t)+Math.sin(u*Math.PI)*t*.002;
        const y=face*(lerp(.0108,.0038,t)+Math.sin(u*Math.PI)*.0007);
        col.copy(face>0?FABRIC:PALM).multiplyScalar(1-.075*t*Math.sin(u*Math.PI));
        vertex(x,y,z,col);
        const weight=smooth(t,0,1)*.58,k=skin.length-4;
        skin[k]=0;skin[k+1]=digits[gap].boneIds[0];skin[k+2]=digits[gap+1].boneIds[0];
        weights[k]=1-weight;weights[k+1]=weight*(1-u);weights[k+2]=weight*u;
      }
      for(let r=0;r<rows;r++)for(let s=0;s<cols;s++){
        const i=start+r*(cols+1)+s,j=i+1,k=i+cols+1,l=k+1;
        if(face>0){tri(i,j,k);tri(j,l,k);}else{tri(i,k,j);tri(j,k,l);}
      }
    }
    const top=surface[0]+rows*(cols+1),bottom=surface[1]+rows*(cols+1);
    for(let s=0;s<cols;s++){tri(top+s,top+s+1,bottom+s);tri(top+s+1,bottom+s+1,bottom+s);}
  });
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  const uv=new Float32Array(positions.length/3*2);
  for(let i=0;i<positions.length/3;i++){uv[i*2]=positions[i*3]*28;uv[i*2+1]=positions[i*3+2]*28;}
  geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));
  geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(skin,4));
  geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
  const ordered=[];
  for(let material=0;material<3;material++){
    geometry.addGroup(ordered.length,indices[material].length,material);ordered.push(...indices[material]);
  }
  geometry.setIndex(ordered);geometry.computeVertexNormals();
  const normals=geometry.attributes.normal;
  for(const [a,b] of seams){
    const x=normals.getX(a)+normals.getX(b),y=normals.getY(a)+normals.getY(b),z=normals.getZ(a)+normals.getZ(b),l=Math.hypot(x,y,z)||1;
    normals.setXYZ(a,x/l,y/l,z/l);normals.setXYZ(b,x/l,y/l,z/l);
  }
  geometry.computeBoundingSphere();
  geometry.userData={parts,digits,materialLayout:['glove','skin','nail'],uvTilesPerMetre:28};
  return {geometry,fingers,thumb};
}

function sleeveGeometry(exposed=false){
  const sections=exposed?[0,.06,.12,.18,.205,.225,.245,.265,.31,.37,.44,.52,.60,.68,.75,.82,.88,.93,.965,1]:null;
  const rings=sections?sections.length-1:18,sides=20,positions=new Float32Array((rings+1)*(sides+1)*3),indices=[];
  const uv=new Float32Array((rings+1)*(sides+1)*2),colors=new Float32Array(positions.length);
  for(let r=0;r<=rings;r++)for(let s=0;s<=sides;s++){
    const i=r*(sides+1)+s,t=sections?sections[r]:r/rings,a=s/sides*Math.PI*2;
    uv[i*2]=s/sides*1.8;uv[i*2+1]=t*3.3;
    const value=.92-.06*Math.cos(a+.7)+.025*Math.sin(t*8+a*2);
    colors[i*3]=value;colors[i*3+1]=value;colors[i*3+2]=value;
  }
  for(let r=0;r<rings;r++)for(let s=0;s<sides;s++){
    const a=r*(sides+1)+s;indices.push(a,a+sides+1,a+1,a+1,a+sides+1,a+sides+2);
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('uv',new THREE.BufferAttribute(uv,2));geo.setAttribute('color',new THREE.BufferAttribute(colors,3));
  geo.setIndex(indices);geo.computeVertexNormals();
  geo.userData={rings,sides,sections,exposed,skinStart:.245,wristInHand:.025,wristRadii:[.0265,.0175],frames:new Float32Array((rings+1)*12)};
  if(exposed){geo.addGroup(0,6*sides*6,0);geo.addGroup(6*sides*6,indices.length-6*sides*6,1);}
  return geo;
}

export function createViewArm(side,material,sleeveMaterial){
  const g=new THREE.Group(),hand=new THREE.Group(),root=new THREE.Bone();root.name='wrist';const bones=[root];
  const {geometry,fingers,thumb}=gloveGeometry(side,root,bones);
  const mesh=new THREE.SkinnedMesh(geometry,material);mesh.add(root);mesh.bind(new THREE.Skeleton(bones));mesh.frustumCulled=false;
  hand.add(mesh);g.add(hand);
  const fore=new THREE.Mesh(sleeveGeometry(true),[sleeveMaterial,Array.isArray(material)?material[1]:material]);
  const upper=new THREE.Mesh(sleeveGeometry(),sleeveMaterial);
  fore.frustumCulled=upper.frustumCulled=false;g.add(fore,upper);
  return {g,hand,mesh,fore,upper,fingers,thumb,trigger:fingers[0][0],side,poseReady:false,
    contact:new THREE.Vector3(),wrist:new THREE.Vector3(),elbow:new THREE.Vector3(),shoulder:new THREE.Vector3(),
    forearmQuaternion:new THREE.Quaternion(),wristQuaternion:new THREE.Quaternion(),forearmDirection:new THREE.Vector3(),
    wristBend:0,wristBendDegrees:0,ikReady:false};
}

const indexTarget=new THREE.Vector3(),indexDirection=new THREE.Vector3(),indexPole=new THREE.Vector3();
const indexX=new THREE.Vector3(),indexY=new THREE.Vector3(),indexZ=new THREE.Vector3();
const indexMatrix=new THREE.Matrix4(),indexRootQ=new THREE.Quaternion(),indexBlendQ=new THREE.Quaternion();
const indexEuler=new THREE.Euler();
const indexCurl=[0,0,0];
function solveGripIndex(arm,grip,trigger){
  // Only the firing index follows a gun target. Its first knuckle stays on the
  // outside of the guard, then the two distal links curl toward the trigger.
  // The rest of the hand continues to wrap the authored grip unchanged.
  const pull=THREE.MathUtils.clamp(trigger,0,1),l0=.033,l1=.022,l2=.019;
  indexTarget.lerpVectors(grip.rest,grip.fire,pull).sub(arm.fingers[0][0].position);
  const distance=indexTarget.length();
  if(!Number.isFinite(distance)||distance<.001)return false;
  const dip=lerp(.08,.32,pull),length=Math.hypot(l1+l2*Math.cos(dip),l2*Math.sin(dip));
  const reach=THREE.MathUtils.clamp(distance,.026,l0+length-.00005);
  indexDirection.copy(indexTarget).multiplyScalar(1/distance);
  indexPole.copy(grip.pole).addScaledVector(indexDirection,-grip.pole.dot(indexDirection));
  if(indexPole.lengthSq()<.0001)indexPole.set(0,1,0).addScaledVector(indexDirection,-indexDirection.y);
  if(indexPole.lengthSq()<.0001)return false;
  indexPole.normalize();
  const alpha=Math.acos(THREE.MathUtils.clamp((l0*l0+reach*reach-length*length)/(2*l0*reach),-1,1));
  const bend=Math.acos(THREE.MathUtils.clamp((reach*reach-l0*l0-length*length)/(2*l0*length),-1,1));
  indexZ.copy(indexDirection).multiplyScalar(-Math.cos(alpha)).addScaledVector(indexPole,-Math.sin(alpha));
  indexY.copy(indexPole).multiplyScalar(Math.cos(alpha)).addScaledVector(indexDirection,-Math.sin(alpha));
  indexX.crossVectors(indexY,indexZ).normalize();
  indexMatrix.makeBasis(indexX,indexY,indexZ);indexRootQ.setFromRotationMatrix(indexMatrix);
  indexCurl[1]=Math.max(0,bend-Math.atan2(l2*Math.sin(dip),l1+l2*Math.cos(dip)));
  indexCurl[2]=dip;
  return true;
}

export function poseGlove(arm,kind,trigger,dt,blendKind=null,blend=0,open=0,indexGrip=null){
  const sign=arm.side==='R'?1:-1,base=CURL[kind]||CURL.grip,other=CURL[blendKind]||base;
  const alpha=arm.poseReady?1-Math.exp(-Math.max(0,dt)*26):1;
  const gripWeight=arm.side==='R'&&indexGrip?((kind==='grip'?1-blend:0)+(blendKind==='grip'?blend:0))*(1-open):0;
  const indexWeight=gripWeight>0&&solveGripIndex(arm,indexGrip,trigger)?gripWeight:0;
  for(let i=0;i<4;i++)for(let j=0;j<3;j++){
    let angle=lerp(base[i][j],other[i][j],blend);angle=lerp(angle,CURL.open[i][j],open);
    if(i===0&&arm.side==='R'&&kind==='grip')angle=lerp(angle,TRIGGER[j],trigger);
    const b=arm.fingers[i][j];
    if(i===0&&indexWeight>0&&j===0){
      indexEuler.set(-angle,sign*(i-1.5)*.025,0);
      indexBlendQ.setFromEuler(indexEuler).slerp(indexRootQ,indexWeight);
      b.quaternion.slerp(indexBlendQ,alpha);continue;
    }
    if(i===0&&indexWeight>0)angle=lerp(angle,indexCurl[j],indexWeight);
    b.rotation.x+=(-angle-b.rotation.x)*alpha;
    b.rotation.y+=(sign*(i-1.5)*.025*(j===0?1:0)-b.rotation.y)*alpha;
    if(i===0)b.rotation.z+=(0-b.rotation.z)*alpha;
  }
  const pinch=(kind==='rack'?1:0)*(1-blend)+(blendKind==='rack'?blend:0);
  const support=(kind==='support'||kind==='pistol-support'?1:0)*(1-blend)
    +(blendKind==='support'||blendKind==='pistol-support'?blend:0);
  const pistol=(kind==='pistol-support'?1:0)*(1-blend)+(blendKind==='pistol-support'?blend:0);
  const cradle=(kind==='cradle'?1:0)*(1-blend)+(blendKind==='cradle'?blend:0);
  for(let j=0;j<3;j++){
    const b=arm.thumb[j];
    // Reduced metacarpal opposition removes the old high arched thumb while
    // keeping the pinch used by charging-handle and magazine interactions.
    let x=j===0?-.28:j===1?-.50-pinch*.35:-.60-pinch*.20;
    let y=j===0?.65:j===1?-.34:-.13,z=j===0?.17:0;
    x=lerp(x,j===0?-.10:-.15,support);y=lerp(y,j===0?.08:0,support);z*=1-support;
    x=lerp(x,j===0?-.06:-.10,pistol);y=lerp(y,j===0?.045:0,pistol);
    x=lerp(x,j===0?-.08:-.20,cradle);y=lerp(y,j===0?1.0:j===1?-.10:0,cradle);z=lerp(z,j===0?.10:0,cradle);
    b.rotation.x+=(x*(1-open*.7)-b.rotation.x)*alpha;
    b.rotation.y+=(y*sign-b.rotation.y)*alpha;b.rotation.z+=(z*sign-b.rotation.z)*alpha;
  }
  arm.poseReady=true;
}

// Scratch vectors are shared: arm solving is synchronous and allocates no objects.
const centre=new THREE.Vector3(),tangent=new THREE.Vector3(),axis=new THREE.Vector3(),normal=new THREE.Vector3();
const delta=new THREE.Vector3(),curve=new THREE.Vector3(),startCurve=new THREE.Vector3(),referenceX=new THREE.Vector3(),endAxis=new THREE.Vector3();
const transportedAxis=new THREE.Vector3(),transportedNormal=new THREE.Vector3();
const foreDirection=new THREE.Vector3(),elbowAxis=new THREE.Vector3();
const previousTangent=new THREE.Vector3(),transportRotation=new THREE.Quaternion();
const preferredPole=new THREE.Vector3(),candidatePole=new THREE.Vector3(),candidateElbow=new THREE.Vector3(),circleCentre=new THREE.Vector3();
const previousElbow=new THREE.Vector3();
const canonicalPole=new THREE.Vector3(),constraintPole=new THREE.Vector3(),startingPole=new THREE.Vector3();
const polePerpendicular=new THREE.Vector3(),frameX=new THREE.Vector3(),frameY=new THREE.Vector3(),frameZ=new THREE.Vector3();
const forearmMatrix=new THREE.Matrix4(),wristFrame=new THREE.Quaternion(),elbowFrame=new THREE.Quaternion(),targetFrame=new THREE.Quaternion();
const back=new THREE.Vector3(),direction=new THREE.Vector3(),pole=new THREE.Vector3(),upperEnd=new THREE.Vector3();
function warpSleeve(mesh,a,b,endDirection,r0,r1,handQuaternion=null,startDirection=null,side=1,endFrameAxis=null,forearmQuaternion=null){
  const geo=mesh.geometry,{rings,sides,sections,exposed}=geo.userData,p=geo.attributes.position,c=geo.attributes.color;
  delta.subVectors(b,a);const len=delta.length();curve.copy(endDirection).multiplyScalar(-len*.82).sub(delta);
  if(startDirection)startCurve.copy(startDirection).multiplyScalar(len*.82).sub(delta);else startCurve.set(0,0,0);
  if(handQuaternion)referenceX.set(1,0,0).applyQuaternion(forearmQuaternion||handQuaternion);
  else if(endFrameAxis)referenceX.copy(endFrameAxis);
  let wristCompression=0;
  if(exposed && handQuaternion){
    frameZ.set(0,0,1).applyQuaternion(handQuaternion);
    const bend=Math.acos(THREE.MathUtils.clamp(-frameZ.dot(foreDirection),-1,1));
    wristCompression=smooth(bend,THREE.MathUtils.degToRad(35),THREE.MathUtils.degToRad(70));
  }
  const frames=geo.userData.frames;
  const startAngle=exposed&&startDirection?Math.acos(THREE.MathUtils.clamp(startDirection.dot(foreDirection),.001,1)):0;
  const startLog=startAngle>.00001?Math.asinh(Math.tan(startAngle)):0;
  // A tilted ring has little distance to its next ring along its own normal.
  // Allocate rotation proportional to cos(tilt), so adjacent sections cannot
  // overtake each other on the inner side of a deeply folded elbow.
  const elbowTransition=exposed?Math.max(.45,Math.min(.72,.055*startLog/Math.max(.1,len))):0;
  for(let r=0;r<=rings;r++){
    const t=sections?sections[r]:r/rings;
    if(exposed){
      // A rigid radius/ulna axis. Hand rotation changes the wrist joint, not a
      // large bend through the forearm's visible centreline.
      centre.copy(a).lerp(b,t);tangent.copy(delta).normalize();
      if(t<elbowTransition && startDirection && startAngle>.00001){
        const remaining=Math.atan(Math.sinh(startLog*(1-t/elbowTransition))),denominator=Math.sin(startAngle);
        tangent.copy(startDirection).multiplyScalar(Math.sin(remaining)/denominator)
          .addScaledVector(foreDirection,Math.sin(startAngle-remaining)/denominator).normalize();
      }
    }else{
      centre.copy(a).lerp(b,t).addScaledVector(curve,t*t*(t-1));
      tangent.copy(delta).addScaledVector(curve,3*t*t-2*t).normalize();
    }
    // Parallel transport, then solve one endpoint twist for the whole loft.
    // Projecting the target axis at every ring crosses a pole when the arm
    // bends through it and produces a hidden half-turn in the mesh.
    if(r===0){
      transportedAxis.crossVectors(tangent,UP);
      if(transportedAxis.lengthSq()<.00001)transportedAxis.set(1,0,0);
      transportedAxis.normalize();
      geo.userData.elbowPhase=0;
    }else{
      transportRotation.setFromUnitVectors(previousTangent,tangent);
      transportedAxis.applyQuaternion(transportRotation).normalize();
    }
    transportedNormal.crossVectors(transportedAxis,tangent).normalize();previousTangent.copy(tangent);
    const offset=r*12;centre.toArray(frames,offset);tangent.toArray(frames,offset+3);
    transportedAxis.toArray(frames,offset+6);transportedNormal.toArray(frames,offset+9);
  }
  let totalTwist=0;
  if(handQuaternion || endFrameAxis){
    endAxis.copy(referenceX).addScaledVector(tangent,-referenceX.dot(tangent)).normalize();
    totalTwist=Math.atan2(transportedNormal.dot(endAxis),transportedAxis.dot(endAxis));
  }
  for(let r=0;r<=rings;r++){
    const t=sections?sections[r]:r/rings,offset=r*12;
    centre.fromArray(frames,offset);tangent.fromArray(frames,offset+3);
    axis.fromArray(frames,offset+6);transportedNormal.fromArray(frames,offset+9);
    const twist=totalTwist*smooth(t,.20,exposed?.85:1);
    axis.multiplyScalar(Math.cos(twist)).addScaledVector(transportedNormal,Math.sin(twist)).normalize();
    normal.crossVectors(axis,tangent).normalize();
    if(exposed && forearmQuaternion){
      // Keep one axial roll over exposed muscle; only swing the section plane
      // gently away from the shared elbow cut. Axial twist stays in the sleeve.
      transportRotation.setFromUnitVectors(foreDirection,tangent);
      wristFrame.copy(transportRotation).multiply(forearmQuaternion);
      if(t<.245){
        frameX.fromArray(frames,offset+6);frameY.fromArray(frames,offset+9);frameZ.copy(tangent).negate();
        elbowFrame.setFromRotationMatrix(forearmMatrix.makeBasis(frameX,frameY,frameZ));
        targetFrame.copy(wristFrame);wristFrame.slerpQuaternions(elbowFrame,targetFrame,smooth(t,0,.245));
      }else if(t>.80)wristFrame.slerpQuaternions(forearmQuaternion,handQuaternion,smooth(t,.80,1));
      axis.set(1,0,0).applyQuaternion(wristFrame);normal.set(0,1,0).applyQuaternion(wristFrame);
    }
    const taper=handQuaternion?Math.pow(t,.82):t;
    const muscle=Math.sin(t*Math.PI)*(handQuaternion?.0045:.003);
    const baseRadius=lerp(r0,r1,taper)+muscle;
    for(let s=0;s<=sides;s++){
      const angle=s/sides*Math.PI*2;
      // Sparse, diagonal compression folds around elbow and wrist. The angular
      // terms prevent a row of identical rings resembling a corrugated hose.
      const envelope=Math.sin(Math.PI*t);
      const wristFold=gauss(t-.73,.20)*Math.sin(t*17+Math.sin(angle)*1.8+angle*2);
      const elbowFold=gauss(t-.16,.15)*Math.sin(t*19-angle*2+.4);
      const fold=envelope*(.0048*wristFold+.0036*elbowFold);
      const radius=baseRadius+fold,ellipse=lerp(.88,handQuaternion?.755:.88,t);
      let x=Math.cos(angle)*radius,y=Math.sin(angle)*radius*ellipse;
      let skinShade=1;
      if(exposed){
        const taper=smooth(t,.30,1),belly=smooth(t,0,.30);
        let width=lerp(lerp(.045,.0475,belly),.0265,taper);
        let depth=lerp(lerp(.0396,.0380,belly),.0175,taper);
        // The final rings sit inside the cuff. Soft tissue compresses there
        // during free wrist flex instead of intersecting its own inner bridge.
        const compression=wristCompression*smooth(t,.925,1);
        width*=1-.32*compression;depth*=1-.38*compression;
        const cs=Math.cos(angle),sn=Math.sin(angle);
        // The proximal radial muscle is fuller; two bony sides emerge gradually
        // from that muscle rather than a uniform circular taper.
        const outer=Math.max(0,-cs*side),inner=Math.max(0,cs*side);
        const form=(.0028*gauss(t-.39,.20)*outer+.0011*gauss(t-.80,.13)*inner)*Math.sin(Math.PI*t);
        width+=form;depth+=.0014*gauss(t-.40,.22)*Math.max(0,-sn)*Math.sin(Math.PI*t);
        if(t<=.245){
          const roll=.0039*gauss(t-.218,.025),clothFold=.0018*Math.sin(t*28+angle*2)*Math.sin(Math.PI*t/.245);
          width+=roll+clothFold;depth+=roll+clothFold*.8;
        }
        x=cs*width;y=sn*depth;
        if(t>.245){
          const tendonT=smooth(t,.54,.79)*(1-smooth(t,.94,1));
          const a1=Math.atan2(Math.sin(angle-Math.PI*.40),Math.cos(angle-Math.PI*.40));
          const a2=Math.atan2(Math.sin(angle-Math.PI*.60),Math.cos(angle-Math.PI*.60));
          const tendons=(gauss(a1,.13)+gauss(a2,.13))*tendonT;
          y+=.00085*tendons;
          skinShade=1-.022*gauss(t-.27,.035)-.012*tendonT*Math.max(0,sn);
        }
      }
      const i=r*(sides+1)+s;
      p.setXYZ(i,centre.x+axis.x*x+normal.x*y,centre.y+axis.y*x+normal.y*y,centre.z+axis.z*x+normal.z*y);
      const seamAngle=Math.atan2(Math.sin(angle-Math.PI*.1),Math.cos(angle-Math.PI*.1));
      const stitchAngle=Math.atan2(Math.sin(angle-Math.PI*.1-.15),Math.cos(angle-Math.PI*.1-.15));
      const sewn=-.07*gauss(seamAngle,.12)+.025*gauss(stitchAngle,.12);
      const shade=1+Math.min(0,fold)*30+Math.max(0,fold)*9;
      const value=(.94-.045*Math.cos(angle+.7)+sewn)*shade;
      if(exposed && t>=.245)c.setXYZ(i,skinShade,skinShade*.984,skinShade*.972);
      else c.setXYZ(i,value,value,value);
    }
  }
  p.needsUpdate=true;c.needsUpdate=true;geo.computeVertexNormals();
  const n=geo.attributes.normal;
  for(let r=0;r<=rings;r++){
    const a=r*(sides+1),b=a+sides,x=n.getX(a)+n.getX(b),y=n.getY(a)+n.getY(b),z=n.getZ(a)+n.getZ(b),l=Math.hypot(x,y,z)||1;
    n.setXYZ(a,x/l,y/l,z/l);n.setXYZ(b,x/l,y/l,z/l);
  }
}

// Apply the same wrist preference to a fresh authored pole or a continued pole.
// This helper has no pose history and never changes the two-bone circle.
function constrainWristPole(out,wrist,height,targetDot,stepLimit=Infinity){
  constraintPole.copy(out);
  candidateElbow.copy(circleCentre).addScaledVector(constraintPole,height);
  foreDirection.subVectors(wrist,candidateElbow).normalize();
  preferredPole.copy(back).addScaledVector(direction,-back.dot(direction));
  if(preferredPole.lengthSq()<=.00001)return;
  const poleAuthority=smooth(preferredPole.length(),.08,.30);
  preferredPole.normalize();let lo=0,hi=-foreDirection.dot(back)<targetDot?1:0;
  polePerpendicular.crossVectors(direction,constraintPole).normalize();
  const angle=Math.atan2(preferredPole.dot(polePerpendicular),preferredPole.dot(constraintPole));
  for(let step=0;hi>0 && step<9;step++){
    const mix=(lo+hi)*.5;
    candidatePole.copy(constraintPole).multiplyScalar(Math.cos(angle*mix)).addScaledVector(polePerpendicular,Math.sin(angle*mix));
    candidateElbow.copy(circleCentre).addScaledVector(candidatePole,height);
    foreDirection.subVectors(wrist,candidateElbow).normalize();
    if(-foreDirection.dot(back)<targetDot)lo=mix;else hi=mix;
  }
  const swivel=THREE.MathUtils.clamp(angle*hi*poleAuthority,-stepLimit,stepLimit);
  out.copy(constraintPole).multiplyScalar(Math.cos(swivel)).addScaledVector(polePerpendicular,Math.sin(swivel)).normalize();
}

// forearmQuaternion is an independently authored reference roll. wristFlexLimit
// is in degrees; restWeight restores a held pose toward its history-free pole.
export function solveViewArm(arm,handPosition,handQuaternion,holderShift,hints=DEFAULT_ARM_HINTS){
  previousElbow.copy(arm.elbow);
  const continuous=Number.isFinite(hints.dt)&&hints.dt>0,continuing=continuous&&arm.ikReady;
  arm.hand.position.copy(handPosition);arm.hand.quaternion.copy(handQuaternion);
  back.set(0,0,1).applyQuaternion(handQuaternion);
  // The skin endpoint sits eight millimetres inside the thin glove cuff.
  const wrist=arm.wrist.copy(handPosition).addScaledVector(back,.025);
  const right=arm.side==='R',shoulder=arm.shoulder.set(right?.31:-.27,-.34,right?-.08:-.20).addScaledVector(holderShift,.48);
  direction.subVectors(wrist,shoulder);const distance=Math.max(.001,direction.length());direction.multiplyScalar(1/distance);
  // Slightly longer upper arm with reach-preserving stretch for authored poses.
  const stretch=Math.max(1,distance/.585),upperLength=.315*stretch,foreLength=.285*stretch;
  const along=THREE.MathUtils.clamp((upperLength*upperLength-foreLength*foreLength+distance*distance)/(2*distance),0,distance);
  const height=Math.sqrt(Math.max(.0001,upperLength*upperLength-along*along));
  pole.set(right?.55:-.53,-.72,-.23).sub(shoulder).addScaledVector(direction,-pole.dot(direction));
  if(pole.lengthSq()<.00001)pole.set(0,-1,0).addScaledVector(direction,direction.y);
  pole.normalize();
  canonicalPole.copy(pole);
  circleCentre.copy(shoulder).addScaledVector(direction,along);
  if(continuing){
    // Select the nearest physical solution on the new IK circle. Rebuilding a
    // fixed world pole each frame switches between equally valid elbow sides
    // as the wrist crosses the circle's axis during a reload.
    candidatePole.subVectors(previousElbow,circleCentre).addScaledVector(direction,-candidatePole.dot(direction));
    if(candidatePole.lengthSq()>.00001)pole.copy(candidatePole).normalize();
  }
  const limit=THREE.MathUtils.degToRad(THREE.MathUtils.clamp(hints.wristFlexLimit??28,15,65)),targetDot=Math.cos(limit);
  const stepLimit=continuing?Math.min(hints.dt,.05)*10:Infinity;
  const restWeight=Number.isFinite(hints.restWeight)?THREE.MathUtils.clamp(hints.restWeight,0,1):0;
  startingPole.copy(pole);
  constrainWristPole(pole,wrist,height,targetDot,stepLimit);
  if(continuing && restWeight>0){
    // The target is exactly the original authored hold pose for these inputs,
    // including its wrist preference. It does not inherit an action's elbow.
    constrainWristPole(canonicalPole,wrist,height,targetDot);
    polePerpendicular.crossVectors(direction,pole).normalize();
    const angle=Math.atan2(canonicalPole.dot(polePerpendicular),canonicalPole.dot(pole));
    const alpha=1-Math.exp(-18*Math.min(hints.dt,.05)*restWeight);
    candidatePole.copy(pole).multiplyScalar(Math.cos(angle*alpha)).addScaledVector(polePerpendicular,Math.sin(angle*alpha));
    pole.copy(candidatePole).normalize();
    // Recovery shares the existing swivel budget with wrist correction.
    polePerpendicular.crossVectors(direction,startingPole).normalize();
    const totalAngle=Math.atan2(pole.dot(polePerpendicular),pole.dot(startingPole));
    const boundedAngle=THREE.MathUtils.clamp(totalAngle,-stepLimit,stepLimit);
    pole.copy(startingPole).multiplyScalar(Math.cos(boundedAngle)).addScaledVector(polePerpendicular,Math.sin(boundedAngle)).normalize();
  }
  const elbow=arm.elbow.copy(circleCentre).addScaledVector(pole,height);
  arm.ikReady=true;
  foreDirection.subVectors(wrist,elbow).normalize();
  arm.forearmDirection.copy(foreDirection);
  // Swing the whole reference frame onto the bone axis. Projecting only its X
  // axis becomes singular when X points along the arm and flips the roll 180°.
  const reference=hints.forearmQuaternion||handQuaternion;
  // Use the current hand's back axis as the intermediate direction. A delayed
  // reference can oppose the bone during a reload even though it remains less
  // than a half turn from the hand; each of these two swings stays well defined.
  frameZ.set(0,0,1).applyQuaternion(reference);
  transportRotation.setFromUnitVectors(frameZ,back);
  arm.forearmQuaternion.copy(transportRotation).multiply(reference);
  frameY.copy(foreDirection).negate();transportRotation.setFromUnitVectors(back,frameY);
  arm.forearmQuaternion.premultiply(transportRotation).normalize();
  arm.wristQuaternion.copy(arm.forearmQuaternion).invert().multiply(handQuaternion);
  arm.wristBend=Math.acos(THREE.MathUtils.clamp(-foreDirection.dot(back),-1,1));
  arm.wristBendDegrees=THREE.MathUtils.radToDeg(arm.wristBend);
  upperEnd.copy(direction).negate();
  elbowAxis.crossVectors(direction,UP).normalize();
  warpSleeve(arm.upper,shoulder,elbow,upperEnd,.057,.045,null,null,1,elbowAxis);
  warpSleeve(arm.fore,elbow,wrist,back,.045,.0265,handQuaternion,direction,right?1:-1,null,arm.forearmQuaternion);
  // These meshes share a geometric elbow ring. Weld its shading only after
  // constructing outward-facing strips on both sides, just as a single mesh
  // would average its two incident sets of faces at this cloth seam.
  const upperNormals=arm.upper.geometry.attributes.normal,foreNormals=arm.fore.geometry.attributes.normal;
  const {rings,sides}=arm.upper.geometry.userData,first=rings*(sides+1),phase=arm.fore.geometry.userData.elbowPhase||0;
  for(let s=0;s<sides;s++){
    const j=(s+phase)%sides;
    normal.fromBufferAttribute(upperNormals,first+s);
    normal.x+=foreNormals.getX(j);normal.y+=foreNormals.getY(j);normal.z+=foreNormals.getZ(j);normal.normalize();
    upperNormals.setXYZ(first+s,normal.x,normal.y,normal.z);foreNormals.setXYZ(j,normal.x,normal.y,normal.z);
  }
  upperNormals.setXYZ(first+sides,upperNormals.getX(first),upperNormals.getY(first),upperNormals.getZ(first));
  foreNormals.setXYZ(sides,foreNormals.getX(0),foreNormals.getY(0),foreNormals.getZ(0));
  upperNormals.needsUpdate=foreNormals.needsUpdate=true;
}
