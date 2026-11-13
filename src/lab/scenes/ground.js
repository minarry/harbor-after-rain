import {box,floor,label,range,toggle,camera,check} from '../common.js';
export function create(ctx){
  floor(ctx,28,24);
  // A real roof collider lets the same GPU roof atlas reject falling rain.
  box(ctx,[-6,3.2,0],[8,.25,7],ctx.materials.bulkhead.mat);
  for(const x of [-9.7,-2.3])for(const z of [-3.2,3.2])box(ctx,[x,1.5,z],[.18,3,.18],ctx.materials.darkSteel.mat);
  box(ctx,[4,1.3,-5],[6,2.6,2.4],ctx.materials.c0s20.mat);
  const labels=[label(ctx,'雨棚内：遮雨 / 湿度仍可保留',[-6,.2,4.3],5),label(ctx,'露天甲板：落雨 / 溅水 / 波纹',[5,.2,4.3],5)];
  return {cameras:[camera('overview','雨棚与露天',[16,8,18],[0,1,0]),camera('ground','低视角积水',[6,.65,9],[2,.05,1]),camera('shelter','进入雨棚',[-6,1.7,1],[3,1,-2]),camera('ocean','海面波浪',[16,-3,19],[65,-7,36])],
    controls:[range('rain','降雨强度',.85,0,1),range('wetness','积水湿度',.85,0,1),toggle('reflections','平面反射',true)],
    control(k,v){ctx.env.atmosphere.setWeather({[k]:v,immediate:true});},onCamera:id=>labels.forEach(l=>l.visible=id==='overview'),
    checks:()=>[check('雨棚阻挡雨滴',ctx.env.atmosphere.roof.heightAt(-6,0)>3),check('露天地面接收落雨',Math.abs(ctx.env.atmosphere.roof.heightAt(5,0))<.1)],
    metrics:()=>({雨棚高度:ctx.env.atmosphere.roof.heightAt(-6,0).toFixed(2)+' m',降雨:ctx.env.atmosphere.getWeather().rain,湿度:ctx.env.atmosphere.getWeather().wetness})};
}
