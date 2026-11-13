// Pointer ownership and movement math, independent of the DOM and the player.
const ACTIONS=new Set(['move','look','fire','fire-left','jump','crouch','reload','switch','aim','pause']);
const looks=action=>action==='look'||action==='fire';
const fires=action=>action==='fire'||action==='fire-left';

export function nextTouchSlot(inventory=[],slot=0) {
  for(let step=1;step<inventory.length;step++) {
    const next=(slot+step)%inventory.length,weapon=inventory[next];
    if(weapon&&!(weapon.def?.type==='grenade'&&weapon.mag<=0))return next;
  }
  return null;
}

export class TouchInputState {
  constructor({deadZone=.14,lookScale=1.6}={}) {
    this.deadZone=Math.max(0,Math.min(.9,deadZone));this.lookScale=lookScale;
    this.pointers=new Map();this.fireIds=new Set();this.reset();
  }
  start(id,action,x,y,{radius=60}={}) {
    if(!ACTIONS.has(action)||this.pointers.has(id)||!Number.isFinite(x)||!Number.isFinite(y))return false;
    if(action==='move'&&this.moveId!==null)return false;
    this.pointers.set(id,{action,x,y,originX:x,originY:y,radius:Math.max(1,radius)});
    if(action==='move')this.moveId=id;
    if(looks(action)&&this.lookId===null)this.lookId=id;
    if(fires(action))this.fireIds.add(id);
    return true;
  }
  move(id,x,y) {
    const pointer=this.pointers.get(id);
    if(!pointer||!Number.isFinite(x)||!Number.isFinite(y))return false;
    const dx=x-pointer.x,dy=y-pointer.y;pointer.x=x;pointer.y=y;
    if(id===this.moveId) {
      const mx=x-pointer.originX,my=y-pointer.originY,length=Math.hypot(mx,my),limited=Math.min(length,pointer.radius);
      this.knobX=length?mx/length*limited:0;this.knobY=length?my/length*limited:0;
      const amount=Math.max(0,(limited/pointer.radius-this.deadZone)/(1-this.deadZone));
      this.mx=length?mx/length*amount:0;this.mz=length?-my/length*amount:0;
    }
    if(id===this.lookId){this.lookX+=dx*this.lookScale;this.lookY+=dy*this.lookScale;}
    return true;
  }
  end(id) {
    const pointer=this.pointers.get(id);if(!pointer)return null;
    this.pointers.delete(id);this.fireIds.delete(id);
    if(id===this.moveId){this.moveId=null;this.mx=this.mz=this.knobX=this.knobY=0;}
    if(id===this.lookId) {
      this.lookId=null;
      // Waiting fingers retain their own latest coordinates, so promotion does
      // not reuse another finger's drag origin and cannot jump the camera.
      for(const [next,entry]of this.pointers)if(looks(entry.action)){this.lookId=next;break;}
    }
    return pointer;
  }
  takeLook() {const value={x:this.lookX,y:this.lookY};this.lookX=this.lookY=0;return value;}
  count(action) {let count=0;for(const pointer of this.pointers.values())if(pointer.action===action)count++;return count;}
  reset() {
    this.pointers.clear();this.fireIds.clear();this.moveId=this.lookId=null;
    this.mx=this.mz=this.knobX=this.knobY=this.lookX=this.lookY=0;
  }
  snapshot() {return{moveId:this.moveId,lookId:this.lookId,fireIds:[...this.fireIds],pointerIds:[...this.pointers.keys()],mx:this.mx,mz:this.mz};}
}
