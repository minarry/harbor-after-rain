import * as THREE from 'three';
import {buildMap} from '../../map.js';
import {NavGrid} from '../../physics.js';
import {toggle,select,camera,check} from '../common.js';
export function create(ctx){
  const map=ctx.map=buildMap(ctx.scene,ctx.T,ctx.world),b=map.navBounds,nav=new NavGrid(ctx.world,b.x0,b.z0,b.x1,b.z1,.5,.42);
  const paths=new THREE.Group();ctx.scene.add(paths);
  const routeResults=[];
  for(const team of ['BL','GR'])for(const point of map.navigationChecks){
    const spawn=map.spawns[team][0],path=nav.findPath(spawn.x,spawn.z,point.x,point.z);
    routeResults.push({team,name:point.name,reachable:!!path?.length});
    if(!path?.length)continue;
    const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(path.map(([x,z])=>new THREE.Vector3(x,(nav.heightAt(x,z)||0)+.14,z))),new THREE.LineBasicMaterial({color:team==='BL'?0xff8c55:0x65d7ff,depthTest:false,transparent:true,opacity:.65}));line.renderOrder=20;line.userData.team=team;paths.add(line);
  }
  const colliders=new THREE.Group();colliders.visible=false;ctx.scene.add(colliders);
  for(const c of ctx.world.colliders){if(c.tag==='boundary')continue;const e=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(c.hx*2,c.hy*2,c.hz*2)),new THREE.LineBasicMaterial({color:0xffbd63,transparent:true,opacity:.35}));e.position.set(c.x,c.y,c.z);e.rotation.y=c.yaw;colliders.add(e);}
  return {cameras:[camera('overview','战场鸟瞰',[44,55,49],[0,0,0]),camera('lane','右舷通道',[-29,2,16.05],[8,1.7,16.05]),camera('platform','高台与楼梯',[-14,7,20],[0,2.6,16.05]),camera('interior','维修舱',[-26,1.7,15.7],[-18,1.5,15.7])],
    controls:[toggle('routes','导航路线',true),toggle('colliders','碰撞体',false),select('team','查看阵营','both',[{value:'both',label:'双方'},{value:'BL',label:'潜伏者'},{value:'GR',label:'保卫者'}])],
    control(k,v){if(k==='routes')paths.visible=v;if(k==='colliders')colliders.visible=v;if(k==='team')paths.children.forEach(o=>o.visible=v==='both'||o.userData.team===v);},
    checks:()=>[check('双方可到达关键区域',routeResults.every(r=>r.reachable),`${routeResults.filter(r=>r.reachable).length}/${routeResults.length} 条规划路线；实走另由自动测试验证`),check('出生点有站立空间',[...map.spawns.BL,...map.spawns.GR].every(p=>!ctx.world.blocked(p.x,.025,p.z,.36,1.8)))],
    metrics:()=>({可达路线:routeResults.filter(r=>r.reachable).length,关键区域:map.navigationChecks.length,可通行网格:Array.from(nav.block).filter(v=>!v).length}),report:()=>({routeResults})};
}
