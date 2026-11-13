export const LAB_IDS=Object.freeze(['render','mats','props','level','backdrop','ground','fx','weapon','enemies']);
export const STEP=1/60;
export function parseLabConfig(search){
  const q=new URLSearchParams(search),raw=q.get('lab')||q.get('show')||'render';
  const numeric=(key,fallback,lo,hi)=>{const v=q.get(key);return v!==null&&Number.isFinite(+v)?Math.max(lo,Math.min(hi,+v)):fallback;};
  let controls={};try{const c=JSON.parse(q.get('c')||'{}');if(c&&typeof c==='object'&&!Array.isArray(c))controls=c;}catch{}
  let view=null;try{const v=JSON.parse(q.get('view'));if(Array.isArray(v)&&v.length===7&&v.every(n=>Number.isFinite(n)&&Math.abs(n)<=10000)&&v[6]>=30&&v[6]<=100)view=v;}catch{}
  return {id:LAB_IDS.includes(raw)?raw:'render',seed:numeric('seed',4207,0,4294967295)>>>0,view,
    quality:['high','medium','low'].includes(q.get('q'))?q.get('q'):'high',
    shot:q.get('shot')==='1',time:numeric('t',2,0,30),camera:q.get('cam')||'overview',controls};
}
export function validateControl(def,value){
  if(!def)throw new Error('未知控制项');
  if(def.type==='toggle'){if(typeof value!=='boolean')throw new TypeError('开关需为布尔值');return value;}
  if(def.type==='select'){if(!def.options.some(o=>o.value===value))throw new RangeError('无效选项');return value;}
  if(typeof value!=='number'||!Number.isFinite(value))throw new TypeError('滑块需为有限数值');
  return Math.max(def.min,Math.min(def.max,value));
}
export function withRandom(rng,fn){const previous=Math.random;Math.random=rng;try{return fn();}finally{Math.random=previous;}}
