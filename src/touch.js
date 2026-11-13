// Two-thumb controls: each pointer keeps the role chosen at pointerdown.
import { TouchInputState, nextTouchSlot } from './touch-state.js';

const BUTTONS=[['fire','开火'],['fire-left','开火'],['jump','跳'],['crouch','蹲'],['reload','换弹'],['switch','切枪'],['aim','瞄准'],['pause','暂停']];
const clamp=(value,min,max)=>max>=min?Math.max(min,Math.min(max,value)):(min+max)/2;
const setClass=(element,name,on)=>{if(element&&element.classList.contains(name)!==on)element.classList.toggle(name,on);};
// Match CSS's serialized precision so a resting fractional touch coordinate
// does not write identical inline styles again on every rendered frame.
const setPixel=(element,key,value)=>{const pixel=`${Math.round(value*100)/100}px`;if(element.style[key]!==pixel)element.style[key]=pixel;};

export class TouchControls {
  constructor(game) {
    this.g=game;this.state=new TouchInputState();this.captures=new Map();this.meleeIds=new Set();
    this.player=null;this.active=false;this.weapon=null;this.altOwned=false;this.buttons=new Map();this.listeners=[];
    this.enabled=matchMedia('(pointer:coarse)').matches||new URLSearchParams(location.search).has('touch');
    if(!this.enabled)return;
    this.root=document.getElementById('touch');if(!this.root){this.enabled=false;return;}
    const create=(tag,className,id)=>{const element=document.createElement(tag);element.className=className;if(id)element.id=id;this.root.appendChild(element);return element;};
    this.moveZone=create('div','touch-zone','touch-move-zone');
    this.lookZone=create('div','touch-zone','touch-look-zone');
    this.pad=create('div','touch-pad');this.knob=create('div','touch-knob');
    this.pad.setAttribute('aria-hidden','true');this.knob.setAttribute('aria-hidden','true');
    this.listen(this.moveZone,'pointerdown',event=>this.start(event,'move'));
    this.listen(this.lookZone,'pointerdown',event=>this.start(event,'look'));
    for(const [action,label]of BUTTONS) {
      const button=create('button','btn');button.type='button';button.textContent=label;button.dataset.touchAction=action;
      button.setAttribute('aria-label',action==='fire'?'开火，按住拖动转向':label);button.setAttribute('aria-pressed','false');
      this.buttons.set(action,button);this.listen(button,'pointerdown',event=>this.start(event,action));
    }
    // Window listeners also cover a browser declining pointer capture.
    this.listen(window,'pointermove',event=>this.move(event));
    this.listen(window,'pointerup',event=>this.end(event));
    this.listen(window,'pointercancel',event=>this.end(event));
    this.listen(this.root,'lostpointercapture',event=>this.end(event));
    // Prevent compatibility mouse events reaching Player.bind a second time.
    for(const type of ['mousedown','mouseup','mousemove','click','dblclick','contextmenu'])this.listen(this.root,type,event=>this.consume(event));
    for(const type of ['blur','resize','orientationchange'])this.listen(window,type,()=>{this.reset();this.sync();});
    this.listen(document,'visibilitychange',()=>{if(document.hidden){this.reset();this.sync();}});
    this.sync();
  }
  listen(target,type,handler) {target.addEventListener(type,handler,{passive:false});this.listeners.push([target,type,handler]);}
  consume(event) {if(event.cancelable)event.preventDefault();event.stopPropagation();}
  inMatch() {const g=this.g;return this.enabled&&g.playing&&!g.ended&&!g.paused&&!g.inLoadout&&g.player&&!document.hidden;}
  playable() {return this.inMatch()&&this.g.player.alive?this.g.player:null;}
  sync() {
    const next=this.playable();
    if(next!==this.player||(!next&&this.state.pointers.size)) {
      this.reset();this.player=next;this.weapon=next?.weapon||null;
    }
    this.active=!!next;
    // Keep pause available during the death camera; gameplay buttons disable.
    setClass(this.root,'hidden',!this.inMatch());
    setClass(this.root,'is-disabled',!this.active);
    if(next) {
      if(this.weapon!==next.weapon) {
        this.meleeIds.clear();if(this.altOwned)next.mouse.r=false;this.altOwned=false;
        this.weapon=next.weapon;
      }
      this.applyHeld(next);
    }
    this.renderState();return this.active;
  }
  start(event,action) {
    if(event.pointerType==='mouse'&&event.button!==0)return;
    this.consume(event);this.sync();
    if(action==='pause'&&this.inMatch()){this.g.pause();this.sync();return;}
    if(!this.active)return;
    const p=this.player,radius=Math.max(1,(this.pad.getBoundingClientRect().width||120)/2);
    if(!this.state.start(event.pointerId,action,event.clientX,event.clientY,{radius}))return;
    const target=event.currentTarget;this.captures.set(event.pointerId,target);
    try{target.setPointerCapture?.(event.pointerId);}catch{/* Window events remain a fallback. */}
    if(action==='move') {
      const rect=this.moveZone.getBoundingClientRect(),root=this.root.getBoundingClientRect();
      this.padX=clamp(event.clientX,rect.left+radius,rect.right-radius)-root.left;
      this.padY=clamp(event.clientY,rect.top+radius,rect.bottom-radius)-root.top;
    }else if(action==='fire'||action==='fire-left')p.touch.firePressed=true;
    else if(action==='jump')p.touch.jump=true;
    else if(action==='crouch')p.touch.crouch=!p.touch.crouch;
    else if(action==='reload')p.pressed.add('KeyR');
    else if(action==='switch') {
      const slot=nextTouchSlot(p.inv,p.slot);if(slot!==null)p.pressed.add('Digit'+(slot+1));
    }
    else if(action==='aim') {
      if(p.weapon?.def.type==='sniper')p.mouse.rp=true;
      else if(p.weapon?.def.type==='melee'){this.meleeIds.add(event.pointerId);this.altOwned=true;}
      else p.touch.aim=!p.touch.aim;
    }
    this.sync();
  }
  move(event) {
    if(!this.state.pointers.has(event.pointerId))return;
    this.consume(event);if(!this.sync())return;
    if(!this.state.move(event.pointerId,event.clientX,event.clientY))return;
    const p=this.player,look=this.state.takeLook();
    p.touchLook||={x:0,y:0};p.touchLook.x+=look.x;p.touchLook.y+=look.y;
    this.applyHeld(p);this.renderState();
  }
  end(event) {
    if(!this.state.pointers.has(event.pointerId))return;
    this.consume(event);const pointer=this.state.end(event.pointerId);this.meleeIds.delete(event.pointerId);
    const target=this.captures.get(event.pointerId);this.captures.delete(event.pointerId);
    try{if(target?.hasPointerCapture?.(event.pointerId))target.releasePointerCapture(event.pointerId);}catch{}
    if(this.player) {
      this.applyHeld(this.player);
      if(event.type==='pointercancel'||event.type==='lostpointercapture') {
        if(!this.state.fireIds.size&&(pointer.action==='fire'||pointer.action==='fire-left'))this.player.touch.firePressed=false;
        if(pointer.action==='jump'&&!this.state.count('jump'))this.player.touch.jump=false;
        if(pointer.action==='aim'&&!this.state.count('aim'))this.player.mouse.rp=false;
      }
    }
    this.renderState();
  }
  applyHeld(p) {
    p.touch.mx=this.state.mx;p.touch.mz=this.state.mz;p.touch.fire=this.state.fireIds.size>0;
    if(this.altOwned){p.mouse.r=this.meleeIds.size>0;if(!p.mouse.r)this.altOwned=false;}
  }
  renderState() {
    if(!this.root)return;
    const p=this.player;
    for(const [action,button]of this.buttons) {
      const pressed=!!(this.state.count(action)||(action==='aim'&&(p?.touch.aim||p?.scoped||p?.mouse.r))||(action==='crouch'&&p?.touch.crouch));
      const disabled=!this.active&&action!=='pause';if(button.disabled!==disabled)button.disabled=disabled;
      setClass(button,'is-active',pressed);
      if(button.getAttribute('aria-pressed')!==String(pressed))button.setAttribute('aria-pressed',String(pressed));
    }
    const moving=this.state.moveId!==null;
    setClass(this.pad,'is-active',moving);setClass(this.knob,'is-active',moving);
    if(moving) {
      setPixel(this.pad,'left',this.padX);setPixel(this.pad,'top',this.padY);
      setPixel(this.knob,'left',this.padX+this.state.knobX);setPixel(this.knob,'top',this.padY+this.state.knobY);
    }else for(const element of [this.pad,this.knob])for(const key of ['left','top'])if(element.style[key])element.style.removeProperty(key);
  }
  reset() {
    this.state.reset();this.meleeIds.clear();
    // Clear ownership before release: lostpointercapture may fire synchronously.
    const captures=[...this.captures];this.captures.clear();
    for(const [id,target]of captures)try{if(target.hasPointerCapture?.(id))target.releasePointerCapture(id);}catch{}
    for(const p of new Set([this.player,this.g.player]))if(p?.touch) {
      Object.assign(p.touch,{mx:0,mz:0,fire:false,firePressed:false,jump:false,crouch:false,aim:false});
      if(p.touchLook)p.touchLook.x=p.touchLook.y=0;
      for(const key of ['KeyR','KeyQ','Digit1','Digit2','Digit3','Digit4'])p.pressed?.delete(key);
      if(p.mouse){p.mouse.rp=false;if(this.altOwned)p.mouse.r=false;}
    }
    this.altOwned=false;this.renderState();
  }
  debugState() {return{...this.state.snapshot(),active:this.active};}
  dispose() {this.reset();for(const [target,type,handler]of this.listeners)target.removeEventListener(type,handler);this.listeners=[];}
}
