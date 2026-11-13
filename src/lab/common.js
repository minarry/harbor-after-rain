import * as THREE from 'three';

export const range=(key,label,value,min,max,step=.05)=>({key,label,value,min,max,step,type:'range'});
export const toggle=(key,label,value)=>({key,label,value,type:'toggle'});
export const select=(key,label,value,options)=>({key,label,value,type:'select',options:options.map(x=>typeof x==='string'?{value:x,label:x}:x)});
export const action=(id,label)=>({id,label});
export const camera=(id,label,pos,target=[0,1,0])=>({id,label,pos,target});
export const check=(name,pass,detail='')=>({name,pass:!!pass,detail});

export function box(ctx,position,size,material,collision=true){
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),material);
  mesh.position.set(...position);mesh.castShadow=true;mesh.receiveShadow=true;ctx.scene.add(mesh);
  if(collision)mesh.userData.labCollider=ctx.world.add({x:position[0],y:position[1],z:position[2],sx:size[0],sy:size[1],sz:size[2],mat:'metal'});
  return mesh;
}
export function floor(ctx,width=32,depth=24){
  const mesh=box(ctx,[0,-.18,0],[width,.36,depth],ctx.materials.deck.mat);
  mesh.name='deck';mesh.castShadow=false;
  Object.assign(mesh.userData.labCollider,{tag:'deck',mat:'deck',surface:'metal',navSurface:true});
  const uv=mesh.geometry.attributes.uv;for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*width/4,uv.getY(i)*depth/4);
  return mesh;
}
export function label(ctx,text,pos,scale=1.8){
  const c=document.createElement('canvas');c.width=512;c.height=96;
  const g=c.getContext('2d');g.fillStyle='rgba(10,22,27,.9)';g.fillRect(0,0,512,96);
  g.fillStyle='#efc276';g.fillRect(0,0,5,96);g.font='500 34px sans-serif';g.fillStyle='#eef3f0';g.textAlign='center';g.textBaseline='middle';g.fillText(text,256,48,480);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:t,depthTest:true,toneMapped:false}));
  sprite.position.set(...pos);sprite.scale.set(scale,scale*96/512,1);ctx.scene.add(sprite);return sprite;
}
export function normalWire(root,visible){root.traverse(o=>{if(o.isMesh&&!o.isSprite&&o.material?.isMeshStandardMaterial)o.material.wireframe=visible;});}
export function galleryCameras(){return [camera('overview','全景',[10,6.3,12],[0,1,0]),camera('front','正面',[0,3.2,12],[0,1,0]),camera('detail','近看',[3,1.9,7],[0,.6,3.5])];}
