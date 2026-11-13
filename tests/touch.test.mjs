import test from 'node:test';
import assert from 'node:assert/strict';
import { TouchInputState, nextTouchSlot } from '../src/touch-state.js';
import { TouchControls } from '../src/touch.js';

test('floating movement begins at zero, ignores jitter and clamps diagonal speed',()=>{
  const state=new TouchInputState();
  state.start(1,'move',13,487,{radius:60});
  assert.equal(state.mx,0);assert.equal(state.mz,0);
  state.move(1,17,483);assert.equal(state.mx,0);assert.equal(state.mz,0);
  state.move(1,73,427);assert.ok(Math.abs(Math.hypot(state.mx,state.mz)-1)<1e-12);
  assert.ok(state.mx>0&&state.mz>0);
  assert.equal(state.start(2,'move',50,300),false,'another finger cannot take the moving thumb');
  state.end(1);assert.equal(state.mx,0);assert.equal(state.mz,0);
});

test('movement and firing aim have separate pointer owners and independent releases',()=>{
  const state=new TouchInputState();state.start(1,'move',70,400);state.start(2,'fire',700,300);state.start(3,'fire-left',200,200);
  state.move(1,110,360);state.move(2,720,290);
  assert.ok(state.mx>0&&state.mz>0);assert.deepEqual(state.takeLook(),{x:32,y:-16});
  state.end(2);assert.deepEqual([...state.fireIds],[3]);assert.equal(state.moveId,1);
  state.end(3);assert.equal(state.fireIds.size,0);assert.ok(state.mx>0);
});

test('look never changes owners on button press and handing off has no stale delta',()=>{
  const state=new TouchInputState();state.start(4,'look',400,100);state.start(5,'fire',750,300);state.start(6,'reload',650,200);
  state.move(5,720,280);state.move(6,300,100);assert.deepEqual(state.takeLook(),{x:0,y:0});
  state.move(4,410,105);assert.deepEqual(state.takeLook(),{x:16,y:8});
  state.end(4);assert.equal(state.lookId,5);
  state.move(5,721,279);assert.deepEqual(state.takeLook(),{x:1.6,y:-1.6});
  state.reset();assert.equal(state.move(5,800,400),false,'cancelled contacts cannot rejoin without a fresh down');
});

test('touch weapon cycling reaches every available slot and skips spent grenades',()=>{
  const inv=[{def:{type:'rifle'}},{def:{type:'pistol'}},{def:{type:'melee'}},{def:{type:'grenade'},mag:1}];
  assert.deepEqual([0,1,2,3].map(slot=>nextTouchSlot(inv,slot)),[1,2,3,0]);
  inv[3].mag=0;assert.equal(nextTouchSlot(inv,2),0);
  assert.equal(nextTouchSlot([inv[0],null,null,null],0),null);
});

class FakeElement extends EventTarget {
  constructor(tag='div') {
    super();this.tagName=tag;this.children=[];this.dataset={};this.attributes=new Map();this.captured=new Set();this.disabled=false;this._className='';this.mutations=0;
    this.style=new Proxy({removeProperty:key=>{delete this.style[key];this.mutations++;}},{set:(object,key,value)=>{this.mutations++;object[key]=value;return true;}});
    this.classList={contains:name=>this._className.split(' ').includes(name),toggle:(name,on)=>{
      const names=new Set(this._className.split(' ').filter(Boolean));on?names.add(name):names.delete(name);this._className=[...names].join(' ');this.mutations++;
    },remove:name=>this.classList.toggle(name,false)};
  }
  set className(value){this._className=value;this.mutations++;}get className(){return this._className;}
  appendChild(element){this.children.push(element);element.parentNode=this;return element;}
  setAttribute(name,value){this.attributes.set(name,String(value));this.mutations++;}
  getAttribute(name){return this.attributes.get(name)??null;}
  setPointerCapture(id){this.captured.add(id);}
  hasPointerCapture(id){return this.captured.has(id);}
  releasePointerCapture(id){this.captured.delete(id);let root=this;while(root.parentNode)root=root.parentNode;root.dispatchEvent(pointer('lostpointercapture',id));}
  getBoundingClientRect(){
    if(this.id==='touch-move-zone')return{left:12,top:160,right:336,bottom:488,width:324,height:328};
    if(this.className.includes('touch-pad'))return{left:0,top:0,right:120,bottom:120,width:120,height:120};
    return{left:0,top:0,right:800,bottom:500,width:800,height:500};
  }
}
function pointer(type,id,x=0,y=0){const event=new Event(type,{bubbles:true,cancelable:true});Object.assign(event,{pointerId:id,pointerType:'touch',button:0,clientX:x,clientY:y});return event;}
function player(){return{alive:true,touch:{mx:0,mz:0,fire:false,firePressed:false,jump:false,crouch:false,aim:false},touchLook:{x:0,y:0},pressed:new Set(),mouse:{r:false,rp:false},weapon:{def:{type:'rifle'}},slot:0,inv:[{def:{type:'rifle'}},{def:{type:'pistol'}},{def:{type:'melee'}},{def:{type:'grenade'},mag:1}]};}
function fixture({enabled=true}={}) {
  const names=['window','document','location','matchMedia'],previous=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  const root=new FakeElement();root.id='touch';root.className='hidden';
  const window=new EventTarget(),document=new EventTarget();document.hidden=false;document.getElementById=id=>id==='touch'?root:null;document.createElement=tag=>new FakeElement(tag);
  Object.assign(globalThis,{window,document,location:{search:''},matchMedia:()=>({matches:enabled})});
  const game={playing:true,paused:false,ended:false,inLoadout:false,player:player(),pause(){this.paused=true;this.touch.reset();}};
  const controls=new TouchControls(game);game.touch=controls;
  return{game,controls,root,window,document,down(action,id,x=700,y=300){const element=action==='move'?controls.moveZone:action==='look'?controls.lookZone:controls.buttons.get(action);const event=pointer('pointerdown',id,x,y);element.dispatchEvent(event);return event;},move(id,x,y){window.dispatchEvent(pointer('pointermove',id,x,y));},up(id){window.dispatchEvent(pointer('pointerup',id));},cancel(id){window.dispatchEvent(pointer('pointercancel',id));},dispose(){controls.dispose();for(const [name,descriptor]of previous)descriptor?Object.defineProperty(globalThis,name,descriptor):delete globalThis[name];}};
}

test('adapter supports two thumbs, multi-finger firing and moving outside a button',()=>{
  const f=fixture();try{
    const p=f.game.player;const down=f.down('move',1,13,487);assert.equal(down.defaultPrevented,true);
    assert.equal(p.touch.mx,0);assert.equal(p.touch.mz,0);assert.equal(f.controls.pad.style.left,'72px','drawing is clamped without changing the input origin');
    f.move(1,17,483);assert.equal(p.touch.mx,0);assert.equal(p.touch.mz,0);
    f.move(1,53,447);f.down('fire',2);f.move(2,500,250);
    assert.ok(p.touch.mx>0&&p.touch.mz>0);assert.equal(p.touch.fire,true);assert.equal(p.touch.firePressed,true);
    assert.deepEqual(p.touchLook,{x:-320,y:-80});
    f.down('fire-left',3,210,200);f.up(2);assert.equal(p.touch.fire,true);
    f.up(3);assert.equal(p.touch.fire,false);assert.ok(p.touch.mx>0);f.up(1);assert.equal(p.touch.mx,0);
  }finally{f.dispose();}
});

test('adapter does not steal a look finger and promotion uses the waiting fire finger position',()=>{
  const f=fixture();try{
    f.down('look',1,450,150);f.down('fire',2,720,300);f.move(2,650,250);
    assert.deepEqual(f.game.player.touchLook,{x:0,y:0});f.move(1,460,155);
    assert.deepEqual(f.game.player.touchLook,{x:16,y:8});f.up(1);f.move(2,651,250);
    assert.deepEqual(f.game.player.touchLook,{x:17.6,y:8});
    f.down('reload',3);f.move(3,400,100);assert.equal(f.controls.debugState().lookId,2);
  }finally{f.dispose();}
});

test('cancel and lost capture clean firing edges while normal quick taps keep their edge',()=>{
  const f=fixture();try{
    const p=f.game.player;f.down('fire',1);f.up(1);assert.equal(p.touch.fire,false);assert.equal(p.touch.firePressed,true);
    f.controls.reset();f.down('fire',2);f.cancel(2);assert.equal(p.touch.fire,false);assert.equal(p.touch.firePressed,false);
    f.down('fire',3);f.down('fire-left',4);f.root.dispatchEvent(pointer('lostpointercapture',3));assert.equal(p.touch.fire,true);
    f.root.dispatchEvent(pointer('lostpointercapture',4));assert.equal(p.touch.fire,false);assert.equal(p.touch.firePressed,false);
    f.controls.reset();f.controls.reset();assert.deepEqual(f.controls.debugState().pointerIds,[]);
  }finally{f.dispose();}
});

test('pause, death, replacement and resize discard old contacts while death keeps pause usable',()=>{
  const f=fixture();try{
    const p=f.game.player;f.down('move',1,100,400);f.move(1,150,350);f.down('fire',2);f.down('crouch',3);
    f.game.paused=true;f.controls.sync();assert.equal(p.touch.fire,false);assert.equal(p.touch.crouch,false);
    f.game.paused=false;f.controls.sync();f.move(1,200,350);f.move(2,600,200);assert.equal(p.touch.mx,0);assert.deepEqual(p.touchLook,{x:0,y:0});
    f.down('fire',4);p.alive=false;f.controls.sync();assert.equal(p.touch.fire,false);assert.equal(f.root.classList.contains('hidden'),false);
    assert.equal(f.controls.buttons.get('fire').disabled,true);assert.equal(f.controls.buttons.get('pause').disabled,false);
    f.down('pause',5);assert.equal(f.game.paused,true);
    f.game.paused=false;f.game.player=player();f.controls.sync();f.move(4,600,100);assert.equal(f.game.player.touch.fire,false);
    f.down('fire',6);f.down('switch',7);assert.ok(f.game.player.pressed.has('Digit2'));
    f.window.dispatchEvent(new Event('resize'));assert.equal(f.game.player.touch.fire,false);assert.equal(f.game.player.pressed.size,0);
    f.move(6,400,100);assert.deepEqual(f.game.player.touchLook,{x:0,y:0});
  }finally{f.dispose();}
});

test('aim preserves rifle toggle, sniper edge and counted melee hold semantics',()=>{
  const f=fixture();try{
    const p=f.game.player;f.down('aim',1);f.up(1);assert.equal(p.touch.aim,true);f.down('aim',2);f.up(2);assert.equal(p.touch.aim,false);
    p.weapon={def:{type:'sniper'}};f.controls.sync();f.down('aim',3);assert.equal(p.mouse.rp,true);f.cancel(3);assert.equal(p.mouse.rp,false);
    p.weapon={def:{type:'melee'}};f.controls.sync();f.down('aim',4);f.down('aim',5);assert.equal(p.mouse.r,true);f.up(4);assert.equal(p.mouse.r,true);f.up(5);assert.equal(p.mouse.r,false);
    f.down('switch',6);assert.ok(p.pressed.has('Digit2'));assert.equal(p.pressed.has('KeyQ'),false);
  }finally{f.dispose();}
});

test('unchanged sync does not rewrite button attributes or joystick styles',()=>{
  const f=fixture();try{
    f.down('move',1,100,400);f.move(1,130,370);
    const elements=[f.root,...f.root.children],before=elements.map(element=>element.mutations);
    for(let frame=0;frame<120;frame++)f.controls.sync();
    assert.deepEqual(elements.map(element=>element.mutations),before);
  }finally{f.dispose();}
});

test('reset and sync are safe when touch controls are disabled',()=>{
  const f=fixture({enabled:false});try{
    assert.equal(f.controls.enabled,false);f.controls.reset();assert.equal(f.controls.sync(),false);f.controls.reset();
  }finally{f.dispose();}
});
