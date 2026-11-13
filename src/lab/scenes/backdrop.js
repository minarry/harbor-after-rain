import {buildMap} from '../../map.js';
import {range,toggle,select,camera,check} from '../common.js';
export function create(ctx){
  ctx.map=buildMap(ctx.scene,ctx.T,ctx.world);
  return {cameras:[camera('overview','船体与吊机',[105,31,80],[0,4,0]),camera('crane','吊机剪影',[-14,9,24],[-31,18,-9]),camera('waterline','水线视角',[85,-2,46],[7,-2,0]),camera('sunset','远海暮光',[12,6,38],[120,5,180])],
    controls:[range('shipSpeed','航速',6.5,0,14,.5),toggle('clouds','程序云层',true),select('lighting','光照时段','dusk',[{value:'dusk',label:'雨后暮光'},{value:'day',label:'日间'}])],
    control(k,v){if(k==='shipSpeed')ctx.env.shipSpeed=v;if(k==='clouds')ctx.env.clouds.visible=v;if(k==='lighting')ctx.env.apply(v);},
    checks:()=>[check('天空生成环境反射',!!ctx.env.envRT?.texture),check('海面顶点使用真实波浪',!!ctx.env.ocean.material.uniforms.uTime)],
    metrics:()=>({航行距离:ctx.env.shipDist.toFixed(1)+' m',海面高度:ctx.env.waterHeightAt(80,45,ctx.time).toFixed(2)+' m'})};
}
